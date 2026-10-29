import { createHash } from 'node:crypto'
import type { CommandRequest } from '../../../shared/api'
import { canonicalJson } from '../../../shared/canonical'
import type { Command, Failure } from '../../../src/domain/types'
import { parseCommand } from '../../../src/domain/validate-command'
import { DomainError, integer, object } from '../../../src/domain/validate-core'
import { ApiException } from '../http'

export function commandFailure(error: Failure): ApiException {
  const status = error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404
    : error.code === 'VALIDATION' || error.code === 'UNSUPPORTED_VERSION' ? 400 : 500
  return new ApiException(status, error.code, error.message)
}

/** Runtime validation remains mandatory even for a statically typed caller. */
export function parseCommandRequest(input: unknown): CommandRequest {
  try {
    const value = object(input, ['expectedRevision', 'command'], 'Операция')
    return {
      expectedRevision: integer(value.expectedRevision, 'Версия изменений'),
      command: parseCommand(value.command),
    }
  } catch (error) {
    if (error instanceof DomainError) throw commandFailure(error)
    throw error
  }
}

/** A retry may change its clock or expected revision, but never its business payload. */
export function commandRequestHash(command: Command): string {
  return createHash('sha256').update(canonicalJson({
    ...command, meta: { commandId: command.meta.commandId },
  })).digest('hex')
}
