import { Module } from '@nestjs/common'
import { ConfigModule } from '../config'
import { DatabaseService } from './database.service'
import { LedgerRepository } from './ledger.repository'

@Module({ imports: [ConfigModule], providers: [DatabaseService, LedgerRepository], exports: [DatabaseService, LedgerRepository] })
export class DatabaseModule {}
