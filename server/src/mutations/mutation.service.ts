import { Injectable } from '@nestjs/common'
import type { CommandRequest, CommandResponse } from '../../../shared/api'
import { applyCommand } from '../../../src/domain/commands'
import type { DocumentV1 } from '../../../src/domain/types'
import { LedgerRepository } from '../database'
import { serializedTime } from '../database/account-history'
import { Prisma } from '../generated/prisma/client'
import { ApiException } from '../http'
import { commandFailure, commandRequestHash, parseCommandRequest } from './command-request'

@Injectable()
export class MutationService {
  constructor(private readonly repository: LedgerRepository) {}

  async execute(userId: string, request: CommandRequest): Promise<CommandResponse> {
    const { command, expectedRevision } = parseCommandRequest(request)
    if (command.type === 'snapshot.create') throw new ApiException(400, 'VALIDATION', 'Балансы закрываются автоматически первого числа по Киеву.')
    const requestHash = commandRequestHash(command)
    return await this.repository.withLockedWorkspace(userId, async (tx, workspace) => {
      const receipt = await tx.commandReceipt.findUnique({ where: {
        workspaceId_requestId: { workspaceId: workspace.id, requestId: command.meta.commandId },
      } })
      if (receipt && (receipt.requestKind !== 'command' || receipt.requestHash !== requestHash)) {
        throw new ApiException(409, 'CONFLICT', 'Идентификатор операции уже использован для другого запроса.')
      }
      const before = await this.repository.readDocument(tx, workspace)
      if (receipt) return { document: before, replayed: true }
      // Imported audit events are not verified acknowledgements of this request.
      if (before.state.audit.some((event) => event.id === command.meta.commandId)) {
        throw new ApiException(409, 'CONFLICT', 'Идентификатор операции уже существует в истории.')
      }
      if (workspace.revision !== BigInt(expectedRevision)) {
        throw new ApiException(409, 'CONFLICT', 'Данные изменились. Обновите их и повторите операцию.')
      }
      if (workspace.revision >= BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApiException(409, 'CONFLICT', 'Достигнут предел версии изменений.')
      }
      const committedAt = await serializedTime(tx)
      const serverCommand = { ...command, meta: { ...command.meta, at: committedAt.toISOString() } }
      const result = applyCommand(before.state, serverCommand)
      if (!result.ok) throw commandFailure(result.error)
      const revision = workspace.revision + 1n
      const after: DocumentV1 = {
        ...before, revision: Number(revision), updatedAt: committedAt.toISOString(), state: result.value,
      }
      await this.repository.persistCommand(tx, workspace, before, after, serverCommand)
      await tx.workspace.update({ where: { id: workspace.id }, data: { revision, updatedAt: committedAt } })
      await tx.commandReceipt.create({ data: {
        workspaceId: workspace.id, requestId: command.meta.commandId, requestKind: 'command', requestHash,
        datasetId: workspace.activeDatasetId, committedRevision: revision, committedAt,
        sourceHash: null, counts: Prisma.DbNull,
      } })
      return { document: after, replayed: false }
    })
  }
}
