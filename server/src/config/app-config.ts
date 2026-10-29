import { z } from 'zod'

export const APP_CONFIG = Symbol('APP_CONFIG')
export type AppConfig = Readonly<{
  databaseUrl: string
  publicOrigin: string
  port: number
  host: string
  isProduction: boolean
  sessionCookieName: string
  sessionTtlMs: number
  secureCookies: boolean
  trustProxyHops: 0 | 1
}>

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PUBLIC_ORIGIN: z.string().default('http://127.0.0.1:5178'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5180),
  HOST: z.string().min(1).default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRUST_PROXY_HOPS: z.enum(['0', '1']).default('0'),
})

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment)
  if (!parsed.success) throw new Error('Invalid server configuration: check DATABASE_URL, PUBLIC_ORIGIN, PORT, HOST, NODE_ENV and TRUST_PROXY_HOPS.')
  const value = parsed.data
  let database: URL
  let origin: URL
  try { database = new URL(value.DATABASE_URL); origin = new URL(value.PUBLIC_ORIGIN) }
  catch { throw new Error('Invalid DATABASE_URL or PUBLIC_ORIGIN configuration.') }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname) {
    throw new Error('DATABASE_URL must identify a PostgreSQL database.')
  }
  if (origin.origin !== value.PUBLIC_ORIGIN || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) {
    throw new Error('PUBLIC_ORIGIN must be an exact HTTP(S) origin without a path or credentials.')
  }
  const isProduction = value.NODE_ENV === 'production'
  const secureCookies = origin.protocol === 'https:'
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
  if (!secureCookies && (isProduction || !isLoopback)) {
    throw new Error('HTTPS is required outside loopback development.')
  }
  return Object.freeze({
    databaseUrl: value.DATABASE_URL,
    publicOrigin: origin.origin,
    port: value.PORT,
    host: value.HOST,
    isProduction,
    sessionCookieName: 'tradeledger_session',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    secureCookies,
    trustProxyHops: value.TRUST_PROXY_HOPS === '1' ? 1 : 0,
  })
}
