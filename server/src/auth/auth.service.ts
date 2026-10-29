import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { AuthRequest, PublicUser } from '../../../shared/api'
import { APP_CONFIG, type AppConfig } from '../config'
import { DatabaseService, LedgerRepository } from '../database'
import { ApiException } from '../http'
import type { AuthenticatedUser } from './auth.types'
import { PasswordService } from './password.service'

const credentialsSchema = z.strictObject({
  email: z.string().max(254).trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(12).max(256),
})
export type IssuedSession = Readonly<{ user: PublicUser; token: string; expiresAt: Date }>

export function parseCredentials(body: unknown): AuthRequest {
  const parsed = credentialsSchema.safeParse(body)
  if (!parsed.success) throw new ApiException(400, 'VALIDATION', 'Введите корректный email и пароль от 12 до 256 символов.')
  return parsed.data
}

export function sessionTokenHash(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
  return createHash('sha256').update(token).digest('hex')
}

export function unauthenticated(): ApiException {
  return new ApiException(401, 'UNAUTHENTICATED', 'Требуется вход в аккаунт.')
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LedgerRepository) private readonly repository: LedgerRepository,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(credentials: AuthRequest): Promise<IssuedSession> {
    const passwordHash = await this.passwords.hash(credentials.password)
    const session = this.newSession()
    try {
      const user = await this.database.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { email: credentials.email, passwordHash }, select: { id: true, email: true } })
        await this.repository.createWorkspace(tx, created.id)
        await tx.session.create({ data: { tokenHash: session.hash, userId: created.id, expiresAt: session.expiresAt } })
        return created
      })
      return { user, token: session.token, expiresAt: session.expiresAt }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new ApiException(409, 'CONFLICT', 'Аккаунт с этим email уже существует.')
      }
      throw error
    }
  }

  async login(credentials: AuthRequest): Promise<IssuedSession> {
    const user = await this.database.user.findUnique({ where: { email: credentials.email }, select: { id: true, email: true, passwordHash: true } })
    if (!user) {
      await this.passwords.verifyDummy(credentials.password)
      throw this.invalidCredentials()
    }
    if (!await this.passwords.verify(credentials.password, user.passwordHash)) throw this.invalidCredentials()
    const session = this.newSession()
    await this.database.session.create({ data: { tokenHash: session.hash, userId: user.id, expiresAt: session.expiresAt } })
    return { user: { id: user.id, email: user.email }, token: session.token, expiresAt: session.expiresAt }
  }

  async authenticate(token: unknown): Promise<AuthenticatedUser> {
    const tokenHash = sessionTokenHash(token)
    if (!tokenHash) throw unauthenticated()
    const session = await this.database.session.findUnique({ where: { tokenHash }, select: {
      expiresAt: true, revokedAt: true, user: { select: { id: true, email: true, workspace: { select: { id: true } } } },
    } })
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.user.workspace) throw unauthenticated()
    return { id: session.user.id, email: session.user.email, workspaceId: session.user.workspace.id }
  }

  async logout(token: unknown): Promise<void> {
    const tokenHash = sessionTokenHash(token)
    if (!tokenHash) throw unauthenticated()
    await this.database.session.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
  }

  private newSession(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('hex')
    return { token, hash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + this.config.sessionTtlMs) }
  }

  private invalidCredentials(): ApiException { return new ApiException(401, 'UNAUTHENTICATED', 'Неверный email или пароль.') }
}
