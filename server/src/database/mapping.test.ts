import { describe, expect, it } from 'vitest'
import { safeNumber } from './mapping'

describe('database safe integer serialization', () => {
  it('serializes both signed safe integer boundaries without losing precision', () => {
    expect(safeNumber(9007199254740991n)).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeNumber(-9007199254740991n)).toBe(-Number.MAX_SAFE_INTEGER)
    expect(() => safeNumber(9007199254740992n)).toThrow()
    expect(() => safeNumber(-9007199254740992n)).toThrow()
  })
})
