/** All money is a safe integer number of Ukrainian kopecks. */
export type Money = number
export type Id = string
export type AccountProvider = 'MONO' | 'NovaPay' | 'other'
export type DebtDirection = 'payable' | 'receivable'

export type InventoryItem = Readonly<{
  id: Id
  sku: string
  name: string
  quantity: number
  stockValueMinor: Money
}>

export type Account = Readonly<{
  id: Id
  name: string
  owner: string
  provider: AccountProvider
  balanceMinor: Money
}>

export type Debt = Readonly<{
  id: Id
  direction: DebtDirection
  counterparty: string
  principalMinor: Money
  repaidMinor: Money
  note: string
}>

export type SnapshotAccount = Omit<Account, 'id'> & Readonly<{ accountId: Id }>

export type Snapshot = Readonly<{
  id: Id
  createdAt: string
  label: string
  accounts: readonly SnapshotAccount[]
  totalMinor: Money
  /** Absent on legacy/manual snapshots; explicit monthly close evidence. */
  closedMonth?: string
}>

/** id is the commandId: persisted events also serve as the idempotency key. */
export type AuditEvent = Readonly<{
  id: Id
  at: string
  type: Command['type']
  entityId: Id | null
  summary: string
}>

export type LedgerState = Readonly<{
  inventory: readonly InventoryItem[]
  accounts: readonly Account[]
  debts: readonly Debt[]
  snapshots: readonly Snapshot[]
  audit: readonly AuditEvent[]
}>

export type DocumentV1 = Readonly<{
  schemaVersion: 1
  revision: number
  updatedAt: string
  state: LedgerState
}>

export type Failure = Readonly<{
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'STORAGE' | 'CORRUPT' | 'UNSUPPORTED_VERSION'
  message: string
}>

export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Failure }>

export type CommandMeta = Readonly<{ commandId: Id; at: string }>

type WithMeta<T> = Readonly<T & { meta: CommandMeta }>

export type Command =
  | WithMeta<{ type: 'inventory.create'; id: Id; sku: string; name: string; quantity: number; unitCostMinor: Money }>
  | WithMeta<{ type: 'inventory.update'; id: Id; sku: string; name: string }>
  | WithMeta<{ type: 'inventory.receive'; id: Id; quantity: number; unitCostMinor: Money }>
  | WithMeta<{ type: 'inventory.issue'; id: Id; quantity: number; reason: string }>
  | WithMeta<{ type: 'account.create' } & Account>
  | WithMeta<{ type: 'account.update'; id: Id; name: string; owner: string; provider: AccountProvider }>
  | WithMeta<{ type: 'account.setBalance'; id: Id; balanceMinor: Money }>
  | WithMeta<{ type: 'debt.create'; id: Id; direction: DebtDirection; counterparty: string; principalMinor: Money; note: string }>
  | WithMeta<{ type: 'debt.update'; id: Id; counterparty: string; principalMinor: Money; note: string }>
  | WithMeta<{ type: 'debt.repay'; id: Id; amountMinor: Money }>
  | WithMeta<{ type: 'snapshot.create'; id: Id; label: string }>

export type StoreSnapshot =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; document: DocumentV1; busy: boolean; error: Failure | null }>
  | Readonly<{ status: 'blocked'; error: Failure; rawBackup: string | null }>

export type LedgerContextValue = Readonly<{
  snapshot: StoreSnapshot
  dispatch: (command: Command, expectedRevision: number) => Promise<Result<DocumentV1>>
  exportBackup: () => Result<string>
  importBackup: (json: string, expectedRevision: number) => Promise<Result<DocumentV1>>
  refresh: () => Promise<void>
}>
