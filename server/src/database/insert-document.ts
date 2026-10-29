import type { DocumentV1, Snapshot } from '../../../src/domain/types'
import type { Tx } from './types'

export async function insertSnapshot(tx: Tx, datasetId: string, snapshot: Snapshot, position: number): Promise<void> {
  await tx.snapshot.create({ data: { datasetId, id: snapshot.id, createdAt: snapshot.createdAt, label: snapshot.label, closedMonth: snapshot.closedMonth ?? null, totalMinor: BigInt(snapshot.totalMinor), position } })
  if (snapshot.accounts.length) await tx.snapshotAccount.createMany({ data: snapshot.accounts.map((account, accountPosition) => ({
    ...account, datasetId, snapshotId: snapshot.id, balanceMinor: BigInt(account.balanceMinor), position: accountPosition,
  })) })
}

/** Import rows retain historical data; opening histories are explicitly synthetic aggregates. */
export async function insertDocument(tx: Tx, datasetId: string, document: DocumentV1): Promise<void> {
  const { state } = document
  if (state.inventory.length) {
    await tx.inventoryItem.createMany({ data: state.inventory.map((item, position) => ({ ...item, datasetId, skuKey: item.sku.trim().toLowerCase(), quantity: BigInt(item.quantity), stockValueMinor: BigInt(item.stockValueMinor), position })) })
    await tx.inventoryMovement.createMany({ data: state.inventory.map((item) => ({ datasetId, itemId: item.id, kind: 'import_opening', quantityDelta: BigInt(item.quantity), valueDeltaMinor: BigInt(item.stockValueMinor), resultingQuantity: BigInt(item.quantity), resultingValueMinor: BigInt(item.stockValueMinor) })) })
  }
  if (state.accounts.length) {
    await tx.account.createMany({ data: state.accounts.map((account, position) => ({ ...account, datasetId, balanceMinor: BigInt(account.balanceMinor), position })) })
    await tx.balanceChange.createMany({ data: state.accounts.map((account) => ({ datasetId, accountId: account.id, kind: 'import_opening', beforeMinor: null, afterMinor: BigInt(account.balanceMinor) })) })
  }
  if (state.debts.length) {
    await tx.debt.createMany({ data: state.debts.map((debt, position) => ({ ...debt, datasetId, principalMinor: BigInt(debt.principalMinor), repaidMinor: BigInt(debt.repaidMinor), position })) })
    const repaid = state.debts.filter((debt) => debt.repaidMinor > 0)
    if (repaid.length) await tx.repayment.createMany({ data: repaid.map((debt) => ({ datasetId, debtId: debt.id, kind: 'import_opening', amountMinor: BigInt(debt.repaidMinor) })) })
  }
  if (state.snapshots.length) {
    await tx.snapshot.createMany({ data: state.snapshots.map((snapshot, position) => ({ datasetId, id: snapshot.id, createdAt: snapshot.createdAt, label: snapshot.label, closedMonth: snapshot.closedMonth ?? null, totalMinor: BigInt(snapshot.totalMinor), position })) })
    const snapshotAccounts = state.snapshots.flatMap((snapshot) => snapshot.accounts.map((account, position) => ({ ...account, datasetId, snapshotId: snapshot.id, balanceMinor: BigInt(account.balanceMinor), position })))
    if (snapshotAccounts.length) await tx.snapshotAccount.createMany({ data: snapshotAccounts })
  }
  if (state.audit.length) await tx.auditEvent.createMany({ data: state.audit.map((event, position) => ({ ...event, datasetId, position })) })
}
