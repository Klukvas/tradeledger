import type { ApiErrorCode } from '../../shared/api'
import type { Failure, Result } from '../domain/types'
import { failure } from './backups'

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type HttpResult = Readonly<{ status: number; result: Result<unknown> }>
export type Transport = (path: string, body?: unknown, expectedUserId?: string | null) => Promise<HttpResult>
const messages: Record<ApiErrorCode, string> = {
  VALIDATION: 'Проверьте введённые данные и повторите действие.',
  NOT_FOUND: 'Запись не найдена. Обновите данные.',
  CONFLICT: 'Данные уже изменились. Проверьте обновлённые значения и повторите действие.',
  STORAGE: 'Сервер не смог сохранить или прочитать данные. Повторите попытку.',
  CORRUPT: 'Данные не прошли проверку. Сохранение отменено.',
  UNSUPPORTED_VERSION: 'Версия резервной копии не поддерживается.',
  UNAUTHENTICATED: 'Сессия завершена. Войдите снова.',
  FORBIDDEN: 'Запрос отклонён. Откройте приложение по его обычному адресу.',
  RATE_LIMITED: 'Слишком много запросов. Подождите и повторите попытку.',
  UNAVAILABLE: 'Сервер временно недоступен. Повторите попытку позже.',
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function apiFailure(code: ApiErrorCode): Readonly<{ ok: false; error: Failure }> {
  const domainCode: Failure['code'] = code === 'UNAUTHENTICATED' || code === 'FORBIDDEN' || code === 'RATE_LIMITED' || code === 'UNAVAILABLE' ? 'STORAGE' : code
  return failure(domainCode, messages[code])
}
export const invalidResponse = (): Readonly<{ ok: false; error: Failure }> => failure('STORAGE', 'Сервер вернул некорректный ответ. Данные не изменены в интерфейсе; обновите их перед повтором.')

export function createTransport(fetcher: Fetcher = (input, init) => fetch(input, init), timeoutMs = 15_000): Transport {
  return async (path, body, expectedUserId) => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const operation = (async (): Promise<HttpResult> => {
        const response = await fetcher(`/api${path}`, {
          method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: { Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-TradeLedger-Request': '1' }),
            ...(expectedUserId ? { 'X-TradeLedger-User': expectedUserId } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        let payload: unknown
        try { payload = await response.json() as unknown } catch { return { status: response.status, result: invalidResponse() } }
        if (!record(payload) || typeof payload.ok !== 'boolean') return { status: response.status, result: invalidResponse() }
        if (response.ok && payload.ok === true && 'value' in payload) return { status: response.status, result: { ok: true, value: payload.value } }
        const statusCode: ApiErrorCode | undefined = ({ 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 409: 'CONFLICT', 429: 'RATE_LIMITED', 503: 'UNAVAILABLE' } as Record<number, ApiErrorCode>)[response.status]
        if (statusCode) return { status: response.status, result: apiFailure(statusCode) }
        if (payload.ok === false && record(payload.error) && typeof payload.error.code === 'string' && Object.hasOwn(messages, payload.error.code)) {
          return { status: response.status, result: apiFailure(payload.error.code as ApiErrorCode) }
        }
        return { status: response.status, result: invalidResponse() }
      })()
      const timeout = new Promise<HttpResult>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve({ status: 0, result: failure('STORAGE', 'Сервер не ответил вовремя. Обновите данные перед повтором сохранения.') }) }, timeoutMs)
      })
      return await Promise.race([operation, timeout])
    } catch { return { status: 0, result: failure('STORAGE', 'Нет связи с сервером. Проверьте подключение и повторите попытку.') } }
    finally { if (timer !== undefined) clearTimeout(timer) }
  }
}
