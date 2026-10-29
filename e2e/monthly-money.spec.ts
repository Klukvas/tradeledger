import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  kyivMonth,
  monthBoundary,
  monthKey,
  shiftMonth,
} from "../src/domain/month-calendar";
import type { DocumentV1, Snapshot } from "../src/domain/types";
import { createDocument, createEmptyState } from "../src/test/fixtures";
import {
  createAccount,
  expect,
  exportDocument,
  importDocument,
  money,
  navigate,
  test,
} from "./helpers";
import { runtimeControl } from "./runtime-control";

function saved(
  id: string,
  createdAt: string,
  totalMinor: number,
  closedMonth?: string,
): Snapshot {
  return {
    id,
    createdAt,
    label: id,
    totalMinor,
    ...(closedMonth ? { closedMonth } : {}),
    accounts: [
      {
        accountId: "bank",
        name: "Основной",
        owner: "ФОП Тест",
        provider: "MONO",
        balanceMinor: totalMinor,
      },
    ],
  };
}
function fixture(asOf: Date, overflow = false, official = true): DocumentV1 {
  const current = kyivMonth(asOf);
  const previous = shiftMonth(current, -1);
  return createDocument({
    state: createEmptyState({
      accounts: [
        {
          id: "bank",
          name: "Основной",
          owner: "ФОП Тест",
          provider: "MONO",
          balanceMinor: overflow ? Number.MAX_SAFE_INTEGER : 150000,
        },
        {
          id: "second",
          name: "NovaPay",
          owner: "ФОП Другой",
          provider: "NovaPay",
          balanceMinor: overflow ? 0 : -5000,
        },
      ],
      snapshots: [
        saved(
          "Старый ручной замер",
          new Date(monthBoundary(current).getTime() - 1000).toISOString(),
          50000,
        ),
        ...(official
          ? [
              saved(
                "Итог прошлого месяца",
                monthBoundary(current).toISOString(),
                overflow ? -1 : 100000,
                monthKey(previous),
              ),
            ]
          : []),
        saved(
          "Ручной замер сегодня",
          asOf.toISOString(),
          overflow ? Number.MAX_SAFE_INTEGER : 140000,
        ),
      ],
    }),
  });
}
async function setBalance(
  page: Page,
  name: string,
  value: string,
): Promise<void> {
  await navigate(page, "Счета");
  await page
    .getByRole("button", {
      name: `Обновить баланс: ${name}, ФОП Тест`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Текущий баланс, UAH", { exact: true }).fill(value);
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
const metricFor = (page: Page) =>
  page.locator(".stat-card").filter({ hasText: "Изменение денег за месяц" });

test("real automatic close survives account edits, a new account, retries and API restart", async ({
  page,
  credentials,
}, info) => {
  await createAccount(page, "Основной", "1000");
  await createAccount(page, "NovaPay", "200", "NovaPay");
  await navigate(page, "Обзор");
  await expect(metricFor(page).locator(".stat-value")).toHaveText(
    "Нет данных за прошлый месяц",
  );
  await expect(
    page.getByRole("button", { name: "Зафиксировать балансы", exact: true }),
  ).toHaveCount(0);
  const closed = await runtimeControl({
    action: "monthlyFixture",
    email: credentials.email,
  });
  expect(closed.ok).toBe(true);
  await page.reload();
  await expect(metricFor(page).locator(".stat-value")).toHaveText(money(0));
  const first = await exportDocument(page);
  expect(first.state.snapshots).toHaveLength(1);
  expect(first.state.snapshots[0]).toMatchObject({
    totalMinor: 120000,
    closedMonth: monthKey(shiftMonth(kyivMonth(new Date()), -1)),
  });
  expect(first.state.snapshots[0]?.createdAt).toBe(
    monthBoundary(kyivMonth(new Date())).toISOString(),
  );
  await setBalance(page, "Основной", "1500");
  await createAccount(page, "Новый счёт", "300");
  expect(
    (
      await runtimeControl({
        action: "monthlyFixture",
        email: credentials.email,
      })
    ).ok,
  ).toBe(true);
  expect((await runtimeControl({ action: "restart" })).ok).toBe(true);
  await page.reload();
  for (const route of ["Обзор", "Счета"]) {
    await navigate(page, route);
    await expect(metricFor(page).locator(".stat-value")).toHaveText(money(800));
    await expect(metricFor(page)).toContainText("Закрыт месяц:");
    await expect(metricFor(page)).toContainText("00:00 (Киев)");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const persisted = await exportDocument(page);
  expect(persisted.state.snapshots).toEqual(first.state.snapshots);
  await navigate(page, "Обзор");
  await mkdir(".cache/automatic-month/frontend/evidence", { recursive: true });
  await page.screenshot({
    path: `.cache/automatic-month/frontend/evidence/automatic-${info.project.name}.png`,
    fullPage: true,
  });
});

test("restored official closure is the baseline; manual history and next-month rollover do not substitute", async ({
  page,
}) => {
  const now = new Date();
  await page.clock.setFixedTime(now);
  await importDocument(page, fixture(now));
  for (const route of ["Обзор", "Счета"]) {
    await navigate(page, route);
    await expect(metricFor(page).locator(".stat-value")).toHaveText(money(450));
    await expect(metricFor(page)).toContainText("Закрыт месяц:");
    await expect(metricFor(page)).toContainText("00:00 (Киев)");
  }
  await setBalance(page, "Основной", "1600");
  await expect(metricFor(page).locator(".stat-value")).toHaveText(money(550));
  await page.reload();
  await expect(metricFor(page).locator(".stat-value")).toHaveText(money(550));
  await navigate(page, "Обзор");
  await expect(
    page.getByRole("region", { name: "Таблица истории балансов" }),
  ).toContainText("Старый ручной замер");
  await page.clock.setFixedTime(monthBoundary(shiftMonth(kyivMonth(now), 1)));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(metricFor(page).locator(".stat-value")).toHaveText(
    "Нет данных за прошлый месяц",
  );
});

test("manual-only imported history never invents a monthly baseline", async ({
  page,
}) => {
  await importDocument(page, fixture(new Date(), false, false));
  for (const route of ["Обзор", "Счета"]) {
    await navigate(page, route);
    await expect(metricFor(page).locator(".stat-value")).toHaveText(
      "Нет данных за прошлый месяц",
    );
  }
});

test("monthly overflow stays explicit and both pages remain usable", async ({
  page,
}) => {
  await importDocument(page, fixture(new Date(), true));
  for (const route of ["Обзор", "Счета"]) {
    await navigate(page, route);
    await expect(metricFor(page).locator(".stat-value")).toHaveText(
      "Сумма вне диапазона",
    );
    await expect(metricFor(page)).toContainText(
      "Разница превышает допустимый диапазон",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
