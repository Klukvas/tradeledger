import { Controller, Get, Inject } from '@nestjs/common'
import type { ApiResult, ReadyResponse } from '../../../shared/api'
import { DatabaseService } from '../database'
import { ApiException } from '../http'

@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('ready')
  async ready(): Promise<ApiResult<ReadyResponse>> {
    try { await this.database.$queryRaw`SELECT 1` }
    catch { throw new ApiException(503, 'UNAVAILABLE', 'База данных временно недоступна.') }
    return { ok: true, value: { ready: true } }
  }
}
