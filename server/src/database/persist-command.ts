import type { Command, DocumentV1 } from '../../../src/domain/types'
import { ApiException } from '../http'
import { appendAccountHistory } from './account-history'
import { insertSnapshot } from './insert-document'
import type { Tx } from './types'

export async function persistCommandRows(tx: Tx, datasetId: string, before: DocumentV1, after: DocumentV1, command: Command): Promise<void> {
  const key = { datasetId_id: { datasetId, id: command.id } }
  if (command.type.startsWith('inventory.')) {
    const item = after.state.inventory.find((entry) => entry.id === command.id)
    if (!item) throw new ApiException(500, 'STORAGE', 'Не удалось сохранить товар.')
    if (command.type === 'inventory.create') {
      await tx.inventoryItem.create({ data: { ...item, datasetId, skuKey: item.sku.trim().toLowerCase(), quantity: BigInt(item.quantity), stockValueMinor: BigInt(item.stockValueMinor), position: before.state.inventory.length } })
    } else if (command.type === 'inventory.update') {
      await tx.inventoryItem.update({ where: key, data: { sku: item.sku, skuKey: item.sku.trim().toLowerCase(), name: item.name } })
    } else {
      await tx.inventoryItem.update({ where: key, data: { quantity: BigInt(item.quantity), stockValueMinor: BigInt(item.stockValueMinor) } })
    }
    if (command.type !== 'inventory.update') {
      const previous = before.state.inventory.find((entry) => entry.id === command.id)
      await tx.inventoryMovement.create({ data: {
        datasetId, itemId: item.id, commandId: command.meta.commandId,
        kind: command.type.slice('inventory.'.length), quantityDelta: BigInt(item.quantity) - BigInt(previous?.quantity ?? 0),
        valueDeltaMinor: BigInt(item.stockValueMinor) - BigInt(previous?.stockValueMinor ?? 0),
        resultingQuantity: BigInt(item.quantity), resultingValueMinor: BigInt(item.stockValueMinor),
        reason: command.type === 'inventory.issue' ? command.reason : null, occurredAt: new Date(command.meta.at),
      } })
    }
  } else if (command.type.startsWith('account.')) {
    const account = after.state.accounts.find((entry) => entry.id === command.id)
    if (!account) throw new ApiException(500, 'STORAGE', 'Не удалось сохранить счёт.')
    if (command.type === 'account.create') {
      await tx.account.create({ data: { ...account, datasetId, balanceMinor: BigInt(account.balanceMinor), position: before.state.accounts.length } })
    } else if (command.type === 'account.update') {
      await tx.account.update({ where: key, data: { name: account.name, owner: account.owner, provider: account.provider } })
    } else await tx.account.update({ where: key, data: { balanceMinor: BigInt(account.balanceMinor) } })
    await appendAccountHistory(tx, datasetId, account, BigInt(after.revision), new Date(command.meta.at))
    if (command.type !== 'account.update') await tx.balanceChange.create({ data: {
      datasetId, accountId: account.id, commandId: command.meta.commandId, kind: command.type === 'account.create' ? 'create' : 'set_balance',
      beforeMinor: command.type === 'account.create' ? null : BigInt(before.state.accounts.find((entry) => entry.id === command.id)?.balanceMinor ?? 0),
      afterMinor: BigInt(account.balanceMinor), occurredAt: new Date(command.meta.at),
    } })
  } else if (command.type.startsWith('debt.')) {
    const debt = after.state.debts.find((entry) => entry.id === command.id)
    if (!debt) throw new ApiException(500, 'STORAGE', 'Не удалось сохранить долг.')
    if (command.type === 'debt.create') await tx.debt.create({ data: { ...debt, datasetId, principalMinor: BigInt(debt.principalMinor), repaidMinor: BigInt(debt.repaidMinor), position: before.state.debts.length } })
    else if (command.type === 'debt.update') await tx.debt.update({ where: key, data: { counterparty: debt.counterparty, principalMinor: BigInt(debt.principalMinor), note: debt.note } })
    else await tx.debt.update({ where: key, data: { repaidMinor: BigInt(debt.repaidMinor) } })
    if (command.type === 'debt.repay') await tx.repayment.create({ data: { datasetId, debtId: debt.id, amountMinor: BigInt(command.amountMinor), kind: 'repay', commandId: command.meta.commandId, occurredAt: new Date(command.meta.at) } })
  } else if (command.type === 'snapshot.create') {
    const snapshot = after.state.snapshots.find((entry) => entry.id === command.id)
    if (!snapshot) throw new ApiException(500, 'STORAGE', 'Не удалось зафиксировать балансы.')
    await insertSnapshot(tx, datasetId, snapshot, before.state.snapshots.length)
  }
  const audit = after.state.audit.find((event) => event.id === command.meta.commandId)
  if (!audit || before.state.audit.some((event) => event.id === audit.id)) throw new ApiException(409, 'CONFLICT', 'Операция уже существует в истории.')
  await tx.auditEvent.create({ data: { ...audit, datasetId, position: before.state.audit.length } })
}
