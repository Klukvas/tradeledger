import type { DocumentV1, Result } from './types'
import { fail, integer, isoDate, object, resultOf } from './validate-core'
import { parseState } from './validate-state'

export function validateDocument(input: unknown): Result<DocumentV1> {
  return resultOf(() => {
    if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion !== 1) {
      fail('UNSUPPORTED_VERSION', 'Версия резервной копии не поддерживается.')
    }
    const value = object(input, ['schemaVersion', 'revision', 'updatedAt', 'state'], 'Резервная копия')
    if (value.schemaVersion !== 1) fail('VALIDATION', 'Укажите версию резервной копии.')
    return { schemaVersion: 1, revision: integer(value.revision, 'Версия изменений'), updatedAt: isoDate(value.updatedAt), state: parseState(value.state) }
  })
}
