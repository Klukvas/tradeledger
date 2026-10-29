import { Catch, HttpException } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Response } from 'express'
import type { ApiFailure } from '../../../shared/api'
import { ApiException } from './api-exception'
import { isDatabaseUnavailable } from './database-unavailable'

export function publicError(exception: unknown): Readonly<{ status: number; error: ApiFailure }> {
  if (exception instanceof ApiException) return { status: exception.getStatus(), error: exception.failure }
  const parserType = exception && typeof exception === 'object' && 'type' in exception ? exception.type : undefined
  if (parserType === 'entity.too.large') return { status: 413, error: { code: 'VALIDATION', message: 'Размер запроса превышает допустимый.' } }
  if (parserType === 'entity.parse.failed') return { status: 400, error: { code: 'VALIDATION', message: 'Не удалось прочитать JSON запроса.' } }
  const status = isDatabaseUnavailable(exception) ? 503 : exception instanceof HttpException ? exception.getStatus() : 500
  switch (status) {
    case 400: return { status, error: { code: 'VALIDATION', message: 'Проверьте данные запроса.' } }
    case 401: return { status, error: { code: 'UNAUTHENTICATED', message: 'Войдите в учётную запись.' } }
    case 403: return { status, error: { code: 'FORBIDDEN', message: 'Запрос запрещён.' } }
    case 404: return { status, error: { code: 'NOT_FOUND', message: 'Запись не найдена.' } }
    case 409: return { status, error: { code: 'CONFLICT', message: 'Данные изменились. Обновите страницу.' } }
    case 413: return { status, error: { code: 'VALIDATION', message: 'Размер запроса превышает допустимый.' } }
    case 429: return { status, error: { code: 'RATE_LIMITED', message: 'Слишком много запросов. Попробуйте позже.' } }
    case 503: return { status, error: { code: 'UNAVAILABLE', message: 'Сервис временно недоступен.' } }
    default: return { status: 500, error: { code: 'STORAGE', message: 'Не удалось выполнить запрос.' } }
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const { status, error } = publicError(exception)
    host.switchToHttp().getResponse<Response>().status(status).json({ ok: false, error })
  }
}
