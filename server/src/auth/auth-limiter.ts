import { Inject, Injectable } from '@nestjs/common'
import { APP_CONFIG, type AppConfig } from '../config'
import { ApiException } from '../http'

export const AUTH_LIMITS = Symbol('AUTH_LIMITS')
export type AuthLimits = Readonly<{
  windowMs: number
  registerPerIp: number
  loginPerIp: number
  totalPerWindow: number
  maxKeys: number
}>
type Bucket = { count: number; expiresAt: number }

export function defaultAuthLimits(config: AppConfig): AuthLimits {
  return Object.freeze({ windowMs: 60_000, registerPerIp: config.isProduction ? 10 : 100,
    loginPerIp: config.isProduction ? 30 : 100, totalPerWindow: config.isProduction ? 300 : 2_000, maxKeys: 10_000 })
}

@Injectable()
export class AuthLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private global: Bucket = { count: 0, expiresAt: 0 }

  constructor(@Inject(AUTH_LIMITS) private readonly limits: AuthLimits) {}

  consume(operation: 'register' | 'login', ip: string): void {
    const now = Date.now()
    if (this.global.expiresAt <= now) this.global = { count: 0, expiresAt: now + this.limits.windowMs }
    if (this.global.count >= this.limits.totalPerWindow) this.reject()
    const key = `${operation}:${ip}`
    let bucket = this.buckets.get(key)
    if (!bucket || bucket.expiresAt <= now) {
      for (const [candidate, value] of this.buckets) if (value.expiresAt <= now) this.buckets.delete(candidate)
      if (this.buckets.size >= this.limits.maxKeys) this.reject()
      bucket = { count: 0, expiresAt: now + this.limits.windowMs }
      this.buckets.set(key, bucket)
    }
    const maximum = operation === 'register' ? this.limits.registerPerIp : this.limits.loginPerIp
    if (bucket.count >= maximum) this.reject()
    bucket.count += 1
    this.global.count += 1
  }

  private reject(): never { throw new ApiException(429, 'RATE_LIMITED', 'Слишком много попыток. Повторите позже.') }
}

export const authLimitsProvider = { provide: AUTH_LIMITS, inject: [APP_CONFIG], useFactory: defaultAuthLimits }
