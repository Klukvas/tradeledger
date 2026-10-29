import { PrismaClientInitializationError, PrismaClientKnownRequestError } from '@prisma/client/runtime/client'
import { describe, expect, it } from 'vitest'
import { publicError } from './api-exception.filter'

const privateMessage = 'SELECT password FROM private; postgresql://private:password@database.example/private'
const unavailable = { status: 503, error: { code: 'UNAVAILABLE', message: 'Сервис временно недоступен.' } }

describe('database outage responses', () => {
  it('sanitizes initialization and connection/pool codes', () => {
    const initialization = new PrismaClientInitializationError(privateMessage, '7.10.1', 'P1001')
    const prismaErrors = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2037'].map((code) => new PrismaClientKnownRequestError(privateMessage, { code, clientVersion: '7.10.1' }))
    const driverErrors = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].map((code) => Object.assign(new Error(privateMessage), { code }))
    for (const error of [initialization, ...prismaErrors, ...driverErrors]) {
      expect(publicError(error)).toEqual(unavailable)
      expect(JSON.stringify(publicError(error))).not.toContain(privateMessage)
    }
  })

  it('recognizes Prisma pg adapter failure shapes nested in known errors', () => {
    for (const kind of ['DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout', 'TooManyConnections', 'TlsConnectionError']) {
      const driverAdapterError = Object.assign(new Error(privateMessage), { name: 'DriverAdapterError', cause: { kind, originalMessage: privateMessage } })
      const error = new PrismaClientKnownRequestError(privateMessage, { code: 'P2010', clientVersion: '7.10.1', meta: { driverAdapterError } })
      expect(publicError(error)).toEqual(unavailable)
      expect(publicError(driverAdapterError)).toEqual(unavailable)
    }
  })

  it('handles structured causes and explicitly tagged pool timeouts without reading messages', () => {
    expect(publicError(new Error(privateMessage, { cause: { code: 'ETIMEDOUT' } }))).toEqual(unavailable)
    expect(publicError(Object.assign(new Error(privateMessage), { name: 'DatabasePoolTimeoutError' }))).toEqual(unavailable)
    const withoutReadableMessage = { code: 'ECONNREFUSED', get message(): never { throw new Error('Must not inspect message') } }
    expect(publicError(withoutReadableMessage)).toEqual(unavailable)
  })

  it('keeps constraint failures and unknown errors at generic 500', () => {
    const errors = [
      new Error(privateMessage),
      new Error('timeout exceeded when trying to connect'),
      new PrismaClientKnownRequestError(privateMessage, { code: 'P2002', clientVersion: '7.10.1' }),
      new PrismaClientKnownRequestError(privateMessage, { code: 'P2010', clientVersion: '7.10.1', meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind: 'UniqueConstraintViolation' } } } }),
    ]
    for (const error of errors) expect(publicError(error)).toEqual({ status: 500, error: { code: 'STORAGE', message: 'Не удалось выполнить запрос.' } })
  })

  it('bounds cyclic cause traversal', () => {
    const cyclic = new Error(privateMessage)
    cyclic.cause = cyclic
    expect(publicError(cyclic).status).toBe(500)
  })
})
