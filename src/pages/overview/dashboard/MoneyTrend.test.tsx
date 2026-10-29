import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Snapshot } from "../../../domain/types";
import { MoneyTrend } from "./MoneyTrend";

afterEach(cleanup);

it("labels zero-inclusive bounds as scale and captions saved dates in append order", () => {
  const snapshots: readonly Snapshot[] = [
    {
      id: "first",
      label: "Добавлен первым",
      createdAt: "2026-10-28T10:00:00Z",
      accounts: [],
      totalMinor: 10000,
    },
    {
      id: "last",
      label: "Добавлен последним",
      createdAt: "2026-10-20T10:00:00Z",
      accounts: [],
      totalMinor: 20000,
    },
  ];
  render(<MoneyTrend snapshots={snapshots} currentMinor={30000} hasAccounts />);
  expect(screen.getByText("Низ шкалы: ≈ 0 UAH")).toBeInTheDocument();
  expect(screen.getByText("Верх шкалы: ≈ 300 UAH")).toBeInTheDocument();
  expect(screen.queryByText(/^Мин\./)).not.toBeInTheDocument();
  expect(screen.queryByText(/^Макс\./)).not.toBeInTheDocument();
  expect(screen.getByText(/^Первая показанная фиксация:/)).toHaveTextContent(
    "28 окт. 2026",
  );
  expect(screen.getByText(/^Последняя показанная фиксация:/)).toHaveTextContent(
    "20 окт. 2026",
  );
  const table = screen.getByRole("region", {
    name: "Значения графика балансов",
    hidden: true,
  });
  expect(within(table).getByText("Добавлен первым")).toBeInTheDocument();
  expect(within(table).getByText("Добавлен последним")).toBeInTheDocument();
});
