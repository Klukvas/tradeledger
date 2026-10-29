import { createAccount, createItem, expect, exportDocument, money, navigate, test } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Начните с текущих остатков' })).toBeVisible()
})

test('backup download, invalid/oversized rejection and explicit restore survive reload', async ({ page }) => {
  await createItem(page)
  await createAccount(page, 'Сохранённый счёт', '123,45')
  const backup = await exportDocument(page)
  expect(backup.schemaVersion).toBe(1)
  await createAccount(page, 'Временный счёт', '999')
  await navigate(page, 'Резервная копия', 'Резервная копия')
  const input = page.getByLabel('Файл резервной копии', { exact: true })
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') })
  await expect(page.getByRole('alert')).toContainText('JSON')
  await input.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, ' ') })
  await expect(page.getByRole('alert')).toContainText('5 МБ')
  expect((await exportDocument(page)).state.accounts).toHaveLength(2)
  await input.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await expect(page.getByRole('heading', { name: 'Предпросмотр: valid.json' })).toBeVisible()
  const restore = page.getByRole('button', { name: 'Заменить данные резервной копией', exact: true })
  await expect(restore).toBeDisabled()
  expect((await exportDocument(page)).state.accounts).toHaveLength(2)
  await page.getByRole('checkbox', { name: 'Подтверждаю полную замену текущих данных' }).check()
  await restore.click()
  await expect(page.getByRole('status')).toContainText('Данные заменены')
  await page.reload()
  const restored = await exportDocument(page)
  expect(restored.state).toEqual(backup.state)
  expect(restored.revision).toBeGreaterThan(backup.revision)
})

test('two tabs preserve a stale draft and require explicit review before replacing a balance', async ({ page, context, expectedApiErrors }) => {
  expectedApiErrors.push({ path: '/api/ledger/commands', status: 409 })
  await createAccount(page, 'Общий счёт', '100')
  await page.getByRole('button', { name: 'Обновить баланс: Общий счёт, ФОП Тест', exact: true }).click()
  const draft = page.getByRole('dialog')
  await draft.getByLabel('Текущий баланс, UAH', { exact: true }).fill('150')
  const other = await context.newPage()
  await other.goto('/#accounts')
  await other.getByRole('button', { name: 'Обновить баланс: Общий счёт, ФОП Тест', exact: true }).click()
  await other.getByRole('dialog').getByLabel('Текущий баланс, UAH', { exact: true }).fill('250')
  await other.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(other.getByRole('dialog')).not.toBeVisible()
  await draft.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(draft.getByRole('alert')).toBeVisible()
  await expect(draft.getByLabel('Текущий баланс, UAH', { exact: true })).toHaveValue('150')
  await expect(draft.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  expect((await exportDocument(other)).state.accounts[0]?.balanceMinor).toBe(25000)
  await draft.getByRole('button', { name: 'Обновить данные', exact: true }).click()
  await expect(draft.getByText(/Сейчас: Общий счёт/).locator('.money')).toHaveText(money(250))
  await draft.getByRole('button', { name: 'Сверился, повторить сохранение', exact: true }).click()
  await expect(draft).not.toBeVisible()
  const saved = await exportDocument(page)
  expect(saved.state.accounts[0]?.balanceMinor).toBe(15000)
  expect(saved.state.audit.filter((entry) => entry.type === 'account.setBalance')).toHaveLength(2)
})

test('navigation, responsive widths, accessible field errors, native focus trap and Escape', async ({ page }, info) => {
  const destinations = [
    ['Склад', 'Склад'], ['Счета', 'Счета'], ['Долги', 'Долги'],
    ['История', 'История'], ['Резервная копия', 'Резервная копия'], ['Обзор', 'Обзор'],
  ] as const
  for (const [label, heading] of destinations) {
    await navigate(page, label, heading)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const controls = await page.locator('button:visible, .nav-item:visible').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent, width: rect.width, height: rect.height }
    }))
    for (const control of controls) {
      expect(control.width, `Target width: ${control.text}`).toBeGreaterThanOrEqual(44)
      expect(control.height, `Target height: ${control.text}`).toBeGreaterThanOrEqual(44)
    }
  }
  await navigate(page, 'Склад')
  await navigate(page, 'Счета')
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Склад', exact: true })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { level: 1, name: 'Счета', exact: true })).toBeVisible()
  const trigger = page.getByRole('button', { name: 'Добавить счёт', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const name = dialog.getByLabel('Название счёта', { exact: true })
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  const description = await name.getAttribute('aria-describedby')
  expect(description).toBeTruthy()
  if (!description) throw new Error('Field error must have an accessible description')
  await expect(page.locator(`[id="${description.split(' ').at(-1)}"]`)).toHaveAttribute('role', 'alert')
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab')
    // Native dialogs may tab into browser chrome (activeElement becomes body),
    // but must never focus background controls.
    expect(await dialog.evaluate((element) => element.contains(document.activeElement) || document.activeElement === document.body)).toBe(true)
  }
  await page.getByRole('navigation', { name: 'Разделы учёта' }).getByRole('link', { name: 'Склад', exact: true }).evaluate((element) => element.focus())
  await expect(page.getByRole('navigation', { name: 'Разделы учёта' }).getByRole('link', { name: 'Склад', exact: true })).not.toBeFocused()
  await page.screenshot({ path: `.cache/previews/${info.project.name}-dialog.png`, fullPage: true })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await createItem(page)
  await createAccount(page, 'Счёт для проверки', '100')
  for (const [label, heading] of destinations) {
    await navigate(page, label, heading)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.screenshot({ path: `.cache/previews/${info.project.name}-overview.png`, fullPage: true })
})
