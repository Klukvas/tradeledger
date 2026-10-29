import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_EMAIL, DEMO_ORIGIN, assertDemoTarget, demoDocument, seedPosition } from './seed-demo-data.mjs'
import { seedDemo } from './seed-demo.mjs'

const emptyDocument = { schemaVersion: 1, revision: 0, updatedAt: '2026-10-01T00:00:00.000Z',
  state: { inventory: [], accounts: [], debts: [], snapshots: [], audit: [] } }

function fakeServer(initial = emptyDocument, { failImport = false, loseImportResponse = false } = {}) {
  let document = structuredClone(initial)
  let imports = 0
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, DEMO_ORIGIN)
    assert.equal(options.headers.Origin, DEMO_ORIGIN)
    assert.equal(options.headers['X-TradeLedger-Request'], '1')
    const path = new URL(url).pathname
    if (path === '/api/auth/login') return Response.json({ ok: true, value: { user: { id: 'demo-user', email: DEMO_EMAIL } } }, {
      headers: { 'set-cookie': 'demo-session=synthetic-test-session; HttpOnly' },
    })
    assert.equal(options.headers['X-TradeLedger-User'], 'demo-user')
    assert.equal(options.headers.Cookie, 'demo-session=synthetic-test-session')
    if (path === '/api/ledger/import') {
      if (failImport) return Response.json({ ok: false, error: { code: 'UNAVAILABLE' } }, { status: 503 })
      const body = JSON.parse(options.body)
      assert.equal(body.expectedRevision, 0)
      assert.equal(body.source, 'backup')
      assert.equal(body.requestId, 'demo-v1-import')
      imports += 1
      document = { ...body.document, revision: 1 }
      if (loseImportResponse) throw new Error('Simulated lost HTTP response')
      return Response.json({ ok: true, value: { document } })
    }
    assert.equal(path, '/api/ledger')
    return Response.json({ ok: true, value: document })
  }
  return { fetchImpl, read: () => structuredClone(document), imports: () => imports }
}

// A generated secret avoids encoding a real or reusable password in the fixture.
const testPassword = (await import('node:crypto')).randomBytes(24).toString('hex')

test('domain-built dataset has historical snapshots, realistic stock and independent financial balances', () => {
  const document = demoDocument()
  assert.deepEqual(demoDocument(), document)
  assert.equal(document.state.inventory.length, 16)
  assert.equal(document.state.accounts.length, 5)
  assert.equal(document.state.debts.length, 6)
  assert.equal(document.state.snapshots.length, 10)
  assert.equal(document.state.audit.length, 95)
  assert.equal(document.state.inventory.filter(item => item.quantity === 0).length, 2)
  assert.ok(document.state.accounts.some(account => account.balanceMinor < 0))
  for (const direction of ['payable', 'receivable']) {
    assert.ok(document.state.debts.some(debt => debt.direction === direction && debt.repaidMinor === debt.principalMinor))
    assert.ok(document.state.debts.some(debt => debt.direction === direction && debt.repaidMinor > 0 && debt.repaidMinor < debt.principalMinor))
  }
  for (const snapshot of document.state.snapshots) {
    assert.equal(snapshot.accounts.length, 5)
    assert.equal(snapshot.totalMinor, snapshot.accounts.reduce((sum, account) => sum + account.balanceMinor, 0))
    assert.equal(new Date(snapshot.createdAt).getUTCDate(), Number(snapshot.label.slice(7, 9)))
  }
  assert.equal(document.state.accounts.reduce((sum, account) => sum + account.balanceMinor, 0), 21994370)
  assert.equal(document.state.inventory.reduce((sum, item) => sum + item.stockValueMinor, 0), 6239953)
})

test('rejects nonloopback, alternate accounts and unexpected arguments before requests', async () => {
  assert.throws(() => assertDemoTarget('https://production.example', DEMO_EMAIL))
  assert.throws(() => assertDemoTarget('http://localhost:5178', DEMO_EMAIL))
  assert.throws(() => assertDemoTarget(DEMO_ORIGIN, 'someone@example.invalid'))
  let calls = 0
  await assert.rejects(seedDemo({ password: testPassword, origin: 'http://127.0.0.1:5180', fetchImpl: async () => { calls += 1 } }))
  assert.equal(calls, 0)
})

test('imports once, then reruns without ledger writes or changing historical dates', async () => {
  const server = fakeServer()
  const first = await seedDemo({ password: testPassword, fetchImpl: server.fetchImpl })
  const saved = server.read()
  const second = await seedDemo({ password: testPassword, fetchImpl: server.fetchImpl })
  assert.equal(first.imported, true)
  assert.equal(second.imported, false)
  assert.equal(server.imports(), 1)
  assert.deepEqual(server.read(), saved)
})

test('refuses any edited or nonseed ledger including empty-but-used accounts', async () => {
  const source = demoDocument()
  const changed = { ...source, revision: 1, state: { ...source.state,
    accounts: source.state.accounts.map((account, index) => index ? account : { ...account, balanceMinor: 1 }) } }
  for (const document of [changed, { ...emptyDocument, revision: 2 }, { ...source, revision: 95 }]) {
    const server = fakeServer(document)
    await assert.rejects(seedDemo({ password: testPassword, fetchImpl: server.fetchImpl }), /differs from the seed/)
    assert.equal(server.imports(), 0)
    assert.deepEqual(server.read(), document)
  }
  assert.throws(() => seedPosition({ ...source, schemaVersion: 2 }))
})

test('failed atomic import leaves ledger pristine and retry can populate it', async () => {
  const failed = fakeServer(emptyDocument, { failImport: true })
  await assert.rejects(seedDemo({ password: testPassword, fetchImpl: failed.fetchImpl }), /HTTP 503/)
  assert.deepEqual(failed.read(), emptyDocument)
  const retry = fakeServer(failed.read())
  assert.equal((await seedDemo({ password: testPassword, fetchImpl: retry.fetchImpl })).imported, true)
})

test('lost response after commit reruns safely without duplicating the imported dataset', async () => {
  const server = fakeServer(emptyDocument, { loseImportResponse: true })
  await assert.rejects(seedDemo({ password: testPassword, fetchImpl: server.fetchImpl }), /lost HTTP response/)
  const retry = await seedDemo({ password: testPassword, fetchImpl: server.fetchImpl })
  assert.equal(retry.imported, false)
  assert.equal(server.imports(), 1)
})
