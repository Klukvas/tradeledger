import type { Command, DocumentV1, Failure } from '../src/domain/types'

export type ApiErrorCode = Failure['code'] | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'UNAVAILABLE'
export type ApiFailure = Readonly<{ code: ApiErrorCode; message: string }>
export type ApiResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: ApiFailure }>
export type PublicUser = Readonly<{ id: string; email: string }>
export type AuthRequest = Readonly<{ email: string; password: string }>
export type AuthResponse = Readonly<{ user: PublicUser }>
export type CommandRequest = Readonly<{ expectedRevision: number; command: Command }>
export type CommandResponse = Readonly<{ document: DocumentV1; replayed: boolean }>
export type ImportSource = 'backup' | 'legacy'
export type DocumentCounts = Readonly<{
  inventory: number
  accounts: number
  debts: number
  snapshots: number
  snapshotAccounts: number
  audit: number
}>
export type ImportRequest = Readonly<{
  requestId: string
  expectedRevision: number
  source: ImportSource
  document: DocumentV1
}>
export type ImportReceipt = Readonly<{
  requestId: string
  datasetId: string
  sourceHash: string
  counts: DocumentCounts
  committedRevision: number
}>
export type ImportResponse = Readonly<{ document: DocumentV1; receipt: ImportReceipt; replayed: boolean }>
export type DatasetMetadata = Readonly<{
  id: string
  createdAt: string
  archivedAt: string | null
  source: 'empty' | ImportSource
  sourceHash: string | null
  counts: DocumentCounts
}>
export type DatasetListResponse = Readonly<{ datasets: readonly DatasetMetadata[] }>
export type ReadyResponse = Readonly<{ ready: true }>
