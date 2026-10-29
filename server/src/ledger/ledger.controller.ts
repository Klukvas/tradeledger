import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common'
import type { ApiResult, CommandResponse, DatasetListResponse, ImportReceipt, ImportResponse } from '../../../shared/api'
import type { DocumentV1 } from '../../../src/domain/types'
import { CurrentUser, SessionGuard, type AuthenticatedUser } from '../auth'
import { LedgerRepository } from '../database'
import { MutationService, parseCommandRequest } from '../mutations'
import { ArchiveService } from './archive.service'
import { ImportService } from './import.service'

@Controller('ledger')
@UseGuards(SessionGuard)
export class LedgerController {
  constructor(@Inject(LedgerRepository) private readonly repository: LedgerRepository,
    @Inject(MutationService) private readonly mutations: MutationService,
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(ArchiveService) private readonly archives: ArchiveService) {}

  @Get()
  async read(@CurrentUser() user: AuthenticatedUser): Promise<ApiResult<DocumentV1>> {
    return { ok: true, value: await this.repository.read(user.id) }
  }

  @Post('commands')
  @HttpCode(200)
  async command(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<ApiResult<CommandResponse>> {
    return { ok: true, value: await this.mutations.execute(user.id, parseCommandRequest(body)) }
  }

  @Get('export')
  async export(@CurrentUser() user: AuthenticatedUser): Promise<ApiResult<DocumentV1>> {
    return { ok: true, value: await this.repository.read(user.id) }
  }

  @Post('import')
  @HttpCode(200)
  async import(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<ApiResult<ImportResponse>> {
    return { ok: true, value: await this.imports.execute(user.id, body) }
  }

  @Get('imports/:requestId')
  async receipt(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string): Promise<ApiResult<ImportReceipt>> {
    return { ok: true, value: await this.imports.receipt(user.id, requestId) }
  }

  @Get('datasets')
  async datasets(@CurrentUser() user: AuthenticatedUser): Promise<ApiResult<DatasetListResponse>> {
    return { ok: true, value: await this.archives.list(user.id) }
  }

  @Get('datasets/:id/export')
  async archiveExport(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ApiResult<DocumentV1>> {
    return { ok: true, value: await this.archives.export(user.id, id) }
  }
}
