import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState } from "../../test/fixtures";
import { MonthlyMoneyStat } from "./MonthlyMoneyStat";

const state = createEmptyState({
  accounts: [
    {
      id: "bank",
      name: "Банк",
      owner: "ФОП",
      provider: "MONO",
      balanceMinor: 15000,
    },
  ],
  snapshots: [
    {
      id: "sep",
      createdAt: "2026-09-30T21:00:00.000Z",
      closedMonth: "2026-09",
      label: "Сентябрь",
      totalMinor: 10000,
      accounts: [],
    },
    {
      id: "oct",
      createdAt: "2026-10-31T22:00:00.000Z",
      closedMonth: "2026-10",
      label: "Октябрь",
      totalMinor: 12000,
      accounts: [],
    },
  ],
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("monthly metric", () => {
  it("shows compared months and the source snapshot date in Kyiv", () => {
    const { container } = render(<MonthlyMoneyStat state={state} />);
    expect(screen.getByText(/октябрь 2026.*сентябрь 2026/)).toHaveTextContent(
      /01.10.2026, 00:00 \(Киев\)/,
    );
    expect(container.querySelector(".stat-value")).toHaveTextContent("50,00");
    expect(container.querySelector(".stat-card")).toHaveClass("stat-positive");
  });
  it("keeps zero distinct from missing history and renders negative values", () => {
    const { container, rerender } = render(
      <MonthlyMoneyStat
        state={{
          ...state,
          accounts: [
            {
              ...state.accounts[0],
              id: "bank",
              name: "Банк",
              owner: "ФОП",
              provider: "MONO",
              balanceMinor: 10000,
            },
          ],
        }}
      />,
    );
    expect(container.querySelector(".stat-value")).toHaveTextContent("0,00");
    expect(container.querySelector(".stat-card")).toHaveClass("stat-default");
    rerender(<MonthlyMoneyStat state={{ ...state, accounts: [] }} />);
    expect(container.querySelector(".stat-value")).toHaveTextContent("-100,00");
    expect(container.querySelector(".stat-card")).toHaveClass("stat-negative");
    rerender(
      <MonthlyMoneyStat
        state={{
          ...state,
          snapshots: state.snapshots.filter((entry) => entry.id !== "sep"),
        }}
      />,
    );
    expect(screen.getByText("Нет данных за прошлый месяц")).toBeInTheDocument();
  });
  it("refreshes an open page when the Kyiv month changes, without a ledger update", () => {
    vi.setSystemTime(new Date("2026-10-31T21:59:30Z"));
    const { container } = render(<MonthlyMoneyStat state={state} />);
    expect(container.querySelector(".stat-value")).toHaveTextContent("50,00");
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.querySelector(".stat-value")).toHaveTextContent("30,00");
    expect(screen.getByText(/ноябрь 2026.*октябрь 2026/)).toBeInTheDocument();
  });
  it("refreshes on focus and visibility resume after a suspended timer", () => {
    const { container } = render(<MonthlyMoneyStat state={state} />);
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    fireEvent.focus(window);
    expect(container.querySelector(".stat-value")).toHaveTextContent("30,00");
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("Нет данных за прошлый месяц")).toBeInTheDocument();
  });
  it("shows an explicit unavailable state if the difference overflows", () => {
    const { container } = render(
      <MonthlyMoneyStat
        state={{
          ...state,
          accounts: [
            {
              id: "bank",
              name: "Банк",
              owner: "ФОП",
              provider: "MONO",
              balanceMinor: Number.MAX_SAFE_INTEGER,
            },
          ],
          snapshots: [
            {
              id: "sep",
              label: "Сентябрь",
              createdAt: "2026-09-30T21:00:00.000Z",
              closedMonth: "2026-09",
              accounts: [],
              totalMinor: -1,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Сумма вне диапазона")).toBeInTheDocument();
    expect(
      screen.getByText(/Разница превышает допустимый диапазон/),
    ).toBeInTheDocument();
    expect(container.querySelector(".stat-card")).toHaveClass("stat-default");
  });
});
