import { Module } from '@nestjs/common'
import { AuthModule } from '../auth'
import { DatabaseModule } from '../database'
import { MutationModule } from '../mutations'
import { ArchiveService } from './archive.service'
import { ImportService } from './import.service'
import { LedgerController } from './ledger.controller'

@Module({ imports: [DatabaseModule, AuthModule, MutationModule], controllers: [LedgerController],
  providers: [ImportService, ArchiveService], exports: [ImportService, ArchiveService] })
export class LedgerModule {}
