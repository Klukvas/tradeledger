import { Inject, Injectable } from '@nestjs/common'
import type { ImportReceipt, ImportResponse } from '../../../shared/api'
import type { DocumentV1 } from '../../../src/domain/types'
import { DatabaseService, LedgerRepository } from '../database'
import { serializedTime } from '../database/account-history'
import { closeDueMonths } from '../database/close-months'
import { ApiException } from '../http'
import { documentCounts, parseImportRequest, parseRequestId, sha256, storedImportReceipt } from './import-request'

@Injectable()
export class ImportService {
  constructor(@Inject(LedgerRepository) private readonly repository: LedgerRepository,
    @Inject(DatabaseService) private readonly database: DatabaseService) {}

  async execute(userId: string, input: unknown): Promise<ImportResponse> {
    const request = parseImportRequest(input)
    const requestHash = sha256({ source: request.source, document: request.document })
    const sourceHash = sha256(request.document)
    const counts = documentCounts(request.document)
    return await this.repository.withLockedWorkspace(userId, async (tx, workspace) => {
      const previous = await tx.commandReceipt.findUnique({ where: {
        workspaceId_requestId: { workspaceId: workspace.id, requestId: request.requestId },
      } })
      if (previous) {
        if (previous.requestKind !== request.source || previous.requestHash !== requestHash) {
          throw new ApiException(409, 'CONFLICT', 'Идентификатор операции уже использован для другого запроса.')
        }
        const receipt = storedImportReceipt(previous)
        return { document: await this.repository.readDocument(tx, workspace), receipt, replayed: true }
      }
      if (workspace.revision !== BigInt(request.expectedRevision)) {
        throw new ApiException(409, 'CONFLICT', 'Данные изменились. Обновите их и повторите импорт.')
      }
      if (workspace.revision >= BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApiException(409, 'CONFLICT', 'Достигнут предел версии изменений.')
      }
      const committedAt = await serializedTime(tx)
      const closed = await closeDueMonths(tx, workspace, committedAt)
      const archivedRevision = workspace.revision + (closed > 0 ? 1n : 0n)
      if (archivedRevision >= BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApiException(409, 'CONFLICT', 'Недостаточно версий для закрытия месяца и импорта.')
      }
      const revision = archivedRevision + 1n
      const datasetId = await this.repository.insertDataset(tx, workspace.id, request.document, { kind: request.source, sourceHash }, committedAt)
      await tx.dataset.update({ where: { workspaceId_id: { workspaceId: workspace.id, id: workspace.activeDatasetId } },
        data: { archivedAt: committedAt, archivedRevision, archivedDocumentUpdatedAt: closed > 0 ? committedAt : workspace.updatedAt } })
      await tx.workspace.update({ where: { id: workspace.id }, data: { activeDatasetId: datasetId, revision, updatedAt: committedAt } })
      const persisted = await tx.commandReceipt.create({ data: {
        workspaceId: workspace.id, requestId: request.requestId, requestKind: request.source, requestHash,
        datasetId, committedRevision: revision, committedAt, sourceHash, counts,
      } })
      const document: DocumentV1 = { schemaVersion: 1, revision: Number(revision), updatedAt: committedAt.toISOString(), state: request.document.state }
      return { document, receipt: storedImportReceipt(persisted), replayed: false }
    })
  }

  async receipt(userId: string, input: unknown): Promise<ImportReceipt> {
    const requestId = parseRequestId(input)
    const receipt = await this.database.commandReceipt.findFirst({ where: {
      workspace: { userId }, requestId, requestKind: { in: ['backup', 'legacy'] },
    } })
    if (!receipt) throw new ApiException(404, 'NOT_FOUND', 'Квитанция импорта не найдена.')
    return storedImportReceipt(receipt)
  }
}
