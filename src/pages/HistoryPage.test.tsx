import { act, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth, useLedger, type AuthContextValue } from "../data";
import type { AuditEvent, LedgerContextValue } from "../domain/types";
import { createDocument, createEmptyState } from "../test/fixtures";
import { App } from "../App";
import { HistoryPage, type HistoryFilters } from "./HistoryPage";

vi.mock("../data", () => ({ useLedger: vi.fn(), useAuth: vi.fn() }));
vi.mock("../auth/LegacySource", () => ({
  LegacyProvider: ({ children }: { children: React.ReactNode }) => children,
  LegacyNotice: () => null,
}));
function ControlledHistory(): React.ReactElement {
  const [filters, setFilters] = useState<HistoryFilters>({
    search: "",
    type: "",
  });
  return <HistoryPage filters={filters} onFiltersChange={setFilters} />;
}

const entries: readonly AuditEvent[] = [
  {
    id: "older",
    at: "2026-10-28T12:00:00+03:00",
    type: "inventory.create",
    entityId: "stock",
    summary: "Добавлен товар «Кабель»: 3 шт.",
  },
  {
    id: "newer",
    at: "2026-10-28T10:00:00Z",
    type: "account.setBalance",
    entityId: "account",
    summary: "Баланс «MONO» изменён на 100,00 ₴.",
  },
];

function showHistory(
  audit: readonly AuditEvent[],
  app = false,
): ReturnType<typeof render> {
  vi.mocked(useLedger).mockReturnValue({
    snapshot: {
      status: "ready",
      document: createDocument({ state: createEmptyState({ audit }) }),
      busy: false,
      error: null,
    },
    refresh: vi.fn(),
    dispatch: vi.fn(),
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
  } satisfies LedgerContextValue);
  return render(app ? <App /> : <ControlledHistory />);
}

let auth: AuthContextValue;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "#history");
  auth = {
    snapshot: {
      status: "authenticated",
      user: { id: "owner-a", email: "a@example.test" },
    },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  vi.mocked(useAuth).mockImplementation(() => auth);
});

function visit(route: string): void {
  act(() => {
    window.history.pushState(null, "", `#${route}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

describe("history", () => {
  it("retains both filters when history remounts and clears them on reset and account change", async () => {
    const user = userEvent.setup();
    const view = showHistory(entries, true);
    await user.type(screen.getByRole("searchbox"), "Кабель");
    await user.selectOptions(screen.getByRole("combobox"), "inventory.create");
    visit("overview");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    visit("history");
    expect(screen.getByRole("searchbox")).toHaveValue("Кабель");
    expect(screen.getByRole("combobox")).toHaveValue("inventory.create");
    expect(screen.getByRole("status")).toHaveTextContent("Показано 1 из 2");
    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    visit("overview");
    visit("history");
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("");
    await user.type(screen.getByRole("searchbox"), "private-a");
    await user.selectOptions(
      screen.getByRole("combobox"),
      "account.setBalance",
    );
    auth = {
      ...auth,
      snapshot: {
        status: "authenticated",
        user: { id: "owner-b", email: "b@example.test" },
      },
    };
    view.rerender(<App />);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Показано 2 из 2");
  });

  it("orders events by their actual timestamp and displays Kyiv time without changing stored dates", () => {
    showHistory(entries);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Баланс «MONO»");
    expect(rows[2]).toHaveTextContent("Добавлен товар «Кабель»");
    const date = rows[1]?.querySelector("time");
    expect(date).toHaveAttribute("datetime", "2026-10-28T10:00:00Z");
    expect(date).toHaveTextContent("12:00");
    expect(entries.map((event) => event.id)).toEqual(["older", "newer"]);
    expect(screen.queryByText("account.setBalance")).not.toBeInTheDocument();
  });

  it("combines search and operation type then offers recovery from zero results", async () => {
    const user = userEvent.setup();
    showHistory(entries);
    await user.type(
      screen.getByRole("searchbox", { name: "Поиск по истории" }),
      "  кабель ",
    );
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Тип операции" }),
      "account.setBalance",
    );
    expect(
      screen.getByRole("heading", { name: "Ничего не найдено" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Показать все операции" }),
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      3,
    );
  });

  it("gives an empty ledger an action and does not expose deletion controls", () => {
    showHistory([]);
    expect(
      screen.getByRole("heading", { name: "Операций пока нет" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Перейти на склад" }),
    ).toHaveAttribute("href", "#inventory");
    expect(
      screen.queryByRole("button", { name: /удалить/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the most recently recorded operation first when timestamps match", () => {
    showHistory(
      entries.map((event) => ({ ...event, at: "2026-10-28T10:00:00Z" })),
    );
    expect(
      within(screen.getByRole("table")).getAllByRole("row")[1],
    ).toHaveTextContent("Баланс «MONO»");
  });

  it("renders audit text as text rather than markup", () => {
    showHistory([
      {
        ...entries[0],
        id: "escaped",
        at: "2026-10-28T10:00:00Z",
        type: "debt.create",
        entityId: "debt",
        summary: "<img src=x onerror=alert(1)>",
      },
    ]);
    expect(screen.getAllByText("<img src=x onerror=alert(1)>")).toHaveLength(2);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
