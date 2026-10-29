import { createAccount, expect, navigate, test } from './helpers'

test('all mobile routes and overview account balances fit without horizontal scrolling', async ({ page }, info) => {
  await page.goto('/')
  await createAccount(page, 'MONO для закупок', '-12345,67')
  await createAccount(page, 'NovaPay', '5000', 'NovaPay')
  await navigate(page, 'Обзор')
  const accounts = page.getByRole('region', { name: 'Текущие счета', exact: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(accounts.getByRole('table')).toBeVisible()
  await expect(accounts.getByRole('list', { name: 'Балансы счетов' })).toHaveCount(0)
  if (info.project.name === 'desktop') {
    await page.screenshot({ path: '.cache/previews/ui-fixes-desktop.png', fullPage: true })
  }

  const longName = 'Название'.repeat(15)
  const longOwner = 'Владелец'.repeat(15)
  await navigate(page, 'Счета')
  await page.getByRole('button', { name: 'Изменить данные: MONO для закупок, ФОП Тест', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Название счёта', { exact: true }).fill(longName)
  await dialog.getByLabel('Владелец (ФОП)', { exact: true }).fill(longOwner)
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.getByRole('button', { name: `Обновить баланс: ${longName}, ${longOwner}`, exact: true }).click()
  await dialog.getByLabel('Текущий баланс, UAH', { exact: true }).fill('-90071992547409,91')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await navigate(page, 'Обзор')

  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => window.scrollTo(0, 0))
    const navigation = page.getByRole('navigation', { name: 'Разделы учёта' })
    const links = navigation.getByRole('link')
    await expect(links).toHaveCount(5)
    const bounds = await links.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width }
    }))
    for (const rect of bounds) {
      expect(rect.left, `${width}px ${rect.text}`).toBeGreaterThanOrEqual(0)
      expect(rect.right, `${width}px ${rect.text}`).toBeLessThanOrEqual(width)
      expect(rect.top).toBeGreaterThanOrEqual(0)
      expect(rect.bottom).toBeLessThanOrEqual(844)
      expect(rect.height).toBeGreaterThanOrEqual(44)
      expect(rect.width).toBeGreaterThanOrEqual(44)
    }
    expect(await navigation.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await navigate(page, 'Резервная копия')
    await expect(page).toHaveTitle(/Резервная копия/)
    await navigate(page, 'Обзор')
    await expect(accounts.getByRole('table')).toHaveCount(0)
    const cards = accounts.getByRole('list', { name: 'Балансы счетов' })
    await expect(cards.getByRole('listitem')).toHaveCount(2)
    const card = cards.getByRole('listitem').filter({ hasText: longName })
    await expect(card.getByRole('heading', { name: longName, exact: true })).toBeVisible()
    await expect(card.locator('.money')).toHaveText(/-90\s071\s992\s547\s409,91\s(?:грн\.|₴|UAH)/)
    await expect(card).toContainText(longOwner)
    const visibleContent = await card.locator('h3, .money, dd').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, fits: element.scrollWidth <= element.clientWidth }
    }))
    for (const rect of visibleContent) {
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(width)
      expect(rect.fits).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    if (width === 390 && info.project.name === 'mobile') {
      await page.screenshot({ path: '.cache/previews/ui-fixes-mobile.png', fullPage: true })
    }
  }
})
