import type { LedgerState } from './types'
import { exactMoney, sum } from './validate-core'

export function getAccountsTotal(state: LedgerState): number {
  return sum(state.accounts.map((account) => account.balanceMinor))
}

export function getStockTotal(state: LedgerState): number {
  return sum(state.inventory.map((item) => item.stockValueMinor))
}

export function getDebtTotals(state: LedgerState): { payable: number; receivable: number } {
  const remaining = (direction: 'payable' | 'receivable'): number => sum(state.debts
    .filter((debt) => debt.direction === direction)
    .map((debt) => exactMoney(BigInt(debt.principalMinor) - BigInt(debt.repaidMinor))))
  return { payable: remaining('payable'), receivable: remaining('receivable') }
}

export function getMoneyChange(state: LedgerState): number | null {
  const latest = state.snapshots.at(-1)
  return latest ? exactMoney(BigInt(getAccountsTotal(state)) - BigInt(latest.totalMinor)) : null
}
