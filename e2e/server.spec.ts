import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { ApiResult, DatasetListResponse, ImportResponse } from '../shared/api'
import { createDocument } from '../src/test/fixtures'
import type { DocumentV1 } from '../src/domain/types'
import { anonymousTest, createAccount, createItem, expect, exportDocument, navigate, signIn, signUp, test, userHeaders } from './helpers'
import { runtimeControl } from './runtime-control'

anonymousTest('login-only access, reload, sign in from a separate browser context and isolate another account', async ({ page, browser, credentials }, info) => {
  await page.goto('/')
  await mkdir('.cache/sidebar-polish', { recursive: true })
  await expect(page.getByRole('heading', { name: 'Вход в TradeLedger', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать аккаунт', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  await page.screenshot({ path: `.cache/sidebar-polish/login-${info.project.name}.png`, fullPage: true })
  await signUp(page, credentials)
  const cookie = (await page.context().cookies()).find(value => value.name === 'tradeledger_session')
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
  await createAccount(page, 'Серверный счёт', '1234,56')
  await page.reload()
  await navigate(page, 'Счета')
  await expect(page.getByRole('row').filter({ hasText: 'Серверный счёт' })).toHaveCount(1)
  const second = await browser.newContext({ baseURL: 'http://127.0.0.1:5179' })
  try {
    const other = await second.newPage()
    await other.goto('/')
    await signIn(other, credentials)
    await navigate(other, 'Счета')
    await expect(other.getByRole('row').filter({ hasText: 'Серверный счёт' })).toHaveCount(1)
    expect((await exportDocument(other)).state.accounts[0]?.balanceMinor).toBe(123456)
    await other.getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(other.getByRole('heading', { name: 'Вход в TradeLedger', exact: true })).toBeVisible()
    await signUp(other, { email: `e2e-${randomUUID()}@example.test`, password: `synthetic-${randomUUID()}` })
    expect((await exportDocument(other)).state.accounts).toHaveLength(0)
  } finally { await second.close() }
  await navigate(page, 'Обзор')
  await page.screenshot({ path: `.cache/sidebar-polish/dashboard-${info.project.name}.png`, fullPage: true })
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeInViewport()
    await expect(page.getByRole('navigation', { name: 'Разделы учёта' }).getByRole('link')).toHaveCount(5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.cache/sidebar-polish/dashboard-${info.project.name}-${width}.png`, fullPage: true })
  }
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await signIn(page, credentials)
  expect((await exportDocument(page)).state.accounts).toHaveLength(1)
})

anonymousTest('wrong password is rejected and a revoked session clears visible account data', async ({ page, credentials, expectedApiErrors }) => {
  await page.goto('/')
  await signUp(page, credentials)
  await createAccount(page, 'Конфиденциальный счёт', '100')
  const logout = await page.request.post('/api/auth/logout', { headers: { Origin: 'http://127.0.0.1:5179', 'X-TradeLedger-Request': '1', ...await userHeaders(page) }, data: {} })
  expect(logout.status()).toBe(200)
  // The UI still holds its old cache; a real protected read must invalidate it on 401.
  expectedApiErrors.push({ path: '/api/ledger/export', status: 401 })
  await navigate(page, 'Резервная копия')
  await page.getByRole('button', { name: 'Скачать резервную копию', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Вход в TradeLedger', exact: true })).toBeVisible()
  await expect(page.getByText('Конфиденциальный счёт', { exact: true })).toHaveCount(0)
  expectedApiErrors.push({ path: '/api/auth/login', status: 401 })
  await page.getByLabel('Электронная почта', { exact: true }).fill(credentials.email)
  await page.getByLabel('Пароль', { exact: true }).fill(`incorrect-${randomUUID()}`)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await signIn(page, credentials)
  expect((await exportDocument(page)).state.accounts).toHaveLength(1)
})

test('offline write preserves the draft and does not change the server', async ({ page, context, expectedApiErrors }) => {
  await navigate(page, 'Счета')
  await page.getByRole('button', { name: 'Добавить счёт', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название счёта', { exact: true }).fill('Черновик без сети')
  await dialog.getByLabel('Владелец (ФОП)', { exact: true }).fill('ФОП Тест')
  await dialog.getByLabel('Текущий баланс, UAH', { exact: true }).fill('555')
  expectedApiErrors.push({ path: '/api/ledger/commands', status: 0 })
  await context.setOffline(true)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Название счёта', { exact: true })).toHaveValue('Черновик без сети')
  await context.setOffline(false)
  await expect.poll(async () => {
    const result = await page.request.get('/api/ledger', { headers: await userHeaders(page) })
    const body = await result.json() as ApiResult<DocumentV1>
    return body.ok ? body.value.state.accounts.length : -1
  }).toBe(0)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect((await exportDocument(page)).state.accounts[0]?.balanceMinor).toBe(55500)
})

test('the owned API application can be recreated against the same database without losing session or ledger', async ({ page }) => {
  await createItem(page, 'DURABLE', 'После перезапуска', '2', '12,34')
  const before = await exportDocument(page)
  const restart = await runtimeControl({ action: 'restart' })
  expect(restart.ok).toBe(true)
  expect(restart.databaseName).toMatch(/^tradeledger_it_/)
  await page.reload()
  const after = await exportDocument(page)
  expect(after).toEqual(before)
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
})

const legacyDocument = createDocument({
  revision: 4,
  state: {
    inventory: [{ id: 'legacy-item', sku: 'LEGACY-1', name: 'Прежний товар', quantity: 3, stockValueMinor: 12345 }],
    accounts: [{ id: 'legacy-account', name: 'Прежний MONO', owner: 'ФОП Источник', provider: 'MONO', balanceMinor: 76543 }],
    debts: [], snapshots: [], audit: [],
  },
})

async function seedLegacy(page: import('@playwright/test').Page, document: unknown): Promise<void> {
  await page.evaluate(async source => {
    await new Promise<void>((resolveSeed, reject) => {
      const open = indexedDB.open('tradeledger', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('ledger')
      open.onerror = () => reject(new Error('Cannot seed isolated legacy fixture'))
      open.onsuccess = () => {
        const database = open.result
        const transaction = database.transaction('ledger', 'readwrite')
        transaction.objectStore('ledger').put(source, 'document')
        transaction.oncomplete = () => { database.close(); resolveSeed() }
        transaction.onerror = () => { database.close(); reject(new Error('Cannot write isolated legacy fixture')) }
      }
    })
  }, document)
}
async function readLegacy(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(async () => new Promise((resolveSource, reject) => {
    const open = indexedDB.open('tradeledger')
    open.onerror = () => reject(new Error('Cannot read isolated source'))
    open.onsuccess = () => {
      const database = open.result
      const read = database.transaction('ledger', 'readonly').objectStore('ledger').get('document')
      read.onsuccess = () => { database.close(); resolveSource(read.result as unknown) }
      read.onerror = () => { database.close(); reject(new Error('Cannot read isolated source')) }
    }
  }))
}

for (const populated of [false, true]) {
  anonymousTest(`legacy transfer ${populated ? 'archives a nonempty destination' : 'requires explicit destination confirmation'} and verifies PostgreSQL receipt`, async ({ page, credentials }, info) => {
    await page.goto('/')
    await seedLegacy(page, legacyDocument)
    await signUp(page, credentials)
    if (populated) await createAccount(page, 'Прежний серверный набор', '100')
    await navigate(page, 'Резервная копия')
    const legacy = page.getByRole('region', { name: 'Перенос прежних данных из браузера' })
    // The section is labelled by its heading, regardless of browser landmark mapping.
    const section = legacy.or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Перенос прежних данных из браузера', exact: true }) })).last()
    await expect(section).toContainText(credentials.email)
    expect((await runtimeControl({ action: 'counts', email: credentials.email })).value).toMatchObject({ accounts: populated ? 1 : 0, inventory: 0, receipts: 0 })
    await page.getByRole('button', { name: 'Проверить перенос в аккаунт', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Предпросмотр переноса', exact: true })).toBeVisible()
    await expect(section).toContainText('Товаров: 1; счетов: 1')
    const transfer = page.getByRole('button', { name: 'Перенести данные в аккаунт', exact: true })
    await expect(transfer).toBeDisabled()
    expect(await readLegacy(page)).toEqual(legacyDocument)
    await page.screenshot({ path: `.cache/previews/fullstack-migration-${info.project.name}.png`, fullPage: true })
    await page.getByRole('checkbox', { name: populated ? 'Подтверждаю архивирование и полную замену записей аккаунта' : 'Подтверждаю перенос в указанный аккаунт', exact: true }).check()
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/ledger/import') && response.request().method() === 'POST')
    await transfer.click()
    const response = await submitted
    expect(response.status()).toBe(200)
    const body = await response.json() as ApiResult<ImportResponse>
    expect(body.ok).toBe(true)
    if (!body.ok) throw new Error('Legacy transfer failed')
    await expect(page.getByRole('heading', { name: 'Перенос подтверждён сервером', exact: true })).toBeVisible()
    const receiptResponse = await page.request.get(`/api/ledger/imports/${body.value.receipt.requestId}`, { headers: await userHeaders(page) })
    expect(receiptResponse.status()).toBe(200)
    expect(await receiptResponse.json()).toEqual({ ok: true, value: body.value.receipt })
    expect(body.value.receipt.counts).toMatchObject({ inventory: 1, accounts: 1 })
    expect((await runtimeControl({ action: 'counts', email: credentials.email })).value).toMatchObject({ accounts: 1, inventory: 1, receipts: 1, archives: 1 })
    expect((await exportDocument(page)).state).toEqual(legacyDocument.state)
    expect(await readLegacy(page)).toEqual(legacyDocument)
    await page.reload()
    await expect(page.getByRole('status')).toContainText('уже перенесена')
    expect(await readLegacy(page)).toEqual(legacyDocument)
    const archiveResponse = await page.request.get('/api/ledger/datasets', { headers: await userHeaders(page) })
    const archive = await archiveResponse.json() as ApiResult<DatasetListResponse>
    expect(archive.ok && archive.value.datasets.length).toBe(1)
    if (archive.ok && populated) {
      const dataset = archive.value.datasets[0]
      if (!dataset) throw new Error('Archived destination missing')
      const archived = await (await page.request.get(`/api/ledger/datasets/${dataset.id}/export`, { headers: await userHeaders(page) })).json() as ApiResult<DocumentV1>
      expect(archived.ok && archived.value.state.accounts[0]?.name).toBe('Прежний серверный набор')
    }
  })
}

anonymousTest('corrupt legacy data remains recoverable and is never uploaded or deleted', async ({ page, credentials }) => {
  await page.goto('/')
  const corrupt = { schemaVersion: 1, revision: 'broken', source: 'isolated-test-only' }
  await seedLegacy(page, corrupt)
  await signUp(page, credentials)
  await navigate(page, 'Резервная копия')
  await expect(page.getByRole('button', { name: 'Скачать исходную копию', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Повторить чтение прежних данных', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Проверить перенос в аккаунт', exact: true })).toHaveCount(0)
  expect((await runtimeControl({ action: 'counts', email: credentials.email })).value).toMatchObject({ receipts: 0, inventory: 0, accounts: 0 })
  expect(await readLegacy(page)).toEqual(corrupt)
  await page.reload()
  expect(await readLegacy(page)).toEqual(corrupt)
  expect((await exportDocument(page)).state.accounts).toHaveLength(0)
})


test('a stale tab cannot write or log out the account selected by another tab', async ({ page, context, expectedApiErrors }) => {
  const aliceHeaders = await userHeaders(page)
  await createAccount(page, 'Счёт первой вкладки', '100')
  await page.getByRole('button', { name: 'Добавить счёт', exact: true }).click()
  const draft = page.getByRole('dialog')
  await draft.getByLabel('Название счёта', { exact: true }).fill('Не переносить другому пользователю')
  await draft.getByLabel('Владелец (ФОП)', { exact: true }).fill('Первый аккаунт')
  await draft.getByLabel('Текущий баланс, UAH', { exact: true }).fill('999')
  const other = await context.newPage()
  await other.goto('/')
  await navigate(other, 'Счета')
  await expect(other.getByRole('row').filter({ hasText: 'Счёт первой вкладки' })).toHaveCount(1)
  // Real auth requests change the shared cookie without a UI BroadcastChannel
  // notification, reproducing a suspended tab that missed another tab's message.
  const loggedOut = await other.request.post('/api/auth/logout', {
    headers: { Origin: 'http://127.0.0.1:5179', 'X-TradeLedger-Request': '1', ...aliceHeaders }, data: {},
  })
  expect(loggedOut.status()).toBe(200)
  const registered = await other.request.post('/api/auth/register', {
    headers: { Origin: 'http://127.0.0.1:5179', 'X-TradeLedger-Request': '1' },
    data: { email: `e2e-${randomUUID()}@example.test`, password: `synthetic-${randomUUID()}` },
  })
  expect(registered.status()).toBe(200)
  await other.reload()
  await expect(other.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
  await expect(draft).toBeVisible()
  const bobHeaders = await userHeaders(other)
  expect(bobHeaders).not.toEqual(aliceHeaders)
  const rejectedLogout = await page.request.post('/api/auth/logout', {
    headers: { Origin: 'http://127.0.0.1:5179', 'X-TradeLedger-Request': '1', ...aliceHeaders }, data: {},
  })
  expect(rejectedLogout.status()).toBe(401)
  expect(rejectedLogout.headers()['set-cookie']).toBeUndefined()
  expectedApiErrors.push({ path: '/api/ledger/commands', status: 401 })
  const submitted = page.waitForResponse(response => response.url().endsWith('/api/ledger/commands'))
  await draft.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect((await submitted).status()).toBe(401)
  await expect(page.getByRole('heading', { name: 'Вход в TradeLedger', exact: true })).toBeVisible()
  await expect(page.getByText('Счёт первой вкладки', { exact: true })).toHaveCount(0)
  // The invalidation broadcast may clear other tab UI, but must retain B's valid cookie.
  await other.reload()
  await expect(other.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
  expect((await exportDocument(other)).state.accounts).toHaveLength(0)
  expect(await userHeaders(other)).toEqual(bobHeaders)
})
