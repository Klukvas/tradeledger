import type { INestApplication } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionGuard } from '../auth'
import { APP_CONFIG } from '../config'
import { DatabaseService, LedgerRepository } from '../database'
import { ApiExceptionFilter } from '../http'
import { MutationService } from '../mutations'
import { ArchiveService } from './archive.service'
import { ImportService } from './import.service'
import { LedgerController } from './ledger.controller'
import { LedgerModule } from './ledger.module'

let app: INestApplication | undefined
afterEach(async () => { await app?.close(); app = undefined })

async function setup(authorized = true) {
  const repository = { read: vi.fn().mockResolvedValue({ revision: 1 }) }
  const mutations = { execute: vi.fn().mockResolvedValue({ replayed: false }) }
  const imports = { execute: vi.fn().mockResolvedValue({ replayed: false }), receipt: vi.fn().mockResolvedValue({ requestId: 'proof' }) }
  const archives = { list: vi.fn().mockResolvedValue({ datasets: [] }), export: vi.fn().mockResolvedValue({ revision: 2 }) }
  const module = await Test.createTestingModule({ controllers: [LedgerController], providers: [
    { provide: LedgerRepository, useValue: repository }, { provide: MutationService, useValue: mutations },
    { provide: ImportService, useValue: imports }, { provide: ArchiveService, useValue: archives },
  ] }).overrideGuard(SessionGuard).useValue({ canActivate: (context: { switchToHttp: () => { getRequest: () => { authenticatedUser?: unknown } } }) => {
    if (authorized) context.switchToHttp().getRequest().authenticatedUser = { id: 'server-owner', email: 'owner@example.test', workspaceId: 'private-workspace' }
    return authorized
  } }).compile()
  app = module.createNestApplication()
  app.setGlobalPrefix('api')
  app.useGlobalFilters(new ApiExceptionFilter())
  await app.init()
  return { http: app.getHttpServer(), repository, mutations, imports, archives }
}

describe('ledger HTTP boundary', () => {
  it('resolves the real session guard and its auth dependencies in the consuming module', async () => {
    const module = await Test.createTestingModule({ imports: [LedgerModule] })
      .overrideProvider(DatabaseService).useValue({})
      .overrideProvider(APP_CONFIG).useValue({ sessionCookieName: 'test_session' })
      .compile()
    expect(module.get(LedgerController)).toBeInstanceOf(LedgerController)
    expect(module.get(SessionGuard)).toBeInstanceOf(SessionGuard)
    await module.close()
  })

  it('guards every ledger route at the class boundary', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, LedgerController)).toContain(SessionGuard)
    const fixture = await setup(false)
    for (const path of ['', '/export', '/imports/proof', '/datasets', '/datasets/id/export']) await request(fixture.http).get(`/api/ledger${path}`).expect(403)
    for (const path of ['/commands', '/import']) await request(fixture.http).post(`/api/ledger${path}`).send({}).expect(403)
    expect(fixture.repository.read).not.toHaveBeenCalled()
    expect(fixture.imports.execute).not.toHaveBeenCalled()
  })

  it('uses session identity for every endpoint, wraps success and freshly reads export', async () => {
    const fixture = await setup()
    await request(fixture.http).get('/api/ledger?userId=foreign').expect(200, { ok: true, value: { revision: 1 } })
    fixture.repository.read.mockResolvedValue({ revision: 9 })
    await request(fixture.http).get('/api/ledger/export').expect(200, { ok: true, value: { revision: 9 } })
    await request(fixture.http).post('/api/ledger/import').send({ data: 'source' }).expect(200)
    await request(fixture.http).get('/api/ledger/imports/proof').expect(200)
    await request(fixture.http).get('/api/ledger/datasets').expect(200)
    await request(fixture.http).get('/api/ledger/datasets/archive-id/export').expect(200)
    const command = { type: 'snapshot.create', id: 's', label: 'Now', meta: { commandId: 'c', at: '2020-01-01T00:00:00Z' } }
    await request(fixture.http).post('/api/ledger/commands').send({ expectedRevision: 0, command }).expect(200, { ok: true, value: { replayed: false } })
    expect(fixture.repository.read.mock.calls).toEqual([['server-owner'], ['server-owner']])
    expect(fixture.mutations.execute).toHaveBeenCalledWith('server-owner', { expectedRevision: 0, command })
    expect(fixture.imports.execute).toHaveBeenCalledWith('server-owner', { data: 'source' })
    expect(fixture.imports.receipt).toHaveBeenCalledWith('server-owner', 'proof')
    expect(fixture.archives.list).toHaveBeenCalledWith('server-owner')
    expect(fixture.archives.export).toHaveBeenCalledWith('server-owner', 'archive-id')
    await request(fixture.http).post('/api/ledger/commands').send({ expectedRevision: 0, command, workspaceId: 'foreign' }).expect(400)
    expect(fixture.mutations.execute).toHaveBeenCalledTimes(1)
  })
})
