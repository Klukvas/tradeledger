import type { ImportResponse, ImportSource } from '../../shared/api'
import { getMonthlyMoneyChange } from '../domain/monthly-money'
import { kyivMonth, monthKey } from '../domain/month-calendar'
import { canonicalJson } from '../../shared/canonical'
import { validateDocument } from '../domain/schema'
import { parseCommand } from '../domain/validate-command'
import { resultOf } from '../domain/validate-core'
import type { Command, DocumentV1, Failure, LedgerContextValue, Result, StoreSnapshot } from '../domain/types'
import { createAuthStore, type AuthBinding, type AuthStore } from './auth'
import { failure, parseBackup } from './backups'
import { createId } from './ids'
import { documentCounts, fingerprint, legacyTransferStatus, markLegacyTransferred, matchesReceipt, parseImportResponse, parseReceipt, type LegacyTransferStatus } from './imports'
import { createTransport, invalidResponse, record, type Fetcher, type HttpResult, type Transport } from './transport'

export type LedgerStore = Readonly<{
  getSnapshot: () => StoreSnapshot
  subscribe: (listener: () => void) => () => void
  dispatch: LedgerContextValue['dispatch']
  exportBackup: LedgerContextValue['exportBackup']
  importBackup: LedgerContextValue['importBackup']
  refresh: LedgerContextValue['refresh']
  exportServerBackup: () => Promise<Result<string>>
  transferLegacy: (document: DocumentV1, expectedRevision: number, requestId: string) => Promise<Result<ImportResponse>>
  getLegacyTransferStatus: (document: DocumentV1) => Promise<Result<LegacyTransferStatus>>
  destroy: () => void
}>
type StoreOptions = Readonly<{ auth?: AuthStore; transport?: Transport; fetcher?: Fetcher; timeoutMs?: number; listen?: boolean }>
const stale = (): Result<never> => failure('CONFLICT', 'Сессия или данные изменились. Обновите данные и повторите действие.')
const validRevision = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

export function createStore(options: StoreOptions = {}): LedgerStore {
  const transport = options.transport ?? createTransport(options.fetcher, options.timeoutMs)
  const auth = options.auth ?? createAuthStore(transport, options.listen !== false)
  const listeners = new Set<() => void>()
  let snapshot: StoreSnapshot = { status: 'loading' }
  let binding = auth.capture()
  let epoch = 0
  let destroyed = false
  let isBusy = false
  let refreshPromise: Promise<void> | undefined
  let channel: BroadcastChannel | undefined
  let monthTimer: ReturnType<typeof setInterval> | undefined
  let boundaryRetry: ReturnType<typeof setTimeout> | undefined
  let pendingMonthRead: boolean | null = null
  let settledReadEpoch = -1
  let observedMonth = monthKey(kyivMonth(new Date()))
  const importIds = new Map<string, string>()
  const publish = (next: StoreSnapshot): void => { if (!destroyed) { snapshot = next; listeners.forEach((listener) => listener()) } }
  const current = (started: AuthBinding, operationEpoch: number): boolean => !destroyed && auth.isCurrent(started) && started.userId !== null && epoch === operationEpoch
  const showError = (error: Failure): void => {
    if (snapshot.status === 'ready') publish({ ...snapshot, busy: isBusy, error })
    else publish({ status: 'blocked', error, rawBackup: null })
  }
  const accepted = (response: HttpResult, started: AuthBinding, operationEpoch: number): boolean => {
    if (response.status === 401 && auth.isCurrent(started)) { auth.expire(started); return false }
    return current(started, operationEpoch)
  }
  const read = async (started: AuthBinding, operationEpoch: number, error: Failure | null = null): Promise<void> => {
    const response = await transport('/ledger', undefined, started.userId)
    if (!accepted(response, started, operationEpoch)) return
    settledReadEpoch = operationEpoch
    if (!response.result.ok) { showError(response.result.error); return }
    const document = validateDocument(response.result.value)
    if (!document.ok) { showError(invalidResponse().error); return }
    publish({ status: 'ready', document: document.value, busy: isBusy, error })
  }
  const refresh = (): Promise<void> => {
    if (destroyed || !auth.capture().userId || isBusy) return Promise.resolve()
    if (refreshPromise) return refreshPromise
    const started = auth.capture()
    const operationEpoch = ++epoch
    const operation = read(started, operationEpoch)
    refreshPromise = operation
    void operation.finally(() => { if (refreshPromise === operation) refreshPromise = undefined })
    return operation
  }
  const beginMutation = (expectedRevision: number): Result<Readonly<{ started: AuthBinding; operationEpoch: number }>> => {
    if (destroyed || !auth.capture().userId || snapshot.status !== 'ready') return failure('STORAGE', 'Войдите и дождитесь загрузки данных перед изменением.')
    if (isBusy) return failure('CONFLICT', 'Сохранение уже выполняется. Дождитесь завершения.')
    if (!validRevision(expectedRevision)) return failure('VALIDATION', 'Некорректная версия изменений.')
    isBusy = true
    const operationEpoch = ++epoch
    refreshPromise = undefined
    publish({ ...snapshot, busy: true, error: null })
    return { ok: true, value: { started: auth.capture(), operationEpoch } }
  }
  const complete = (started: AuthBinding, operationEpoch: number): void => {
    if (!current(started, operationEpoch)) return
    isBusy = false
    if (snapshot.status === 'ready') publish({ ...snapshot, busy: false })
    if (pendingMonthRead !== null) {
      const allowRetry = pendingMonthRead
      refreshMonth(allowRetry)
    }
  }
  const refreshMonth = (allowRetry: boolean): void => {
    if (destroyed || !auth.capture().userId) return
    pendingMonthRead = pendingMonthRead === true || allowRetry
    if (isBusy) return
    const operation = refresh()
    const requestedEpoch = epoch
    void operation.then(() => {
      // A new mutation may cancel this read. Keep it pending until an accepted read settles.
      if (destroyed || isBusy || epoch !== requestedEpoch || settledReadEpoch !== requestedEpoch || pendingMonthRead === null) return
      const canRetry = pendingMonthRead
      pendingMonthRead = null
      if (canRetry && snapshot.status === 'ready' && !getMonthlyMoneyChange(snapshot.document.state, new Date()).baseline) {
        boundaryRetry = setTimeout(() => { refreshMonth(false) }, 2_000)
      }
    })
  }
  const notify = (userId: string): void => {
    try { channel?.postMessage({ type: 'ledger-changed', userId }) }
    catch { channel?.close(); channel = undefined }
  }
  const mutationFailure = async (response: HttpResult, started: AuthBinding, operationEpoch: number): Promise<Result<never>> => {
    const result = response.result.ok ? invalidResponse() : response.result
    if (response.status === 409) await read(started, operationEpoch, result.error)
    else showError(result.error)
    return result
  }
  const dispatch = async (command: Command, expectedRevision: number): Promise<Result<DocumentV1>> => {
    const parsed = resultOf(() => parseCommand(command))
    if (!parsed.ok) { showError(parsed.error); return parsed }
    const begin = beginMutation(expectedRevision)
    if (!begin.ok) return begin
    const { started, operationEpoch } = begin.value
    try {
      const response = await transport('/ledger/commands', { expectedRevision, command: parsed.value }, started.userId)
      if (!accepted(response, started, operationEpoch)) return stale()
      if (!response.result.ok) return await mutationFailure(response, started, operationEpoch)
      if (!record(response.result.value) || typeof response.result.value.replayed !== 'boolean') { const result = invalidResponse(); showError(result.error); return result }
      const document = validateDocument(response.result.value.document)
      if (!document.ok) { const result = invalidResponse(); showError(result.error); return result }
      publish({ status: 'ready', document: document.value, busy: true, error: null })
      if (started.userId) notify(started.userId)
      return document
    } finally { complete(started, operationEpoch) }
  }
  const importDocument = async (document: DocumentV1, expectedRevision: number, source: ImportSource, requestId: string, sourceHash: string, started: AuthBinding): Promise<Result<ImportResponse>> => {
    if (!auth.isCurrent(started)) return stale()
    const begin = beginMutation(expectedRevision)
    if (!begin.ok) return begin
    const { operationEpoch } = begin.value
    try {
      const response = await transport('/ledger/import', { requestId, expectedRevision, source, document }, started.userId)
      if (!accepted(response, started, operationEpoch)) return stale()
      if (!response.result.ok) return await mutationFailure(response, started, operationEpoch)
      const imported = parseImportResponse(response.result.value)
      const counts = documentCounts(document)
      if (!imported.ok || !matchesReceipt(imported.value.receipt, requestId, sourceHash, counts)) { const result = invalidResponse(); showError(result.error); return result }
      const proof = await transport(`/ledger/imports/${encodeURIComponent(requestId)}`, undefined, started.userId)
      if (!accepted(proof, started, operationEpoch)) return stale()
      const receipt = proof.result.ok ? parseReceipt(proof.result.value) : proof.result
      if (!receipt.ok) { showError(receipt.error); return receipt }
      if (!matchesReceipt(receipt.value, requestId, sourceHash, counts) || canonicalJson(receipt.value) !== canonicalJson(imported.value.receipt)) { const result = invalidResponse(); showError(result.error); return result }
      if (source === 'legacy' && started.userId) markLegacyTransferred(started.userId, sourceHash)
      publish({ status: 'ready', document: imported.value.document, busy: true, error: null })
      if (started.userId) notify(started.userId)
      return imported
    } finally { complete(started, operationEpoch) }
  }
  const importBackup = async (json: string, expectedRevision: number): Promise<Result<DocumentV1>> => {
    const document = parseBackup(json)
    if (!document.ok) { showError(document.error); return document }
    const started = auth.capture()
    if (!started.userId) return stale()
    const hash = await fingerprint(document.value)
    if (!auth.isCurrent(started)) return stale()
    if (!hash.ok) return hash
    const requestId = importIds.get(hash.value) ?? createId()
    importIds.set(hash.value, requestId)
    const result = await importDocument(document.value, expectedRevision, 'backup', requestId, hash.value, started)
    if (result.ok) importIds.delete(hash.value)
    return result.ok ? { ok: true, value: result.value.document } : result
  }
  const transferLegacy = async (input: DocumentV1, expectedRevision: number, requestId: string): Promise<Result<ImportResponse>> => {
    const document = parseBackup(JSON.stringify(input))
    if (!document.ok) return document
    if (!requestId.trim() || requestId.length > 128) return failure('VALIDATION', 'Некорректный идентификатор переноса.')
    const started = auth.capture()
    if (!started.userId) return stale()
    const hash = await fingerprint(document.value)
    if (!auth.isCurrent(started)) return stale()
    if (!hash.ok) return hash
    return importDocument(document.value, expectedRevision, 'legacy', requestId, hash.value, started)
  }
  const exportServerBackup = async (): Promise<Result<string>> => {
    const started = auth.capture()
    const operationEpoch = epoch
    if (!started.userId) return stale()
    const response = await transport('/ledger/export', undefined, started.userId)
    if (!accepted(response, started, operationEpoch)) return stale()
    if (!response.result.ok) return response.result
    const document = validateDocument(response.result.value)
    return document.ok ? { ok: true, value: JSON.stringify(document.value, null, 2) } : invalidResponse()
  }
  const unsubscribeAuth = auth.subscribe(() => {
    const next = auth.capture()
    if (next.generation === binding.generation && next.userId === binding.userId) return
    binding = next
    epoch += 1
    isBusy = false
    pendingMonthRead = null
    if (boundaryRetry !== undefined) clearTimeout(boundaryRetry)
    boundaryRetry = undefined
    refreshPromise = undefined
    importIds.clear()
    publish({ status: 'loading' })
    if (next.userId) void refresh()
  })
  const onFocus = (): void => { void refresh() }
  if (options.listen !== false && typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    monthTimer = setInterval(() => {
      const month = monthKey(kyivMonth(new Date()))
      if (month !== observedMonth) {
        observedMonth = month
        refreshMonth(true)
      }
    }, 60_000)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('tradeledger-server-changes')
        channel.onmessage = (event: MessageEvent<unknown>) => {
          if (record(event.data) && event.data.type === 'ledger-changed' && event.data.userId === auth.capture().userId) void refresh()
        }
      } catch { channel = undefined }
    }
  }
  void refresh()
  return {
    getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } }, dispatch, importBackup, refresh, exportServerBackup, transferLegacy,
    async getLegacyTransferStatus(document) {
      const started = auth.capture()
      if (!started.userId) return stale()
      const parsed = validateDocument(document)
      if (!parsed.ok) return parsed
      const result = await legacyTransferStatus(started.userId, parsed.value)
      return auth.isCurrent(started) ? result : stale()
    },
    exportBackup() { return snapshot.status === 'ready' && auth.capture().userId ? { ok: true, value: JSON.stringify(snapshot.document, null, 2) } : failure('STORAGE', 'Нет доступных данных для резервной копии.') },
    destroy() { destroyed = true; epoch += 1; unsubscribeAuth(); channel?.close(); if (!options.auth) auth.destroy(); if (monthTimer !== undefined) clearInterval(monthTimer); if (boundaryRetry !== undefined) clearTimeout(boundaryRetry); if (typeof window !== 'undefined') { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }; listeners.clear() },
  }
}
