import { describe, expect, it } from 'vitest'
import { loadConfig } from './app-config'

const environment = { DATABASE_URL: 'postgresql://example@127.0.0.1:5439/example' }

describe('server configuration', () => {
  it('requires a PostgreSQL URL without reflecting its value in errors', () => {
    expect(() => loadConfig({})).toThrow('Invalid server configuration')
    expect(() => loadConfig({ DATABASE_URL: 'secret-value' })).toThrow('Invalid DATABASE_URL or PUBLIC_ORIGIN')
    expect(() => loadConfig({ DATABASE_URL: 'https://example.com' })).toThrow('PostgreSQL')
  })

  it('permits HTTP cookies only on loopback in development', () => {
    expect(loadConfig(environment)).toMatchObject({ port: 5180, secureCookies: false, sessionCookieName: 'tradeledger_session' })
    expect(() => loadConfig({ ...environment, PUBLIC_ORIGIN: 'http://example.com' })).toThrow('HTTPS')
    expect(() => loadConfig({ ...environment, NODE_ENV: 'production' })).toThrow('HTTPS')
    expect(loadConfig({ ...environment, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com' }).secureCookies).toBe(true)
  })

  it('requires an exact origin and a valid port', () => {
    for (const PUBLIC_ORIGIN of ['null', 'http://127.0.0.1:5178/', 'http://127.0.0.1:5178/path', 'https://user:password@example.com']) {
      expect(() => loadConfig({ ...environment, PUBLIC_ORIGIN })).toThrow()
    }
    for (const PORT of ['0', '65536', 'not-a-number', '5180.5']) expect(() => loadConfig({ ...environment, PORT })).toThrow()
  })

  it('trusts no proxy by default and permits exactly one explicit proxy hop', () => {
    expect(loadConfig(environment).trustProxyHops).toBe(0)
    expect(loadConfig({ ...environment, TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0)
    expect(loadConfig({ ...environment, TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1)
    for (const TRUST_PROXY_HOPS of ['true', '2', '-1', '', '1.0', 'loopback']) {
      expect(() => loadConfig({ ...environment, TRUST_PROXY_HOPS })).toThrow('TRUST_PROXY_HOPS')
    }
  })
})
