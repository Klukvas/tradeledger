import { describe, expect, it } from 'vitest'
import { checkedMoney, formatMoney, parseMoney } from './money'

describe('parseMoney', () => {
  it.each([
    ['0', 0], ['0012', 1200], ['12,3', 1230], ['12.34', 1234],
    ['  0,01  ', 1], ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('parses %s as exact kopecks', (input, expected) => {
    expect(parseMoney(input)).toEqual({ ok: true, value: expected })
  })

  it('preserves negative balances only when requested', () => {
    expect(parseMoney('-0,01', true)).toEqual({ ok: true, value: -1 })
    expect(parseMoney('-90071992547409.91', true)).toEqual({ ok: true, value: -Number.MAX_SAFE_INTEGER })
    expect(parseMoney('-1')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(parseMoney('-0', true)).toEqual({ ok: true, value: 0 })
  })

  it.each(['', ' ', '+1', '1e3', '0x10', 'NaN', 'Infinity', '.5', '1.', '1,234',
    '1.001', '1,2.3', '1 234,56', '1\u00a0234', '--1', '90071992547409.92',
    '-90071992547409.92', '999999999999999999999999999999'])('rejects invalid/unsafe %s without rounding', (input) => {
    expect(parseMoney(input, true)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })

  it('does not introduce floating point multiplication errors', () => {
    expect(parseMoney('0.29')).toEqual({ ok: true, value: 29 })
    expect(parseMoney('1.005')).toMatchObject({ ok: false })
  })
})

describe('checkedMoney', () => {
  it('rejects either sign of overflow before conversion to number', () => {
    const maximum = BigInt(Number.MAX_SAFE_INTEGER)
    expect(checkedMoney(maximum)).toEqual({ ok: true, value: Number.MAX_SAFE_INTEGER })
    expect(checkedMoney(maximum + 1n)).toMatchObject({ ok: false })
    expect(checkedMoney(-maximum - 1n)).toMatchObject({ ok: false })
  })
})

describe('formatMoney', () => {
  const normalize = (value: string): string => value.replace(/[\u00a0\u202f]/g, ' ')

  it('formats hryvnias in Russian locale with two kopeck digits', () => {
    expect(normalize(formatMoney(123456))).toBe('1 234,56 ₴')
    expect(normalize(formatMoney(0))).toBe('0,00 ₴')
    expect(normalize(formatMoney(-1))).toBe('-0,01 ₴')
  })

  it('keeps the last kopeck exact at either boundary', () => {
    expect(normalize(formatMoney(Number.MAX_SAFE_INTEGER))).toBe('90 071 992 547 409,91 ₴')
    expect(normalize(formatMoney(-Number.MAX_SAFE_INTEGER))).toBe('-90 071 992 547 409,91 ₴')
  })

  it.each([1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid minor value %s', (input) => {
    expect(() => formatMoney(input)).toThrow(RangeError)
  })
})
