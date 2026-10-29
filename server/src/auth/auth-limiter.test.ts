import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthLimiter } from './auth-limiter'

const limits = { windowMs: 60_000, registerPerIp: 1, loginPerIp: 2, totalPerWindow: 3, maxKeys: 10 }
afterEach(() => { vi.useRealTimers() })

describe('AuthLimiter', () => {
  it('limits before work, separates operations, and expires windows', () => {
    vi.useFakeTimers()
    const limiter = new AuthLimiter(limits)
    limiter.consume('register', 'client')
    expect(() => limiter.consume('register', 'client')).toThrowError(expect.objectContaining({ status: 429 }))
    limiter.consume('login', 'client')
    limiter.consume('login', 'client')
    expect(() => limiter.consume('login', 'different')).toThrowError(expect.objectContaining({ status: 429 }))
    vi.advanceTimersByTime(60_000)
    expect(() => limiter.consume('register', 'client')).not.toThrow()
  })

  it('bounds distinct client buckets', () => {
    const limiter = new AuthLimiter({ ...limits, maxKeys: 1 })
    limiter.consume('login', 'first')
    expect(() => limiter.consume('login', 'second')).toThrowError(expect.objectContaining({ status: 429 }))
  })
})
