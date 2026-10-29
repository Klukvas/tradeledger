import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  createAccount,
  expect,
  money,
  navigate,
  importHistoricalSnapshot,
  test,
} from "./helpers";

async function changeBalance(page: Page, value: string): Promise<void> {
  await navigate(page, "Счета");
  await page
    .getByRole("button", {
      name: "Обновить баланс: Карточка, ФОП Тест",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Текущий баланс, UAH", { exact: true }).fill(value);
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await navigate(page, "Обзор");
}

async function expectMoneyFits(page: Page, singleLine: boolean): Promise<void> {
  const geometry = await page
    .locator(".overview-stats .stat-card")
    .evaluateAll((cards) =>
      cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        const groups = [...card.querySelectorAll(".dashboard-money-group")].map(
          (group) => {
            const rect = group.getBoundingClientRect();
            return {
              left: rect.left,
              right: rect.right,
              top: Math.round(rect.top),
              bottom: rect.bottom,
            };
          },
        );
        return {
          left: bounds.left,
          right: bounds.right,
          bottom: bounds.bottom,
          groups,
        };
      }),
    );
  for (const card of geometry) {
    for (const group of card.groups) {
      expect(group.left).toBeGreaterThanOrEqual(card.left);
      expect(group.right).toBeLessThanOrEqual(card.right);
      expect(group.bottom).toBeLessThanOrEqual(card.bottom);
    }
    if (singleLine && card.groups.length)
      expect(new Set(card.groups.map((group) => group.top)).size).toBe(1);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("overview balances five metrics and keeps ordinary currency on one line while large values fit", async ({
  page,
}, info) => {
  await createAccount(page, "Карточка", "219943.70");
  await navigate(page, "Обзор");
  await expect(page.locator(".overview-stats .stat-value").first()).toHaveText(
    money(219943.7),
  );
  for (const [width, expectedRows] of [
    [320, [1, 1, 1, 1, 1]],
    [390, [2, 2, 1]],
    [760, [2, 2, 1]],
    [1000, [2, 2, 1]],
    [1001, [3, 2]],
    [1265, [3, 2]],
    [1440, [3, 2]],
    [1600, [5]],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    const rows = await page
      .locator(".overview-stats .stat-card")
      .evaluateAll((cards) => {
        const counts = new Map<number, number>();
        for (const card of cards) {
          const top = Math.round(card.getBoundingClientRect().top);
          counts.set(top, (counts.get(top) ?? 0) + 1);
        }
        return [...counts.values()];
      });
    expect(rows, `${width}px metric rows`).toEqual(expectedRows);
    await expectMoneyFits(page, true);
  }
  if (info.project.name === "desktop") {
    await mkdir(".cache/automatic-month/frontend/evidence/layout", {
      recursive: true,
    });
    for (const width of [1265, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: `.cache/automatic-month/frontend/evidence/layout/desktop-${width}.png`,
        fullPage: true,
      });
    }
  }
  await importHistoricalSnapshot(page, "До изменения");
  await changeBalance(page, "-219943.70");
  for (const width of [390, 1001, 1265, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectMoneyFits(page, true);
  }
  await importHistoricalSnapshot(page, "Отрицательный остаток");
  await changeBalance(page, "-90071992547409.91");
  await expect(page.locator(".overview-stats .stat-value").first()).toHaveText(
    /-90\s071\s992\s547\s409,91\sгрн\./,
  );
  for (const width of [320, 390, 760, 1001, 1265, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectMoneyFits(page, false);
    const currency = page
      .locator(".overview-stats .stat-card")
      .first()
      .locator(".dashboard-money-group")
      .last();
    await expect(currency).toHaveText(/409,91\sгрн\./);
  }
});

test("history retains search and type through links, browser back and forward, including reset", async ({
  page,
}) => {
  await createAccount(page, "Карточка", "219943.70");
  await navigate(page, "История");
  const search = page.getByRole("searchbox", { name: "Поиск по истории" });
  const type = page.getByRole("combobox", { name: "Тип операции" });
  await search.fill("Карточка");
  await type.selectOption("account.create");
  await expect(page.getByRole("status")).toHaveText("Показано 1 из 1");
  await navigate(page, "Обзор");
  await page.goBack();
  await expect(search).toHaveValue("Карточка");
  await expect(type).toHaveValue("account.create");
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Обзор", exact: true }),
  ).toBeVisible();
  await navigate(page, "История");
  await expect(search).toHaveValue("Карточка");
  await expect(type).toHaveValue("account.create");
  await search.fill("нет такой записи");
  await navigate(page, "Обзор");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Ничего не найдено" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Показать все операции" }).click();
  await navigate(page, "Обзор");
  await page.goBack();
  await expect(search).toHaveValue("");
  await expect(type).toHaveValue("");
  await expect(page.getByRole("status")).toHaveText("Показано 1 из 1");
});
