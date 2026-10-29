import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import { Client } from 'pg'
import request from 'supertest'
import type { Response, Test as HttpTest } from 'supertest'
import type { ApiResult, AuthResponse, CommandResponse } from '../../../shared/api'
import type { Command, DocumentV1 } from '../../../src/domain/types'
import type { DatabaseService, LedgerRepository } from '../../src/database'
import type { AppConfig } from '../../src/config'

type LocalKeys = Readonly<{ admin: string; app: string }>
type DbHelpers = Readonly<{
  credentials: () => Promise<LocalKeys>
  databaseUrl: (password: string, options?: { admin: boolean }) => string
  run: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; quiet: boolean; secrets: string[] }) => Promise<unknown>
}>
export type Actor = Readonly<{ id: string; email: string; cookie: string }>
export type CommandInput = { [Kind in Command['type']]: Omit<Extract<Command, { type: Kind }>, 'meta'> }[Command['type']]
export const origin = 'http://127.0.0.1:5178'
export const historicalAt = '2020-02-29T10:20:30+02:00'
// Synthetic integration fixture, never a credential for a real account.
export const fixturePassword = 'integration-fixture-password-2026'
const root = resolve(__dirname, '../../..')
const compiled = createRequire(resolve(root, 'server/package.json'))

export function value<T>(response: Response): T {
  const body = response.body as ApiResult<T>
  if (!body.ok) throw new Error(`Expected successful HTTP response, got ${response.status}/${body.error?.code ?? 'unknown'}`)
  return body.value
}

export function command(input: CommandInput, commandId: string = randomUUID()): Command {
  return { ...input, meta: { commandId, at: historicalAt } } as Command
}

export type Harness = Readonly<{
  app: INestApplication
  database: DatabaseService
  repository: LedgerRepository
  sql: Client
  databaseName: string
  get: (path: string, actor?: Actor) => HttpTest
  post: (path: string, body: object | string, actor?: Actor) => HttpTest
  register: () => Promise<Actor>
  read: (actor: Actor) => Promise<DocumentV1>
  execute: (actor: Actor, input: CommandInput) => Promise<CommandResponse>
  workspace: (actor: Actor) => ReturnType<DatabaseService['workspace']['findUniqueOrThrow']>
  close: () => Promise<void>
}>

/** Every run creates and retains its own database; no application database is reset or dropped. */
export async function startHarness(options: Readonly<{ origin?: string; reuseDatabaseName?: string }> = {}): Promise<Harness> {
  const requestOrigin = options.origin ?? origin
  const helperUrl = pathToFileURL(resolve(root, 'scripts/db-env.mjs')).href
  const helpers = await import(/* @vite-ignore */ helperUrl) as DbHelpers
  const keys = await helpers.credentials()
  const databaseName = options.reuseDatabaseName ?? `tradeledger_it_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  if (!/^tradeledger_it_[a-z0-9_]+$/.test(databaseName)) throw new Error('Invalid isolated database name')
  const adminUrl = new URL(helpers.databaseUrl(keys.admin, { admin: true }))
  const appUrl = new URL(helpers.databaseUrl(keys.app))
  if (adminUrl.hostname !== '127.0.0.1' || adminUrl.port !== '5439' || appUrl.port !== '5439') {
    throw new Error('Integration tests require the task-owned local PostgreSQL on 5439')
  }
  const creator = new Client({ connectionString: adminUrl.href })
  try {
    await creator.connect()
    // PostgreSQL cannot parameterize identifiers; this identifier is generated and allowlisted above.
    if (!options.reuseDatabaseName) await creator.query(`CREATE DATABASE "${databaseName}"`)
  } catch { throw new Error('Could not create isolated integration database; existing databases preserved') }
  finally { await creator.end() }
  adminUrl.pathname = `/${databaseName}`
  appUrl.pathname = `/${databaseName}`
  if (!options.reuseDatabaseName) await helpers.run('npm', ['run', 'db:migrate'], {
    env: { ...process.env, DATABASE_URL: adminUrl.href }, quiet: true,
    secrets: [keys.admin, keys.app, adminUrl.href, appUrl.href],
  })
  const grant = new Client({ connectionString: adminUrl.href })
  try {
    await grant.connect()
    await grant.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT CONNECT ON DATABASE "${databaseName}" TO tradeledger_app;
      GRANT USAGE ON SCHEMA public TO tradeledger_app;
      GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO tradeledger_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tradeledger_app;
      REVOKE ALL ON TABLE public._prisma_migrations FROM tradeledger_app;`)
  } catch { throw new Error('Could not prepare isolated integration database privileges') }
  finally { await grant.end() }

  // Runtime classes and symbols must come from one compiled module graph. Vitest/esbuild
  // does not emit Nest constructor metadata for implicit dependencies in source modules.
  const { AppModule } = compiled('./dist/server/src/app.module.js') as typeof import('../../src/app.module')
  const { APP_CONFIG, loadConfig } = compiled('./dist/server/src/config/index.js') as typeof import('../../src/config')
  const { AUTH_LIMITS } = compiled('./dist/server/src/auth/auth-limiter.js') as typeof import('../../src/auth/auth-limiter')
  const { configureHttp } = compiled('./dist/server/src/http/index.js') as typeof import('../../src/http')
  const databaseTypes = compiled('./dist/server/src/database/index.js') as typeof import('../../src/database')
  const config: AppConfig = loadConfig({ DATABASE_URL: appUrl.href, PUBLIC_ORIGIN: requestOrigin, NODE_ENV: 'test' })
  const testing = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(AUTH_LIMITS).useValue({ windowMs: 60_000, registerPerIp: 1_000, loginPerIp: 1_000, totalPerWindow: 5_000, maxKeys: 1_000 })
    .compile()
  const app = testing.createNestApplication({ bodyParser: false, logger: false })
  configureHttp(app, config)
  const sql = new Client({ connectionString: appUrl.href })
  try { await app.init(); await sql.connect() }
  catch { await app.close(); await sql.end(); throw new Error('Isolated integration application could not initialize') }
  process.stdout.write(`[integration] Retained isolated database: ${databaseName}\n`)
  const get = (path: string, actor?: Actor): HttpTest => {
    const operation = request(app.getHttpServer()).get(`/api${path}`)
    return actor ? operation.set('Cookie', actor.cookie).set('X-TradeLedger-User', actor.id) : operation
  }
  const post = (path: string, body: object | string, actor?: Actor): HttpTest => {
    const operation = request(app.getHttpServer()).post(`/api${path}`).set('Origin', requestOrigin)
      .set('X-TradeLedger-Request', '1').send(body)
    return actor ? operation.set('Cookie', actor.cookie).set('X-TradeLedger-User', actor.id) : operation
  }
  const register = async (): Promise<Actor> => {
    const email = `integration-${randomUUID()}@example.test`
    const response = await post('/auth/register', { email, password: fixturePassword }).expect(200)
    const user = value<AuthResponse>(response).user
    const header = response.headers['set-cookie'] as string[] | undefined
    const cookie = header?.[0]?.split(';')[0]
    if (!cookie) throw new Error('Registration did not issue a session cookie')
    return { ...user, cookie }
  }
  const read = async (actor: Actor): Promise<DocumentV1> => value<DocumentV1>(await get('/ledger', actor).expect(200))
  const execute = async (actor: Actor, input: CommandInput): Promise<CommandResponse> => {
    const before = await read(actor)
    return value<CommandResponse>(await post('/ledger/commands', { expectedRevision: before.revision, command: command(input) }, actor).expect(200))
  }
  const database = app.get<DatabaseService>(databaseTypes.DatabaseService)
  return {
    app, sql, database, databaseName, get, post, register, read, execute,
    repository: app.get<LedgerRepository>(databaseTypes.LedgerRepository),
    workspace: (actor) => database.workspace.findUniqueOrThrow({ where: { userId: actor.id } }),
    close: async () => { await app.close(); await sql.end() },
  }
}
