import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandRequest } from '../../../shared/api'
import type { Command, DocumentV1, LedgerState } from '../../../src/domain/types'
import type { LedgerRepository, LockedWorkspace, Tx } from '../database'
import { commandRequestHash, parseCommandRequest } from './command-request'
import { MutationService } from './mutation.service'

vi.mock('../database/account-history', () => ({ serializedTime: async () => new Date() }))

const clientAt = '2001-01-01T00:00:00.000Z'
const serverAt = '2026-10-29T01:02:03.456Z'
const empty: DocumentV1 = {
  schemaVersion: 1, revision: 0, updatedAt: clientAt,
  state: { inventory: [], accounts: [], debts: [], snapshots: [], audit: [] },
}
const create: Command = {
  type: 'account.create', id: 'account-1', name: 'Cash', owner: 'Owner', provider: 'other', balanceMinor: 100,
  meta: { commandId: 'request-1', at: clientAt },
}
type Receipt = Readonly<{
  requestId: string; requestKind: string; requestHash: string; datasetId: string
  committedRevision: bigint; committedAt: Date
}>
type FailurePoint = 'persist' | 'workspace' | 'receipt' | 'commit'

function documentWith(state: Partial<LedgerState>): DocumentV1 {
  return { ...empty, state: { ...empty.state, ...state } }
}

/** Staging models the repository transaction boundary, including failure at commit. */
function setup(initial = empty, initialReceipts: readonly Receipt[] = []) {
  let committed = { document: structuredClone(initial), receipts: [...initialReceipts], commands: [] as Command[] }
  let failure: FailurePoint | undefined
  let staged: typeof committed | undefined
  let attempts: readonly string[] = []
  let scopedUser: string | undefined
  const requireStage = () => {
    if (!staged) throw new Error('outside transaction')
    return staged
  }
  const write = (point: FailurePoint) => {
    attempts = [...attempts, point]
    if (failure === point) throw new Error(`failure at ${point}`)
  }
  const workspace = (): LockedWorkspace => ({
    id: 'owned-workspace', userId: 'owner', activeDatasetId: 'active-dataset',
    revision: BigInt(committed.document.revision), updatedAt: new Date(committed.document.updatedAt),
  })
  const transaction = {
    commandReceipt: {
      findUnique: async ({ where }: { where: { workspaceId_requestId: { workspaceId: string; requestId: string } } }) => {
        expect(where.workspaceId_requestId.workspaceId).toBe('owned-workspace')
        return requireStage().receipts.find((receipt) => receipt.requestId === where.workspaceId_requestId.requestId) ?? null
      },
      create: async ({ data }: { data: Receipt }) => {
        write('receipt')
        const current = requireStage()
        staged = { ...current, receipts: [...current.receipts, data] }
        return data
      },
    },
    workspace: { update: async ({ where, data }: { where: { id: string }; data: { revision: bigint; updatedAt: Date } }) => {
      write('workspace')
      expect(where.id).toBe('owned-workspace')
      const current = requireStage()
      staged = { ...current, document: { ...current.document, revision: Number(data.revision), updatedAt: data.updatedAt.toISOString() } }
      return data
    } },
  }
  const repository = {
    withLockedWorkspace: async <T>(userId: string, run: (tx: Tx, locked: LockedWorkspace) => Promise<T>): Promise<T> => {
      scopedUser = userId
      staged = structuredClone(committed)
      try {
        const result = await run(transaction as unknown as Tx, workspace())
        if (failure === 'commit') throw new Error('failure at commit')
        committed = requireStage()
        return result
      } finally { staged = undefined }
    },
    readDocument: async () => requireStage().document,
    persistCommand: async (_tx: Tx, _workspace: LockedWorkspace, before: DocumentV1, after: DocumentV1, command: Command) => {
      write('persist')
      expect(before).toEqual(requireStage().document)
      staged = { ...requireStage(), document: after, commands: [...requireStage().commands, command] }
    },
  }
  return {
    service: new MutationService(repository as unknown as LedgerRepository),
    state: () => committed, attempts: () => attempts, user: () => scopedUser,
    fail: (point: FailurePoint) => { failure = point },
  }
}

afterEach(() => vi.useRealTimers())

describe('command request boundary', () => {
  it('strictly validates the envelope, safe integer bounds and the original domain command', () => {
    const valid = { expectedRevision: 0, command: create }
    expect(parseCommandRequest(valid)).toEqual(valid)
    for (const input of [null, [], { command: create }, { ...valid, workspaceId: 'foreign' },
      ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0'].map((expectedRevision) => ({ ...valid, expectedRevision })),
      { ...valid, command: { ...create, workspaceId: 'foreign' } },
      { ...valid, command: { ...create, id: 'x'.repeat(129) } },
      { ...valid, command: { ...create, balanceMinor: Number.MAX_SAFE_INTEGER + 1 } },
      { ...valid, command: { ...create, meta: { ...create.meta, at: '2026-02-30T00:00:00Z' } } },
    ]) expect(() => parseCommandRequest(input)).toThrowError(expect.objectContaining({ status: 400, failure: { code: 'VALIDATION', message: expect.any(String) } }))
  })

  it('hashes validated trimmed payload and commandId, excluding client time and revision', () => {
    const first = parseCommandRequest({ expectedRevision: 0, command: { ...create, name: ' Cash ' } })
    const retry = parseCommandRequest({ expectedRevision: 80, command: { ...create, meta: { ...create.meta, at: serverAt } } })
    expect(commandRequestHash(first.command)).toMatch(/^[a-f0-9]{64}$/)
    expect(commandRequestHash(first.command)).toBe(commandRequestHash(retry.command))
    expect(commandRequestHash({ ...create, balanceMinor: 101 })).not.toBe(commandRequestHash(create))
    expect(commandRequestHash({ ...create, meta: { ...create.meta, commandId: 'new-id' } })).not.toBe(commandRequestHash(create))
  })

  it('revalidates a typed caller before entering a transaction', async () => {
    const fixture = setup()
    const unsafe = { expectedRevision: 0, command: create, workspaceId: 'foreign' } as CommandRequest
    await expect(fixture.service.execute('owner', unsafe)).rejects.toMatchObject({ status: 400 })
    expect(fixture.user()).toBeUndefined()
    expect(fixture.state().document).toEqual(empty)
  })
})

describe('atomic command coordination', () => {
  it('commits the normalized command, revision, receipt and server timestamps together', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(serverAt))
    const fixture = setup()
    const response = await fixture.service.execute('owner', { expectedRevision: 0, command: create })
    expect(fixture.user()).toBe('owner')
    expect(response).toEqual({ replayed: false, document: fixture.state().document })
    expect(response.document.revision).toBe(1)
    expect(response.document.updatedAt).toBe(serverAt)
    expect(response.document.state.accounts).toEqual([{ id: 'account-1', name: 'Cash', owner: 'Owner', provider: 'other', balanceMinor: 100 }])
    expect(response.document.state.audit).toEqual([expect.objectContaining({ id: 'request-1', at: serverAt })])
    expect(fixture.state().commands).toEqual([{ ...create, meta: { ...create.meta, at: serverAt } }])
    expect(fixture.state().receipts).toEqual([expect.objectContaining({
      requestId: 'request-1', requestKind: 'command', requestHash: commandRequestHash(create),
      committedRevision: 1n, committedAt: new Date(serverAt), datasetId: 'active-dataset', sourceHash: null,
    })])
    expect(empty.state.accounts).toEqual([])
  })

  it('returns the current document on a verified retry before revision CAS without writes', async () => {
    const fixture = setup()
    await fixture.service.execute('owner', { expectedRevision: 0, command: create })
    await fixture.service.execute('owner', { expectedRevision: 1, command: {
      ...create, id: 'account-2', meta: { ...create.meta, commandId: 'request-2' },
    } })
    const beforeRetry = structuredClone(fixture.state())
    const attempts = fixture.attempts()
    const result = await fixture.service.execute('owner', { expectedRevision: 0, command: {
      ...create, name: ' Cash ', meta: { ...create.meta, at: serverAt },
    } })
    expect(result).toEqual({ replayed: true, document: beforeRetry.document })
    expect(result.document.revision).toBe(2)
    expect(fixture.state()).toEqual(beforeRetry)
    expect(fixture.attempts()).toEqual(attempts)
  })

  it('rejects reused request IDs with changed payload or import kind and preserves all state', async () => {
    for (const requestKind of ['command', 'backup', 'legacy']) {
      const fixture = setup(empty, [{ requestId: 'request-1', requestKind,
        requestHash: commandRequestHash(requestKind === 'command' ? { ...create, balanceMinor: 50 } : create),
        committedRevision: 0n, committedAt: new Date(clientAt), datasetId: 'old-dataset' }])
      const before = structuredClone(fixture.state())
      await expect(fixture.service.execute('owner', { expectedRevision: 0, command: create })).rejects.toMatchObject({ status: 409, failure: { code: 'CONFLICT' } })
      expect(fixture.state()).toEqual(before)
      expect(fixture.attempts()).toEqual([])
    }
  })

  it('rejects an imported audit ID without a verified receipt rather than silently acknowledging it', async () => {
    const document = documentWith({ audit: [{ id: 'request-1', at: clientAt, type: 'account.create', entityId: 'account-1', summary: 'Imported' }] })
    const fixture = setup(document)
    await expect(fixture.service.execute('owner', { expectedRevision: 0, command: create })).rejects.toMatchObject({ status: 409 })
    expect(fixture.state().document).toEqual(document)
    expect(fixture.state().receipts).toEqual([])
    expect(fixture.attempts()).toEqual([])
  })

  it('rejects stale revisions and a maximum safe revision without writes', async () => {
    for (const [revision, expectedRevision] of [[3, 2], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
      const document = { ...empty, revision: revision ?? 0 }
      const fixture = setup(document)
      await expect(fixture.service.execute('owner', { expectedRevision: expectedRevision ?? 0, command: create })).rejects.toMatchObject({ status: 409 })
      expect(fixture.state().document).toEqual(document)
      expect(fixture.state().receipts).toEqual([])
      expect(fixture.attempts()).toEqual([])
    }
  })

  it('rolls back every staged write and never returns success when persistence or commit fails', async () => {
    for (const point of ['persist', 'workspace', 'receipt', 'commit'] as const) {
      const fixture = setup()
      fixture.fail(point)
      await expect(fixture.service.execute('owner', { expectedRevision: 0, command: create })).rejects.toThrow(`failure at ${point}`)
      expect(fixture.state()).toEqual({ document: empty, receipts: [], commands: [] })
    }
  })
})

describe('domain failure preservation', () => {
  const debt = { id: 'debt-1', direction: 'payable' as const, counterparty: 'Vendor', principalMinor: 100, repaidMinor: 80, note: '' }
  const stock = { id: 'item-1', sku: 'SKU', name: 'Item', quantity: 1, stockValueMinor: 100 }
  const failures: readonly { name: string; document: DocumentV1; command: Command; status: number; code: string }[] = [
    { name: 'overpayment', document: documentWith({ debts: [debt] }), command: { type: 'debt.repay', id: debt.id, amountMinor: 21, meta: create.meta }, status: 400, code: 'VALIDATION' },
    { name: 'negative stock', document: documentWith({ inventory: [stock] }), command: { type: 'inventory.issue', id: stock.id, quantity: 2, reason: 'Sale', meta: create.meta }, status: 400, code: 'VALIDATION' },
    { name: 'duplicate SKU', document: documentWith({ inventory: [stock] }), command: { type: 'inventory.create', id: 'item-2', sku: ' sku ', name: 'Other', quantity: 1, unitCostMinor: 1, meta: create.meta }, status: 409, code: 'CONFLICT' },
    { name: 'missing entity', document: empty, command: { type: 'account.setBalance', id: 'foreign-account', balanceMinor: 1, meta: create.meta }, status: 404, code: 'NOT_FOUND' },
    { name: 'aggregate overflow', document: documentWith({ accounts: [{ id: 'large', name: 'Large', owner: 'Owner', provider: 'other', balanceMinor: Number.MAX_SAFE_INTEGER }] }), command: create, status: 400, code: 'VALIDATION' },
    { name: 'stock value overflow', document: empty, command: { type: 'inventory.create', id: 'item-1', sku: 'SKU', name: 'Item', quantity: 2, unitCostMinor: Number.MAX_SAFE_INTEGER, meta: create.meta }, status: 400, code: 'VALIDATION' },
  ]
  for (const scenario of failures) it(`rejects ${scenario.name} without an entity or receipt write`, async () => {
    const fixture = setup(scenario.document)
    await expect(fixture.service.execute('owner', { expectedRevision: 0, command: scenario.command })).rejects.toMatchObject({ status: scenario.status, failure: { code: scenario.code } })
    expect(fixture.state()).toEqual({ document: scenario.document, receipts: [], commands: [] })
    expect(fixture.attempts()).toEqual([])
  })
})
