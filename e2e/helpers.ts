import { randomUUID } from 'node:crypto'
import { expect, request, test as base, type Page } from '@playwright/test'
import type { ApiResult, AuthResponse } from '../shared/api'
import type { DocumentV1 } from '../src/domain/types'

export type Credentials = Readonly<{ email: string; password: string }>
type ExpectedError = Readonly<{ path: string; status: number }>
type Fixtures = { credentials: Credentials; expectedApiErrors: ExpectedError[]; browserErrors: readonly string[] }
export const anonymousTest = base.extend<Fixtures>({
  // Playwright requires an object destructuring parameter for fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  credentials: async ({}, use) => { await use({ email: `e2e-${randomUUID()}@example.test`, password: `synthetic-${randomUUID()}` }) },
  // eslint-disable-next-line no-empty-pattern
  expectedApiErrors: async ({}, use) => { await use([]) },
  browserErrors: [async ({ context, expectedApiErrors }, use) => {
    const errors: string[] = []
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message))
      page.on('response', response => {
        const path = new URL(response.url()).pathname
        if (!path.startsWith('/api/') || response.status() < 400) return
        const expected = (path === '/api/auth/me' && response.status() === 401)
          || expectedApiErrors.some(entry => entry.path === path && entry.status === response.status())
        if (!expected) errors.push(`Unexpected API ${response.status()} ${path}`)
      })
      page.on('console', message => {
        if (message.type() !== 'error') return
        const path = new URL(message.location().url || 'http://localhost').pathname
        // HTTP errors are checked against actual response route/status above, not their generic Chrome console text.
        if (path.startsWith('/api/') && /^Failed to load resource: the server responded with a status of/.test(message.text())) return
        if (path.startsWith('/api/') && /^Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|FAILED)/.test(message.text())
          && expectedApiErrors.some(entry => entry.path === path && entry.status === 0)) return
        errors.push(`${message.text()} (${path})`)
      })
    })
    await use(errors)
    expect(errors, 'No uncaught errors or unexpected API/console errors').toEqual([])
  }, { auto: true }],
})
export const test = anonymousTest.extend({
  page: async ({ page, credentials }, use) => {
    await page.goto('/')
    await signUp(page, credentials)
    await use(page)
  },
})

/** Provision synthetic accounts only in the isolated E2E runtime, then exercise UI login. */
export async function signUp(page: Page, credentials: Credentials): Promise<void> {
  const origin = 'http://127.0.0.1:5179'
  if (new URL(page.url()).origin !== origin || !/^e2e-[a-f0-9-]+@example\.test$/.test(credentials.email)) {
    throw new Error('Synthetic account provisioning is restricted to the isolated E2E runtime')
  }
  const provisioning = await request.newContext({ baseURL: origin })
  try {
    const response = await provisioning.post('/api/auth/register', {
      headers: { Origin: origin, 'X-TradeLedger-Request': '1' },
      data: credentials,
    })
    expect(response.status()).toBe(200)
  } finally {
    await provisioning.dispose()
  }
  await signIn(page, credentials)
}

export async function signIn(page: Page, credentials: Credentials): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Вход в TradeLedger', exact: true })).toBeVisible()
  await page.getByLabel('Электронная почта', { exact: true }).fill(credentials.email)
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible()
}
export { expect }

export async function navigate(page: Page, label: string, heading = label): Promise<void> {
  if (label === 'Резервная копия') {
    // Backup remains available by direct route after its menu entry was removed.
    await page.evaluate(() => { window.location.hash = '#settings' })
  } else {
    await page.getByRole('navigation', { name: 'Разделы учёта' }).getByRole('link', { name: label, exact: true }).click()
  }
  await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
}

export async function createAccount(page: Page, name: string, balance = '1000', provider = 'MONO'): Promise<void> {
  await navigate(page, 'Счета')
  await page.getByRole('button', { name: 'Добавить счёт', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название счёта', { exact: true }).fill(name)
  await dialog.getByLabel('Владелец (ФОП)', { exact: true }).fill('ФОП Тест')
  await dialog.getByLabel('Провайдер', { exact: true }).selectOption(provider)
  await dialog.getByLabel('Текущий баланс, UAH', { exact: true }).fill(balance)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1)
}

export async function createItem(page: Page, sku = 'SKU-01', name = 'Кабель', quantity = '3', cost = '10,01'): Promise<void> {
  await navigate(page, 'Склад')
  await page.getByRole('button', { name: 'Добавить товар', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Артикул (SKU)', { exact: true }).fill(sku)
  await dialog.getByLabel('Название товара', { exact: true }).fill(name)
  await dialog.getByLabel('Начальное количество, шт.', { exact: true }).fill(quantity)
  await dialog.getByLabel('Закупочная цена за единицу, UAH', { exact: true }).fill(cost)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

export async function exportDocument(page: Page): Promise<DocumentV1> {
  await navigate(page, 'Резервная копия', 'Резервная копия')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать резервную копию' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toMatch(/^tradeledger-\d{4}-\d{2}-\d{2}\.json$/)
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download stream missing')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as DocumentV1
}

export function money(major: number): RegExp {
  // Node and Chrome ship different CLDR currency symbols for UAH.
  const amount = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(major).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s/g, '\\s')
  return new RegExp(`^${amount}\\s(?:грн\\.|₴|UAH)$`)
}

/** Restore legacy history through the supported backup workflow; this is not a monthly close. */
export async function importHistoricalSnapshot(
  page: Page,
  label: string,
): Promise<void> {
  const document = await exportDocument(page);
  const accounts = document.state.accounts.map((account) => ({
    accountId: account.id,
    name: account.name,
    owner: account.owner,
    provider: account.provider,
    balanceMinor: account.balanceMinor,
  }));
  const totalMinor = Number(
    accounts.reduce((sum, account) => sum + BigInt(account.balanceMinor), 0n),
  );
  await importDocument(page, {
    ...document,
    state: {
      ...document.state,
      snapshots: [
        ...document.state.snapshots,
        {
          id: randomUUID(),
          label,
          createdAt: new Date().toISOString(),
          totalMinor,
          accounts,
        },
      ],
    },
  });
  await navigate(page, "Обзор");
  await expect(page.getByRole("row").filter({ hasText: label })).toHaveCount(1);
}

export async function importDocument(
  page: Page,
  document: DocumentV1,
): Promise<void> {
  await navigate(page, "Резервная копия");
  await page.getByLabel("Файл резервной копии", { exact: true }).setInputFiles({
    name: "history.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(
    page.getByRole("heading", { name: "Предпросмотр: history.json" }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Подтверждаю полную замену текущих данных" })
    .check();
  await page
    .getByRole("button", {
      name: "Заменить данные резервной копией",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Данные заменены");
}

/** Discover public identity once, then capture it for direct test requests. */
export async function userHeaders(page: Page): Promise<Readonly<Record<string, string>>> {
  const response = await page.request.get('/api/auth/me')
  expect(response.status()).toBe(200)
  const body = await response.json() as ApiResult<AuthResponse>
  if (!body.ok) throw new Error('Test account identity unavailable')
  return { 'X-TradeLedger-User': body.value.user.id }
}
