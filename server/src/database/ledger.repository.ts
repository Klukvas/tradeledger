import { Injectable } from '@nestjs/common'
import type { Command, DocumentV1 } from '../../../src/domain/types'
import { Prisma } from '../generated/prisma/client'
import { ApiException } from '../http'
import { DatabaseService } from './database.service'
import { ensureAccountHistory, serializedTime } from './account-history'
import { insertDocument } from './insert-document'
import { accountFromRow, auditFromRow, debtFromRow, documentFromRows, inventoryFromRow, snapshotFromRow } from './mapping'
import { persistCommandRows } from './persist-command'
import type { LockedWorkspace, Tx } from './types'

function requireActive(workspace: { id: string; userId: string; activeDatasetId: string | null; revision: bigint; updatedAt: Date } | null): LockedWorkspace {
  if (!workspace?.activeDatasetId) throw new ApiException(404, 'NOT_FOUND', 'Учёт не найден.')
  return { ...workspace, activeDatasetId: workspace.activeDatasetId }
}

@Injectable()
export class LedgerRepository {
  constructor(private readonly database: DatabaseService) {}

  async read(userId: string): Promise<DocumentV1> {
    return this.database.$transaction(async (tx) => {
      const workspace = requireActive(await tx.workspace.findUnique({ where: { userId } }))
      return this.readDocument(tx, workspace)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 })
  }

  async withLockedWorkspace<T>(userId: string, run: (tx: Tx, workspace: LockedWorkspace) => Promise<T>): Promise<T> {
    return this.database.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedWorkspace[]>`SELECT "id", "userId", "activeDatasetId", "revision", "updatedAt" FROM "Workspace" WHERE "userId" = ${userId}::uuid FOR UPDATE`
      return run(tx, requireActive(rows[0] ?? null))
    }, { timeout: 30_000, maxWait: 10_000 })
  }

  async readDocument(tx: Tx, workspace: LockedWorkspace): Promise<DocumentV1> {
    await this.requireDataset(tx, workspace)
    const where = { datasetId: workspace.activeDatasetId }
    const orderBy = { position: 'asc' as const }
    const [inventory, accounts, debts, snapshots, audit] = await Promise.all([
      tx.inventoryItem.findMany({ where, orderBy }), tx.account.findMany({ where, orderBy }),
      tx.debt.findMany({ where, orderBy }), tx.snapshot.findMany({ where, orderBy, include: { accounts: { orderBy } } }),
      tx.auditEvent.findMany({ where, orderBy }),
    ])
    return documentFromRows(workspace, {
      inventory: inventory.map(inventoryFromRow), accounts: accounts.map(accountFromRow), debts: debts.map(debtFromRow),
      snapshots: snapshots.map((snapshot) => snapshotFromRow(snapshot, snapshot.accounts)),
      audit: audit.map(auditFromRow),
    })
  }

  async persistCommand(tx: Tx, workspace: LockedWorkspace, before: DocumentV1, after: DocumentV1, command: Command): Promise<void> {
    await this.requireDataset(tx, workspace)
    await ensureAccountHistory(tx, workspace.activeDatasetId, workspace.revision, new Date(command.meta.at))
    await persistCommandRows(tx, workspace.activeDatasetId, before, after, command)
  }

  async insertDataset(tx: Tx, workspaceId: string, document: DocumentV1, source: { kind: 'backup' | 'legacy'; sourceHash: string }, effectiveAt: Date): Promise<string> {
    const dataset = await tx.dataset.create({ data: { workspaceId, source: source.kind, sourceHash: source.sourceHash, sourceRevision: BigInt(document.revision), sourceUpdatedAt: new Date(document.updatedAt) } })
    await insertDocument(tx, dataset.id, document)
    await ensureAccountHistory(tx, dataset.id, 0n, effectiveAt)
    return dataset.id
  }

  async createWorkspace(tx: Tx, userId: string): Promise<string> {
    const now = new Date()
    const workspace = await tx.workspace.create({ data: { userId, revision: 0n, updatedAt: now } })
    const dataset = await tx.dataset.create({ data: { workspaceId: workspace.id, source: 'empty', sourceRevision: 0n, sourceUpdatedAt: now } })
    await tx.workspace.update({ where: { id: workspace.id }, data: { activeDatasetId: dataset.id } })
    await ensureAccountHistory(tx, dataset.id, 0n, await serializedTime(tx))
    return workspace.id
  }

  private async requireDataset(tx: Tx, workspace: LockedWorkspace): Promise<void> {
    const dataset = await tx.dataset.findUnique({ where: { workspaceId_id: { workspaceId: workspace.id, id: workspace.activeDatasetId } }, select: { id: true } })
    if (!dataset) throw new ApiException(404, 'NOT_FOUND', 'Набор данных не найден.')
    const owner = await tx.workspace.findFirst({ where: { id: workspace.id, userId: workspace.userId }, select: { id: true } })
    if (!owner) throw new ApiException(404, 'NOT_FOUND', 'Учёт не найден.')
  }
}
