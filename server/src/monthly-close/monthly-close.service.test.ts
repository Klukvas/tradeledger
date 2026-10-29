import { ConsoleLogger } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseService, LedgerRepository, LockedWorkspace, Tx } from '../database'
import { closeDueMonths } from '../database/close-months'
import { MonthlyCloseService } from './monthly-close.service'

vi.mock('../database/account-history', () => ({ serializedTime: async () => new Date() }))
vi.mock('../database/close-months', () => ({ closeDueMonths: vi.fn(async () => 0) }))
const services: MonthlyCloseService[] = []
function fixture() {
  const list = vi.fn(async () => [{ userId: 'owner' }])
  const update = vi.fn(async () => undefined)
  const workspace: LockedWorkspace = { id: 'workspace', userId: 'owner', activeDatasetId: 'dataset', revision: 1n, updatedAt: new Date() }
  const lock = vi.fn(async (_id: string, run: (tx: Tx, row: LockedWorkspace) => Promise<void>) => run({ workspace: { update } } as unknown as Tx, workspace))
  const service = new MonthlyCloseService({ workspace: { findMany: list } } as unknown as DatabaseService,
    { withLockedWorkspace: lock } as unknown as LedgerRepository)
  services.push(service)
  return { service, list, lock, update }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(closeDueMonths).mockReset().mockResolvedValue(0)
  vi.spyOn(ConsoleLogger.prototype, 'error').mockImplementation(() => undefined)
})
afterEach(() => { services.splice(0).forEach((service) => service.onModuleDestroy()); vi.useRealTimers() })

describe('bounded monthly failure recovery', () => {
  it('does not schedule any retry or healthy periodic polling after a successful run', async () => {
    const { service, list } = fixture()
    await service.closeAll()
    await vi.advanceTimersByTimeAsync(86_400_000)
    expect(list).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('recovers a transient workspace failure once and leaves idempotent close writes to the locked engine', async () => {
    const { service, lock, update, list } = fixture()
    lock.mockRejectedValueOnce(new Error('temporary database outage'))
    vi.mocked(closeDueMonths).mockResolvedValueOnce(1)
    await service.closeAll()
    expect(update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(86_400_000)
    expect(list).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('bounds workspace-list outage recovery to 30s, 2m and 10m, then stops', async () => {
    const { service, list } = fixture()
    list.mockRejectedValue(new Error('list unavailable'))
    await service.closeAll()
    for (const [delay, count] of [[30_000, 2], [120_000, 3], [600_000, 4]] as const) {
      await vi.advanceTimersByTimeAsync(delay)
      expect(list).toHaveBeenCalledTimes(count)
    }
    await vi.advanceTimersByTimeAsync(86_400_000)
    expect(list).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels a pending retry on shutdown and prevents subsequent work', async () => {
    const { service, list } = fixture()
    list.mockRejectedValueOnce(new Error('temporary list failure'))
    await service.closeAll()
    service.onModuleDestroy()
    await vi.advanceTimersByTimeAsync(86_400_000)
    await service.closeAll()
    expect(list).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('coalesces overlapping invocations while the previous pass is in flight', async () => {
    const { service, list } = fixture()
    let finish: (rows: { userId: string }[]) => void = () => { throw new Error('not initialized') }
    list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const first = service.closeAll()
    const second = service.closeAll()
    expect(first).toBe(second)
    expect(list).toHaveBeenCalledTimes(1)
    finish([{ userId: 'owner' }])
    await Promise.all([first, second])
    expect(vi.getTimerCount()).toBe(0)
  })
})
