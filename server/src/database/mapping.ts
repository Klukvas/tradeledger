import type { Account, AuditEvent, Debt, DocumentV1, InventoryItem, Snapshot } from '../../../src/domain/types'
import type { Account as AccountRow, AuditEvent as AuditRow, Debt as DebtRow, InventoryItem as InventoryRow, Snapshot as SnapshotRow, SnapshotAccount as SnapshotAccountRow } from '../generated/prisma/client'
import { ApiException } from '../http'
import type { LockedWorkspace } from './types'

export function safeNumber(value: bigint): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new ApiException(500, 'CORRUPT', 'Сохранённые данные выходят за допустимый диапазон.')
  return result
}

export function inventoryFromRow(row: InventoryRow): InventoryItem {
  return { id: row.id, sku: row.sku, name: row.name, quantity: safeNumber(row.quantity), stockValueMinor: safeNumber(row.stockValueMinor) }
}
export function accountFromRow(row: AccountRow): Account {
  if (!['MONO', 'NovaPay', 'other'].includes(row.provider)) throw new ApiException(500, 'CORRUPT', 'Сохранён неверный банк.')
  return { id: row.id, name: row.name, owner: row.owner, provider: row.provider as Account['provider'], balanceMinor: safeNumber(row.balanceMinor) }
}
export function debtFromRow(row: DebtRow): Debt {
  if (!['payable', 'receivable'].includes(row.direction)) throw new ApiException(500, 'CORRUPT', 'Сохранено неверное направление долга.')
  return { id: row.id, direction: row.direction as Debt['direction'], counterparty: row.counterparty, principalMinor: safeNumber(row.principalMinor), repaidMinor: safeNumber(row.repaidMinor), note: row.note }
}
export function snapshotFromRow(row: SnapshotRow, accounts: readonly SnapshotAccountRow[]): Snapshot {
  return { id: row.id, createdAt: row.createdAt, label: row.label, totalMinor: safeNumber(row.totalMinor), ...(row.closedMonth === null ? {} : { closedMonth: row.closedMonth }), accounts: accounts.map((account) => {
    const value = accountFromRow({ ...account, id: account.accountId })
    return { accountId: value.id, name: value.name, owner: value.owner, provider: value.provider, balanceMinor: value.balanceMinor }
  }) }
}
export function auditFromRow(row: AuditRow): AuditEvent {
  return { id: row.id, at: row.at, type: row.type as AuditEvent['type'], entityId: row.entityId, summary: row.summary }
}
export function documentFromRows(workspace: LockedWorkspace, state: DocumentV1['state']): DocumentV1 {
  return { schemaVersion: 1, revision: safeNumber(workspace.revision), updatedAt: workspace.updatedAt.toISOString(), state }
}
