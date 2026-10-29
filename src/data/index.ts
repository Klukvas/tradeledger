import { useSyncExternalStore } from 'react'
import type { LedgerContextValue } from '../domain/types'
import { createAuthStore, type AuthContextValue, type AuthStore } from './auth'
import { createStore, type LedgerStore } from './store'
import { createTransport } from './transport'

export { createCommandMeta, createId } from './ids'
export { createStore } from './store'
export { createAuthStore } from './auth'
export { createTransport } from './transport'
export { readLegacyLedger } from './legacy'
export type { LegacyLedger } from './legacy'
export type { LegacyTransferStatus } from './imports'
export type { LedgerStore } from './store'
export type { AuthStore, AuthSnapshot, AuthContextValue } from './auth'
export type { PublicUser, ImportResponse } from '../../shared/api'

let singleton: Readonly<{ auth: AuthStore; ledger: LedgerStore }> | undefined
function client(): Readonly<{ auth: AuthStore; ledger: LedgerStore }> {
  if (!singleton) {
    const transport = createTransport()
    const auth = createAuthStore(transport)
    singleton = { auth, ledger: createStore({ transport, auth }) }
  }
  return singleton
}
export function useAuth(): AuthContextValue {
  const { auth } = client()
  const snapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot)
  return { snapshot, register: auth.register, login: auth.login, logout: auth.logout, refresh: auth.refresh }
}
export function useLedger(): LedgerContextValue {
  const { ledger } = client()
  const snapshot = useSyncExternalStore(ledger.subscribe, ledger.getSnapshot, ledger.getSnapshot)
  return { snapshot, dispatch: ledger.dispatch, exportBackup: ledger.exportBackup, importBackup: ledger.importBackup, refresh: ledger.refresh }
}
export const exportServerBackup: LedgerStore['exportServerBackup'] = () => client().ledger.exportServerBackup()
export const transferLegacy: LedgerStore['transferLegacy'] = (document, expectedRevision, requestId) => client().ledger.transferLegacy(document, expectedRevision, requestId)
export const getLegacyTransferStatus: LedgerStore['getLegacyTransferStatus'] = (document) => client().ledger.getLegacyTransferStatus(document)
