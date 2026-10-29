import { Injectable, type OnModuleInit } from '@nestjs/common'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { ApiException } from '../http'

const COST = 131_072
const BLOCK_SIZE = 8
const PARALLELISM = 1
const KEY_LENGTH = 64
const MAX_MEMORY = 256 * 1024 * 1024
const PREFIX = `scrypt$v1$${COST}$${BLOCK_SIZE}$${PARALLELISM}`
const HASH_PATTERN = /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/

/** Two 128 MiB jobs at most; queued requests are also bounded. */
@Injectable()
export class PasswordService implements OnModuleInit {
  private active = 0
  private readonly waiting: Array<() => void> = []
  private dummyHash: Promise<string> | undefined

  async onModuleInit(): Promise<void> { await this.getDummyHash() }

  async hash(password: string): Promise<string> {
    this.requireBoundedPassword(password)
    const salt = randomBytes(16).toString('hex')
    const key = await this.derive(password, salt)
    return `${PREFIX}$${salt}$${key.toString('hex')}`
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    this.requireBoundedPassword(password)
    // Accept only the supported cost profile: DB corruption cannot request arbitrary memory.
    const match = encoded.length === 182 ? HASH_PATTERN.exec(encoded) : null
    const salt = match?.[1]
    const expected = match?.[2]
    if (!salt || !expected) return false
    const actual = await this.derive(password, salt)
    return timingSafeEqual(actual, Buffer.from(expected, 'hex'))
  }

  async verifyDummy(password: string): Promise<void> {
    await this.verify(password, await this.getDummyHash())
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('hex'))
    return this.dummyHash
  }

  private requireBoundedPassword(password: string): void {
    if (typeof password !== 'string' || password.length > 256) {
      throw new ApiException(400, 'VALIDATION', 'Пароль должен содержать от 12 до 256 символов.')
    }
  }

  private async derive(password: string, salt: string): Promise<Buffer> {
    if (this.active >= 2) {
      if (this.waiting.length >= 8) throw new ApiException(429, 'RATE_LIMITED', 'Слишком много попыток. Повторите позже.')
      await new Promise<void>((resolve) => { this.waiting.push(resolve) })
    } else this.active += 1
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY }, (error, key) => {
          if (error) reject(error)
          else resolve(key)
        })
      })
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active -= 1
    }
  }
}
