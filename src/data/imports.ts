import type { DocumentCounts, ImportReceipt, ImportResponse } from '../../shared/api'
import { canonicalJson } from '../../shared/canonical'
import { validateDocument } from '../domain/schema'
import type { DocumentV1, Result } from '../domain/types'
import { failure } from './backups'
import { invalidResponse, record } from './transport'

export function documentCounts(document: DocumentV1): DocumentCounts {
  const { state } = document
  return { inventory: state.inventory.length, accounts: state.accounts.length, debts: state.debts.length, snapshots: state.snapshots.length, snapshotAccounts: state.snapshots.reduce((count, snapshot) => count + snapshot.accounts.length, 0), audit: state.audit.length }
}
export async function fingerprint(value: unknown): Promise<Result<string>> {
  try {
    const bytes = new TextEncoder().encode(canonicalJson(value))
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return { ok: true, value: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') }
  } catch { return failure('STORAGE', 'Браузер не поддерживает безопасную проверку копии. Откройте приложение по защищённому или локальному адресу.') }
}
export function parseReceipt(value: unknown): Result<ImportReceipt> {
  if (!record(value) || typeof value.requestId !== 'string' || !value.requestId || typeof value.datasetId !== 'string' || !value.datasetId || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) || typeof value.committedRevision !== 'number' || !Number.isSafeInteger(value.committedRevision) || value.committedRevision < 0 || !record(value.counts)) return invalidResponse()
  const fields = ['inventory', 'accounts', 'debts', 'snapshots', 'snapshotAccounts', 'audit'] as const
  const counts = value.counts
  for (const field of fields) if (typeof counts[field] !== 'number' || !Number.isSafeInteger(counts[field]) || counts[field] < 0) return invalidResponse()
  return { ok: true, value: { requestId: value.requestId, datasetId: value.datasetId, sourceHash: value.sourceHash, committedRevision: value.committedRevision, counts: counts as DocumentCounts } }
}
export function matchesReceipt(receipt: ImportReceipt, requestId: string, hash: string, counts: DocumentCounts): boolean {
  return receipt.requestId === requestId && receipt.sourceHash === hash && canonicalJson(receipt.counts) === canonicalJson(counts)
}
export function parseImportResponse(value: unknown): Result<ImportResponse> {
  if (!record(value) || typeof value.replayed !== 'boolean') return invalidResponse()
  const document = validateDocument(value.document)
  const receipt = parseReceipt(value.receipt)
  if (!document.ok || !receipt.ok) return invalidResponse()
  if (document.value.revision < receipt.value.committedRevision) return invalidResponse()
  return { ok: true, value: { document: document.value, receipt: receipt.value, replayed: value.replayed } }
}
export type LegacyTransferStatus = Readonly<{ fingerprint: string; requestId: string; transferred: boolean }>
function markerKey(userId: string, hash: string): string { return `tradeledger-legacy-transfer:${userId}:${hash}` }
export async function legacyTransferStatus(userId: string, document: DocumentV1): Promise<Result<LegacyTransferStatus>> {
  const hash = await fingerprint(document)
  if (!hash.ok) return hash
  const requestHash = await fingerprint({ userId, source: 'legacy', sourceHash: hash.value })
  if (!requestHash.ok) return requestHash
  let transferred = false
  try { transferred = globalThis.localStorage?.getItem(markerKey(userId, hash.value)) === hash.value }
  catch { /* Storage restrictions leave migration retryable; the server receipt remains authoritative. */ }
  return { ok: true, value: { fingerprint: hash.value, requestId: `legacy-${requestHash.value}`, transferred } }
}
export function markLegacyTransferred(userId: string, hash: string): void {
  try { globalThis.localStorage?.setItem(markerKey(userId, hash), hash) }
  catch { /* The verified server receipt still proves completion when local markers are unavailable. */ }
}
