import { describe, expect, it, vi } from 'vitest'
import type { DatabaseService, LedgerRepository, Tx } from '../database'
import { ArchiveService } from './archive.service'

const id = 'c5b64ec4-ff42-434c-9cac-ad97f32e5213'
const at = new Date('2020-01-01T00:00:00Z')
const archived = new Date('2021-01-01T00:00:00Z')
const workspace = { id: 'w', userId: 'owner', activeDatasetId: 'current', revision: 999n, updatedAt: new Date('2026-01-01T00:00:00Z') }
function setup() {
  const findFirst = vi.fn().mockResolvedValue({ id, archivedAt: archived, archivedRevision: 7n, archivedDocumentUpdatedAt: at, workspace })
  const findMany = vi.fn().mockResolvedValue([{ id, createdAt: at, archivedAt: archived, source: 'backup', sourceHash: 'a'.repeat(64),
    _count: { inventory: 2, accounts: 1, debts: 3, snapshots: 4, audit: 5 } }])
  const groupBy = vi.fn().mockResolvedValue([{ datasetId: id, _count: { _all: 6 } }])
  const tx = { dataset: { findFirst, findMany }, snapshotAccount: { groupBy } }
  const transaction = vi.fn(async <T>(run: (client: Tx) => Promise<T>) => run(tx as unknown as Tx))
  const readDocument = vi.fn().mockResolvedValue({ schemaVersion: 1, revision: 7, updatedAt: at.toISOString(), state: {} })
  const service = new ArchiveService({ $transaction: transaction } as unknown as DatabaseService, { readDocument } as unknown as LedgerRepository)
  return { service, findFirst, findMany, groupBy, transaction, readDocument, tx }
}

describe('owner-scoped archive reads', () => {
  it('exports the saved archive revision/time in a consistent transaction independent of the active revision', async () => {
    const fixture = setup()
    const result = await fixture.service.export('owner', id)
    expect(result.revision).toBe(7)
    expect(fixture.findFirst).toHaveBeenCalledWith({ where: { id, workspace: { userId: 'owner' }, archivedAt: { not: null } }, include: { workspace: true } })
    expect(fixture.readDocument).toHaveBeenCalledWith(fixture.tx, { ...workspace, activeDatasetId: id, revision: 7n, updatedAt: at })
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 20_000 })
  })

  it('rejects malformed UUIDs before database lookup and gives 404 for absent/unowned/active datasets', async () => {
    const fixture = setup()
    for (const value of ['no-id', '../../foreign', 'x'.repeat(36), 'c5b64ec4-ff42-434c-0cac-ad97f32e5213']) {
      await expect(fixture.service.export('owner', value)).rejects.toMatchObject({ status: 400 })
    }
    expect(fixture.transaction).not.toHaveBeenCalled()
    fixture.findFirst.mockResolvedValue(null)
    await expect(fixture.service.export('other', id)).rejects.toMatchObject({ status: 404 })
    expect(fixture.readDocument).not.toHaveBeenCalled()
  })

  it('fails closed when archive metadata is missing or exceeds the domain limit', async () => {
    const fixture = setup()
    for (const fields of [{ archivedRevision: null, archivedDocumentUpdatedAt: at }, { archivedRevision: 7n, archivedDocumentUpdatedAt: null },
      { archivedRevision: BigInt(Number.MAX_SAFE_INTEGER) + 1n, archivedDocumentUpdatedAt: at }]) {
      fixture.findFirst.mockResolvedValue({ id, workspace, ...fields })
      await expect(fixture.service.export('owner', id)).rejects.toMatchObject({ status: 503 })
    }
    expect(fixture.readDocument).not.toHaveBeenCalled()
  })

  it('lists only the owner archives and batches snapshot account counts without per-dataset document reads', async () => {
    const fixture = setup()
    expect(await fixture.service.list('owner')).toEqual({ datasets: [{ id, createdAt: at.toISOString(), archivedAt: archived.toISOString(),
      source: 'backup', sourceHash: 'a'.repeat(64), counts: { inventory: 2, accounts: 1, debts: 3, snapshots: 4, audit: 5, snapshotAccounts: 6 } }] })
    expect(fixture.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace: { userId: 'owner' }, archivedAt: { not: null } } }))
    expect(fixture.groupBy).toHaveBeenCalledWith({ by: ['datasetId'], where: { datasetId: { in: [id] } }, _count: { _all: true } })
    expect(fixture.readDocument).not.toHaveBeenCalled()
    fixture.findMany.mockResolvedValue([])
    fixture.groupBy.mockClear()
    expect(await fixture.service.list('other')).toEqual({ datasets: [] })
    expect(fixture.groupBy).not.toHaveBeenCalled()
  })
})
