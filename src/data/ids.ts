import type { CommandMeta, Id } from '../domain/types'

export function createId(): Id {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('Браузер не поддерживает безопасное создание идентификаторов.')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // UUID v4 also works on HTTP LAN origins that expose getRandomValues only.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createCommandMeta(): CommandMeta {
  return { commandId: createId(), at: new Date().toISOString() }
}
