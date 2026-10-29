import type { DocumentV1, Failure, Result } from '../domain/types'
import { failure, MAX_BACKUP_BYTES, rawBackup, readDocument } from './backups'

export type LegacyLedger = Readonly<{ status: 'absent' }> | Readonly<{ status: 'ready'; document: DocumentV1; rawBackup: string }> | Readonly<{ status: 'corrupt'; error: Failure; rawBackup: string | null }>
type LegacyOptions = Readonly<{ factory?: IDBFactory; databaseName?: string; timeoutMs?: number }>
/** Opening without a version and aborting creation keeps a missing legacy database missing. */
export async function readLegacyLedger(options: LegacyOptions = {}): Promise<Result<LegacyLedger>> {
  const factory = options.factory ?? globalThis.indexedDB
  if (!factory) return failure('STORAGE', 'Браузер не предоставляет доступ к прежним локальным данным.')
  return new Promise((resolve) => {
    let finished = false
    let database: IDBDatabase | undefined
    const finish = (result: Result<LegacyLedger>): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      database?.close()
      resolve(result)
    }
    const timer = setTimeout(() => finish(failure('STORAGE', 'Прежнее хранилище не ответило. Закройте другие вкладки и повторите чтение.')), options.timeoutMs ?? 5000)
    try {
      const request = factory.open(options.databaseName ?? 'tradeledger')
      let absent = false
      request.onupgradeneeded = () => { absent = true; request.transaction?.abort() }
      request.onerror = () => finish(absent ? { ok: true, value: { status: 'absent' } } : failure('STORAGE', 'Не удалось прочитать прежнее локальное хранилище. Данные не изменены.'))
      request.onblocked = () => finish(failure('STORAGE', 'Доступ к прежнему хранилищу заблокирован другой вкладкой.'))
      request.onsuccess = () => {
        database = request.result
        if (finished) { database.close(); return }
        if (!database.objectStoreNames.contains('ledger')) { finish({ ok: true, value: { status: 'absent' } }); return }
        const transaction = database.transaction('ledger', 'readonly')
        const read = transaction.objectStore('ledger').get('document')
        let raw: unknown
        read.onsuccess = () => { raw = read.result as unknown }
        transaction.oncomplete = () => {
          if (raw === undefined) { finish({ ok: true, value: { status: 'absent' } }); return }
          const backup = rawBackup(raw)
          const parsed = readDocument(raw)
          if (!parsed.ok) { finish({ ok: true, value: { status: 'corrupt', error: parsed.error, rawBackup: backup } }); return }
          if (backup === null || new TextEncoder().encode(backup).byteLength > MAX_BACKUP_BYTES) {
            finish({ ok: true, value: { status: 'corrupt', error: { code: 'VALIDATION', message: 'Прежняя копия превышает допустимый размер 5 МБ.' }, rawBackup: backup } }); return
          }
          finish({ ok: true, value: { status: 'ready', document: parsed.value, rawBackup: backup } })
        }
        transaction.onabort = () => finish(failure('STORAGE', 'Чтение прежних данных прервано. Исходные данные сохранены.'))
        transaction.onerror = () => finish(failure('STORAGE', 'Не удалось прочитать прежние данные. Исходные данные сохранены.'))
      }
    } catch { finish(failure('STORAGE', 'Не удалось открыть прежние данные. Исходные данные сохранены.')) }
  })
}
