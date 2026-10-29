import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyCommand } from '../../../src/domain/commands'
import type { Command, DocumentV1 } from '../../../src/domain/types'
import { loadConfig } from '../config'
import { DatabaseService } from './database.service'
import { serializedTime } from './account-history'
import { LedgerRepository } from './ledger.repository'
import type { LockedWorkspace } from './types'

type CommandInput = { [Kind in Command['type']]: Omit<Extract<Command, { type: Kind }>, 'meta'> }[Command['type']]

const rollback = new Error('ROLLBACK_DATABASE_TEST_FIXTURE')
const databaseTests = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip

databaseTests('normalized repository with real PostgreSQL (all fixture data rolled back)', () => {
  it('round trips domain commands, imports immutable history, scopes owners and rejects invalid SQL values', async () => {
    const database = new DatabaseService(loadConfig())
    const repository = new LedgerRepository(database)
    await database.onModuleInit()
    try {
      await expect(database.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: `d2-${randomUUID()}@example.test`, passwordHash: 'test-fixture-never-a-real-password' } })
        const workspaceId = await repository.createWorkspace(tx, user.id)
        const row = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
        if (!row.activeDatasetId) throw new Error('bootstrap did not activate a dataset')
        const workspace: LockedWorkspace = { ...row, activeDatasetId: row.activeDatasetId }
        let document = await repository.readDocument(tx, workspace)
        expect(document.state).toEqual({ inventory: [], accounts: [], debts: [], snapshots: [], audit: [] })
        const at = '2026-10-28T10:20:30.000Z'
        const execute = async (input: CommandInput): Promise<void> => {
          const command = { ...input, meta: { commandId: randomUUID(), at } } as Command
          const result = applyCommand(document.state, command)
          if (!result.ok) throw new Error(result.error.message)
          const after: DocumentV1 = { ...document, revision: document.revision + 1, state: result.value }
          await repository.persistCommand(tx, workspace, document, after, command)
          document = after
          expect(await repository.readDocument(tx, { ...workspace, revision: BigInt(document.revision) })).toEqual(document)
        }
        await execute({ type: 'inventory.create', id: 'item', sku: 'ABC', name: 'Item', quantity: 3, unitCostMinor: 101 })
        await execute({ type: 'inventory.create', id: 'unicode-item', sku: 'İ'.repeat(80), name: 'Unicode key', quantity: 0, unitCostMinor: 0 })
        await execute({ type: 'inventory.receive', id: 'item', quantity: 2, unitCostMinor: 104 })
        await execute({ type: 'inventory.issue', id: 'item', quantity: 2, reason: 'test' })
        await execute({ type: 'inventory.update', id: 'item', sku: 'abc2', name: 'Updated item' })
        await execute({ type: 'account.create', id: 'account', name: 'Account', owner: 'Owner', provider: 'MONO', balanceMinor: Number.MAX_SAFE_INTEGER })
        await execute({ type: 'account.setBalance', id: 'account', balanceMinor: -Number.MAX_SAFE_INTEGER })
        await execute({ type: 'account.setBalance', id: 'account', balanceMinor: 100 })
        await execute({ type: 'snapshot.create', id: 'snapshot', label: 'Before rename' })
        await execute({ type: 'account.update', id: 'account', name: 'Renamed', owner: 'Other', provider: 'NovaPay' })
        expect(document.state.snapshots[0]?.accounts[0]?.name).toBe('Account')
        await execute({ type: 'debt.create', id: 'debt', direction: 'receivable', counterparty: 'Person', principalMinor: 1000, note: '' })
        await execute({ type: 'debt.repay', id: 'debt', amountMinor: 100 })
        await execute({ type: 'debt.update', id: 'debt', principalMinor: 2000, counterparty: 'Renamed person', note: 'Updated' })
        expect(await tx.inventoryMovement.count({ where: { datasetId: workspace.activeDatasetId } })).toBe(4)
        expect(await tx.balanceChange.count({ where: { datasetId: workspace.activeDatasetId } })).toBe(3)
        expect(await tx.repayment.count({ where: { datasetId: workspace.activeDatasetId } })).toBe(1)
        expect((await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).revision).toBe(0n)
        const historical: DocumentV1 = { ...document, revision: 77, updatedAt: '2020-01-01T10:00:00+02:00', state: { ...document.state, snapshots: document.state.snapshots.map((snapshot) => ({ ...snapshot, createdAt: '2020-01-01T10:00:00+02:00' })), audit: document.state.audit.map((event) => ({ ...event, at: '2020-01-01T10:00:00+02:00' })) } }
        const importedId = await repository.insertDataset(tx, workspaceId, historical, { kind: 'backup', sourceHash: 'a'.repeat(64) }, await serializedTime(tx))
        const imported = await repository.readDocument(tx, { ...workspace, activeDatasetId: importedId })
        expect(imported.state).toEqual(historical.state)
        const opening = await tx.repayment.findMany({ where: { datasetId: importedId } })
        expect(opening).toHaveLength(1)
        expect(opening[0]).toMatchObject({ kind: 'import_opening', amountMinor: 100n, occurredAt: null, commandId: null })
        await expect(repository.readDocument(tx, { ...workspace, userId: randomUUID() })).rejects.toMatchObject({ failure: { code: 'NOT_FOUND' } })
        await tx.$executeRaw`SAVEPOINT invalid_money`
        await expect(tx.account.update({ where: { datasetId_id: { datasetId: importedId, id: 'account' } }, data: { balanceMinor: 9007199254740992n } })).rejects.toThrow()
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_money`
        const otherWorkspace = await tx.workspace.create({ data: { userId: (await tx.user.create({ data: { email: `d2-other-${randomUUID()}@example.test`, passwordHash: 'fixture' } })).id } })
        await tx.$executeRaw`SAVEPOINT invalid_owner`
        await expect(tx.workspace.update({ where: { id: otherWorkspace.id }, data: { activeDatasetId: importedId } })).rejects.toThrow()
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_owner`
        throw rollback
      }, { timeout: 30_000 })).rejects.toBe(rollback)
      await expect(repository.read(randomUUID())).rejects.toMatchObject({ failure: { code: 'NOT_FOUND' } })
    } finally { await database.onModuleDestroy() }
  })
})
