import { describe, expect, it } from 'vitest'
import { validateDocument } from './schema'
import { applyCommand } from './commands'
import type { DocumentV1 } from './types'
import { createDocument, createEmptyState, FIXED_TIME } from '../test/fixtures'

function populated(): DocumentV1 {
  const account = applyCommand(createEmptyState(), { type: 'account.create', id: 'a1', name: 'ФОП', owner: 'Анна', provider: 'NovaPay', balanceMinor: -100, meta: { commandId: 'a', at: FIXED_TIME } })
  if (!account.ok) throw new Error(account.error.message)
  const snapshot = applyCommand(account.value, { type: 'snapshot.create', id: 's1', label: 'Замер', meta: { commandId: 's', at: FIXED_TIME } })
  if (!snapshot.ok) throw new Error(snapshot.error.message)
  return createDocument({ revision: 2, state: snapshot.value })
}
function rejects(input: unknown): void { expect(validateDocument(input).ok).toBe(false) }

describe('validateDocument', () => {
  it('accepts an empty document and round-trips a populated backup', () => {
    expect(validateDocument(createDocument())).toEqual({ ok: true, value: createDocument() })
    const document = populated()
    expect(validateDocument(JSON.parse(JSON.stringify(document)))).toEqual({ ok: true, value: document })
  })
  it.each([null, [], {}, 'json', { schemaVersion: 1 }, { ...createDocument(), revision: -1 }, { ...createDocument(), revision: 1.2 }, { ...createDocument(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...createDocument(), state: null }, { ...createDocument(), extra: true }])('rejects malformed structure %#', rejects)
  it.each(['inventory', 'accounts', 'debts', 'snapshots', 'audit'] as const)('rejects sparse %s arrays without throwing', (collection) => {
    const document = createDocument({ state: createEmptyState({ [collection]: new Array(1) }) })
    expect(() => validateDocument(document)).not.toThrow()
    expect(validateDocument(document)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })
  it('rejects sparse copied snapshot account arrays without throwing', () => {
    const document = populated()
    const snapshot = document.state.snapshots[0]
    if (!snapshot) throw new Error('Нет замера')
    const malformed = { ...document, state: { ...document.state, snapshots: [{ ...snapshot, accounts: new Array(1) }] } }
    expect(() => validateDocument(malformed)).not.toThrow()
    expect(validateDocument(malformed)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })
  it('distinguishes unsupported versions', () => {
    const result = validateDocument({ ...createDocument(), schemaVersion: 2 })
    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_VERSION' } })
  })
  it.each(['2026-02-29T00:00:00.000Z', '2026-04-31T00:00:00Z', 'yesterday', '2026-10-28', '2026-10-28T25:00:00Z', '2026-10-28T10:00:00'])('rejects invalid ISO timestamp %s', (updatedAt) => rejects({ ...createDocument(), updatedAt }))
  it('accepts real leap days and offset timestamps', () => {
    expect(validateDocument({ ...createDocument(), updatedAt: '2024-02-29T10:00:00+02:00' }).ok).toBe(true)
  })
  it('rejects duplicate ids in each entity list and copied snapshot accounts', () => {
    const document = populated()
    rejects({ ...document, state: { ...document.state, accounts: [...document.state.accounts, ...document.state.accounts] } })
    rejects({ ...document, state: { ...document.state, snapshots: [...document.state.snapshots, ...document.state.snapshots] } })
    rejects({ ...document, state: { ...document.state, audit: [...document.state.audit, ...document.state.audit] } })
    const snapshot = document.state.snapshots[0]
    if (!snapshot) throw new Error('Нет замера')
    rejects({ ...document, state: { ...document.state, snapshots: [{ ...snapshot, accounts: [...snapshot.accounts, ...snapshot.accounts], totalMinor: -200 }] } })
  })
  it('rejects duplicate SKUs after trimming and case folding', () => {
    const item = { id: 'i', sku: 'SKU', name: 'Товар', quantity: 1, stockValueMinor: 1 }
    rejects(createDocument({ state: createEmptyState({ inventory: [item, { ...item, id: 'other', sku: ' sku ' }] }) }))
  })
  it.each([
    { quantity: -1, stockValueMinor: 1 }, { quantity: 0.5, stockValueMinor: 1 },
    { quantity: 0, stockValueMinor: 1 }, { quantity: 1, stockValueMinor: -1 },
    { quantity: Number.MAX_SAFE_INTEGER + 1, stockValueMinor: 1 },
  ])('rejects invalid inventory values %#', (overrides) => rejects(createDocument({ state: createEmptyState({ inventory: [{ id: 'i', sku: 'SKU', name: 'Товар', ...overrides }] }) })))
  it('rejects missing account references and mismatched snapshot total', () => {
    const document = populated()
    const snapshot = document.state.snapshots[0]
    if (!snapshot) throw new Error('Нет замера')
    rejects({ ...document, state: { ...document.state, snapshots: [{ ...snapshot, totalMinor: 0 }] } })
    rejects({ ...document, state: { ...document.state, accounts: [] } })
  })
  it('rejects invalid providers and account money', () => {
    const document = populated()
    const account = document.state.accounts[0]
    rejects({ ...document, state: { ...document.state, accounts: [{ ...account, provider: 'unknown' }] } })
    rejects({ ...document, state: { ...document.state, accounts: [{ ...account, balanceMinor: Infinity }] } })
  })
  it('rejects invalid debt constraints and duplicate debt ids', () => {
    const debt = { id: 'd', direction: 'payable', counterparty: 'ФОП', principalMinor: 100, repaidMinor: 10, note: '' } as const
    for (const overrides of [{ principalMinor: 0 }, { repaidMinor: 101 }, { repaidMinor: -1 }, { direction: 'other' }]) {
      rejects(createDocument({ state: createEmptyState({ debts: [{ ...debt, ...overrides } as typeof debt] }) }))
    }
    rejects(createDocument({ state: createEmptyState({ debts: [debt, debt] }) }))
  })
  it('rejects section aggregate overflow but permits a derived difference outside range', () => {
    const account = { id: 'a', name: 'ФОП', owner: 'Анна', provider: 'MONO', balanceMinor: Number.MAX_SAFE_INTEGER } as const
    rejects(createDocument({ state: createEmptyState({ accounts: [account, { ...account, id: 'b', balanceMinor: 1 }] }) }))
    expect(validateDocument(createDocument({ state: createEmptyState({ accounts: [account], snapshots: [{ id: 's', label: 'Замер', createdAt: FIXED_TIME, accounts: [{ accountId: account.id, name: account.name, owner: account.owner, provider: account.provider, balanceMinor: -1 }], totalMinor: -1 }] }) })).ok).toBe(true)
  })
  it('rejects audit ids, dates, types and broken entity relationships', () => {
    const document = populated()
    const event = document.state.audit[0]
    if (!event) throw new Error('Нет истории')
    for (const overrides of [{ id: '' }, { at: 'bad' }, { type: 'account.delete' }, { entityId: 'missing' }, { entityId: null }, { summary: '' }]) {
      rejects({ ...document, state: { ...document.state, audit: [{ ...event, ...overrides }] } })
    }
  })
})
