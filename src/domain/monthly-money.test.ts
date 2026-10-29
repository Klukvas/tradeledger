import { describe, expect, it } from "vitest";
import { createEmptyState } from "../test/fixtures";
import type { Snapshot } from "./types";
import { closingBoundary } from "./month-calendar";
import { getMonthlyMoneyChange } from "./monthly-money";
import { parseState } from "./validate-state";

function saved(
  closedMonth: string,
  totalMinor: number,
  id = closedMonth,
): Snapshot {
  const boundary = closingBoundary(closedMonth);
  if (!boundary) throw new Error("Invalid test month");
  return {
    id,
    createdAt: boundary.toISOString(),
    closedMonth,
    label: id,
    totalMinor,
    accounts: [
      {
        accountId: "bank",
        name: "Банк",
        owner: "ФОП",
        provider: "MONO",
        balanceMinor: totalMinor,
      },
    ],
  };
}
const now = new Date("2026-10-29T10:00:00Z");
const account = {
  id: "bank",
  name: "Банк",
  owner: "ФОП",
  provider: "MONO" as const,
  balanceMinor: 15001,
};

describe("official monthly money change", () => {
  it("uses only the previous closed calendar month, preserving every signed kopeck", () => {
    const official = saved("2026-09", 10000);
    const source = saved("2026-09", 1, "manual");
    const manual = { id: source.id, createdAt: source.createdAt, label: source.label, accounts: source.accounts, totalMinor: source.totalMinor };
    const state = createEmptyState({
      accounts: [account, { ...account, id: "negative", balanceMinor: -2000 }],
      snapshots: [
        saved("2026-10", 20000),
        manual,
        official,
        saved("2026-08", 0),
      ],
    });
    const result = getMonthlyMoneyChange(state, now);
    expect(result.baseline).toBe(official);
    expect(result.change).toEqual({ ok: true, value: 3001 });
    expect(result.currentMonth).toEqual({ year: 2026, month: 10 });
  });
  it("keeps zero distinct from a missing official baseline and ignores future evidence", () => {
    const official = saved("2026-09", 15001);
    expect(
      getMonthlyMoneyChange(
        createEmptyState({ accounts: [account], snapshots: [official] }),
        now,
      ).change,
    ).toEqual({ ok: true, value: 0 });
    const manual = { id: official.id, createdAt: official.createdAt, label: official.label, accounts: official.accounts, totalMinor: official.totalMinor };
    expect(
      getMonthlyMoneyChange(
        createEmptyState({ accounts: [account], snapshots: [manual] }),
        now,
      ).change,
    ).toBeNull();
    expect(
      getMonthlyMoneyChange(
        createEmptyState({
          accounts: [account],
          snapshots: [saved("2026-10", 0)],
        }),
        now,
      ).baseline,
    ).toBeNull();
  });
  it.each([1, -1])(
    "allows safe stored balances with an explicitly unavailable derived delta (%s)",
    (sign) => {
      const state = createEmptyState({
        accounts: [
          { ...account, balanceMinor: sign * Number.MAX_SAFE_INTEGER },
        ],
        snapshots: [saved("2026-09", -sign)],
      });
      expect(parseState(state)).toEqual(state);
      expect(getMonthlyMoneyChange(state, now).change?.ok).toBe(false);
    },
  );
  it("validates optional backup markers without reading the wall clock", () => {
    const official = saved("2026-09", 1);
    const state = createEmptyState({
      accounts: [account],
      snapshots: [official],
    });
    expect(parseState(state)).toEqual(state);
    for (const snapshot of [
      { ...official, closedMonth: "2026-13" },
      { ...official, createdAt: "2026-09-30T20:59:59Z" },
    ]) {
      expect(() => parseState({ ...state, snapshots: [snapshot] })).toThrow();
    }
    expect(() =>
      parseState({
        ...state,
        snapshots: [official, { ...official, id: "duplicate" }],
      }),
    ).toThrow();
  });
});
