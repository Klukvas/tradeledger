import { describe, expect, it } from 'vitest'
import { applyCommand } from './commands'
import { getAccountsTotal, getDebtTotals, getMoneyChange, getStockTotal } from './selectors'
import type { Command, LedgerState } from './types'
import { createEmptyState, FIXED_TIME } from '../test/fixtures'

const meta = (commandId = 'operation-1') => ({ commandId, at: FIXED_TIME })
const inventory = { type: 'inventory.create', id: 'item-1', sku: ' A-1 ', name: ' Кабель ', quantity: 3, unitCostMinor: 100, meta: meta() } satisfies Command
const account = { type: 'account.create', id: 'account-1', name: 'ФОП', owner: 'Анна', provider: 'MONO', balanceMinor: 10000, meta: meta() } satisfies Command
const debt = { type: 'debt.create', id: 'debt-1', direction: 'payable', counterparty: 'Поставщик', principalMinor: 500, note: '', meta: meta() } satisfies Command
function apply(state: LedgerState, command: Command): LedgerState {
  const result = applyCommand(state, command)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
function error(state: LedgerState, command: unknown): string {
  const result = applyCommand(state, command as Command)
  if (result.ok) throw new Error('Ожидалась ошибка')
  return result.error.code
}

describe('inventory commands', () => {
  it('trims names, costs initial quantity and keeps input untouched', () => {
    const empty = createEmptyState()
    const state = apply(empty, inventory)
    expect(state.inventory[0]).toEqual({ id: 'item-1', sku: 'A-1', name: 'Кабель', quantity: 3, stockValueMinor: 300 })
    expect(empty.inventory).toEqual([])
    expect(state.audit[0]).toMatchObject({ id: 'operation-1', entityId: 'item-1', type: 'inventory.create', at: FIXED_TIME })
    expect(state.audit[0]?.summary).toContain('Кабель')
    expect(state.audit[0]?.summary).toContain('3')
  })
  it('combines different purchase prices and rounds proportional issue half up', () => {
    let state = apply(createEmptyState(), { ...inventory, quantity: 1, unitCostMinor: 100 })
    state = apply(state, { type: 'inventory.receive', id: 'item-1', quantity: 1, unitCostMinor: 101, meta: meta('receive') })
    expect(getStockTotal(state)).toBe(201)
    state = apply(state, { type: 'inventory.issue', id: 'item-1', quantity: 1, reason: 'Продажа', meta: meta('issue') })
    expect(state.inventory[0]).toMatchObject({ quantity: 1, stockValueMinor: 100 })
    state = apply(state, { type: 'inventory.issue', id: 'item-1', quantity: 1, reason: 'Продажа', meta: meta('issue-final') })
    expect(state.inventory[0]).toMatchObject({ quantity: 0, stockValueMinor: 0 })
  })
  it('keeps BigInt precision near the monetary limit', () => {
    const state = apply(createEmptyState(), { ...inventory, quantity: 1, unitCostMinor: Number.MAX_SAFE_INTEGER })
    expect(getStockTotal(state)).toBe(Number.MAX_SAFE_INTEGER)
    const issued = apply(state, { type: 'inventory.issue', id: 'item-1', quantity: 1, reason: 'Выдача', meta: meta('issue') })
    expect(getStockTotal(issued)).toBe(0)
  })
  it('uses exact proportional division when a double multiplication is unsafe', () => {
    const state = createEmptyState({ inventory: [{ id: 'i', sku: 'SKU', name: 'Товар', quantity: 3, stockValueMinor: Number.MAX_SAFE_INTEGER }] })
    const next = apply(state, { type: 'inventory.issue', id: 'i', quantity: 2, reason: 'Продажа', meta: meta() })
    expect(next.inventory[0]?.stockValueMinor).toBe(3002399751580330)
  })
  it('allows an empty stock item and zero purchase price', () => {
    const state = apply(createEmptyState(), { ...inventory, quantity: 0 })
    expect(getStockTotal(state)).toBe(0)
    const next = apply(state, { type: 'inventory.receive', id: 'item-1', quantity: 2, unitCostMinor: 0, meta: meta('free') })
    expect(next.inventory[0]).toMatchObject({ quantity: 2, stockValueMinor: 0 })
  })
  it('rejects duplicate SKU ignoring case and surrounding whitespace', () => {
    const state = apply(createEmptyState(), inventory)
    expect(error(state, { ...inventory, id: 'another', sku: ' a-1 ', meta: meta('duplicate') })).toBe('CONFLICT')
  })
  it('rejects renaming another item to a duplicate SKU', () => {
    let state = apply(createEmptyState(), inventory)
    state = apply(state, { ...inventory, id: 'other', sku: 'B', meta: meta('other') })
    expect(error(state, { type: 'inventory.update', id: 'other', sku: 'a-1', name: 'Другое', meta: meta('rename') })).toBe('CONFLICT')
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid issue quantity %s', (quantity) => {
    const state = apply(createEmptyState(), inventory)
    expect(error(state, { type: 'inventory.issue', id: 'item-1', quantity, reason: 'Расход', meta: meta('issue') })).toBe('VALIDATION')
  })
  it('rejects overissue and receive zero without modifying state', () => {
    const state = apply(createEmptyState(), inventory)
    expect(error(state, { type: 'inventory.issue', id: 'item-1', quantity: 4, reason: 'Расход', meta: meta('issue') })).toBe('VALIDATION')
    expect(error(state, { type: 'inventory.receive', id: 'item-1', quantity: 0, unitCostMinor: 1, meta: meta('receive') })).toBe('VALIDATION')
    expect(state.inventory[0]?.quantity).toBe(3)
    expect(state.audit).toHaveLength(1)
  })
  it('rejects cost, quantity and section-total overflow', () => {
    expect(error(createEmptyState(), { ...inventory, quantity: 2, unitCostMinor: Number.MAX_SAFE_INTEGER })).toBe('VALIDATION')
    const state = apply(createEmptyState(), { ...inventory, quantity: Number.MAX_SAFE_INTEGER, unitCostMinor: 0 })
    expect(error(state, { type: 'inventory.receive', id: 'item-1', quantity: 1, unitCostMinor: 0, meta: meta('receive') })).toBe('VALIDATION')
    const costly = apply(createEmptyState(), { ...inventory, quantity: 1, unitCostMinor: Number.MAX_SAFE_INTEGER })
    expect(error(costly, { ...inventory, id: 'other', sku: 'OTHER', quantity: 1, unitCostMinor: 1, meta: meta('other') })).toBe('VALIDATION')
  })
})

describe('accounts, debts and snapshots', () => {
  it('permits negative account balance and prevents aggregate overflow', () => {
    const state = apply(createEmptyState(), { ...account, balanceMinor: -100 })
    expect(getAccountsTotal(state)).toBe(-100)
    const maximum = apply(createEmptyState(), { ...account, balanceMinor: Number.MAX_SAFE_INTEGER })
    expect(error(maximum, { ...account, id: 'other', balanceMinor: 1, meta: meta('other') })).toBe('VALIDATION')
  })
  it('calculates aggregates through cancellation without intermediate overflow', () => {
    const accounts = [Number.MAX_SAFE_INTEGER, 1, -Number.MAX_SAFE_INTEGER].map((balanceMinor, index) => ({ id: `${index}`, name: 'Счёт', owner: 'ФОП', provider: 'MONO' as const, balanceMinor }))
    expect(getAccountsTotal(createEmptyState({ accounts }))).toBe(1)
  })
  it('repays debts independently from bank balances and enforces outstanding amount', () => {
    let state = apply(createEmptyState(), account)
    state = apply(state, { ...debt, meta: meta('debt') })
    state = apply(state, { type: 'debt.repay', id: 'debt-1', amountMinor: 200, meta: meta('repay') })
    expect(getDebtTotals(state)).toEqual({ payable: 300, receivable: 0 })
    expect(getAccountsTotal(state)).toBe(10000)
    expect(error(state, { type: 'debt.repay', id: 'debt-1', amountMinor: 301, meta: meta('excess') })).toBe('VALIDATION')
    expect(error(state, { type: 'debt.update', id: 'debt-1', principalMinor: 199, counterparty: 'Поставщик', note: '', meta: meta('update') })).toBe('VALIDATION')
    state = apply(state, { type: 'debt.update', id: 'debt-1', principalMinor: 200, counterparty: 'Поставщик', note: '', meta: meta('settle') })
    expect(getDebtTotals(state).payable).toBe(0)
  })
  it.each([0, -1, 0.5])('rejects invalid repayment %s', (amountMinor) => {
    const state = apply(createEmptyState(), debt)
    expect(error(state, { type: 'debt.repay', id: 'debt-1', amountMinor, meta: meta('repay') })).toBe('VALIDATION')
  })
  it('checks receivable totals and debt aggregate overflow', () => {
    let state = apply(createEmptyState(), { ...debt, direction: 'receivable', principalMinor: Number.MAX_SAFE_INTEGER })
    expect(getDebtTotals(state).receivable).toBe(Number.MAX_SAFE_INTEGER)
    expect(error(state, { ...debt, id: 'd2', direction: 'receivable', principalMinor: 1, meta: meta('second') })).toBe('VALIDATION')
    state = apply(state, { type: 'debt.repay', id: 'debt-1', amountMinor: Number.MAX_SAFE_INTEGER, meta: meta('repay') })
    expect(getDebtTotals(state).receivable).toBe(0)
  })
  it('copies snapshot accounts and uses append order for money change', () => {
    let state = apply(createEmptyState(), account)
    expect(getMoneyChange(state)).toBeNull()
    state = apply(state, { type: 'snapshot.create', id: 's1', label: 'Январь', meta: meta('snapshot') })
    const originalSnapshot = state.snapshots[0]
    state = apply(state, { type: 'account.setBalance', id: 'account-1', balanceMinor: 20000, meta: meta('balance') })
    expect(getMoneyChange(state)).toBe(10000)
    expect(originalSnapshot?.accounts[0]?.balanceMinor).toBe(10000)
    expect(originalSnapshot?.accounts[0]).not.toBe(state.accounts[0])
    state = apply(state, { type: 'snapshot.create', id: 's2', label: 'Апрель', meta: { commandId: 'snapshot2', at: '2025-01-01T00:00:00.000Z' } })
    expect(getMoneyChange(state)).toBe(0)
    expect(state.snapshots[0]).toBe(originalSnapshot)
  })
  it('accepts a safe balance when a derived historical difference overflows', () => {
    let state = apply(createEmptyState(), { ...account, balanceMinor: -Number.MAX_SAFE_INTEGER })
    state = apply(state, { type: 'snapshot.create', id: 'snapshot', label: 'Старт', meta: meta('snapshot') })
    expect(applyCommand(state, { type: 'account.setBalance', id: 'account-1', balanceMinor: 1, meta: meta('balance') }).ok).toBe(true)
  })
  it('never changes accounts for inventory operations', () => {
    let state = apply(createEmptyState(), account)
    state = apply(state, { ...inventory, meta: meta('inventory') })
    expect(getAccountsTotal(state)).toBe(10000)
  })
})

describe('command boundary', () => {
  it('returns identical state for repeated command id without double audit', () => {
    const state = apply(createEmptyState(), account)
    expect(apply(state, account)).toBe(state)
    expect(state.audit).toHaveLength(1)
  })
  it.each([null, {}, { ...account, provider: 'INVALID' }, { ...account, name: ' ' }, { ...account, meta: { commandId: '', at: FIXED_TIME } }, { ...account, meta: { commandId: 'a', at: '2026-02-30T00:00:00.000Z' } }, { ...account, extra: true }, { ...account, balanceMinor: NaN }, { ...account, balanceMinor: '100' }, { ...account, id: 3 }])('rejects malformed runtime input %#', (command) => {
    expect(error(createEmptyState(), command)).toBe('VALIDATION')
  })
  it('reports unknown entities and conflicting ids', () => {
    expect(error(createEmptyState(), { type: 'account.setBalance', id: 'missing', balanceMinor: 0, meta: meta() })).toBe('NOT_FOUND')
    const state = apply(createEmptyState(), account)
    expect(error(state, { ...account, meta: meta('new') })).toBe('CONFLICT')
  })
})
