import type { DocumentV1 } from '../../../src/domain/types'
import { historicalAt } from './harness'

/** Deliberately nonalphabetic order and offset ISO text detect lossy persistence. */
export function historicalDocument(): DocumentV1 {
  return {
    schemaVersion: 1, revision: 77, updatedAt: historicalAt,
    state: {
      inventory: [
        { id: 'z-item', sku: 'Z', name: 'Last alphabetically', quantity: 3, stockValueMinor: 307 },
        { id: 'a-item', sku: 'A', name: 'First alphabetically', quantity: 0, stockValueMinor: 0 },
      ],
      accounts: [
        { id: 'z-account', name: 'Historical Z', owner: 'Owner', provider: 'MONO', balanceMinor: 100 },
        { id: 'a-account', name: 'Historical A', owner: 'Owner', provider: 'other', balanceMinor: -20 },
      ],
      debts: [{ id: 'debt', direction: 'payable', counterparty: 'Historical person', principalMinor: 500, repaidMinor: 100, note: 'Imported aggregate' }],
      snapshots: [{ id: 'snapshot', createdAt: historicalAt, label: 'Historical snapshot', totalMinor: 60, accounts: [
        { accountId: 'a-account', name: 'Before A', owner: 'Previous', provider: 'NovaPay', balanceMinor: -40 },
        { accountId: 'z-account', name: 'Before Z', owner: 'Previous', provider: 'MONO', balanceMinor: 100 },
      ] }],
      audit: [
        { id: 'historical-z', at: historicalAt, type: 'inventory.create', entityId: 'z-item', summary: 'Historical inventory' },
        { id: 'historical-a', at: '2021-01-01T00:00:00.1Z', type: 'snapshot.create', entityId: 'snapshot', summary: 'Historical snapshot' },
      ],
    },
  }
}
