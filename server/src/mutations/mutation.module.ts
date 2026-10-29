import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database'
import { MutationService } from './mutation.service'

@Module({ imports: [DatabaseModule], providers: [MutationService], exports: [MutationService] })
export class MutationModule {}
