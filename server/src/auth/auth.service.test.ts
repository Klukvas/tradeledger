import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config'
import type { DatabaseService, LedgerRepository, Tx } from '../database'
import { AuthService, parseCredentials, sessionTokenHash } from './auth.service'
import type { PasswordService } from './password.service'

const config = loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example' })
const token = 'a'.repeat(64)
const validSession: { expiresAt: Date; revokedAt: Date | null; user: { id: string; email: string; workspace: { id: string } } } = { expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
  user: { id: 'owner', email: 'owner@example.com', workspace: { id: 'owned-workspace' } } }

function setup(serviceConfig = config) {
  let failWorkspace = false
  let committedUsers: Array<{ id: string; email: string }> = []
  let committedSessions: Array<{ tokenHash: string; userId: string; expiresAt: Date }> = []
  const findUser = vi.fn(async () => null as { id: string; email: string; passwordHash: string } | null)
  const findSession = vi.fn(async () => validSession as typeof validSession | null)
  const createSession = vi.fn(async () => ({}))
  const updateSessions = vi.fn(async () => ({ count: 1 }))
  const createWorkspace = vi.fn(async () => {
    if (failWorkspace) throw new Error('workspace creation failed')
    return 'workspace'
  })
  const database = {
    user: { findUnique: findUser }, session: { findUnique: findSession, create: createSession, updateMany: updateSessions },
    $transaction: async <T>(run: (tx: Tx) => Promise<T>): Promise<T> => {
      const stagedUsers = [...committedUsers]
      const stagedSessions = [...committedSessions]
      const transaction = {
        user: { create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
          if (stagedUsers.some((user) => user.email === data.email)) throw { code: 'P2002' }
          const created = { id: 'new-user', email: data.email }
          stagedUsers.push(created)
          return created
        } },
        session: { create: async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => {
          stagedSessions.push(data)
          return data
        } },
      }
      const result = await run(transaction as unknown as Tx)
      committedUsers = stagedUsers
      committedSessions = stagedSessions
      return result
    },
  }
  const passwords = { hash: vi.fn(async () => 'derived-password-hash'), verify: vi.fn(async () => true), verifyDummy: vi.fn(async () => undefined) }
  const service = new AuthService(database as unknown as DatabaseService, { createWorkspace } as unknown as LedgerRepository,
    passwords as unknown as PasswordService, serviceConfig)
  return { service, passwords, findUser, findSession, createSession, updateSessions, createWorkspace,
    users: () => committedUsers, sessions: () => committedSessions, failWorkspace: () => { failWorkspace = true } }
}

describe('auth validation and registration', () => {
  it('keeps production account creation available to a trusted local caller', async () => {
    const fixture = setup(loadConfig({ DATABASE_URL: 'postgresql://example@127.0.0.1/example', NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com' }))
    const issued = await fixture.service.register(parseCredentials({ email: 'new@example.com', password: 'long enough password' }))
    expect(issued.user.email).toBe('new@example.com')
    expect(fixture.users()).toHaveLength(1)
    expect(fixture.sessions()).toHaveLength(1)
  })

  it('normalizes only email, rejects extra fields and bounds strings', () => {
    expect(parseCredentials({ email: ' Owner@Example.com ', password: '  secure passphrase  ' })).toEqual({ email: 'owner@example.com', password: '  secure passphrase  ' })
    for (const body of [{ email: 'bad', password: 'long enough password' }, { email: 'a@b.com', password: 'short' },
      { email: 'a@b.com', password: 'p'.repeat(257) }, { email: 'a@b.com', password: 'long enough password', workspaceId: 'foreign' }]) {
      expect(() => parseCredentials(body)).toThrowError(expect.objectContaining({ status: 400 }))
    }
  })

  it('commits user, workspace and only hashed session token together and rejects normalized duplicates', async () => {
    const fixture = setup()
    const issued = await fixture.service.register(parseCredentials({ email: ' New@Example.com ', password: 'long enough password' }))
    expect(issued.user).toEqual({ id: 'new-user', email: 'new@example.com' })
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/)
    expect(fixture.users()).toHaveLength(1)
    expect(fixture.sessions()).toEqual([{ userId: 'new-user', tokenHash: sessionTokenHash(issued.token), expiresAt: issued.expiresAt }])
    expect(JSON.stringify(fixture.sessions())).not.toContain(issued.token)
    expect(fixture.createWorkspace).toHaveBeenCalledOnce()
    await expect(fixture.service.register(parseCredentials({ email: 'NEW@example.com', password: 'long enough password' }))).rejects.toMatchObject({ status: 409 })
    expect(fixture.users()).toHaveLength(1)
    expect(fixture.sessions()).toHaveLength(1)
  })

  it('rolls back user and session when workspace bootstrap fails', async () => {
    const fixture = setup()
    fixture.failWorkspace()
    await expect(fixture.service.register(parseCredentials({ email: 'new@example.com', password: 'long enough password' }))).rejects.toThrow('workspace creation failed')
    expect(fixture.users()).toEqual([])
    expect(fixture.sessions()).toEqual([])
  })
})

describe('login and sessions', () => {
  it('performs dummy verification for unknown users and gives the same public credential error', async () => {
    const fixture = setup()
    const credentials = { email: 'owner@example.com', password: 'long enough password' }
    await expect(fixture.service.login(credentials)).rejects.toMatchObject({ status: 401, failure: { code: 'UNAUTHENTICATED', message: 'Неверный email или пароль.' } })
    expect(fixture.passwords.verifyDummy).toHaveBeenCalledWith(credentials.password)
    fixture.findUser.mockResolvedValue({ id: 'owner', email: credentials.email, passwordHash: 'stored hash' })
    fixture.passwords.verify.mockResolvedValue(false)
    await expect(fixture.service.login(credentials)).rejects.toMatchObject({ status: 401, failure: { code: 'UNAUTHENTICATED', message: 'Неверный email или пароль.' } })
    expect(fixture.createSession).not.toHaveBeenCalled()
  })

  it('issues an opaque session after password verification and never exposes the password hash', async () => {
    const fixture = setup()
    fixture.findUser.mockResolvedValue({ id: 'owner', email: 'owner@example.com', passwordHash: 'stored hash' })
    const result = await fixture.service.login({ email: 'owner@example.com', password: 'long enough password' })
    expect(result.user).toEqual({ id: 'owner', email: 'owner@example.com' })
    expect(fixture.createSession).toHaveBeenCalledWith({ data: { tokenHash: sessionTokenHash(result.token), userId: 'owner', expiresAt: result.expiresAt } })
  })

  it('rejects invalid, missing, expired and revoked sessions and looks up the owner from DB', async () => {
    const fixture = setup()
    for (const invalid of [undefined, '', 'bad', 'A'.repeat(64), ['a'.repeat(64)]]) {
      await expect(fixture.service.authenticate(invalid)).rejects.toMatchObject({ status: 401 })
    }
    expect(fixture.findSession).not.toHaveBeenCalled()
    expect(await fixture.service.authenticate(token)).toEqual({ id: 'owner', email: 'owner@example.com', workspaceId: 'owned-workspace' })
    fixture.findSession.mockResolvedValue(null)
    await expect(fixture.service.authenticate(token)).rejects.toMatchObject({ status: 401 })
    fixture.findSession.mockResolvedValue({ ...validSession, expiresAt: new Date(0) })
    await expect(fixture.service.authenticate(token)).rejects.toMatchObject({ status: 401 })
    fixture.findSession.mockResolvedValue({ ...validSession, revokedAt: new Date() })
    await expect(fixture.service.authenticate(token)).rejects.toMatchObject({ status: 401 })
  })

  it('revokes using update and fails closed when the database is unavailable', async () => {
    const fixture = setup()
    await fixture.service.logout(token)
    expect(fixture.updateSessions).toHaveBeenCalledWith({ where: { tokenHash: sessionTokenHash(token), revokedAt: null }, data: { revokedAt: expect.any(Date) } })
    fixture.findSession.mockRejectedValue(new Error('database unavailable'))
    await expect(fixture.service.authenticate(token)).rejects.toThrow('database unavailable')
  })
})
