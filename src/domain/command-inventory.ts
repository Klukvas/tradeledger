import type { Command, LedgerState } from './types'
import { formatMoney } from './money'
import { exactMoney, fail } from './validate-core'

export type Mutation = Readonly<{ state: LedgerState; summary: string }>
type InventoryCommand = Extract<Command, { type: `inventory.${string}` }>

export function changeInventory(state: LedgerState, command: InventoryCommand): Mutation {
  const current = state.inventory.find((item) => item.id === command.id)
  if (command.type === 'inventory.create') {
    if (current) fail('CONFLICT', 'Товар с таким идентификатором уже существует.')
    checkSku(state, command.sku)
    const stockValueMinor = exactMoney(BigInt(command.quantity) * BigInt(command.unitCostMinor))
    const item = { id: command.id, sku: command.sku, name: command.name, quantity: command.quantity, stockValueMinor }
    return { state: { ...state, inventory: [...state.inventory, item] }, summary: `Добавлен товар «${item.name}» (${item.sku}): ${item.quantity} шт., стоимость ${formatMoney(stockValueMinor)}.` }
  }
  if (!current) fail('NOT_FOUND', 'Товар не найден.')
  if (command.type === 'inventory.update') {
    checkSku(state, command.sku, command.id)
    const item = { ...current, sku: command.sku, name: command.name }
    return { state: { ...state, inventory: state.inventory.map((entry) => entry.id === item.id ? item : entry) }, summary: `Товар «${current.name}» (${current.sku}) изменён на «${item.name}» (${item.sku}); остаток ${item.quantity} шт.` }
  }
  const receiving = command.type === 'inventory.receive'
  if (!receiving && command.quantity > current.quantity) fail('VALIDATION', 'Нельзя списать больше товара, чем есть на складе.')
  const quantity = exactMoney(BigInt(current.quantity) + (receiving ? 1n : -1n) * BigInt(command.quantity))
  const valueChange = receiving ? exactMoney(BigInt(command.quantity) * BigInt(command.unitCostMinor)) : issueValue(current.stockValueMinor, current.quantity, command.quantity)
  const stockValueMinor = exactMoney(BigInt(current.stockValueMinor) + (receiving ? 1n : -1n) * BigInt(valueChange))
  const item = { ...current, quantity, stockValueMinor }
  const reason = command.type === 'inventory.issue' ? ` Причина: ${command.reason}.` : ''
  return { state: { ...state, inventory: state.inventory.map((entry) => entry.id === item.id ? item : entry) }, summary: `${receiving ? 'Приход' : 'Расход'} «${item.name}»: ${command.quantity} шт. на ${formatMoney(valueChange)}; остаток ${quantity} шт.${reason}` }
}

function checkSku(state: LedgerState, sku: string, exceptId?: string): void {
  if (state.inventory.some((item) => item.id !== exceptId && item.sku.trim().toLowerCase() === sku.toLowerCase())) fail('CONFLICT', 'Товар с таким артикулом уже существует.')
}

function issueValue(value: number, quantity: number, issued: number): number {
  if (issued === quantity) return value
  const numerator = BigInt(value) * BigInt(issued)
  const denominator = BigInt(quantity)
  return exactMoney((2n * numerator + denominator) / (2n * denominator))
}
