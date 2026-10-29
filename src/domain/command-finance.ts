import type { Command, LedgerState } from './types'
import type { Mutation } from './command-inventory'
import { formatMoney } from './money'
import { getAccountsTotal } from './selectors'
import { exactMoney, fail } from './validate-core'

type AccountCommand = Extract<Command, { type: `account.${string}` }>
type DebtCommand = Extract<Command, { type: `debt.${string}` }>

export function changeAccount(state: LedgerState, command: AccountCommand): Mutation {
  const current = state.accounts.find((account) => account.id === command.id)
  if (command.type === 'account.create') {
    if (current) fail('CONFLICT', 'Счёт с таким идентификатором уже существует.')
    const account = { id: command.id, name: command.name, owner: command.owner, provider: command.provider, balanceMinor: command.balanceMinor }
    return { state: { ...state, accounts: [...state.accounts, account] }, summary: `Добавлен счёт «${account.name}», ${account.owner}: ${formatMoney(account.balanceMinor)}.` }
  }
  if (!current) fail('NOT_FOUND', 'Счёт не найден.')
  const account = command.type === 'account.setBalance' ? { ...current, balanceMinor: command.balanceMinor } : { ...current, name: command.name, owner: command.owner, provider: command.provider }
  const summary = command.type === 'account.setBalance' ? `Баланс «${account.name}» изменён с ${formatMoney(current.balanceMinor)} на ${formatMoney(account.balanceMinor)}.` : `Счёт «${current.name}» изменён: «${account.name}», ${account.owner}; баланс ${formatMoney(account.balanceMinor)}.`
  return { state: { ...state, accounts: state.accounts.map((entry) => entry.id === account.id ? account : entry) }, summary }
}

export function changeDebt(state: LedgerState, command: DebtCommand): Mutation {
  const current = state.debts.find((debt) => debt.id === command.id)
  if (command.type === 'debt.create') {
    if (current) fail('CONFLICT', 'Долг с таким идентификатором уже существует.')
    const debt = { id: command.id, direction: command.direction, counterparty: command.counterparty, principalMinor: command.principalMinor, repaidMinor: 0, note: command.note }
    return { state: { ...state, debts: [...state.debts, debt] }, summary: `${debt.direction === 'payable' ? 'Мы должны' : 'Нам должны'}: «${debt.counterparty}», ${formatMoney(debt.principalMinor)}.` }
  }
  if (!current) fail('NOT_FOUND', 'Долг не найден.')
  if (command.type === 'debt.update' && command.principalMinor < current.repaidMinor) fail('VALIDATION', 'Сумма долга не может быть меньше уже погашенной суммы.')
  const repaidMinor = command.type === 'debt.repay' ? exactMoney(BigInt(current.repaidMinor) + BigInt(command.amountMinor)) : current.repaidMinor
  if (repaidMinor > current.principalMinor) fail('VALIDATION', 'Погашение превышает остаток долга.')
  const debt = command.type === 'debt.repay' ? { ...current, repaidMinor } : { ...current, counterparty: command.counterparty, principalMinor: command.principalMinor, note: command.note }
  const summary = command.type === 'debt.repay' ? `Погашен долг «${debt.counterparty}» на ${formatMoney(command.amountMinor)}; осталось ${formatMoney(debt.principalMinor - debt.repaidMinor)}.` : `Изменён долг «${current.counterparty}»: «${debt.counterparty}», сумма ${formatMoney(debt.principalMinor)}, погашено ${formatMoney(debt.repaidMinor)}.`
  return { state: { ...state, debts: state.debts.map((entry) => entry.id === debt.id ? debt : entry) }, summary }
}

export function createSnapshot(state: LedgerState, command: Extract<Command, { type: 'snapshot.create' }>): Mutation {
  if (state.snapshots.some((entry) => entry.id === command.id)) fail('CONFLICT', 'Фиксация балансов с таким идентификатором уже существует.')
  const accounts = state.accounts.map(({ id, ...account }) => ({ accountId: id, ...account }))
  const totalMinor = getAccountsTotal(state)
  const snapshot = { id: command.id, createdAt: command.meta.at, label: command.label, accounts, totalMinor }
  return { state: { ...state, snapshots: [...state.snapshots, snapshot] }, summary: `Фиксация балансов «${snapshot.label}»: счетов — ${accounts.length}, всего ${formatMoney(totalMinor)}.` }
}
