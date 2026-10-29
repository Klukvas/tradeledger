import type { Money, Result } from './types'

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER)
const currencyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'UAH',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function invalidMoney(message: string): Result<never> {
  return { ok: false, error: { code: 'VALIDATION', message } }
}

export function checkedMoney(value: bigint): Result<Money> {
  if (value > MAX_MINOR || value < -MAX_MINOR) {
    return invalidMoney('Сумма выходит за допустимый диапазон.')
  }
  return { ok: true, value: Number(value) }
}

export function parseMoney(input: string, allowNegative = false): Result<Money> {
  const text = input.trim()
  const pattern = allowNegative ? /^-?\d+(?:[.,]\d{1,2})?$/ : /^\d+(?:[.,]\d{1,2})?$/
  if (!pattern.test(text)) {
    return invalidMoney('Введите сумму цифрами, максимум два знака после запятой.')
  }

  const isNegative = text.startsWith('-')
  const unsigned = isNegative ? text.slice(1) : text
  const [whole = '', fraction = ''] = unsigned.split(/[.,]/)
  const digits = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+/, '') || '0'
  if (digits.length > 16) return invalidMoney('Сумма выходит за допустимый диапазон.')
  const minor = BigInt(digits) * (isNegative ? -1n : 1n)
  return checkedMoney(minor)
}

export function formatMoney(minor: Money): string {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError('Денежная сумма должна быть безопасным целым числом копеек.')
  }

  const exact = BigInt(minor)
  const absolute = exact < 0n ? -exact : exact
  const whole = exact / 100n
  // Intl receives integer hryvnias to avoid losing kopecks near MAX_SAFE_INTEGER.
  const hasNegativeZeroWhole = whole === 0n && exact < 0n
  const displayWhole = hasNegativeZeroWhole ? -1n : whole
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return currencyFormatter.formatToParts(displayWhole).map((part) => {
    if (part.type === 'fraction') return fraction
    if (part.type === 'integer' && hasNegativeZeroWhole) return '0'
    return part.value
  }).join('')
}
