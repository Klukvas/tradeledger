import { HttpException } from '@nestjs/common'
import type { ApiErrorCode, ApiFailure } from '../../../shared/api'

/** Only deliberately public messages belong in this exception. */
export class ApiException extends HttpException {
  readonly failure: ApiFailure

  constructor(status: number, code: ApiErrorCode, message: string) {
    super({ ok: false, error: { code, message } }, status)
    this.failure = { code, message }
  }
}
