import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { DEMO_EMAIL, DEMO_ORIGIN, assertDemoTarget, demoDocument, seedPosition } from './seed-demo-data.mjs'

/** Imports a domain-built document through the public API with identity, CSRF and revision checks. */
export async function seedDemo({ password, origin = DEMO_ORIGIN, email = DEMO_EMAIL, fetchImpl = fetch } = {}) {
  assertDemoTarget(origin, email)
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Supply a demo-only password (12–256 characters) through stdin or TRADELEDGER_DEMO_PASSWORD; never use a real account password.')
  }
  const source = demoDocument()
  let cookie = ''
  let userId = ''
  async function request(path, body) {
    const response = await fetchImpl(`${origin}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Origin: origin, 'X-TradeLedger-Request': '1',
        ...(cookie ? { Cookie: cookie } : {}), ...(userId ? { 'X-TradeLedger-User': userId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const session = response.headers.get('set-cookie')
    if (session) cookie = session.split(';', 1)[0]
    const result = await response.json()
    if (!response.ok || result.ok !== true) {
      const error = new Error(`Demo API ${path}: HTTP ${response.status} (${result.error?.code ?? 'INVALID_RESPONSE'}). Data preserved; fix the issue and rerun with the same credentials.`)
      error.status = response.status
      throw error
    }
    return result.value
  }
  let authenticated
  try { authenticated = await request('auth/login', { email, password }) }
  catch (error) {
    if (error.status !== 401) throw error
    authenticated = await request('auth/register', { email, password })
  }
  if (authenticated.user?.email !== DEMO_EMAIL || typeof authenticated.user.id !== 'string' || !cookie) {
    throw new Error('Could not verify demo account identity; no ledger writes performed.')
  }
  userId = authenticated.user.id
  const document = await request('ledger')
  const initialPosition = seedPosition(document, source)
  if (initialPosition === 'empty') {
    await request('ledger/import', { requestId: 'demo-v1-import', expectedRevision: 0, source: 'backup', document: source })
  }
  const persisted = await request('ledger')
  if (seedPosition(persisted, source) !== 'seeded') throw new Error('Demo verification incomplete; rerun with the same credentials.')
  const { inventory, accounts, debts, snapshots, audit } = persisted.state
  return { email, origin, revision: persisted.revision, imported: initialPosition === 'empty',
    counts: { inventory: inventory.length, accounts: accounts.length, debts: debts.length, snapshots: snapshots.length, audit: audit.length } }
}

async function main() {
  if (process.argv.length > 2) throw new Error('No arguments accepted. Supply password only through stdin or TRADELEDGER_DEMO_PASSWORD.')
  let password = process.env.TRADELEDGER_DEMO_PASSWORD
  if (!password) {
    if (process.stdin.isTTY) throw new Error('Pipe a demo-only password through stdin, or set TRADELEDGER_DEMO_PASSWORD.')
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk.toString()
      if (input.length > 1024) throw new Error('Demo password input is too long.')
    }
    password = input.replace(/\r?\n$/, '')
  }
  process.stdout.write(`${JSON.stringify(await seedDemo({ password }))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Avoid echoing server responses, cookies or caller-supplied credentials.
    process.stderr.write('Demo seed failed. Check the local stack, demo credentials and unchanged seed ledger; all existing data is preserved.\n')
    process.exitCode = 1
  })
}
