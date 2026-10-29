import type { Prisma } from '../generated/prisma/client'

export type Tx = Prisma.TransactionClient
export type LockedWorkspace = Readonly<{
  id: string
  userId: string
  activeDatasetId: string
  revision: bigint
  updatedAt: Date
}>
