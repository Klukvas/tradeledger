import type { Command, LedgerState, Result } from './types'
import { changeInventory } from './command-inventory'
import { changeAccount, changeDebt, createSnapshot } from './command-finance'
import { parseCommand } from './validate-command'
import { resultOf } from './validate-core'
import { checkAggregates } from './validate-state'

export function applyCommand(state: LedgerState, input: Command): Result<LedgerState> {
  return resultOf(() => {
    const command = parseCommand(input)
    if (state.audit.some((entry) => entry.id === command.meta.commandId)) return state
    const mutation = (() => {
      switch (command.type) {
        case 'inventory.create': case 'inventory.update': case 'inventory.receive': case 'inventory.issue': return changeInventory(state, command)
        case 'account.create': case 'account.update': case 'account.setBalance': return changeAccount(state, command)
        case 'debt.create': case 'debt.update': case 'debt.repay': return changeDebt(state, command)
        case 'snapshot.create': return createSnapshot(state, command)
      }
    })()
    checkAggregates(mutation.state)
    return { ...mutation.state, audit: [...state.audit, { id: command.meta.commandId, at: command.meta.at, type: command.type, entityId: command.id, summary: mutation.summary }] }
  })
}
