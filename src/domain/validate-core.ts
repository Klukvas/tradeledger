import { checkedMoney } from './money'
import type { Failure, Result } from './types'

export class DomainError extends Error {
  constructor(readonly code: Failure['code'], message: string) { super(message) }
}

export function invalid(message: string): never { throw new DomainError('VALIDATION', message) }
export function fail(code: Failure['code'], message: string): never { throw new DomainError(code, message) }

export function resultOf<T>(operation: () => T): Result<T> {
  try { return { ok: true, value: operation() } }
  catch (error) {
    if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message } }
    throw error
  }
}

export function object(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`${label}: ожидается объект.`)
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(`${label}: неизвестные поля.`)
  if (keys.some((key) => !Object.hasOwn(value, key))) invalid(`${label}: заполните все поля.`)
  return value
}

export function text(input: unknown, label: string, max = 120, allowEmpty = false): string {
  if (typeof input !== 'string') invalid(`${label}: ожидается текст.`)
  const value = input.trim()
  if ((!allowEmpty && !value) || value.length > max || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    invalid(`${label}: ${allowEmpty ? 'не более' : 'от 1 до'} ${max} символов без управляющих знаков.`)
  }
  return value
}

export function id(input: unknown): string { return text(input, 'Идентификатор', 128) }
export function integer(input: unknown, label: string, minimum = 0): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum) {
    invalid(`${label}: введите целое число в допустимом диапазоне.`)
  }
  return input
}

export function money(input: unknown, label: string, minimum = 0): number { return integer(input, label, minimum) }
export function exactMoney(value: bigint): number {
  const result = checkedMoney(value)
  if (!result.ok) invalid(result.error.message)
  return result.value
}
export function sum(values: readonly number[]): number { return exactMoney(values.reduce((total, value) => total + BigInt(value), 0n)) }

export function oneOf<T extends string>(input: unknown, choices: readonly T[], label: string): T {
  if (typeof input !== 'string' || !choices.includes(input as T)) invalid(`${label}: недопустимое значение.`)
  return input as T
}
export const providers = ['MONO', 'NovaPay', 'other'] as const
export const directions = ['payable', 'receivable'] as const
export const commandTypes = ['inventory.create', 'inventory.update', 'inventory.receive', 'inventory.issue', 'account.create', 'account.update', 'account.setBalance', 'debt.create', 'debt.update', 'debt.repay', 'snapshot.create'] as const

export function isoDate(input: unknown): string {
  if (typeof input !== 'string') invalid('Дата: ожидается дата и время ISO.')
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(input)
  if (!match || !Number.isFinite(Date.parse(input))) invalid('Дата: укажите действительную дату и время ISO.')
  const [, year = '', month = '', day = ''] = match
  const numericYear = Number(year)
  const isLeap = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0)
  const days = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1] ?? 0
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days) invalid('Дата не существует.')
  return input
}

export function array<T>(input: unknown, parse: (entry: unknown) => T, label: string): T[] {
  if (!Array.isArray(input)) invalid(`${label}: ожидается список.`)
  return Array.from(input, parse)
}

export function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) invalid(`${label}: найдены повторы.`)
}
