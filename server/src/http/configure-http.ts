import type { INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { json } from 'express'
import type { Express, RequestHandler } from 'express'
import type { AppConfig } from '../config'
import { ApiExceptionFilter } from './api-exception.filter'
import { unsafeRequestProtection } from './unsafe-request'

export const MAX_JSON_BYTES = 6 * 1024 * 1024

/** Create Nest with bodyParser:false so this is the only JSON size policy. */
export function configureHttp(app: INestApplication, config: AppConfig): void {
  const express: Express = app.getHttpAdapter().getInstance()
  express.set('trust proxy', config.trustProxyHops)
  app.setGlobalPrefix('api')
  const headers: RequestHandler = (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.removeHeader('X-Powered-By')
    next()
  }
  app.use(headers)
  app.use(unsafeRequestProtection(config))
  app.use(json({ limit: MAX_JSON_BYTES, strict: true }))
  app.use(cookieParser())
  app.useGlobalFilters(new ApiExceptionFilter())
}
