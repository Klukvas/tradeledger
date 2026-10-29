import type { PublicUser } from '../../shared/api'
import type { Result } from '../domain/types'
import { failure } from './backups'
import { invalidResponse, record, type Transport } from './transport'

export type AuthSnapshot = Readonly<{ status: 'loading' }> | Readonly<{ status: 'anonymous'; message?: string }> | Readonly<{ status: 'authenticated'; user: PublicUser }> | Readonly<{ status: 'unavailable'; message: string }>
export type AuthBinding = Readonly<{ generation: number; userId: string | null }>
export type AuthStore = Readonly<{
  getSnapshot: () => AuthSnapshot
  subscribe: (listener: () => void) => () => void
  register: (email: string, password: string) => Promise<Result<PublicUser>>
  login: (email: string, password: string) => Promise<Result<PublicUser>>
  logout: () => Promise<Result<null>>
  refresh: () => Promise<void>
  capture: () => AuthBinding
  isCurrent: (binding: AuthBinding) => boolean
  expire: (binding: AuthBinding) => void
  destroy: () => void
}>
export type AuthContextValue = Pick<AuthStore, 'register' | 'login' | 'logout' | 'refresh'> & Readonly<{ snapshot: AuthSnapshot }>
const superseded = (): Result<never> => failure('CONFLICT', 'Сессия изменилась. Повторите действие после входа.')
function parseUser(value: unknown): Result<PublicUser> {
  if (!record(value) || !record(value.user) || typeof value.user.id !== 'string' || !value.user.id || typeof value.user.email !== 'string' || !value.user.email) return invalidResponse()
  return { ok: true, value: { id: value.user.id, email: value.user.email } }
}

export function createAuthStore(transport: Transport, listen = true): AuthStore {
  let snapshot: AuthSnapshot = { status: 'loading' }
  let generation = 0
  let destroyed = false
  let issuedUserId: string | null = null
  let authOperation: Promise<Result<PublicUser>> | undefined
  let logoutOperation: Promise<Result<null>> | undefined
  let refreshOperation: Promise<void> | undefined
  let queuedRefreshGeneration: number | undefined
  let channel: BroadcastChannel | undefined
  const listeners = new Set<() => void>()
  const publish = (next: AuthSnapshot): void => { if (!destroyed) { snapshot = next; listeners.forEach((listener) => listener()) } }
  const capture = (): AuthBinding => ({ generation, userId: snapshot.status === 'authenticated' ? snapshot.user.id : null })
  const isCurrent = (binding: AuthBinding): boolean => !destroyed && binding.generation === generation && binding.userId === capture().userId
  const broadcast = (type: 'session-invalidated' | 'session-changed' = 'session-invalidated'): void => {
    try { channel?.postMessage({ type }) }
    catch { channel?.close(); channel = undefined }
  }
  const invalidate = (message?: string): void => { queuedRefreshGeneration = undefined; generation += 1; publish({ status: 'anonymous', ...(message ? { message } : {}) }) }
  const drainSessionRefresh = (): void => {
    if (destroyed || authOperation || logoutOperation || refreshOperation || queuedRefreshGeneration === undefined) return
    const requestedGeneration = queuedRefreshGeneration
    queuedRefreshGeneration = undefined
    if (requestedGeneration === generation) void refresh()
  }
  const authenticate = (route: '/auth/login' | '/auth/register', email: string, password: string): Promise<Result<PublicUser>> => {
    if (destroyed) return Promise.resolve(superseded())
    if (authOperation || logoutOperation) return Promise.resolve(failure('CONFLICT', 'Вход или выход уже выполняется. Дождитесь завершения.'))
    queuedRefreshGeneration = undefined
    generation += 1
    publish({ status: 'loading' })
    const started = capture()
    issuedUserId = null
    const operation = (async (): Promise<Result<PublicUser>> => {
      const response = await transport(route, { email, password })
      const result = response.result.ok ? parseUser(response.result.value) : response.status === 401 && route === '/auth/login' ? failure('VALIDATION', 'Неверная почта или пароль.') : response.result
      // Logout may need to revoke this response's cookie even if its UI generation was cancelled.
      issuedUserId = result.ok ? result.value.id : null
      if (!isCurrent(started)) return superseded()
      if (result.ok) { publish({ status: 'authenticated', user: result.value }); broadcast('session-changed') }
      else publish({ status: 'anonymous', message: response.status === 401 ? 'Неверная почта или пароль.' : result.error.message })
      return result
    })()
    authOperation = operation
    void operation.finally(() => { if (authOperation === operation) { authOperation = undefined; drainSessionRefresh() } })
    return operation
  }
  const refresh = (): Promise<void> => {
    if (destroyed || authOperation || logoutOperation) return Promise.resolve()
    if (refreshOperation) return refreshOperation
    queuedRefreshGeneration = undefined
    generation += 1
    publish({ status: 'loading' })
    const started = capture()
    const operation = (async (): Promise<void> => {
      const response = await transport('/auth/me')
      if (!isCurrent(started)) return
      const result = response.result.ok ? parseUser(response.result.value) : response.result
      if (result.ok) publish({ status: 'authenticated', user: result.value })
      else if (response.status === 401) publish({ status: 'anonymous' })
      else publish({ status: 'unavailable', message: result.error.message })
    })()
    refreshOperation = operation
    void operation.finally(() => { if (refreshOperation === operation) { refreshOperation = undefined; drainSessionRefresh() } })
    return operation
  }
  const logout = (): Promise<Result<null>> => {
    if (logoutOperation) return logoutOperation
    const expectedUserId = capture().userId
    invalidate()
    broadcast()
    const started = capture()
    const pendingAuth = authOperation
    const operation = (async (): Promise<Result<null>> => {
      // Login cookies must settle before revocation, otherwise a late login could resurrect a session.
      if (pendingAuth) await pendingAuth
      const logoutUserId = pendingAuth ? issuedUserId : expectedUserId
      if (!logoutUserId) return { ok: true, value: null }
      const response = await transport('/auth/logout', {}, logoutUserId)
      if (!isCurrent(started)) return superseded()
      if (!response.result.ok) { publish({ status: 'anonymous', message: response.result.error.message }); return response.result }
      if (response.result.value !== null) return invalidResponse()
      return { ok: true, value: null }
    })()
    logoutOperation = operation
    void operation.finally(() => { if (logoutOperation === operation) { logoutOperation = undefined; drainSessionRefresh() } })
    return operation
  }
  if (listen && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('tradeledger-session')
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!record(event.data)) return
        if (event.data.type === 'session-invalidated') invalidate()
        if (event.data.type === 'session-changed') { invalidate(); queuedRefreshGeneration = generation; drainSessionRefresh() }
      }
    } catch { channel = undefined }
  }
  const store: AuthStore = {
    getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    register: (email, password) => authenticate('/auth/register', email, password), login: (email, password) => authenticate('/auth/login', email, password), logout, refresh, capture, isCurrent,
    expire(binding) { if (isCurrent(binding)) { invalidate('Сессия завершена. Войдите снова.'); broadcast() } },
    destroy() { destroyed = true; queuedRefreshGeneration = undefined; generation += 1; channel?.close(); listeners.clear() },
  }
  void refresh()
  return store
}
