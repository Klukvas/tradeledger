import type { RequestHandler } from 'express'
import type { AppConfig } from '../config'

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

export function unsafeRequestProtection(config: Pick<AppConfig, 'publicOrigin'>): RequestHandler {
  return (request, response, next) => {
    if (!safeMethods.has(request.method) && (request.headers.origin !== config.publicOrigin || request.headers['x-tradeledger-request'] !== '1')) {
      response.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Источник запроса не разрешён.' } })
      return
    }
    next()
  }
}
