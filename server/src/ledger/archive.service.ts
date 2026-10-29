import { Inject, Injectable } from '@nestjs/common'
import type { DatasetListResponse, DatasetMetadata } from '../../../shared/api'
import type { DocumentV1 } from '../../../src/domain/types'
import { DatabaseService, LedgerRepository } from '../database'
import { Prisma } from '../generated/prisma/client'
import { ApiException } from '../http'

export function parseDatasetId(input: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input)) {
    throw new ApiException(400, 'VALIDATION', 'Некорректный идентификатор набора данных.')
  }
  return input
}

@Injectable()
export class ArchiveService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LedgerRepository) private readonly repository: LedgerRepository) {}

  async list(userId: string): Promise<DatasetListResponse> {
    return this.database.$transaction(async (tx) => {
      const datasets = await tx.dataset.findMany({ where: { workspace: { userId }, archivedAt: { not: null } },
        orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }], include: { _count: { select: { inventory: true, accounts: true, debts: true, snapshots: true, audit: true } } } })
      const snapshotCounts = datasets.length ? await tx.snapshotAccount.groupBy({ by: ['datasetId'],
        where: { datasetId: { in: datasets.map((dataset) => dataset.id) } }, _count: { _all: true } }) : []
      const countsByDataset = new Map(snapshotCounts.map((count) => [count.datasetId, count._count._all]))
      return { datasets: datasets.map((dataset): DatasetMetadata => {
        if (!['empty', 'backup', 'legacy'].includes(dataset.source)) throw new ApiException(503, 'UNAVAILABLE', 'Архив недоступен.')
        return { id: dataset.id, createdAt: dataset.createdAt.toISOString(), archivedAt: dataset.archivedAt?.toISOString() ?? null,
          source: dataset.source as DatasetMetadata['source'], sourceHash: dataset.sourceHash,
          counts: { ...dataset._count, snapshotAccounts: countsByDataset.get(dataset.id) ?? 0 } }
      }) }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 })
  }

  async export(userId: string, input: string): Promise<DocumentV1> {
    const id = parseDatasetId(input)
    return this.database.$transaction(async (tx) => {
      const dataset = await tx.dataset.findFirst({ where: { id, workspace: { userId }, archivedAt: { not: null } }, include: { workspace: true } })
      if (!dataset) throw new ApiException(404, 'NOT_FOUND', 'Архивный набор данных не найден.')
      if (dataset.archivedRevision === null || dataset.archivedDocumentUpdatedAt === null
        || dataset.archivedRevision < 0n || dataset.archivedRevision > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApiException(503, 'UNAVAILABLE', 'Метаданные архива недоступны.')
      }
      return this.repository.readDocument(tx, { ...dataset.workspace, activeDatasetId: dataset.id,
        revision: dataset.archivedRevision, updatedAt: dataset.archivedDocumentUpdatedAt })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 })
  }
}
