import { Inject, Injectable, ConsoleLogger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DatabaseService, LedgerRepository } from '../database'
import { closeDueMonths } from '../database/close-months'
import { serializedTime } from '../database/account-history'
import { ApiException } from '../http'

const failureBackoffs = [30_000, 120_000, 600_000] as const

@Injectable()
export class MonthlyCloseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new ConsoleLogger(MonthlyCloseService.name)
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryAttempt = 0
  private running: Promise<void> | undefined
  private stopped = false

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LedgerRepository) private readonly repository: LedgerRepository) {}

  async onApplicationBootstrap(): Promise<void> { await this.closeAll() }

  onModuleDestroy(): void {
    this.stopped = true
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
  }

  @Cron('0 0 0 1 * *', { name: 'monthly-account-close', timeZone: 'Europe/Kyiv', waitForCompletion: true })
  closeAll(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) return this.running
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.retryAttempt = 0
    return this.startPass()
  }

  private startPass(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) return this.running
    const operation = this.processWorkspaces().then((failed) => {
      if (failed) this.retryFailure()
      else this.retryAttempt = 0
    }).finally(() => { if (this.running === operation) this.running = undefined })
    this.running = operation
    return operation
  }

  private retryFailure(): void {
    if (this.stopped) return
    const delay = failureBackoffs[this.retryAttempt]
    if (delay === undefined) {
      this.logger.error('Monthly account close retries exhausted; next attempt is on startup or the next monthly run.')
      return
    }
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.startPass()
    }, delay)
  }

  private async processWorkspaces(): Promise<boolean> {
    try {
      const workspaces = await this.database.workspace.findMany({ where: { activeDatasetId: { not: null } }, select: { userId: true } })
      let failed = false
      for (const workspace of workspaces) {
        if (this.stopped) break
        try { await this.closeWorkspace(workspace.userId) }
        catch {
          failed = true
          this.logger.error(`Monthly account close failed for workspace owner ${workspace.userId}.`)
        }
      }
      return failed
    } catch {
      this.logger.error('Monthly account close could not list workspaces.')
      return true
    }
  }

  private async closeWorkspace(userId: string): Promise<void> {
    await this.repository.withLockedWorkspace(userId, async (tx, locked) => {
      const at = await serializedTime(tx)
      const count = await closeDueMonths(tx, locked, at)
      if (count === 0) return
      if (locked.revision >= BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiException(409, 'CONFLICT', 'Достигнут предел версии изменений.')
      await tx.workspace.update({ where: { id: locked.id }, data: { revision: locked.revision + 1n, updatedAt: at } })
    })
  }
}
