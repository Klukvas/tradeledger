import 'reflect-metadata'
import { Controller, Get, Module, Post, Req } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import type { Request } from 'express'
import { NestFactory } from '@nestjs/core'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config'
import { ApiException } from './api-exception'
import { publicError } from './api-exception.filter'
import { configureHttp, MAX_JSON_BYTES } from './configure-http'

@Controller('test')
class TestController {
  @Get('ip')
  ip(@Req() request: Request): { ip: string | undefined } { return { ip: request.ip } }

  @Post()
  write(): { ok: true; value: null } { return { ok: true, value: null } }

  @Get('failure')
  failure(): never { throw new Error('SQL password database-url stacktrace') }

  @Get('unavailable')
  unavailable(): never { throw Object.assign(new Error('postgresql://private:password@database.example/private'), { code: 'ECONNREFUSED' }) }
}

@Module({ controllers: [TestController] })
class TestModule {}

describe('HTTP boundaries', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { bodyParser: false, logger: false })
    configureHttp(app, loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example' }))
    await app.init()
  })
  afterAll(async () => { await app.close() })

  it('requires both the exact Origin and request marker for unsafe endpoints', async () => {
    for (const origin of [undefined, 'null', 'http://foreign.example', 'http://127.0.0.1:5178.evil.example']) {
      let operation = request(app.getHttpServer()).post('/api/test').set('X-TradeLedger-Request', '1')
      if (origin) operation = operation.set('Origin', origin)
      const result = await operation.send({})
      expect(result.status).toBe(403)
      expect(result.body.error.code).toBe('FORBIDDEN')
    }
    expect((await request(app.getHttpServer()).post('/api/test').set('Origin', 'http://127.0.0.1:5178').send({})).status).toBe(403)
    const accepted = await request(app.getHttpServer()).post('/api/test').set('Origin', 'http://127.0.0.1:5178').set('X-TradeLedger-Request', '1').send({})
    expect(accepted.status).toBe(201)
    expect(accepted.body).toEqual({ ok: true, value: null })
  })

  it('returns bounded JSON errors without reflecting the malformed body', async () => {
    const malformed = await request(app.getHttpServer()).post('/api/test').set('Origin', 'http://127.0.0.1:5178').set('X-TradeLedger-Request', '1').set('Content-Type', 'application/json').send('{"credential":')
    expect(malformed.status).toBe(400)
    expect(malformed.body.error.code).toBe('VALIDATION')
    expect(JSON.stringify(malformed.body)).not.toContain('credential')
    const oversized = await request(app.getHttpServer()).post('/api/test').set('Origin', 'http://127.0.0.1:5178').set('X-TradeLedger-Request', '1').send({ content: 'x'.repeat(MAX_JSON_BYTES) })
    expect(oversized.status).toBe(413)
    expect(oversized.body.error.code).toBe('VALIDATION')
  })

  it('sanitizes unexpected errors and disables caching without enabling CORS', async () => {
    const result = await request(app.getHttpServer()).get('/api/test/failure')
    expect(result.status).toBe(500)
    expect(result.body).toEqual({ ok: false, error: { code: 'STORAGE', message: 'Не удалось выполнить запрос.' } })
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('preserves only explicitly public exception details', () => {
    expect(publicError(new ApiException(409, 'CONFLICT', 'Обновите данные.'))).toEqual({ status: 409, error: { code: 'CONFLICT', message: 'Обновите данные.' } })
  })

  it('returns a sanitized 503 envelope for runtime database outages', async () => {
    const result = await request(app.getHttpServer()).get('/api/test/unavailable')
    expect(result.status).toBe(503)
    expect(result.body).toEqual({ ok: false, error: { code: 'UNAVAILABLE', message: 'Сервис временно недоступен.' } })
    expect(result.headers['cache-control']).toBe('no-store')
  })
})

describe('bounded proxy trust', () => {
  it.each(['0', '1'])('uses the configured %s proxy hops for request.ip', async (TRUST_PROXY_HOPS) => {
    const app = await NestFactory.create(TestModule, { bodyParser: false, logger: false })
    configureHttp(app, loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example', TRUST_PROXY_HOPS }))
    await app.init()
    try {
      const direct = await request(app.getHttpServer()).get('/api/test/ip')
      const forwarded = await request(app.getHttpServer()).get('/api/test/ip').set('X-Forwarded-For', '203.0.113.99, 198.51.100.10')
      expect(direct.status).toBe(200)
      expect(direct.body.ip).toMatch(/127\.0\.0\.1|::1/)
      expect(forwarded.body.ip).toBe(TRUST_PROXY_HOPS === '1' ? '198.51.100.10' : direct.body.ip)
      expect(forwarded.body.ip).not.toBe('203.0.113.99')
    } finally { await app.close() }
  })
})
