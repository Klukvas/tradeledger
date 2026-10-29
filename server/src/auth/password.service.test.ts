import { describe, expect, it } from 'vitest'
import { PasswordService } from './password.service'

describe('PasswordService', () => {
  it('uses fresh salts, verifies exact passwords and rejects malformed cost parameters', async () => {
    const passwords = new PasswordService()
    const plaintext = '  correct horse battery staple  '
    const first = await passwords.hash(plaintext)
    const second = await passwords.hash(plaintext)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^scrypt\$v1\$131072\$8\$1\$/)
    expect(await passwords.verify(plaintext, first)).toBe(true)
    expect(await passwords.verify(plaintext.trim(), first)).toBe(false)
    expect(await passwords.verify('incorrect password', first)).toBe(false)
    expect(await passwords.verify(plaintext, first.replace('131072', '999999999999'))).toBe(false)
    expect(await passwords.verify(plaintext, 'invalid')).toBe(false)
    expect(await passwords.verify(plaintext, `${first}extra`)).toBe(false)
  })

  it('bounds expensive work and rejects excess queued jobs', async () => {
    const passwords = new PasswordService()
    const jobs = Array.from({ length: 10 }, () => passwords.hash('a sufficiently long password'))
    await expect(passwords.hash('another sufficient password')).rejects.toMatchObject({ status: 429 })
    const hashes = await Promise.all(jobs)
    expect(hashes).toHaveLength(10)
    expect(await passwords.verify('a sufficiently long password', hashes[0] ?? '')).toBe(true)
    await expect(passwords.hash('x'.repeat(257))).rejects.toMatchObject({ status: 400 })
  }, 15_000)
})
