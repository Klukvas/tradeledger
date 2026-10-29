import { describe, expect, it, vi } from 'vitest'
import { createCommandMeta, createId } from './ids'

describe('command identities', () => {
  it('uses a secure UUID and attaches an ISO timestamp', () => {
    const meta = createCommandMeta()
    expect(meta.commandId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(new Date(meta.at).toISOString()).toBe(meta.at)
    expect(createId()).not.toBe(meta.commandId)
  })

  it('supports HTTP LAN origins with getRandomValues but no randomUUID', () => {
    const secureCrypto = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto) })
    try {
      const ids = Array.from({ length: 100 }, createId)
      expect(new Set(ids).size).toBe(100)
      expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally { vi.unstubAllGlobals() }
  })

  it('fails clearly rather than generating a weak fallback when secure randomness is absent', () => {
    vi.stubGlobal('crypto', undefined)
    try { expect(createId).toThrow('безопасное создание идентификаторов') }
    finally { vi.unstubAllGlobals() }
  })
})
