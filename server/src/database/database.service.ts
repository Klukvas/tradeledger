import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { APP_CONFIG, type AppConfig } from '../config'
import { PrismaClient } from '../generated/prisma/client'
import { ApiException } from '../http'

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        max: 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      }),
      errorFormat: 'minimal',
      log: [],
    })
  }

  async onModuleInit(): Promise<void> {
    try { await this.$connect() }
    catch { throw new ApiException(503, 'UNAVAILABLE', 'База данных временно недоступна.') }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
