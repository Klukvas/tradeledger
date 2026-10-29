import 'reflect-metadata'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { APP_CONFIG, loadConfig } from '../config'
import { configureHttp } from '../http'
import { AuthLimiter, AUTH_LIMITS } from './auth-limiter'
import { AuthController } from './auth.controller'
import { AuthService, unauthenticated } from './auth.service'
import { SessionGuard } from './session.guard'

const config = loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example' })
const token = 'a'.repeat(64)
const user = { id: 'owner', email: 'owner@example.com' }
const issued = { user, token, expiresAt: new Date(Date.now() + config.sessionTtlMs) }
const auth = {
  register: vi.fn(async () => issued), login: vi.fn(async () => issued),
  authenticate: vi.fn(async (candidate: unknown) => {
    if (candidate !== token) throw unauthenticated()
    return { ...user, workspaceId: 'secret-workspace' }
  }), logout: vi.fn(async () => undefined),
}
const limits = { windowMs: 60_000, registerPerIp: 2, loginPerIp: 20, totalPerWindow: 100, maxKeys: 100 }

@Module({ controllers: [AuthController], providers: [SessionGuard, AuthLimiter,
  { provide: AuthService, useValue: auth }, { provide: APP_CONFIG, useValue: config }, { provide: AUTH_LIMITS, useValue: limits }] })
class AuthTestModule {}

describe('auth HTTP contract', () => {
  let app: INestApplication
  beforeAll(async () => {
    app = await NestFactory.create(AuthTestModule, { bodyParser: false, logger: false })
    configureHttp(app, config)
    await app.init()
  })
  afterAll(async () => { await app.close() })

  function post(path: string) {
    return request(app.getHttpServer()).post(`/api/auth/${path}`).set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
  }

  it('sets only an opaque HttpOnly SameSite cookie and returns a public user', async () => {
    const response = await post('register').send({ email: ' Owner@Example.com ', password: 'long enough password' })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, value: { user } })
    expect(auth.register).toHaveBeenCalledWith({ email: user.email, password: 'long enough password' })
    const cookie = response.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain(`tradeledger_session=${token}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
    expect(JSON.stringify(response.body)).not.toContain(token)
  })

  it('validates the body and limits attempts before expensive auth work', async () => {
    const invalid = await post('register').send({ email: 'owner@example.com', password: 'long enough password', workspaceId: 'foreign' })
    expect(invalid.status).toBe(400)
    const limited = await post('register').send({ email: 'owner@example.com', password: 'long enough password' })
    expect(limited.status).toBe(429)
    expect(auth.register).not.toHaveBeenCalled()
    const invalidLogin = await post('login').send({ email: 'owner@example.com', password: 'x'.repeat(257) })
    expect(invalidLogin.status).toBe(400)
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('resolves sessions from cookies, keeps the workspace internal and rejects unauthenticated reads', async () => {
    expect((await request(app.getHttpServer()).get('/api/auth/me')).status).toBe(401)
    expect((await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', 'tradeledger_session=invalid')).status).toBe(401)
    const response = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', `tradeledger_session=${token}`)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, value: { user } })
  })

  it.each([undefined, 'stale-owner'])('rejects logout context %s without revoking or clearing the current cookie', async (expectedUser) => {
    const operation = post('logout').set('Cookie', `tradeledger_session=${token}`)
    if (expectedUser !== undefined) operation.set('X-TradeLedger-User', expectedUser)
    const response = await operation.send({})
    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } })
    expect(auth.logout).not.toHaveBeenCalled()
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('requires an empty logout object and revokes the session without changing browser cookies', async () => {
    const invalid = await post('logout').set('X-TradeLedger-User', user.id).set('Cookie', `tradeledger_session=${token}`).send({ workspaceId: 'foreign' })
    expect(invalid.status).toBe(400)
    expect(auth.logout).not.toHaveBeenCalled()
    const response = await post('logout').set('X-TradeLedger-User', user.id).set('Cookie', `tradeledger_session=${token}`).send({})
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true, value: null })
    expect(auth.logout).toHaveBeenCalledWith(token)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('preserves B login cookie when an older A logout completes after that login', async () => {
    const tokenB = 'b'.repeat(64)
    const userB = { id: 'owner-b', email: 'b@example.com' }
    let releaseLogout: () => void = () => { throw new Error('Logout not started') }
    let markLogoutStarted: () => void = () => { throw new Error('Logout not initialized') }
    const logoutStarted = new Promise<void>((resolve) => { markLogoutStarted = resolve })
    const pendingRevocation = new Promise<void>((resolve) => { releaseLogout = resolve })
    auth.logout.mockImplementationOnce(async () => { markLogoutStarted(); await pendingRevocation })
    const browser = request.agent(app.getHttpServer())
    const loginA = await browser.post('/api/auth/login').set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
      .send({ email: user.email, password: 'long enough password' })
    expect(loginA.status).toBe(200)
    const logoutA = browser.post('/api/auth/logout').set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
      .set('X-TradeLedger-User', user.id).send({}).then((response) => response)
    await logoutStarted
    try {
      auth.login.mockResolvedValueOnce({ user: userB, token: tokenB, expiresAt: issued.expiresAt })
      const loginB = await browser.post('/api/auth/login').set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
        .send({ email: userB.email, password: 'long enough password' })
      expect(loginB.status).toBe(200)
      expect(loginB.headers['set-cookie']?.[0]).toContain(`tradeledger_session=${tokenB}`)
    } finally { releaseLogout() }
    const loggedOut = await logoutA
    expect(loggedOut.status).toBe(200)
    expect(auth.logout).toHaveBeenCalledExactlyOnceWith(token)
    expect(loggedOut.headers['set-cookie']).toBeUndefined()
    auth.authenticate.mockImplementationOnce(async (candidate) => {
      if (candidate !== tokenB) throw unauthenticated()
      return { ...userB, workspaceId: 'workspace-b' }
    })
    const current = await browser.get('/api/auth/me')
    expect(current.status).toBe(200)
    expect(current.body).toEqual({ ok: true, value: { user: userB } })
  })

})
