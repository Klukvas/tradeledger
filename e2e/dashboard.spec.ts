import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  createAccount,
  createItem,
  expect,
  money,
  navigate,
  importHistoricalSnapshot,
  test,
} from "./helpers";

async function setBalance(
  page: Page,
  name: string,
  balance: string,
): Promise<void> {
  await navigate(page, "Счета");
  await page
    .getByRole("button", {
      name: `Обновить баланс: ${name}, ФОП Тест`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Текущий баланс, UAH", { exact: true }).fill(balance);
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("dashboard preserves imported legacy history, signed accounts and procurement values across sizes", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await createAccount(page, "MONO — торговля", "15000");
  await createAccount(page, "NovaPay — расчёты", "-2500", "NovaPay");
  await importHistoricalSnapshot(page, "Начало недели");
  await setBalance(page, "MONO — торговля", "18000");
  await importHistoricalSnapshot(page, "После поставки");
  await setBalance(page, "MONO — торговля", "19000");
  for (let index = 0; index < 7; index += 1) {
    await createItem(
      page,
      `SKU-${index + 1}`,
      [
        "Кабель USB-C",
        "Зарядное устройство",
        "Адаптер HDMI",
        "Чехол",
        "Подставка",
        "Крепление",
        "Переходник",
      ][index],
      index === 6 ? "0" : "10",
      `${700 - index * 100}`,
    );
  }
  await navigate(page, "Обзор");
  const trend = page.getByRole("region", {
    name: "Динамика балансов",
    exact: true,
  });
  await expect(trend.locator(".dashboard-current strong")).toHaveText(
    money(16500),
  );
  await expect(trend.locator(".dashboard-history-point")).toHaveCount(2);
  await expect(trend.locator(".dashboard-current-point")).toHaveCount(1);
  await expect(trend.getByText(/^Верх шкалы:/)).toBeVisible();
  await expect(trend.getByText(/^Низ шкалы:/)).toBeVisible();
  await expect(trend.getByText(/^Первая показанная фиксация:/)).toBeVisible();
  await expect(
    trend.getByText(/^Последняя показанная фиксация:/),
  ).toBeVisible();
  const accounts = page
    .getByRole("region", { name: "Балансы счетов", exact: true })
    .filter({ has: page.locator("h2") });
  await expect(accounts.locator(".is-negative")).toHaveCount(1);
  await expect(accounts.locator(".is-positive")).toHaveCount(1);
  await expect(accounts.getByText("NovaPay — расчёты")).toBeVisible();
  const stock = page.getByRole("region", {
    name: "Стоимость товаров",
    exact: true,
  });
  await expect(
    stock.getByText("Позиций: 7 · Единиц: 60 · Без остатка: 1"),
  ).toBeVisible();
  await expect(stock.locator(".dashboard-rank-row")).toHaveCount(6);
  await expect(
    stock.locator(".dashboard-rank-row").first().locator(".money"),
  ).toHaveText(money(7000));
  await expect(stock.getByText("Остальные товары")).toBeVisible();
  const summary = trend.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const values = page.getByRole("region", {
    name: "Значения графика балансов",
  });
  await expect(
    values.getByRole("row", { name: /Начало недели/ }).locator(".money"),
  ).toHaveText(money(12500));
  await expect(
    values.getByRole("row", { name: /После поставки/ }).locator(".money"),
  ).toHaveText(money(15500));
  await expect(
    values.getByRole("row", { name: /Сейчас/ }).locator(".money"),
  ).toHaveText(money(16500));
  await page.keyboard.press("Enter");
  await expect(values).not.toBeVisible();
  for (const width of [320, 390, 760, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await expect(
      page.getByRole("heading", { name: "Стоимость товаров", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await mkdir(".cache/automatic-month/frontend/evidence", { recursive: true });
  if (testInfo.project.name === "desktop") {
    const fullHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    await page.setViewportSize({ width: 1440, height: fullHeight });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: ".cache/automatic-month/frontend/evidence/dashboard-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: ".cache/automatic-month/frontend/evidence/dashboard-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: ".cache/automatic-month/frontend/evidence/dashboard-320.png",
      fullPage: true,
    });
  }
  await page.setViewportSize({
    width: testInfo.project.name === "desktop" ? 1440 : 390,
    height: testInfo.project.name === "desktop" ? 1000 : 844,
  });
  await trend.screenshot({
    path: `.cache/automatic-month/frontend/evidence/trend-${testInfo.project.name}.png`,
  });
  if (testInfo.project.name === "mobile") {
    const fullHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    await page.setViewportSize({ width: 390, height: fullHeight });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: ".cache/automatic-month/frontend/evidence/dashboard-mobile.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await expect(
    page.getByRole("button", { name: "Зафиксировать балансы", exact: true }),
  ).toHaveCount(0);
});
