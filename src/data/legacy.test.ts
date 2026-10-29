import { IDBFactory, IDBObjectStore, IDBDatabase } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createDocument } from '../test/fixtures'
import { DATABASE_NAME, DOCUMENT_KEY, OBJECT_STORE } from './adapter'
import { readLegacyLedger } from './legacy'

async function seed(factory: IDBFactory, raw: unknown, version = 1): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, version)
    request.onupgradeneeded = () => request.result.createObjectStore(OBJECT_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE, 'readwrite')
    transaction.objectStore(OBJECT_STORE).put(raw, DOCUMENT_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
  database.close()
}

describe('read-only legacy discovery', () => {
  it('leaves a missing database absent rather than creating an empty legacy ledger', async () => {
    const factory = new IDBFactory()
    const open = vi.spyOn(factory, 'open')
    const remove = vi.spyOn(factory, 'deleteDatabase')
    expect(await readLegacyLedger({ factory })).toEqual({ ok: true, value: { status: 'absent' } })
    expect(await factory.databases()).toEqual([])
    expect(open).toHaveBeenCalledWith(DATABASE_NAME)
    expect(remove).not.toHaveBeenCalled()
  })
  it('reads the existing version with readonly transactions and never writes, upgrades or deletes', async () => {
    const factory = new IDBFactory()
    const source = createDocument()
    await seed(factory, source, 3)
    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    const remove = vi.spyOn(factory, 'deleteDatabase')
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
    const result = await readLegacyLedger({ factory })
    expect(result).toMatchObject({ ok: true, value: { status: 'ready', document: source } })
    expect(transaction.mock.calls.every(([, mode]) => mode === 'readonly')).toBe(true)
    expect(put).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await factory.databases()).toEqual([{ name: DATABASE_NAME, version: 3 }])
    expect(await readLegacyLedger({ factory })).toEqual(result)
  })
  it('preserves a corrupted source as a downloadable raw backup', async () => {
    const factory = new IDBFactory()
    const raw = { schemaVersion: 1, valuableOriginal: 'never discard' }
    await seed(factory, raw)
    const result = await readLegacyLedger({ factory })
    expect(result).toMatchObject({ ok: true, value: { status: 'corrupt', error: { code: 'CORRUPT' } } })
    if (!result.ok || result.value.status !== 'corrupt' || !result.value.rawBackup) throw new Error('Missing original backup')
    expect(JSON.parse(result.value.rawBackup)).toEqual(raw)
    expect(await readLegacyLedger({ factory })).toEqual(result)
  })
  it('reports unavailable storage and timeouts without creating a fallback', async () => {
    const factory = new IDBFactory()
    vi.spyOn(factory, 'open').mockImplementation(() => { throw new Error('private storage details') })
    const failed = await readLegacyLedger({ factory })
    expect(failed.ok).toBe(false)
    expect(JSON.stringify(failed)).not.toContain('private storage')
  })
})
