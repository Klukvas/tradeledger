import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportReceipt, PublicUser } from '../../shared/api'
import type { Command, DocumentV1 } from '../domain/types'
import { createDocument, FIXED_TIME } from '../test/fixtures'
import { createAuthStore, type AuthStore } from './auth'
import { MAX_BACKUP_BYTES, parseBackup } from './backups'
import { documentCounts, fingerprint } from './imports'
import { createStore, type LedgerStore } from './store'
import { createTransport, type Fetcher } from './transport'

const userA: PublicUser = { id: 'user-a', email: 'a@example.test' }
const userB: PublicUser = { id: 'user-b', email: 'b@example.test' }
const cleanups: Array<() => void> = []
const ok = (value: unknown, status = 200): Response => new Response(JSON.stringify({ ok: true, value }), { status })
const error = (status: number, code = 'STORAGE'): Response => new Response(JSON.stringify({ ok: false, error: { code, message: 'private internal details' } }), { status })
function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized') }
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function command(): Command {
  return { type: 'account.create', id: 'account-1', name: 'Расчётный', owner: 'ФОП', provider: 'MONO', balanceMinor: 12550, meta: { commandId: 'command-1', at: FIXED_TIME } }
}
function client(handler: Fetcher): Readonly<{ auth: AuthStore; ledger: LedgerStore }> {
  const transport = createTransport(handler, 1000)
  const auth = createAuthStore(transport, false)
  const ledger = createStore({ auth, transport, listen: false })
  cleanups.push(() => { ledger.destroy(); auth.destroy() })
  return { auth, ledger }
}
function ready(ledger: LedgerStore): DocumentV1 {
  const snapshot = ledger.getSnapshot()
  if (snapshot.status !== 'ready') throw new Error(`Expected ready, got ${snapshot.status}`)
  return snapshot.document
}
async function load(auth: AuthStore, ledger: LedgerStore): Promise<void> { await auth.refresh(); await ledger.refresh() }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); localStorage.clear() })
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('server ledger and session boundary', () => {
  it('does not load or write ledger before authentication', async () => {
    const fetcher = vi.fn<Fetcher>(async () => error(401, 'UNAUTHENTICATED'))
    const { auth, ledger } = client(fetcher)
    await load(auth, ledger)
    expect(auth.getSnapshot()).toEqual({ status: 'anonymous' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await ledger.dispatch(command(), 0)).ok).toBe(false)
    expect(ledger.exportBackup().ok).toBe(false)
  })
  it('loads a validated server document after login with cookie credentials and unsafe header', async () => {
    const fetcher = vi.fn<Fetcher>(async (path) => String(path).endsWith('/auth/me') ? error(401) : String(path).endsWith('/auth/login') ? ok({ user: userA }) : ok(createDocument()))
    const { auth, ledger } = client(fetcher)
    await auth.refresh()
    expect((await auth.login('a@example.test', 'password')).ok).toBe(true)
    await ledger.refresh()
    expect(ready(ledger)).toEqual(createDocument())
    const login = fetcher.mock.calls.find(([path]) => String(path).endsWith('/auth/login'))
    expect(login?.[1]).toMatchObject({ credentials: 'same-origin', method: 'POST', headers: { 'X-TradeLedger-Request': '1' } })
    expect(fetcher.mock.calls.every(([path]) => String(path).startsWith('/api/'))).toBe(true)
  })
  it.each(['command', 'backup', 'legacy', 'read', 'export'] as const)('binds stale A %s to its captured user when the shared cookie silently changes to B', async (kind) => {
    let cookieUser = userA
    let writesForB = 0
    const fetcher = vi.fn<Fetcher>(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: cookieUser })
      const expectedUser = new Headers(init?.headers).get('X-TradeLedger-User')
      if (cookieUser.id === userB.id && expectedUser === null) {
        if (init?.method === 'POST') writesForB += 1
        return ok(createDocument())
      }
      if (expectedUser !== null && expectedUser !== cookieUser.id) return error(401, 'UNAUTHENTICATED')
      return ok(createDocument())
    })
    const { auth, ledger } = client(fetcher)
    await load(auth, ledger)
    expect(ready(ledger).revision).toBe(0)
    cookieUser = userB // No BroadcastChannel notification; both users have revision zero.
    if (kind === 'command') expect((await ledger.dispatch(command(), 0)).ok).toBe(false)
    if (kind === 'backup') expect((await ledger.importBackup(JSON.stringify(createDocument()), 0)).ok).toBe(false)
    if (kind === 'legacy') expect((await ledger.transferLegacy(createDocument(), 0, 'silent-switch')).ok).toBe(false)
    if (kind === 'read') await ledger.refresh()
    if (kind === 'export') expect((await ledger.exportServerBackup()).ok).toBe(false)
    expect(writesForB).toBe(0)
    expect(auth.getSnapshot().status).toBe('anonymous')
    expect(ledger.getSnapshot()).toEqual({ status: 'loading' })
    expect(ledger.exportBackup().ok).toBe(false)
    expect(localStorage.length).toBe(0)
    await auth.refresh()
    await ledger.refresh()
    expect(auth.getSnapshot()).toEqual({ status: 'authenticated', user: userB })
    expect(ready(ledger).revision).toBe(0)
  })
  it('blocks an invalid server document instead of inventing an empty ledger', async () => {
    const { auth, ledger } = client(async (path) => String(path).endsWith('/auth/me') ? ok({ user: userA }) : ok({ bad: 'document' }))
    await load(auth, ledger)
    expect(ledger.getSnapshot().status).toBe('blocked')
    expect(ledger.exportBackup().ok).toBe(false)
  })
  it('keeps the prior document on network failure without optimistic commands', async () => {
    const fetcher = vi.fn<Fetcher>(async (path) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: userA })
      if (String(path).endsWith('/commands')) throw new Error('private hostname')
      return ok(createDocument())
    })
    const { auth, ledger } = client(fetcher)
    await load(auth, ledger)
    const result = await ledger.dispatch(command(), 0)
    expect(result.ok).toBe(false)
    expect(ready(ledger).revision).toBe(0)
    expect(ready(ledger).state.accounts).toHaveLength(0)
    expect(JSON.stringify(result)).not.toContain('hostname')
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/commands'))).toHaveLength(1)
  })
  it('publishes only the validated server mutation document and keeps caller command IDs', async () => {
    const saved = createDocument({ revision: 1 })
    const fetcher = vi.fn<Fetcher>(async (path) => String(path).endsWith('/auth/me') ? ok({ user: userA }) : String(path).endsWith('/commands') ? ok({ document: saved, replayed: false }) : ok(createDocument()))
    const { auth, ledger } = client(fetcher)
    await load(auth, ledger)
    expect(await ledger.dispatch(command(), 0)).toEqual({ ok: true, value: saved })
    expect(ready(ledger)).toEqual(saved)
    const sent = fetcher.mock.calls.find(([path]) => String(path).endsWith('/commands'))?.[1]?.body
    expect(typeof sent === 'string' ? JSON.parse(sent) : null).toEqual({ expectedRevision: 0, command: command() })
  })
  it('refreshes a conflict document while exposing an error for forms to preserve drafts', async () => {
    let revision = 0
    const { auth, ledger } = client(async (path) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: userA })
      if (String(path).endsWith('/commands')) { revision = 3; return error(409, 'CONFLICT') }
      return ok(createDocument({ revision }))
    })
    await load(auth, ledger)
    const result = await ledger.dispatch(command(), 0)
    expect(result.ok ? null : result.error.code).toBe('CONFLICT')
    expect(ready(ledger).revision).toBe(3)
    expect(ledger.getSnapshot()).toMatchObject({ status: 'ready', busy: false, error: { code: 'CONFLICT' } })
  })
  it('clears auth and cached ledger immediately on a 401', async () => {
    const { auth, ledger } = client(async (path) => String(path).endsWith('/auth/me') ? ok({ user: userA }) : String(path).endsWith('/commands') ? error(401, 'UNAUTHENTICATED') : ok(createDocument()))
    await load(auth, ledger)
    await ledger.dispatch(command(), 0)
    expect(auth.getSnapshot().status).toBe('anonymous')
    expect(ledger.getSnapshot()).toEqual({ status: 'loading' })
    expect(ledger.exportBackup().ok).toBe(false)
  })
  it('discards late user A ledger GETs after logout and user B login', async () => {
    const late = deferred<Response>()
    let hold = false
    let user = userA
    const { auth, ledger } = client(async (path) => {
      if (String(path).endsWith('/auth/me')) return ok({ user })
      if (String(path).endsWith('/auth/logout')) return ok(null)
      if (String(path).endsWith('/auth/login')) { user = userB; return ok({ user }) }
      if (hold && user.id === userA.id) return late.promise
      return ok(createDocument({ revision: user.id === userB.id ? 20 : 1 }))
    })
    await load(auth, ledger)
    hold = true
    const pending = ledger.refresh()
    const logout = auth.logout()
    expect(ledger.exportBackup().ok).toBe(false)
    expect(ledger.getSnapshot()).toEqual({ status: 'loading' })
    await logout
    await auth.login(userB.email, 'password')
    await ledger.refresh()
    late.resolve(ok(createDocument({ revision: 999 })))
    await pending
    expect(ready(ledger).revision).toBe(20)
  })
  it.each(['command', 'export', 'import'] as const)('rejects a late %s result after synchronous logout', async (kind) => {
    const late = deferred<Response>()
    let hold = false
    const { auth, ledger } = client(async (path) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: userA })
      if (String(path).endsWith('/auth/logout')) return ok(null)
      if (hold) return late.promise
      return ok(createDocument())
    })
    await load(auth, ledger)
    hold = true
    const pending = kind === 'command' ? ledger.dispatch(command(), 0) : kind === 'export' ? ledger.exportServerBackup() : ledger.importBackup(JSON.stringify(createDocument()), 0)
    await vi.waitFor(() => expect(ledger.getSnapshot().status === 'ready').toBe(true))
    await auth.logout()
    late.resolve(ok({ document: createDocument({ revision: 9 }), replayed: false }))
    expect((await pending).ok).toBe(false)
    expect(ledger.exportBackup().ok).toBe(false)
  })
  it('ignores a late /me response after a newer login', async () => {
    const late = deferred<Response>()
    const { auth, ledger } = client(async (path) => String(path).endsWith('/auth/me') ? late.promise : String(path).endsWith('/auth/login') ? ok({ user: userB }) : ok(createDocument()))
    await auth.login(userB.email, 'password')
    late.resolve(ok({ user: userA }))
    await auth.refresh()
    expect(auth.getSnapshot()).toEqual({ status: 'authenticated', user: userB })
    await ledger.refresh()
  })
  it('revokes a pending login only after its cookie response, without publishing it', async () => {
    const late = deferred<Response>()
    const routes: string[] = []
    const { auth, ledger } = client(async (path) => {
      routes.push(String(path))
      if (String(path).endsWith('/auth/me')) return error(401)
      if (String(path).endsWith('/auth/login')) return late.promise
      return ok(null)
    })
    await auth.refresh()
    const login = auth.login(userA.email, 'password')
    const logout = auth.logout()
    expect(auth.getSnapshot().status).toBe('anonymous')
    expect(routes).not.toContain('/api/auth/logout')
    late.resolve(ok({ user: userA }))
    expect((await login).ok).toBe(false)
    await logout
    expect(routes.at(-1)).toBe('/api/auth/logout')
    expect(ledger.exportBackup().ok).toBe(false)
  })
  it('invalidates other tabs immediately during logout without reloading an unrevoked cookie', async () => {
    const channels: Array<{ name: string; onmessage: ((event: MessageEvent<unknown>) => void) | null }> = []
    class FakeChannel {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      constructor(readonly name: string) { channels.push(this) }
      postMessage(data: unknown): void { for (const peer of channels) if (peer !== this && peer.name === this.name) peer.onmessage?.({ data } as MessageEvent<unknown>) }
      close(): void { this.onmessage = null }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel)
    const revocation = deferred<Response>()
    const fetcher = vi.fn<Fetcher>(async (path) => String(path).endsWith('/auth/me') ? ok({ user: userA }) : String(path).endsWith('/auth/logout') ? revocation.promise : ok(createDocument()))
    const transport = createTransport(fetcher)
    const firstAuth = createAuthStore(transport)
    const secondAuth = createAuthStore(transport)
    const secondLedger = createStore({ auth: secondAuth, transport, listen: false })
    cleanups.push(() => { firstAuth.destroy(); secondAuth.destroy(); secondLedger.destroy() })
    await Promise.all([firstAuth.refresh(), secondAuth.refresh()])
    await secondLedger.refresh()
    expect(secondLedger.exportBackup().ok).toBe(true)
    const callsBefore = fetcher.mock.calls.length
    const pending = firstAuth.logout()
    expect(secondAuth.getSnapshot().status).toBe('anonymous')
    expect(secondLedger.exportBackup().ok).toBe(false)
    expect(fetcher.mock.calls.slice(callsBefore).map(([path]) => String(path))).toEqual(['/api/auth/logout'])
    revocation.resolve(ok(null))
    await pending
    expect(secondAuth.getSnapshot().status).toBe('anonymous')
  })
  it('exports a fresh server read rather than serializing its cached document', async () => {
    const { auth, ledger } = client(async (path) => String(path).endsWith('/auth/me') ? ok({ user: userA }) : ok(createDocument({ revision: String(path).endsWith('/export') ? 5 : 0 })))
    await load(auth, ledger)
    const exported = await ledger.exportServerBackup()
    expect(exported.ok ? JSON.parse(exported.value).revision : null).toBe(5)
    expect(ready(ledger).revision).toBe(0)
  })
})

describe('restore and verified legacy transfer', () => {
  it('reuses a backup request ID after ambiguous network failure and verifies its durable receipt', async () => {
    const source = createDocument()
    const hash = await fingerprint(source)
    if (!hash.ok) throw new Error('Hash unavailable')
    const ids: string[] = []
    let receipt: ImportReceipt | undefined
    const { auth, ledger } = client(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: userA })
      if (String(path).endsWith('/ledger/import')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string }
        ids.push(request.requestId)
        receipt = { requestId: request.requestId, sourceHash: hash.value, counts: documentCounts(source), datasetId: 'dataset-new', committedRevision: 1 }
        if (ids.length === 1) throw new Error('Response lost after commit')
        return ok({ document: createDocument({ revision: 1 }), receipt, replayed: true })
      }
      if (String(path).includes('/imports/')) return ok(receipt)
      return ok(createDocument())
    })
    await load(auth, ledger)
    expect((await ledger.importBackup(JSON.stringify(source), 0)).ok).toBe(false)
    expect(ready(ledger).revision).toBe(0)
    expect((await ledger.importBackup(JSON.stringify(source, null, 2), 0)).ok).toBe(true)
    expect(ids[0]).toBe(ids[1])
    expect(ready(ledger).revision).toBe(1)
  })
  it.each(['post', 'proof'] as const)('does not mark legacy transferred when the %s receipt has wrong counts', async (badReceipt) => {
    const source = createDocument()
    const hash = await fingerprint(source)
    if (!hash.ok) throw new Error('Hash unavailable')
    const valid: ImportReceipt = { requestId: 'legacy-request', datasetId: 'new', sourceHash: hash.value, counts: documentCounts(source), committedRevision: 1 }
    const invalid = { ...valid, counts: { ...valid.counts, snapshotAccounts: 99 } }
    const { auth, ledger } = client(async (path) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: userA })
      if (String(path).endsWith('/ledger/import')) return ok({ document: createDocument({ revision: 1 }), receipt: badReceipt === 'post' ? invalid : valid, replayed: false })
      if (String(path).includes('/imports/')) return ok(badReceipt === 'proof' ? invalid : valid)
      return ok(source)
    })
    await load(auth, ledger)
    expect((await ledger.transferLegacy(source, 0, 'legacy-request')).ok).toBe(false)
    const status = await ledger.getLegacyTransferStatus(source)
    expect(status.ok && status.value.transferred).toBe(false)
    expect(ready(ledger).revision).toBe(0)
  })
  it('marks only a matching user/source fingerprint after persisted receipt verification', async () => {
    const source = createDocument()
    const hash = await fingerprint(source)
    if (!hash.ok) throw new Error('Hash unavailable')
    let receipt: ImportReceipt | undefined
    const { auth, ledger } = client(async (path, init) => {
      if (String(path).endsWith('/auth/me') || String(path).endsWith('/auth/login')) return ok({ user: String(path).endsWith('/auth/login') ? userB : userA })
      if (String(path).endsWith('/auth/logout')) return ok(null)
      if (String(path).endsWith('/ledger/import')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string }
        receipt = { requestId: request.requestId, sourceHash: hash.value, counts: documentCounts(source), datasetId: 'new', committedRevision: 1 }
        return ok({ document: createDocument({ revision: 1 }), receipt, replayed: false })
      }
      if (String(path).includes('/imports/')) return ok(receipt)
      return ok(source)
    })
    await load(auth, ledger)
    const before = await ledger.getLegacyTransferStatus(source)
    if (!before.ok) throw new Error('Status unavailable')
    expect(before.value.transferred).toBe(false)
    expect((await ledger.transferLegacy(source, 0, before.value.requestId)).ok).toBe(true)
    const after = await ledger.getLegacyTransferStatus(source)
    expect(after.ok && after.value.transferred).toBe(true)
    expect(localStorage.length).toBe(1)
    expect(localStorage.getItem(localStorage.key(0) ?? '')).toBe(hash.value)
    await auth.logout()
    await auth.login(userB.email, 'password')
    const other = await ledger.getLegacyTransferStatus(source)
    expect(other.ok && other.value.transferred).toBe(false)
    expect(other.ok && other.value.requestId).not.toBe(before.value.requestId)
  })
  it('discards late durable receipt proof after switching users without marking the source', async () => {
    const source = createDocument()
    const hash = await fingerprint(source)
    if (!hash.ok) throw new Error('Hash unavailable')
    const proof = deferred<Response>()
    let proofRequested = false
    let receipt: ImportReceipt | undefined
    const { auth, ledger } = client(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: userA })
      if (String(path).endsWith('/auth/login')) return ok({ user: userB })
      if (String(path).endsWith('/auth/logout')) return ok(null)
      if (String(path).endsWith('/ledger/import')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string }
        receipt = { requestId: request.requestId, sourceHash: hash.value, counts: documentCounts(source), datasetId: 'new', committedRevision: 1 }
        return ok({ document: createDocument({ revision: 1 }), receipt, replayed: false })
      }
      if (String(path).includes('/imports/')) { proofRequested = true; return proof.promise }
      return ok(createDocument({ revision: 10 }))
    })
    await load(auth, ledger)
    const pending = ledger.transferLegacy(source, 10, 'late-proof')
    await vi.waitFor(() => expect(proofRequested).toBe(true))
    expect(localStorage.length).toBe(0)
    await auth.logout()
    await auth.login(userB.email, 'password')
    await ledger.refresh()
    proof.resolve(ok(receipt))
    expect((await pending).ok).toBe(false)
    expect(localStorage.length).toBe(0)
    expect(ready(ledger).revision).toBe(10)
  })
  it('binds import receipt proof to A when the cookie changes to B after the import commits', async () => {
    const source = createDocument()
    const hash = await fingerprint(source)
    if (!hash.ok) throw new Error('Hash unavailable')
    let cookieUser = userA
    let receipt: ImportReceipt | undefined
    const { auth, ledger } = client(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: cookieUser })
      const expectedUser = new Headers(init?.headers).get('X-TradeLedger-User')
      if (expectedUser !== cookieUser.id) return error(401, 'UNAUTHENTICATED')
      if (String(path).endsWith('/ledger/import')) {
        const request = JSON.parse(String(init?.body)) as { requestId: string }
        receipt = { requestId: request.requestId, sourceHash: hash.value, counts: documentCounts(source), datasetId: 'new', committedRevision: 1 }
        cookieUser = userB
        return ok({ document: createDocument({ revision: 1 }), receipt, replayed: false })
      }
      if (String(path).includes('/imports/')) return ok(receipt)
      return ok(source)
    })
    await load(auth, ledger)
    expect((await ledger.transferLegacy(source, 0, 'switch-before-proof')).ok).toBe(false)
    expect(auth.getSnapshot().status).toBe('anonymous')
    expect(ledger.getSnapshot()).toEqual({ status: 'loading' })
    expect(ledger.exportBackup().ok).toBe(false)
    expect(localStorage.length).toBe(0)
  })
  it('keeps the 5 MiB backup limit and rejects corrupt input before a request', () => {
    expect(parseBackup('invalid').ok).toBe(false)
    expect(parseBackup('x'.repeat(MAX_BACKUP_BYTES + 1)).ok).toBe(false)
    expect(parseBackup(JSON.stringify(createDocument())).ok).toBe(true)
  })
})

describe("automatic monthly close refresh", () => {
  it("reads once on Kyiv month change with one bounded race retry, then stays quiet until focus or visibility resume", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T21:59:30Z"));
    let reads = 0;
    const transport = createTransport(async (path) => {
      if (String(path).endsWith("/auth/me")) return ok({ user: userA });
      reads += 1;
      return ok(createDocument({ revision: reads }));
    });
    const auth = createAuthStore(transport, false);
    const ledger = createStore({ auth, transport });
    cleanups.push(() => {
      ledger.destroy();
      auth.destroy();
    });
    await load(auth, ledger);
    const initial = reads;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toBe(initial + 1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reads).toBe(initial + 2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reads).toBe(initial + 2);
    window.dispatchEvent(new Event("focus"));
    await ledger.refresh();
    expect(reads).toBe(initial + 3);
    document.dispatchEvent(new Event("visibilitychange"));
    await ledger.refresh();
    expect(reads).toBe(initial + 4);
  });
});


it('queues the month-boundary read until a save that outlives both rollover attempts settles', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T21:59:30Z'))
  const account = { id: 'account-1', name: 'Bank', owner: 'Owner', provider: 'MONO' as const, balanceMinor: 15000 }
  const initial = createDocument({ state: { inventory: [], debts: [], audit: [], snapshots: [], accounts: [{ ...account, balanceMinor: 10000 }] } })
  const saved = { ...initial, revision: 1, state: { ...initial.state, accounts: [account] } }
  const closed = { ...saved, revision: 2, state: { ...saved.state, snapshots: [{
    id: 'official-october', label: 'October', closedMonth: '2026-10', createdAt: '2026-10-31T22:00:00.000Z', totalMinor: 15000,
    accounts: [{ accountId: account.id, name: account.name, owner: account.owner, provider: account.provider, balanceMinor: 15000 }],
  }] } }
  const delayed = deferred<Response>()
  let isClosed = false
  let reads = 0
  const transport = createTransport(async (path) => {
    if (String(path).endsWith('/auth/me')) return ok({ user: userA })
    if (String(path).endsWith('/commands')) return delayed.promise
    reads += 1
    return ok(isClosed ? closed : initial)
  }, 120_000)
  const auth = createAuthStore(transport, false)
  const ledger = createStore({ auth, transport })
  cleanups.push(() => { ledger.destroy(); auth.destroy() })
  await load(auth, ledger)
  const initialReads = reads
  const saving = ledger.dispatch({ type: 'account.setBalance', id: account.id, balanceMinor: 15000,
    meta: { commandId: 'slow-before-midnight', at: '2026-10-31T21:59:30Z' } }, 0)
  await vi.advanceTimersByTimeAsync(65_000)
  expect(reads).toBe(initialReads)
  isClosed = true
  delayed.resolve(ok({ document: saved, replayed: false }))
  expect((await saving).ok).toBe(true)
  await vi.waitFor(() => expect(ready(ledger)).toEqual(closed), { timeout: 100, interval: 1 })
  expect(reads).toBe(initialReads + 1)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(reads).toBe(initialReads + 1)
})


it('retains a pending monthly read when a new mutation invalidates the in-flight GET', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T21:59:30Z'))
  const initial = createDocument()
  const saved = { ...initial, revision: 1 }
  const closed = { ...initial, revision: 2, state: { ...initial.state, snapshots: [{
    id: 'empty-october', label: 'October', closedMonth: '2026-10', createdAt: '2026-10-31T22:00:00.000Z', totalMinor: 0, accounts: [],
  }] } }
  const monthlyRead = deferred<Response>()
  const mutation = deferred<Response>()
  let blockMonthRead = false
  let isClosed = false
  let reads = 0
  const transport = createTransport(async (path) => {
    if (String(path).endsWith('/auth/me')) return ok({ user: userA })
    if (String(path).endsWith('/commands')) return mutation.promise
    reads += 1
    if (blockMonthRead) { blockMonthRead = false; return monthlyRead.promise }
    return ok(isClosed ? closed : initial)
  }, 120_000)
  const auth = createAuthStore(transport, false)
  const ledger = createStore({ auth, transport })
  cleanups.push(() => { ledger.destroy(); auth.destroy() })
  await load(auth, ledger)
  const initialReads = reads
  blockMonthRead = true
  await vi.advanceTimersByTimeAsync(60_000)
  const saving = ledger.dispatch(command(), 0)
  monthlyRead.resolve(ok(closed))
  await vi.advanceTimersByTimeAsync(3_000)
  expect(ready(ledger).revision).toBe(0)
  isClosed = true
  mutation.resolve(ok({ document: saved, replayed: false }))
  await saving
  await vi.waitFor(() => expect(ready(ledger)).toEqual(closed), { timeout: 100, interval: 1 })
  expect(reads).toBe(initialReads + 2)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(reads).toBe(initialReads + 2)
})
