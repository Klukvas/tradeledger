import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthResponse, CommandResponse, DatasetListResponse, ImportResponse } from '../../../shared/api'
import { canonicalJson } from '../../../shared/canonical'
import type { DocumentV1 } from '../../../src/domain/types'
import { historicalDocument } from './fixtures'
import { command, fixturePassword, historicalAt, origin, startHarness, value } from './harness'
import type { Harness } from './harness'

describe('real PostgreSQL / compiled Nest HTTP integration', () => {
  let harness: Harness
  beforeAll(async () => { harness = await startHarness() })
  afterAll(async () => { if (harness) await harness.close() })

  it('runs readiness SQL and limits the runtime role to data access without migration/DDL/delete privileges', async () => {
    expect(value(await harness.get('/health/ready').expect(200))).toEqual({ ready: true })
    const privileges = await harness.sql.query<{ superuser: boolean; create_db: boolean; create_schema: boolean; deletes: boolean; migrations: boolean }>(`
      SELECT rolsuper AS superuser, rolcreatedb AS create_db,
      has_schema_privilege(current_user, 'public', 'CREATE') AS create_schema,
      has_table_privilege(current_user, 'public."Account"', 'DELETE') AS deletes,
      has_table_privilege(current_user, 'public._prisma_migrations', 'SELECT') AS migrations
      FROM pg_roles WHERE rolname = current_user`)
    expect(privileges.rows).toEqual([{ superuser: false, create_db: false, create_schema: false, deletes: false, migrations: false }])
  })

  it('returns a sanitized 503 readiness envelope for an injected database outage and recovers', async () => {
    // Fault injection affects this test application only; the shared PostgreSQL stays running.
    const spy = vi.spyOn(harness.database, '$queryRaw').mockRejectedValueOnce({ code: 'ECONNREFUSED' })
    try {
      const response = await harness.get('/health/ready').expect(503)
      expect(response.body).toEqual({ ok: false, error: { code: 'UNAVAILABLE', message: 'База данных временно недоступна.' } })
    } finally { spy.mockRestore() }
    await harness.get('/health/ready').expect(200)
  })

  it('registers strictly, exposes only public user fields and issues a bounded HttpOnly SameSite cookie', async () => {
    const actor = await harness.register()
    const response = await harness.post('/auth/login', { email: actor.email.toUpperCase(), password: fixturePassword }).expect(200)
    expect(Object.keys(value<AuthResponse>(response).user).sort()).toEqual(['email', 'id'])
    const cookies = response.headers['set-cookie'] as string[] | undefined
    const attributes = (cookies?.[0] ?? '').split(';').slice(1).map((part) => part.trim())
    expect(attributes.includes('HttpOnly')).toBe(true)
    expect(attributes.includes('SameSite=Lax')).toBe(true)
    expect(attributes.includes('Path=/')).toBe(true)
    expect(attributes.includes('Max-Age=604800')).toBe(true)
    expect(attributes.some((part) => part.startsWith('Expires='))).toBe(true)
    expect(attributes.includes('Secure')).toBe(false)
    expect(value<AuthResponse>(await harness.get('/auth/me', actor).expect(200)).user.id).toBe(actor.id)
    expect((await harness.read(actor)).revision).toBe(0)
    for (const body of [
      { email: actor.email, password: fixturePassword, admin: true },
      { email: 'invalid', password: fixturePassword },
      { email: 'short@example.test', password: 'short' },
    ]) await harness.post('/auth/register', body).expect(400)
    await harness.post('/auth/register', { email: actor.email, password: fixturePassword }).expect(409)
    const rows = await harness.database.user.findMany({ where: { id: actor.id }, select: { workspace: { select: { activeDatasetId: true } }, sessions: { select: { tokenHash: true } } } })
    expect(rows.length).toBe(1)
    expect(Boolean(rows[0]?.workspace?.activeDatasetId)).toBe(true)
    expect(rows[0]?.sessions.length).toBe(2)
    // Hashes and tokens are deliberately reduced to booleans before assertions.
    expect(rows[0]?.sessions.every((session) => /^[a-f0-9]{64}$/.test(session.tokenHash))).toBe(true)
    expect(rows[0]?.sessions.every((session) => !actor.cookie.includes(session.tokenHash))).toBe(true)
  })

  it('rejects wrong/unknown credentials and revokes logout sessions in the database', async () => {
    const actor = await harness.register()
    const wrong = await harness.post('/auth/login', { email: actor.email, password: 'wrong-integration-password' }).expect(401)
    const unknown = await harness.post('/auth/login', { email: `${randomUUID()}@example.test`, password: fixturePassword }).expect(401)
    expect(wrong.body).toEqual(unknown.body)
    const logout = await harness.post('/auth/logout', {}, actor).expect(200)
    expect(logout.headers['set-cookie']).toBeUndefined()
    expect(await harness.database.session.count({ where: { userId: actor.id, revokedAt: { not: null } } })).toBe(1)
    await harness.get('/auth/me', actor).expect(401)
    await harness.get('/ledger', actor).expect(401)
  })

  it('rejects expired sessions and every anonymous protected route', async () => {
    const actor = await harness.register()
    await harness.database.session.updateMany({ where: { userId: actor.id }, data: { expiresAt: new Date(0) } })
    await harness.get('/auth/me', actor).expect(401)
    for (const path of ['/auth/me', '/ledger', '/ledger/export', '/ledger/datasets', '/ledger/imports/unknown', `/ledger/datasets/${randomUUID()}/export`]) {
      await harness.get(path).expect(401)
    }
    for (const path of ['/auth/logout', '/ledger/commands', '/ledger/import']) await harness.post(path, {}).expect(401)
  })

  it('checks exact Origin and custom header for all unsafe routes, including public auth/import', async () => {
    const actor = await harness.register()
    for (const path of ['/auth/register', '/auth/login', '/auth/logout', '/ledger/commands', '/ledger/import']) {
      for (const candidate of [undefined, 'null', 'https://foreign.example', `${origin}/`]) {
        const operation = request(harness.app.getHttpServer()).post(`/api${path}`).set('Cookie', actor.cookie).set('X-TradeLedger-Request', '1')
        const response = await (candidate ? operation.set('Origin', candidate) : operation).send({}).expect(403)
        expect(response.body).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
      }
      await request(harness.app.getHttpServer()).post(`/api${path}`).set('Cookie', actor.cookie).set('Origin', origin).send({}).expect(403)
    }
    expect((await harness.read(actor)).revision).toBe(0)
  })

  it('rejects missing or stale expected identity on every protected route without altering the cookie owner', async () => {
    const [alice, bob] = await Promise.all([harness.register(), harness.register()])
    const before = await harness.read(bob)
    for (const expected of [undefined, alice.id]) {
      for (const path of ['/ledger', '/ledger/export', '/ledger/datasets', '/ledger/imports/unknown', `/ledger/datasets/${randomUUID()}/export`]) {
        const operation = request(harness.app.getHttpServer()).get(`/api${path}`).set('Cookie', bob.cookie)
        const response = await (expected ? operation.set('X-TradeLedger-User', expected) : operation).expect(401)
        expect(response.body).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
      }
      for (const path of ['/auth/logout', '/ledger/commands', '/ledger/import']) {
        const operation = request(harness.app.getHttpServer()).post(`/api${path}`).set('Cookie', bob.cookie)
          .set('Origin', origin).set('X-TradeLedger-Request', '1')
        const response = await (expected ? operation.set('X-TradeLedger-User', expected) : operation).send({}).expect(401)
        expect(response.headers['set-cookie']).toBeUndefined()
      }
    }
    expect(await harness.read(bob)).toEqual(before)
    await harness.get('/auth/me', bob).expect(200)
    expect(await harness.database.session.count({ where: { userId: bob.id, revokedAt: null } })).toBe(1)
  })

  it('isolates owners while allowing identical external entity IDs in independent workspaces', async () => {
    const [alice, bob] = await Promise.all([harness.register(), harness.register()])
    await harness.execute(alice, { type: 'account.create', id: 'shared-id', name: 'Alice', owner: 'A', provider: 'MONO', balanceMinor: 100 })
    await harness.execute(bob, { type: 'account.create', id: 'shared-id', name: 'Bob', owner: 'B', provider: 'other', balanceMinor: 200 })
    await harness.execute(alice, { type: 'account.setBalance', id: 'shared-id', balanceMinor: 500 })
    expect((await harness.read(bob)).state.accounts[0]?.balanceMinor).toBe(200)
    expect((await harness.read(alice)).state.accounts[0]?.name).toBe('Alice')
    await harness.execute(alice, { type: 'inventory.create', id: 'alice-only', sku: 'A', name: 'Private', quantity: 1, unitCostMinor: 20 })
    const before = await harness.read(bob)
    await harness.post('/ledger/commands', { expectedRevision: before.revision, command: command({ type: 'inventory.issue', id: 'alice-only', quantity: 1, reason: 'forbidden' }) }, bob).expect(404)
    expect(await harness.read(bob)).toEqual(before)
  })

  it('persists inventory create/update/receive/issue, rounding and server timestamps as normalized history', async () => {
    const actor = await harness.register()
    const earliest = Date.now()
    await harness.execute(actor, { type: 'inventory.create', id: 'item', sku: 'A', name: 'Item', quantity: 3, unitCostMinor: 101 })
    await harness.execute(actor, { type: 'inventory.receive', id: 'item', quantity: 2, unitCostMinor: 104 })
    await harness.execute(actor, { type: 'inventory.issue', id: 'item', quantity: 2, reason: 'integration' })
    const updated = await harness.execute(actor, { type: 'inventory.update', id: 'item', sku: 'B', name: 'Renamed' })
    expect(updated.document.state.inventory).toEqual([{ id: 'item', sku: 'B', name: 'Renamed', quantity: 3, stockValueMinor: 307 }])
    expect(updated.document.state.audit.every((event) => Date.parse(event.at) >= earliest && event.at !== historicalAt)).toBe(true)
    const workspace = await harness.workspace(actor)
    const rows = await harness.sql.query<{ kind: string; quantityDelta: string; valueDeltaMinor: string }>('SELECT kind, "quantityDelta", "valueDeltaMinor" FROM "InventoryMovement" WHERE "datasetId"=$1 ORDER BY "recordedAt", id', [workspace.activeDatasetId])
    expect(rows.rows.map((row) => [row.kind, row.quantityDelta, row.valueDeltaMinor]).sort()).toEqual([
      ['create', '3', '303'], ['issue', '-2', '-204'], ['receive', '2', '208'],
    ].sort())
    await harness.execute(actor, { type: 'inventory.issue', id: 'item', quantity: 3, reason: 'final issue' })
    expect((await harness.read(actor)).state.inventory[0]).toMatchObject({ quantity: 0, stockValueMinor: 0 })
  })

  it('stores signed safe-integer endpoints without computing an overflowing balance delta', async () => {
    const actor = await harness.register()
    await harness.execute(actor, { type: 'account.create', id: 'account', name: 'Account', owner: 'Owner', provider: 'MONO', balanceMinor: Number.MAX_SAFE_INTEGER })
    await harness.execute(actor, { type: 'account.setBalance', id: 'account', balanceMinor: -Number.MAX_SAFE_INTEGER })
    const workspace = await harness.workspace(actor)
    const history = await harness.database.balanceChange.findFirstOrThrow({ where: { datasetId: workspace.activeDatasetId ?? '', kind: 'set_balance' } })
    expect(history.beforeMinor).toBe(BigInt(Number.MAX_SAFE_INTEGER))
    expect(history.afterMinor).toBe(-BigInt(Number.MAX_SAFE_INTEGER))
  })

  it('preserves snapshot account copies after account rename and balance changes', async () => {
    const actor = await harness.register()
    await harness.execute(actor, { type: 'account.create', id: 'account', name: 'Before', owner: 'Owner', provider: 'MONO', balanceMinor: 123 })
    const source = await harness.read(actor)
    const account = source.state.accounts[0]
    if (!account) throw new Error('Missing historical snapshot account')
    const snapshot = { id: 'snapshot', label: 'Immutable', createdAt: historicalAt, totalMinor: 123,
      accounts: [{ accountId: account.id, name: account.name, owner: account.owner, provider: account.provider, balanceMinor: account.balanceMinor }] }
    await harness.post('/ledger/import', { requestId: randomUUID(), expectedRevision: source.revision, source: 'backup',
      document: { ...source, state: { ...source.state, snapshots: [snapshot] } } }, actor).expect(200)
    await harness.execute(actor, { type: 'account.update', id: 'account', name: 'After', owner: 'Other', provider: 'NovaPay' })
    await harness.execute(actor, { type: 'account.setBalance', id: 'account', balanceMinor: -50 })
    expect((await harness.read(actor)).state.snapshots[0]).toEqual(snapshot)
    const workspace = await harness.workspace(actor)
    const row = await harness.database.snapshotAccount.findFirstOrThrow({ where: { datasetId: workspace.activeDatasetId ?? '' } })
    expect({ name: row.name, owner: row.owner, provider: row.provider, balance: row.balanceMinor }).toEqual({ name: 'Before', owner: 'Owner', provider: 'MONO', balance: 123n })
  })

  it('persists debt create/update and partial/full repayments without changing accounts', async () => {
    const actor = await harness.register()
    await harness.execute(actor, { type: 'account.create', id: 'account', name: 'Independent', owner: 'Owner', provider: 'other', balanceMinor: 100 })
    await harness.execute(actor, { type: 'debt.create', id: 'debt', direction: 'receivable', counterparty: 'Before', principalMinor: 500, note: '' })
    await harness.execute(actor, { type: 'debt.update', id: 'debt', counterparty: 'After', principalMinor: 600, note: 'Updated' })
    await harness.execute(actor, { type: 'debt.repay', id: 'debt', amountMinor: 200 })
    await harness.execute(actor, { type: 'debt.repay', id: 'debt', amountMinor: 400 })
    const document = await harness.read(actor)
    expect(document.state.debts[0]).toMatchObject({ principalMinor: 600, repaidMinor: 600, counterparty: 'After' })
    expect(document.state.accounts[0]?.balanceMinor).toBe(100)
    const workspace = await harness.workspace(actor)
    const rows = await harness.database.repayment.findMany({ where: { datasetId: workspace.activeDatasetId ?? '' }, orderBy: { amountMinor: 'asc' } })
    expect(rows.map((row) => row.amountMinor)).toEqual([200n, 400n])
    expect(rows.every((row) => row.kind === 'repay' && row.occurredAt !== null)).toBe(true)
  })

  it('serializes simultaneous distinct CAS commands so exactly one commits', async () => {
    const actor = await harness.register()
    const responses = await Promise.all(['left', 'right'].map((id) => harness.post('/ledger/commands', {
      expectedRevision: 0, command: command({ type: 'account.create', id, name: id, owner: 'Owner', provider: 'other', balanceMinor: 1 }),
    }, actor)))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const document = await harness.read(actor)
    expect(document.revision).toBe(1)
    expect(document.state.accounts).toHaveLength(1)
    expect(document.state.audit).toHaveLength(1)
    const workspace = await harness.workspace(actor)
    expect(await harness.database.commandReceipt.count({ where: { workspaceId: workspace.id } })).toBe(1)
  })

  it('replays concurrent identical requests and stale retries without duplicate history or revision', async () => {
    const actor = await harness.register()
    const operation = command({ type: 'account.create', id: 'account', name: 'Only once', owner: 'Owner', provider: 'MONO', balanceMinor: 10 })
    const body = { expectedRevision: 0, command: operation }
    const responses = await Promise.all([harness.post('/ledger/commands', body, actor), harness.post('/ledger/commands', body, actor)])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(responses.map((response) => value<CommandResponse>(response).replayed).sort()).toEqual([false, true])
    await harness.execute(actor, { type: 'account.setBalance', id: 'account', balanceMinor: 30 })
    const replay = value<CommandResponse>(await harness.post('/ledger/commands', { ...body, command: { ...operation, meta: { ...operation.meta, at: new Date().toISOString() } } }, actor).expect(200))
    expect(replay.replayed).toBe(true)
    expect(replay.document.revision).toBe(2)
    expect(replay.document.state.audit).toHaveLength(2)
    expect(replay.document.state.accounts[0]?.balanceMinor).toBe(30)
    const workspace = await harness.workspace(actor)
    expect(await harness.database.balanceChange.count({ where: { datasetId: workspace.activeDatasetId ?? '' } })).toBe(2)
  })

  it('rejects reused command IDs with changed payload or import request kind', async () => {
    const actor = await harness.register()
    const operation = command({ type: 'account.create', id: 'account', name: 'Original', owner: 'Owner', provider: 'other', balanceMinor: 1 })
    await harness.post('/ledger/commands', { expectedRevision: 0, command: operation }, actor).expect(200)
    await harness.post('/ledger/commands', { expectedRevision: 1, command: { ...operation, name: 'Changed' } }, actor).expect(409)
    await harness.post('/ledger/import', { requestId: operation.meta.commandId, expectedRevision: 1, source: 'backup', document: historicalDocument() }, actor).expect(409)
    expect((await harness.read(actor)).revision).toBe(1)
  })

  it('rolls back normalized rows, history, workspace and receipt after an injected post-persistence failure', async () => {
    const actor = await harness.register()
    const before = await harness.read(actor)
    const persist = harness.repository.persistCommand.bind(harness.repository)
    const spy = vi.spyOn(harness.repository, 'persistCommand').mockImplementationOnce(async (...args) => {
      await persist(...args)
      throw new Error('Integration post-persistence fault')
    })
    try {
      const response = await harness.post('/ledger/commands', { expectedRevision: 0, command: command({ type: 'account.create', id: 'rollback', name: 'Rollback', owner: 'Owner', provider: 'MONO', balanceMinor: 10 }) }, actor).expect(500)
      expect(response.body).toEqual({ ok: false, error: { code: 'STORAGE', message: 'Не удалось выполнить запрос.' } })
    } finally { spy.mockRestore() }
    expect(await harness.read(actor)).toEqual(before)
    const workspace = await harness.workspace(actor)
    for (const count of await Promise.all([
      harness.database.account.count({ where: { datasetId: workspace.activeDatasetId ?? '' } }),
      harness.database.balanceChange.count({ where: { datasetId: workspace.activeDatasetId ?? '' } }),
      harness.database.commandReceipt.count({ where: { workspaceId: workspace.id } }),
    ])) expect(count).toBe(0)
  })

  for (const source of ['backup', 'legacy'] as const) {
    it(`imports ${source} into fresh normalized rows with verified receipt, exact ISO/order and imported opening provenance`, async () => {
      const actor = await harness.register()
      const document = historicalDocument()
      const imported = value<ImportResponse>(await harness.post('/ledger/import', { requestId: randomUUID(), expectedRevision: 0, source, document }, actor).expect(200))
      expect(imported.document.revision).toBe(1)
      expect(imported.document.state).toEqual(document.state)
      expect(imported.receipt.counts).toEqual({ inventory: 2, accounts: 2, debts: 1, snapshots: 1, snapshotAccounts: 2, audit: 2 })
      expect(imported.receipt.sourceHash).toBe(createHash('sha256').update(canonicalJson(document)).digest('hex'))
      expect(value(await harness.get(`/ledger/imports/${imported.receipt.requestId}`, actor).expect(200))).toEqual(imported.receipt)
      expect(value<DocumentV1>(await harness.get('/ledger/export', actor).expect(200))).toEqual(imported.document)
      const datasetId = imported.receipt.datasetId
      const counts = await Promise.all([
        harness.database.inventoryItem.count({ where: { datasetId } }), harness.database.account.count({ where: { datasetId } }),
        harness.database.debt.count({ where: { datasetId } }), harness.database.snapshot.count({ where: { datasetId } }),
        harness.database.snapshotAccount.count({ where: { datasetId } }), harness.database.auditEvent.count({ where: { datasetId } }),
      ])
      expect(counts).toEqual([2, 2, 1, 1, 2, 2])
      const histories = await Promise.all([
        harness.database.inventoryMovement.findMany({ where: { datasetId } }), harness.database.balanceChange.findMany({ where: { datasetId } }), harness.database.repayment.findMany({ where: { datasetId } }),
      ])
      expect(histories.map((rows) => rows.length)).toEqual([2, 2, 1])
      expect(histories.every((rows) => rows.every((row) => row.kind === 'import_opening' && row.occurredAt === null && row.commandId === null))).toBe(true)
    })
  }

  it('archives the exact previous document and never resets global revision; foreign archives/receipts stay invisible', async () => {
    const [actor, foreign] = await Promise.all([harness.register(), harness.register()])
    await harness.execute(actor, { type: 'account.create', id: 'previous', name: 'Previous', owner: 'Owner', provider: 'MONO', balanceMinor: 10 })
    const before = await harness.read(actor)
    const previousWorkspace = await harness.workspace(actor)
    const imported = value<ImportResponse>(await harness.post('/ledger/import', { requestId: randomUUID(), expectedRevision: before.revision, source: 'backup', document: historicalDocument() }, actor).expect(200))
    expect(imported.document.revision).toBe(before.revision + 1)
    expect(imported.receipt.datasetId === previousWorkspace.activeDatasetId).toBe(false)
    await harness.execute(actor, { type: 'account.setBalance', id: 'z-account', balanceMinor: 700 })
    expect(value(await harness.get(`/ledger/datasets/${previousWorkspace.activeDatasetId}/export`, actor).expect(200))).toEqual(before)
    const list = value<DatasetListResponse>(await harness.get('/ledger/datasets', actor).expect(200))
    expect(list.datasets.map((dataset) => dataset.id)).toEqual([previousWorkspace.activeDatasetId])
    await harness.get(`/ledger/datasets/${previousWorkspace.activeDatasetId}/export`, foreign).expect(404)
    await harness.get(`/ledger/imports/${imported.receipt.requestId}`, foreign).expect(404)
    expect(value<DatasetListResponse>(await harness.get('/ledger/datasets', foreign).expect(200)).datasets).toEqual([])
  })

  it('replays import before stale CAS and rejects changed source/payload and imported audit ID collision', async () => {
    const actor = await harness.register()
    const body = { requestId: randomUUID(), expectedRevision: 0, source: 'legacy', document: historicalDocument() }
    const initial = value<ImportResponse>(await harness.post('/ledger/import', body, actor).expect(200))
    await harness.execute(actor, { type: 'account.setBalance', id: 'z-account', balanceMinor: 120 })
    const replay = value<ImportResponse>(await harness.post('/ledger/import', body, actor).expect(200))
    expect(replay.replayed).toBe(true)
    expect(replay.receipt).toEqual(initial.receipt)
    expect(replay.document.revision).toBe(2)
    await harness.post('/ledger/import', { ...body, source: 'backup', expectedRevision: 2 }, actor).expect(409)
    await harness.post('/ledger/import', { ...body, document: { ...body.document, revision: 78 }, expectedRevision: 2 }, actor).expect(409)
    await harness.post('/ledger/commands', { expectedRevision: 2, command: command({ type: 'inventory.update', id: 'z-item', name: 'collision', sku: 'Z' }, 'historical-z') }, actor).expect(409)
    await harness.post('/ledger/commands', { expectedRevision: 2, command: command({ type: 'account.setBalance', id: 'z-account', balanceMinor: 5 }, body.requestId) }, actor).expect(409)
    expect((await harness.read(actor)).revision).toBe(2)
  })

  it('serializes concurrent identical imports into one dataset, receipt and revision', async () => {
    const actor = await harness.register()
    const body = { requestId: randomUUID(), expectedRevision: 0, source: 'backup', document: historicalDocument() }
    const responses = await Promise.all([harness.post('/ledger/import', body, actor), harness.post('/ledger/import', body, actor)])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const results = responses.map((response) => value<ImportResponse>(response))
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true])
    expect(new Set(results.map((result) => result.receipt.datasetId)).size).toBe(1)
    const workspace = await harness.workspace(actor)
    expect(workspace.revision).toBe(1n)
    expect(await harness.database.dataset.count({ where: { workspaceId: workspace.id } })).toBe(2)
    expect(await harness.database.commandReceipt.count({ where: { workspaceId: workspace.id } })).toBe(1)
    expect((await harness.read(actor)).state).toEqual(body.document.state)
  })

  it('rolls back fresh dataset insertion when an import fails before activation', async () => {
    const actor = await harness.register()
    const before = await harness.read(actor)
    const insert = harness.repository.insertDataset.bind(harness.repository)
    const spy = vi.spyOn(harness.repository, 'insertDataset').mockImplementationOnce(async (...args) => {
      await insert(...args)
      throw new Error('Integration post-import fault')
    })
    try { await harness.post('/ledger/import', { requestId: randomUUID(), expectedRevision: 0, source: 'backup', document: historicalDocument() }, actor).expect(500) }
    finally { spy.mockRestore() }
    const workspace = await harness.workspace(actor)
    expect(await harness.read(actor)).toEqual(before)
    expect(await harness.database.dataset.count({ where: { workspaceId: workspace.id } })).toBe(1)
    expect(await harness.database.commandReceipt.count({ where: { workspaceId: workspace.id } })).toBe(0)
  })

  it('enforces the composite active-dataset ownership FK in PostgreSQL', async () => {
    const [alice, bob] = await Promise.all([harness.register(), harness.register()])
    const [left, right] = await Promise.all([harness.workspace(alice), harness.workspace(bob)])
    let rejected = false
    try { await harness.sql.query('UPDATE "Workspace" SET "activeDatasetId"=$1 WHERE id=$2', [right.activeDatasetId, left.id]) }
    catch (error) { rejected = typeof error === 'object' && error !== null && 'code' in error && error.code === '23503' }
    expect(rejected).toBe(true)
    expect((await harness.workspace(alice)).activeDatasetId).toBe(left.activeDatasetId)
  })

  it('rejects malformed JSON and unsafe integers without mutating data; SQL checks reject unsafe direct values', async () => {
    const actor = await harness.register()
    const before = await harness.read(actor)
    await harness.post('/ledger/commands', { expectedRevision: Number.MAX_SAFE_INTEGER + 1, command: command({ type: 'snapshot.create', id: 'invalid', label: 'Invalid' }) }, actor).expect(400)
    await harness.post('/ledger/commands', { expectedRevision: 0, command: command({ type: 'account.create', id: 'invalid', name: 'Invalid', owner: 'Owner', provider: 'other', balanceMinor: Number.MAX_SAFE_INTEGER + 1 }) }, actor).expect(400)
    await harness.post('/ledger/commands', '{malformed', actor).set('Content-Type', 'application/json').expect(400)
    await harness.post('/ledger/import', { requestId: randomUUID(), expectedRevision: 0, source: 'backup', document: { ...historicalDocument(), schemaVersion: 2 } }, actor).expect(400)
    expect(await harness.read(actor)).toEqual(before)
    const workspace = await harness.workspace(actor)
    let rejected = false
    try { await harness.sql.query('UPDATE "Workspace" SET revision=$1 WHERE id=$2', ['9007199254740992', workspace.id]) }
    catch (error) { rejected = typeof error === 'object' && error !== null && 'code' in error && error.code === '23514' }
    expect(rejected).toBe(true)
    expect(await harness.read(actor)).toEqual(before)
  })

  it('rejects the 6 MiB envelope and valid 5 MiB source without changing the active document', async () => {
    const actor = await harness.register()
    const before = await harness.read(actor)
    await harness.post('/ledger/import', { padding: 'x'.repeat(6 * 1024 * 1024) }, actor).expect(413)
    const small = historicalDocument()
    const large: DocumentV1 = { ...small, state: { ...small.state, audit: Array.from({ length: 5_100 }, (_, index) => ({
      id: `oversize-${index}`, at: historicalAt, type: 'inventory.create', entityId: 'z-item', summary: 'x'.repeat(1000),
    })) } }
    expect(Buffer.byteLength(canonicalJson(large)) > 5 * 1024 * 1024).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(large)) < 6 * 1024 * 1024).toBe(true)
    await harness.post('/ledger/import', { requestId: randomUUID(), expectedRevision: 0, source: 'backup', document: large }, actor).expect(413)
    expect(await harness.read(actor)).toEqual(before)
  })
})
