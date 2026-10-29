import { Controller, Get, HttpCode, Module, Post, UseGuards, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG, loadConfig } from '../config'
import { configureHttp } from '../http'
import { AuthService, unauthenticated } from './auth.service'
import { CurrentUser } from './current-user.decorator'
import { SessionGuard } from './session.guard'
import type { AuthenticatedUser } from './auth.types'

const config = loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example' })
const userA = { id: 'user-a', email: 'a@example.test', workspaceId: 'workspace-a' }
const userB = { id: 'user-b', email: 'b@example.test', workspaceId: 'workspace-b' }
const reached = vi.fn((user: AuthenticatedUser) => ({ ok: true, value: { id: user.id } }))
const auth = { authenticate: vi.fn(async (cookie: unknown) => {
  if (cookie === 'cookie-a') return userA
  if (cookie === 'cookie-b') return userB
  throw unauthenticated()
}) }

@Controller('ledger')
@UseGuards(SessionGuard)
class ProtectedLedger {
  @Get(['', 'export', 'imports/:requestId', 'datasets', 'datasets/:id/export'])
  read(@CurrentUser() user: AuthenticatedUser) { return reached(user) }

  @Post(['commands', 'import'])
  @HttpCode(200)
  write(@CurrentUser() user: AuthenticatedUser) { return reached(user) }
}
@Module({ controllers: [ProtectedLedger], providers: [SessionGuard,
  { provide: AuthService, useValue: auth }, { provide: APP_CONFIG, useValue: config }] })
class GuardTestModule {}

const routes = [
  ['get', ''], ['get', '/export'], ['get', '/imports/request'], ['get', '/datasets'],
  ['get', '/datasets/archive/export'], ['post', '/commands'], ['post', '/import'],
] as const

describe('protected requests bind the expected user to the authenticated cookie', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await NestFactory.create(GuardTestModule, { bodyParser: false, logger: false })
    configureHttp(app, config)
    await app.init()
  })
  afterAll(async () => { await app.close() })

  it.each(routes)('rejects a stale A context with B cookie for %s /ledger%s before the handler', async (method, path) => {
    const response = await request(app.getHttpServer())[method](`/api/ledger${path}`)
      .set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
      .set('Cookie', 'tradeledger_session=cookie-b').set('X-TradeLedger-User', userA.id).send(method === 'post' ? {} : undefined)
    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(reached).not.toHaveBeenCalled()
  })

  it('requires a binding even for authenticated reads and never authenticates a header by itself', async () => {
    await request(app.getHttpServer()).get('/api/ledger').set('Cookie', 'tradeledger_session=cookie-b').expect(401)
    await request(app.getHttpServer()).get('/api/ledger').set('X-TradeLedger-User', userB.id).expect(401)
    expect(reached).not.toHaveBeenCalled()
  })

  it.each(routes)('uses only the cookie-derived owner for matching %s /ledger%s', async (method, path) => {
    const response = await request(app.getHttpServer())[method](`/api/ledger${path}?userId=${userA.id}`)
      .set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
      .set('Cookie', 'tradeledger_session=cookie-b').set('X-TradeLedger-User', userB.id).send(method === 'post' ? {} : undefined)
    expect(response.status).toBe(200)
    expect(reached).toHaveBeenCalledWith(userB)
    expect(response.body).toEqual({ ok: true, value: { id: userB.id } })
  })
})
