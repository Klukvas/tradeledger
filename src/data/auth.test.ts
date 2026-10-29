import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicUser } from '../../shared/api'
import { createAuthStore } from './auth'
import { createTransport, type Fetcher } from './transport'

const userA: PublicUser = { id: 'user-a', email: 'a@example.test' }
const userB: PublicUser = { id: 'user-b', email: 'b@example.test' }
const cleanups: Array<() => void> = []
const ok = (value: unknown): Response => new Response(JSON.stringify({ ok: true, value }))
const anonymous = (): Response => new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Session expired' } }), { status: 401 })
function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve: (value: T) => void = () => { throw new Error('Not initialized') }
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function broadcastHarness(): (type: 'session-changed' | 'session-invalidated') => void {
  const channels: Array<{ onmessage: ((event: MessageEvent<unknown>) => void) | null }> = []
  class FakeChannel {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null
    constructor() { channels.push(this) }
    postMessage(): void { /* Incoming peer events are controlled explicitly in these race tests. */ }
    close(): void { this.onmessage = null }
  }
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  return (type) => { channels.forEach((channel) => channel.onmessage?.({ data: { type } } as MessageEvent<unknown>)) }
}
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.unstubAllGlobals() })

describe('queued cross-tab session refresh', () => {
  it.each(['me', 'login'] as const)('waits for pending %s then reads the current session exactly once', async (pendingKind) => {
    const broadcast = broadcastHarness()
    const pending = deferred<Response>()
    let meRequests = 0
    const fetcher = vi.fn<Fetcher>(async (path) => {
      if (String(path).endsWith('/auth/login')) return pending.promise
      meRequests += 1
      if (meRequests === 1) return pendingKind === 'me' ? pending.promise : anonymous()
      return ok({ user: userB })
    })
    const auth = createAuthStore(createTransport(fetcher))
    cleanups.push(auth.destroy)
    const original = pendingKind === 'login' ? (await auth.refresh(), auth.login(userA.email, 'password')) : auth.refresh()
    broadcast('session-changed')
    broadcast('session-changed')
    expect(auth.getSnapshot()).toEqual({ status: 'anonymous' })
    expect(meRequests).toBe(1)
    pending.resolve(ok({ user: userA }))
    await original
    await vi.waitFor(() => expect(auth.getSnapshot()).toEqual({ status: 'authenticated', user: userB }))
    expect(meRequests).toBe(2)
  })
  it.each([
    ['me', 'logout'], ['me', 'session-invalidated'], ['me', 'expire'],
    ['login', 'logout'], ['login', 'session-invalidated'], ['login', 'expire'],
  ] as const)('cancels pending %s refresh after %s without reviving a cookie', async (pendingKind, cancellation) => {
    const broadcast = broadcastHarness()
    const pending = deferred<Response>()
    let meRequests = 0
    const fetcher = vi.fn<Fetcher>(async (path) => {
      if (String(path).endsWith('/auth/login')) return pending.promise
      if (String(path).endsWith('/auth/logout')) return ok(null)
      meRequests += 1
      return pendingKind === 'me' ? pending.promise : anonymous()
    })
    const auth = createAuthStore(createTransport(fetcher))
    cleanups.push(auth.destroy)
    const original = pendingKind === 'login' ? (await auth.refresh(), auth.login(userA.email, 'password')) : auth.refresh()
    broadcast('session-changed')
    const logout = cancellation === 'logout' ? auth.logout() : undefined
    if (cancellation === 'session-invalidated') broadcast('session-invalidated')
    if (cancellation === 'expire') auth.expire(auth.capture())
    pending.resolve(ok({ user: userA }))
    await original
    await logout
    await Promise.resolve()
    expect(auth.getSnapshot().status).toBe('anonymous')
    expect(meRequests).toBe(1)
  })
})


describe('logout expected session identity', () => {
  it('sends the captured A identity after local invalidation so a changed B cookie is preserved', async () => {
    let cookieUser = userA
    let revoked = false
    const fetcher = vi.fn<Fetcher>(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return ok({ user: cookieUser })
      const expectedUser = new Headers(init?.headers).get('X-TradeLedger-User')
      expect(expectedUser).toBe(userA.id)
      if (expectedUser !== cookieUser.id) return anonymous()
      revoked = true
      return ok(null)
    })
    const auth = createAuthStore(createTransport(fetcher), false)
    cleanups.push(auth.destroy)
    await auth.refresh()
    cookieUser = userB
    expect((await auth.logout()).ok).toBe(false)
    expect(revoked).toBe(false)
    expect(auth.getSnapshot().status).toBe('anonymous')
    await auth.refresh()
    expect(auth.getSnapshot()).toEqual({ status: 'authenticated', user: userB })
  })

  it('binds pending-login revocation to the identity returned by that login', async () => {
    const loginResponse = deferred<Response>()
    const fetcher = vi.fn<Fetcher>(async (path, init) => {
      if (String(path).endsWith('/auth/me')) return anonymous()
      if (String(path).endsWith('/auth/login')) return loginResponse.promise
      expect(new Headers(init?.headers).get('X-TradeLedger-User')).toBe(userA.id)
      return ok(null)
    })
    const auth = createAuthStore(createTransport(fetcher), false)
    cleanups.push(auth.destroy)
    await auth.refresh()
    const login = auth.login(userA.email, 'password')
    const logout = auth.logout()
    loginResponse.resolve(ok({ user: userA }))
    expect((await login).ok).toBe(false)
    expect((await logout).ok).toBe(true)
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/auth/logout'))).toHaveLength(1)
    expect(auth.getSnapshot().status).toBe('anonymous')
  })
})
