import { describe, expect, it } from 'vitest'
import { canonicalJson } from './canonical'

describe('canonical JSON', () => {
  it('sorts nested keys but preserves array order', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }, 3], a: true })).toBe('{"a":true,"b":[{"a":2,"z":1},3]}')
    expect(canonicalJson({ a: true, b: [{ a: 2, z: 1 }, 3] })).toBe(canonicalJson({ b: [{ z: 1, a: 2 }, 3], a: true }))
  })

  it('rejects non-JSON values rather than silently hashing a different payload', () => {
    for (const value of [undefined, NaN, Infinity, new Date(), { missing: undefined }, BigInt(1)]) {
      expect(() => canonicalJson(value)).toThrow(TypeError)
    }
  })
})
