import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportRequest } from '../../../shared/api'
import type { DocumentV1 } from '../../../src/domain/types'
import type { DatabaseService, LedgerRepository, LockedWorkspace, Tx } from '../database'
import type { CommandReceipt } from '../generated/prisma/client'
import { MAX_IMPORT_BYTES, documentCounts, parseImportRequest, sha256, storedImportReceipt } from './import-request'
import { ImportService } from './import.service'

vi.mock('../database/account-history', () => ({ serializedTime: async () => new Date() }))
vi.mock('../database/close-months', () => ({ closeDueMonths: async () => 0 }))

const at = '2020-01-01T00:00:00.000Z'
const now = '2026-10-29T03:00:00.000Z'
const empty: DocumentV1 = { schemaVersion: 1, revision: 4, updatedAt: at,
  state: { inventory: [], accounts: [], debts: [], snapshots: [], audit: [] } }
const account = { id: 'a', name: 'Cash', owner: 'Owner', provider: 'other' as const, balanceMinor: 123 }
const source: DocumentV1 = { ...empty, revision: 78, state: { ...empty.state, accounts: [account],
  snapshots: [{ id: 's', label: 'Old', createdAt: '2020-01-01T02:00:00+02:00', totalMinor: 123,
    accounts: [{ accountId: account.id, name: account.name, owner: account.owner, provider: account.provider, balanceMinor: 123 }] }],
  audit: [{ id: 'event', at: '2020-01-01T02:00:00+02:00', entityId: 'a', type: 'account.create', summary: 'Opening' }] } }
const request: ImportRequest = { requestId: 'import-1', expectedRevision: 4, source: 'backup', document: source }
type Archived = Readonly<{ document: DocumentV1; archivedRevision: bigint; archivedDocumentUpdatedAt: Date }>
type Stage = { workspace: LockedWorkspace; document: DocumentV1; receipts: CommandReceipt[]; archives: Archived[]; inserted: DocumentV1[] }
type Failure = 'insert' | 'archive' | 'workspace' | 'receipt' | 'commit'
function setup(revision = 4) {
  let committed: Stage = { workspace: { id: 'w', userId: 'owner', activeDatasetId: 'old', revision: BigInt(revision), updatedAt: new Date(at) },
    document: { ...empty, revision }, receipts: [], archives: [], inserted: [] }
  let staged: Stage | undefined
  let failure: Failure | undefined
  let attempts: string[] = []
  let owner: string | undefined
  const current = (): Stage => { if (!staged) throw new Error('no transaction'); return staged }
  const write = (point: Failure): void => { attempts = [...attempts, point]; if (failure === point) throw new Error(point) }
  const tx = { commandReceipt: {
    findUnique: async ({ where }: { where: { workspaceId_requestId: { workspaceId: string; requestId: string } } }) => {
      expect(where.workspaceId_requestId.workspaceId).toBe('w')
      return current().receipts.find((entry) => entry.requestId === where.workspaceId_requestId.requestId) ?? null
    },
    create: async ({ data }: { data: CommandReceipt }) => { write('receipt'); staged = { ...current(), receipts: [...current().receipts, data] }; return data },
  }, dataset: { update: async ({ where, data }: { where: { workspaceId_id: { workspaceId: string; id: string } }; data: { archivedRevision: bigint; archivedDocumentUpdatedAt: Date } }) => {
    write('archive'); expect(where.workspaceId_id).toEqual({ workspaceId: 'w', id: current().workspace.activeDatasetId })
    staged = { ...current(), archives: [...current().archives, { document: current().document, ...data }] }
  } }, workspace: { update: async ({ data }: { data: { activeDatasetId: string; revision: bigint; updatedAt: Date } }) => {
    write('workspace'); const state = current(); const inserted = state.inserted.at(-1)
    if (!inserted) throw new Error('missing insert')
    staged = { ...state, workspace: { ...state.workspace, ...data }, document: { ...inserted, revision: Number(data.revision), updatedAt: data.updatedAt.toISOString() } }
  } } }
  const repository = {
    withLockedWorkspace: async <T>(userId: string, run: (transaction: Tx, workspace: LockedWorkspace) => Promise<T>): Promise<T> => {
      owner = userId; staged = structuredClone(committed)
      try { const value = await run(tx as unknown as Tx, current().workspace); if (failure === 'commit') throw new Error('commit'); committed = current(); return value }
      finally { staged = undefined }
    },
    readDocument: async () => current().document,
    insertDataset: async (_tx: Tx, workspaceId: string, document: DocumentV1, metadata: { kind: string; sourceHash: string }) => {
      write('insert'); expect(workspaceId).toBe('w'); expect(metadata).toEqual({ kind: 'backup', sourceHash: sha256(document) })
      staged = { ...current(), inserted: [...current().inserted, document] }; return `new-${current().inserted.length}`
    },
  }
  return { service: new ImportService(repository as unknown as LedgerRepository, {} as DatabaseService),
    state: () => committed, attempts: () => attempts, owner: () => owner, fail: (point: Failure) => { failure = point },
    receipts: (receipts: CommandReceipt[]) => { committed = { ...committed, receipts } } }
}

afterEach(() => vi.useRealTimers())

describe('strict import boundary', () => {
  it('validates all document fields/references and rejects unsafe owner, version and source inputs before locking', async () => {
    const fixture = setup()
    for (const input of [null, [], { ...request, userId: 'other' }, { ...request, workspaceId: 'foreign' },
      { ...request, source: 'command' }, { ...request, expectedRevision: -1 }, { ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...request, requestId: 'x'.repeat(129) }, { ...request, requestId: '\u0000' },
      { ...request, document: { ...source, extra: true } },
      { ...request, document: { ...source, state: { ...source.state, accounts: [] } } },
      { ...request, document: { ...source, schemaVersion: 2 } },
    ]) await expect(fixture.service.execute('owner', input)).rejects.toMatchObject({ status: 400 })
    expect(fixture.owner()).toBeUndefined()
    expect(parseImportRequest({ ...request, requestId: ' import-1 ' }).requestId).toBe('import-1')
  })

  it('enforces the 5 MiB UTF8 size rather than character count', () => {
    const accounts = Array.from({ length: 12_000 }, (_, index) => ({ ...account, id: String(index), name: 'Я'.repeat(120), owner: 'Ю'.repeat(120) }))
    const document = { ...empty, state: { ...empty.state, accounts } }
    expect(JSON.stringify(document).length).toBeLessThan(MAX_IMPORT_BYTES)
    expect(Buffer.byteLength(JSON.stringify(document))).toBeGreaterThan(MAX_IMPORT_BYTES)
    expect(() => parseImportRequest({ ...request, document })).toThrowError(expect.objectContaining({ status: 413 }))
  })

  it('hashes the full validated source including metadata independently from expected revision or key order', () => {
    const first = parseImportRequest(request)
    const reordered = parseImportRequest({ document: { state: source.state, updatedAt: at, revision: 78, schemaVersion: 1 }, source: 'backup', expectedRevision: 99, requestId: 'another' })
    expect(sha256({ source: first.source, document: first.document })).toBe(sha256({ source: reordered.source, document: reordered.document }))
    expect(sha256(source)).not.toBe(sha256({ ...source, revision: 79 }))
    expect(sha256({ source: 'backup', document: source })).not.toBe(sha256({ source: 'legacy', document: source }))
  })
})

describe('atomic import coordination', () => {
  it('archives the old committed metadata and atomically switches datasets without replacing the global revision', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now))
    const fixture = setup()
    const result = await fixture.service.execute('owner', request)
    expect(fixture.owner()).toBe('owner')
    expect(result).toEqual({ document: { ...source, revision: 5, updatedAt: now }, replayed: false,
      receipt: { requestId: request.requestId, datasetId: 'new-1', committedRevision: 5, sourceHash: sha256(source), counts: documentCounts(source) } })
    expect(fixture.state().archives).toEqual([{ document: empty, archivedAt: new Date(now), archivedRevision: 4n, archivedDocumentUpdatedAt: new Date(at) }])
    expect(fixture.state().inserted).toEqual([source])
    expect(fixture.state().document.state.snapshots[0]?.createdAt).toBe('2020-01-01T02:00:00+02:00')
    expect(fixture.state().receipts[0]).toMatchObject({ workspaceId: 'w', requestKind: 'backup', sourceHash: sha256(source), committedRevision: 5n, committedAt: new Date(now) })
  })

  it('replays with CURRENT document and original persisted proof before stale revision without writes', async () => {
    const fixture = setup()
    const first = await fixture.service.execute('owner', request)
    const second = await fixture.service.execute('owner', { ...request, requestId: 'import-2', expectedRevision: 5, document: empty })
    const attempts = fixture.attempts()
    const replay = await fixture.service.execute('owner', { ...request, expectedRevision: 0 })
    expect(replay).toEqual({ document: second.document, receipt: first.receipt, replayed: true })
    expect(replay.receipt.counts.accounts).toBe(1)
    expect(replay.document.state.accounts).toEqual([])
    expect(fixture.attempts()).toEqual(attempts)
    expect(fixture.state().archives).toHaveLength(2)
  })

  it('rejects changed request payload or kind across the shared receipt namespace', async () => {
    const fixture = setup()
    await fixture.service.execute('owner', request)
    for (const next of [{ ...request, document: empty }, { ...request, source: 'legacy' }]) {
      await expect(fixture.service.execute('owner', next)).rejects.toMatchObject({ status: 409 })
    }
    const receipt = fixture.state().receipts[0]
    if (!receipt) throw new Error('missing receipt')
    fixture.receipts([{ ...receipt, requestKind: 'command' }])
    await expect(fixture.service.execute('owner', request)).rejects.toMatchObject({ status: 409 })
    expect(fixture.state().archives).toHaveLength(1)
  })

  it('rejects stale or exhausted revisions without inserting datasets or receipts', async () => {
    for (const revision of [5, Number.MAX_SAFE_INTEGER]) {
      const fixture = setup(revision)
      await expect(fixture.service.execute('owner', { ...request, expectedRevision: revision === 5 ? 4 : revision })).rejects.toMatchObject({ status: 409 })
      expect(fixture.attempts()).toEqual([])
    }
  })

  it('rolls back inserts, archive metadata, pointer, global revision and receipt on every failure including outer commit', async () => {
    for (const point of ['insert', 'archive', 'workspace', 'receipt', 'commit'] as const) {
      const fixture = setup(); const before = structuredClone(fixture.state()); fixture.fail(point)
      await expect(fixture.service.execute('owner', request)).rejects.toThrow(point)
      expect(fixture.state()).toEqual(before)
    }
  })
})

describe('persisted receipt retrieval', () => {
  it('uses owner and import-kind predicates and returns stored counts instead of active counts', async () => {
    const fixture = setup(); await fixture.service.execute('owner', request)
    const stored = fixture.state().receipts[0]
    const findFirst = vi.fn().mockResolvedValue(stored)
    const service = new ImportService({} as LedgerRepository, { commandReceipt: { findFirst } } as unknown as DatabaseService)
    expect(await service.receipt('owner', ' import-1 ')).toEqual(storedImportReceipt(stored as CommandReceipt))
    expect(findFirst).toHaveBeenCalledWith({ where: { workspace: { userId: 'owner' }, requestId: 'import-1', requestKind: { in: ['backup', 'legacy'] } } })
    findFirst.mockResolvedValue(null)
    await expect(service.receipt('other', 'import-1')).rejects.toMatchObject({ status: 404 })
  })

  it('refuses corrupt stored proof rather than inventing receipt values', async () => {
    const fixture = setup(); await fixture.service.execute('owner', request)
    const receipt = fixture.state().receipts[0]
    if (!receipt) throw new Error('missing receipt')
    for (const damaged of [{ ...receipt, counts: null }, { ...receipt, sourceHash: null }, { ...receipt, committedRevision: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      { ...receipt, counts: { ...documentCounts(source), snapshotAccounts: -1 } }]) {
      expect(() => storedImportReceipt(damaged)).toThrowError(expect.objectContaining({ status: 503 }))
    }
  })
})
