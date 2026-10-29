import { createHash } from 'node:crypto'
import type { DocumentCounts, ImportRequest, ImportReceipt } from '../../../shared/api'
import { canonicalJson } from '../../../shared/canonical'
import { validateDocument } from '../../../src/domain/schema'
import type { DocumentV1 } from '../../../src/domain/types'
import { DomainError, id, integer, object, oneOf } from '../../../src/domain/validate-core'
import type { CommandReceipt } from '../generated/prisma/client'
import { ApiException } from '../http'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export function parseRequestId(input: unknown): string {
  try { return id(input) }
  catch (error) {
    if (error instanceof DomainError) throw new ApiException(400, error.code, error.message)
    throw error
  }
}

export function parseImportRequest(input: unknown): ImportRequest {
  try {
    const value = object(input, ['requestId', 'expectedRevision', 'source', 'document'], 'Импорт')
    const requestId = id(value.requestId)
    const expectedRevision = integer(value.expectedRevision, 'Версия изменений')
    const source = oneOf(value.source, ['backup', 'legacy'] as const, 'Источник')
    const document = validateDocument(value.document)
    if (!document.ok) throw new ApiException(400, document.error.code, document.error.message)
    if (Buffer.byteLength(canonicalJson(document.value), 'utf8') > MAX_IMPORT_BYTES) {
      throw new ApiException(413, 'VALIDATION', 'Резервная копия превышает 5 МиБ.')
    }
    return { requestId, expectedRevision, source, document: document.value }
  } catch (error) {
    if (error instanceof DomainError) throw new ApiException(400, error.code, error.message)
    throw error
  }
}

export function documentCounts(document: DocumentV1): DocumentCounts {
  const { state } = document
  return { inventory: state.inventory.length, accounts: state.accounts.length, debts: state.debts.length,
    snapshots: state.snapshots.length, snapshotAccounts: state.snapshots.reduce((count, snapshot) => count + snapshot.accounts.length, 0), audit: state.audit.length }
}

export function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function storedImportReceipt(receipt: CommandReceipt): ImportReceipt {
  try {
    if (receipt.requestKind !== 'backup' && receipt.requestKind !== 'legacy') throw new Error('kind')
    if (!receipt.sourceHash || !/^[a-f0-9]{64}$/.test(receipt.sourceHash)) throw new Error('hash')
    const fields = ['inventory', 'accounts', 'debts', 'snapshots', 'snapshotAccounts', 'audit'] as const
    const counts = object(receipt.counts, fields, 'Квитанция')
    const revision = Number(receipt.committedRevision)
    return { requestId: receipt.requestId, datasetId: receipt.datasetId, sourceHash: receipt.sourceHash,
      committedRevision: integer(revision, 'Версия изменений'), counts: {
        inventory: integer(counts.inventory, 'Склад'), accounts: integer(counts.accounts, 'Счета'), debts: integer(counts.debts, 'Долги'),
        snapshots: integer(counts.snapshots, 'Фиксации балансов'), snapshotAccounts: integer(counts.snapshotAccounts, 'Счета в фиксациях балансов'), audit: integer(counts.audit, 'История'),
      } }
  } catch {
    throw new ApiException(503, 'UNAVAILABLE', 'Квитанция импорта недоступна.')
  }
}
