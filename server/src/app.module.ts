import { Module } from '@nestjs/common'
import { ConfigModule } from './config'
import { DatabaseModule } from './database'
import { AuthModule } from './auth/auth.module'
import { LedgerModule } from './ledger/ledger.module'
import { HealthModule } from './health/health.module'
import { MonthlyCloseModule } from './monthly-close/monthly-close.module'

@Module({ imports: [ConfigModule, DatabaseModule, AuthModule, LedgerModule, HealthModule, MonthlyCloseModule] })
export class AppModule {}
