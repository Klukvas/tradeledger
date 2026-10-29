import { validateDocument } from '../domain/schema'
import type { DocumentV1, Failure, Result } from '../domain/types'

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024

export function failure(code: Failure['code'], message: string): Readonly<{ ok: false; error: Failure }> {
  return { ok: false, error: { code, message } }
}

export function parseBackup(json: string): Result<DocumentV1> {
  if (json.length > MAX_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) {
    return failure('VALIDATION', 'Резервная копия превышает допустимый размер 5 МБ.')
  }
  try { return validateDocument(JSON.parse(json) as unknown) }
  catch { return failure('VALIDATION', 'Не удалось прочитать JSON резервной копии.') }
}

export function rawBackup(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  try { return JSON.stringify(raw, null, 2) ?? null }
  catch { return null }
}

export function readDocument(raw: unknown): Result<DocumentV1> {
  const result = validateDocument(raw)
  if (result.ok || result.error.code === 'UNSUPPORTED_VERSION') return result
  return failure('CORRUPT', 'Локальные данные повреждены. Сохраните исходную копию перед восстановлением.')
}
