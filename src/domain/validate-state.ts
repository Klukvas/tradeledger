import { closingBoundary } from './month-calendar'
import type { Account, AuditEvent, Debt, InventoryItem, LedgerState, Snapshot, SnapshotAccount } from './types'
import { getAccountsTotal, getDebtTotals, getStockTotal } from './selectors'
import { array, commandTypes, directions, id, integer, invalid, isoDate, money, object, oneOf, providers, sum, text, unique } from './validate-core'

export function parseAccount(input: unknown): Account {
  const value = object(input, ['id', 'name', 'owner', 'provider', 'balanceMinor'], 'Счёт')
  return { id: id(value.id), name: text(value.name, 'Название счёта'), owner: text(value.owner, 'Владелец'), provider: oneOf(value.provider, providers, 'Банк'), balanceMinor: money(value.balanceMinor, 'Баланс', -Number.MAX_SAFE_INTEGER) }
}
function parseInventory(input: unknown): InventoryItem {
  const value = object(input, ['id', 'sku', 'name', 'quantity', 'stockValueMinor'], 'Товар')
  const item = { id: id(value.id), sku: text(value.sku, 'Артикул', 80), name: text(value.name, 'Название товара'), quantity: integer(value.quantity, 'Количество'), stockValueMinor: money(value.stockValueMinor, 'Стоимость склада') }
  if (item.quantity === 0 && item.stockValueMinor !== 0) invalid('У товара без остатка должна быть нулевая стоимость.')
  return item
}
function parseDebt(input: unknown): Debt {
  const value = object(input, ['id', 'direction', 'counterparty', 'principalMinor', 'repaidMinor', 'note'], 'Долг')
  const debt = { id: id(value.id), direction: oneOf(value.direction, directions, 'Направление долга'), counterparty: text(value.counterparty, 'Контрагент'), principalMinor: money(value.principalMinor, 'Сумма долга', 1), repaidMinor: money(value.repaidMinor, 'Погашено'), note: text(value.note, 'Примечание', 1000, true) }
  if (debt.repaidMinor > debt.principalMinor) invalid('Погашение превышает сумму долга.')
  return debt
}
function parseSnapshotAccount(input: unknown): SnapshotAccount {
  const value = object(input, ['accountId', 'name', 'owner', 'provider', 'balanceMinor'], 'Счёт в фиксации балансов')
  const account = parseAccount({ id: value.accountId, name: value.name, owner: value.owner, provider: value.provider, balanceMinor: value.balanceMinor })
  return { accountId: account.id, name: account.name, owner: account.owner, provider: account.provider, balanceMinor: account.balanceMinor }
}
function parseSnapshot(input: unknown): Snapshot {
  const hasMonth = Boolean(input && typeof input === 'object' && Object.hasOwn(input, 'closedMonth'))
  const value = object(input, ['id', 'createdAt', 'label', 'accounts', 'totalMinor', ...(hasMonth ? ['closedMonth'] : [])], 'Фиксация балансов')
  const accounts = array(value.accounts, parseSnapshotAccount, 'Счета в фиксации балансов')
  unique(accounts.map((account) => account.accountId), 'Счета в фиксации балансов')
  const totalMinor = money(value.totalMinor, 'Итог фиксации балансов', -Number.MAX_SAFE_INTEGER)
  if (sum(accounts.map((account) => account.balanceMinor)) !== totalMinor) invalid('Итог фиксации балансов не совпадает с суммой счетов.')
  const createdAt = isoDate(value.createdAt)
  const closedMonth = hasMonth ? text(value.closedMonth, 'Месяц закрытия', 7) : undefined
  if (closedMonth !== undefined && closingBoundary(closedMonth)?.getTime() !== Date.parse(createdAt)) invalid('Дата закрытия не совпадает с границей месяца в Киеве.')
  return { id: id(value.id), createdAt, label: text(value.label, 'Название фиксации'), accounts, totalMinor, ...(closedMonth === undefined ? {} : { closedMonth }) }
}
function parseAudit(input: unknown): AuditEvent {
  const value = object(input, ['id', 'at', 'type', 'entityId', 'summary'], 'История')
  return { id: id(value.id), at: isoDate(value.at), type: oneOf(value.type, commandTypes, 'Операция'), entityId: value.entityId === null ? null : id(value.entityId), summary: text(value.summary, 'Описание операции', 1000) }
}

export function checkAggregates(state: LedgerState): void {
  getAccountsTotal(state)
  getStockTotal(state)
  getDebtTotals(state)
}

export function parseState(input: unknown): LedgerState {
  const value = object(input, ['inventory', 'accounts', 'debts', 'snapshots', 'audit'], 'Данные')
  const state: LedgerState = { inventory: array(value.inventory, parseInventory, 'Склад'), accounts: array(value.accounts, parseAccount, 'Счета'), debts: array(value.debts, parseDebt, 'Долги'), snapshots: array(value.snapshots, parseSnapshot, 'Фиксации балансов'), audit: array(value.audit, parseAudit, 'История') }
  for (const entries of [state.inventory, state.accounts, state.debts, state.snapshots, state.audit]) unique(entries.map((entry) => entry.id), 'Идентификаторы')
  unique(state.inventory.map((item) => item.sku.toLowerCase()), 'Артикулы')
  unique(state.snapshots.flatMap((snapshot) => snapshot.closedMonth === undefined ? [] : [snapshot.closedMonth]), 'Закрытые месяцы')
  const accountIds = new Set(state.accounts.map((account) => account.id))
  if (state.snapshots.some((snapshot) => snapshot.accounts.some((account) => !accountIds.has(account.accountId)))) invalid('В фиксации балансов указан неизвестный счёт.')
  for (const event of state.audit) {
    const entries = event.type.startsWith('inventory.') ? state.inventory : event.type.startsWith('account.') ? state.accounts : event.type.startsWith('debt.') ? state.debts : state.snapshots
    if (!event.entityId || !entries.some((entry) => entry.id === event.entityId)) invalid('В истории указана неизвестная запись.')
  }
  checkAggregates(state)
  return state
}
