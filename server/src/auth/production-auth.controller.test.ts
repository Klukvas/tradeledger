import 'reflect-metadata'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { APP_CONFIG, loadConfig } from '../config'
import { DatabaseService, LedgerRepository } from '../database'
import { configureHttp } from '../http'
import { AUTH_LIMITS, AuthLimiter } from './auth-limiter'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './password.service'
import { SessionGuard } from './session.guard'

const credentials = { email: 'owner@example.test', password: 'synthetic-test-passphrase' }

async function fixture(NODE_ENV: 'production' | 'test') {
  const config = loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example', PUBLIC_ORIGIN: 'https://example.test', NODE_ENV })
  const user = { id: 'owner', email: credentials.email, passwordHash: 'test-hash' }
  const hash = vi.fn(async () => 'test-hash')
  const createSession = vi.fn(async () => ({}))
  const createUser = vi.fn(async () => ({ id: user.id, email: user.email }))
  const createWorkspace = vi.fn(async () => 'workspace')
  const transaction = vi.fn(async (run: (tx: object) => Promise<unknown>) => run({ user: { create: createUser }, session: { create: createSession } }))
  const module = await Test.createTestingModule({ controllers: [AuthController], providers: [AuthService, AuthLimiter, SessionGuard,
    { provide: APP_CONFIG, useValue: config },
    { provide: AUTH_LIMITS, useValue: { windowMs: 60_000, registerPerIp: 10, loginPerIp: 10, totalPerWindow: 100, maxKeys: 100 } },
    { provide: DatabaseService, useValue: { $transaction: transaction, user: { findUnique: vi.fn(async () => user) }, session: { create: createSession } } },
    { provide: LedgerRepository, useValue: { createWorkspace } },
    { provide: PasswordService, useValue: { hash, verify: vi.fn(async () => true) } },
  ] }).compile()
  const app = module.createNestApplication({ bodyParser: false, logger: false })
  configureHttp(app, config)
  await app.init()
  const post = (path: string) => request(app.getHttpServer()).post(`/api/auth/${path}`)
    .set('Origin', config.publicOrigin).set('X-TradeLedger-Request', '1')
  return { app, post, hash, transaction, createUser, createSession, createWorkspace }
}

describe('production registration boundary', () => {
  it('rejects public registration before hashing or any account/session work, including malformed credentials', async () => {
    const test = await fixture('production')
    try {
      for (const body of [credentials, { email: 'invalid', password: 'short' }, {}]) {
        const response = await test.post('register').send(body)
        expect(response.status).toBe(403)
        expect(response.body).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Доступ предоставляет владелец TradeLedger.' } })
        expect(response.headers['set-cookie']).toBeUndefined()
      }
      expect(test.hash).not.toHaveBeenCalled()
      expect(test.transaction).not.toHaveBeenCalled()
      expect(test.createUser).not.toHaveBeenCalled()
      expect(test.createWorkspace).not.toHaveBeenCalled()
      expect(test.createSession).not.toHaveBeenCalled()
    } finally { await test.app.close() }
  })

  it('continues issuing Secure HttpOnly session cookies for HTTPS production login', async () => {
    const test = await fixture('production')
    try {
      const response = await test.post('login').send(credentials)
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true, value: { user: { id: 'owner', email: credentials.email } } })
      const cookie = response.headers['set-cookie']?.[0] ?? ''
      for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) expect(cookie).toContain(attribute)
      expect(test.createSession).toHaveBeenCalledOnce()
    } finally { await test.app.close() }
  })

  it('preserves test registration and its atomic account bootstrap', async () => {
    const test = await fixture('test')
    try {
      const response = await test.post('register').send(credentials)
      expect(response.status).toBe(200)
      expect(test.hash).toHaveBeenCalledExactlyOnceWith(credentials.password)
      expect(test.transaction).toHaveBeenCalledOnce()
      expect(test.createUser).toHaveBeenCalledOnce()
      expect(test.createWorkspace).toHaveBeenCalledOnce()
      expect(test.createSession).toHaveBeenCalledOnce()
      expect(response.headers['set-cookie']?.[0]).toContain('Secure')
    } finally { await test.app.close() }
  })
})
