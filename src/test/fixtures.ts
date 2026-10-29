import type { DocumentV1, LedgerState } from '../domain/types'

export const FIXED_TIME = '2026-10-28T10:00:00.000Z'

/** Fresh values keep each test independent; production always starts empty. */
export function createEmptyState(overrides: Partial<LedgerState> = {}): LedgerState {
  return { inventory: [], accounts: [], debts: [], snapshots: [], audit: [], ...overrides }
}

export function createDocument(overrides: Partial<DocumentV1> = {}): DocumentV1 {
  return { schemaVersion: 1, revision: 0, updatedAt: FIXED_TIME, state: createEmptyState(), ...overrides }
}
