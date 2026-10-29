import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerContextValue, Snapshot } from "../../domain/types";
import { createDocument, createEmptyState } from "../../test/fixtures";
import { OverviewPage } from "../OverviewPage";

vi.mock("../../data", async (original) => ({
  ...(await original<typeof import("../../data")>()),
  useLedger: () => ledger,
}));
let ledger: LedgerContextValue;
const account = {
  id: "bank",
  name: "Основной",
  owner: "Иван",
  provider: "MONO" as const,
  balanceMinor: 20000,
};
function ready(
  snapshots: readonly Snapshot[] = [],
): LedgerContextValue["snapshot"] {
  return {
    status: "ready",
    busy: false,
    error: null,
    document: createDocument({
      state: createEmptyState({ accounts: [account], snapshots }),
    }),
  };
}
function saved(official = false): Snapshot {
  return {
    id: "saved",
    label: official ? "Итог месяца" : "Прежний ручной замер",
    createdAt: official
      ? "2026-10-31T22:00:00.000Z"
      : "2026-10-20T10:00:00.000Z",
    ...(official ? { closedMonth: "2026-10" } : {}),
    totalMinor: 12345,
    accounts: [
      {
        accountId: account.id,
        name: "Старое название",
        owner: account.owner,
        provider: account.provider,
        balanceMinor: 12345,
      },
    ],
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
  ledger = {
    snapshot: ready(),
    dispatch: vi.fn(),
    refresh: vi.fn(),
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("automatic monthly balances", () => {
  it("offers onboarding and explains the first automatic close without a manual workflow", () => {
    ledger = {
      ...ledger,
      snapshot: {
        status: "ready",
        document: createDocument(),
        busy: false,
        error: null,
      },
    };
    render(<OverviewPage />);
    expect(screen.getByText("Нет данных за прошлый месяц")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Зафиксировать балансы" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /Первое месячное сравнение появится после автоматического закрытия/,
      ),
    ).toBeInTheDocument();
    for (const name of ["Добавить счёт", "Добавить товар", "Добавить долг"])
      expect(screen.getByRole("link", { name })).toHaveAttribute("href");
  });

  it("keeps legacy history and graph values without treating a manual snapshot as the monthly baseline", () => {
    ledger = { ...ledger, snapshot: ready([saved()]) };
    render(<OverviewPage />);
    expect(screen.getByText("Нет данных за прошлый месяц")).toBeInTheDocument();
    const history = screen.getByRole("region", {
      name: "Таблица истории балансов",
    });
    expect(
      within(history).getByText("Прежний ручной замер"),
    ).toBeInTheDocument();
    expect(within(history).getByText(/Старое название/)).toBeInTheDocument();
    const graph = screen.getByRole("region", {
      name: "Значения графика балансов",
      hidden: true,
    });
    expect(
      within(graph).getByRole("row", {
        name: /Прежний ручной замер/,
        hidden: true,
      }),
    ).toHaveTextContent("123,45");
    expect(
      within(graph).getByRole("row", { name: /Сейчас/, hidden: true }),
    ).toHaveTextContent("200,00");
  });

  it("names the closed month when its timestamp is the first day of the next month", () => {
    ledger = { ...ledger, snapshot: ready([saved(true)]) };
    const view = render(<OverviewPage />);
    const metric = screen
      .getByText("Изменение денег за месяц")
      .closest(".stat-card");
    expect(metric).toHaveTextContent("76,55");
    expect(metric).toHaveTextContent("Закрыт месяц: октябрь 2026");
    expect(metric).toHaveTextContent("01.11.2026, 00:00 (Киев)");
    const history = screen.getByRole("region", {
      name: "Таблица истории балансов",
    });
    expect(history).toHaveTextContent("Закрыт месяц: октябрь 2026");
    expect(history).toHaveTextContent("Старое название");
    expect(
      screen.getByRole("region", {
        name: "Значения графика балансов",
        hidden: true,
      }),
    ).toHaveTextContent("Итог месяца · Закрыт месяц: октябрь 2026");
    ledger = {
      ...ledger,
      snapshot: {
        status: "ready",
        busy: false,
        error: null,
        document: createDocument({
          state: createEmptyState({
            accounts: [{ ...account, balanceMinor: 30000 }],
            snapshots: [saved(true)],
          }),
        }),
      },
    };
    view.rerender(<OverviewPage />);
    expect(metric).toHaveTextContent("176,55");
    expect(history).toHaveTextContent("123,45");
  });

  it("shows real goods-only stock without inventing account history", () => {
    ledger = {
      ...ledger,
      snapshot: {
        status: "ready",
        busy: false,
        error: null,
        document: createDocument({
          state: createEmptyState({
            inventory: [
              {
                id: "goods",
                sku: "FREE",
                name: "Подарок",
                quantity: 2,
                stockValueMinor: 0,
              },
            ],
          }),
        }),
      },
    };
    render(<OverviewPage />);
    expect(
      screen.getByText("Позиций: 1 · Единиц: 2 · Без остатка: 0"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Закупочная стоимость остатков равна нулю."),
    ).toBeInTheDocument();
    expect(screen.getByText("Счетов пока нет")).toBeInTheDocument();
    expect(screen.queryByText("Значения графика")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Начните с текущих остатков"),
    ).not.toBeInTheDocument();
  });
});
