import type { Command } from './types'
import { commandTypes, directions, id, integer, isoDate, money, object, oneOf, providers, text } from './validate-core'

const fields: Record<Command['type'], readonly string[]> = {
  'inventory.create': ['id', 'sku', 'name', 'quantity', 'unitCostMinor'],
  'inventory.update': ['id', 'sku', 'name'],
  'inventory.receive': ['id', 'quantity', 'unitCostMinor'],
  'inventory.issue': ['id', 'quantity', 'reason'],
  'account.create': ['id', 'name', 'owner', 'provider', 'balanceMinor'],
  'account.update': ['id', 'name', 'owner', 'provider'],
  'account.setBalance': ['id', 'balanceMinor'],
  'debt.create': ['id', 'direction', 'counterparty', 'principalMinor', 'note'],
  'debt.update': ['id', 'counterparty', 'principalMinor', 'note'],
  'debt.repay': ['id', 'amountMinor'],
  'snapshot.create': ['id', 'label'],
}

export function parseCommand(input: unknown): Command {
  const raw = input && typeof input === 'object' && 'type' in input ? input.type : undefined
  const type = oneOf(raw, commandTypes, 'Операция')
  const value = object(input, ['type', 'meta', ...fields[type]], 'Операция')
  const rawMeta = object(value.meta, ['commandId', 'at'], 'Дата операции')
  const base = { id: id(value.id), meta: { commandId: id(rawMeta.commandId), at: isoDate(rawMeta.at) } }
  switch (type) {
    case 'inventory.create': return { ...base, type, sku: text(value.sku, 'Артикул', 80), name: text(value.name, 'Название товара'), quantity: integer(value.quantity, 'Количество'), unitCostMinor: money(value.unitCostMinor, 'Закупочная цена') }
    case 'inventory.update': return { ...base, type, sku: text(value.sku, 'Артикул', 80), name: text(value.name, 'Название товара') }
    case 'inventory.receive': return { ...base, type, quantity: integer(value.quantity, 'Количество', 1), unitCostMinor: money(value.unitCostMinor, 'Закупочная цена') }
    case 'inventory.issue': return { ...base, type, quantity: integer(value.quantity, 'Количество', 1), reason: text(value.reason, 'Причина расхода', 300) }
    case 'account.create': return { ...base, type, name: text(value.name, 'Название счёта'), owner: text(value.owner, 'Владелец'), provider: oneOf(value.provider, providers, 'Банк'), balanceMinor: money(value.balanceMinor, 'Баланс', -Number.MAX_SAFE_INTEGER) }
    case 'account.update': return { ...base, type, name: text(value.name, 'Название счёта'), owner: text(value.owner, 'Владелец'), provider: oneOf(value.provider, providers, 'Банк') }
    case 'account.setBalance': return { ...base, type, balanceMinor: money(value.balanceMinor, 'Баланс', -Number.MAX_SAFE_INTEGER) }
    case 'debt.create': return { ...base, type, direction: oneOf(value.direction, directions, 'Направление долга'), counterparty: text(value.counterparty, 'Контрагент'), principalMinor: money(value.principalMinor, 'Сумма долга', 1), note: text(value.note, 'Примечание', 1000, true) }
    case 'debt.update': return { ...base, type, counterparty: text(value.counterparty, 'Контрагент'), principalMinor: money(value.principalMinor, 'Сумма долга', 1), note: text(value.note, 'Примечание', 1000, true) }
    case 'debt.repay': return { ...base, type, amountMinor: money(value.amountMinor, 'Погашение', 1) }
    case 'snapshot.create': return { ...base, type, label: text(value.label, 'Название фиксации') }
  }
}
