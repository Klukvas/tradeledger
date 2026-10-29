import { checkedMoney } from "./money";
import {
  kyivMonth,
  monthKey,
  shiftMonth,
  type CalendarMonth,
} from "./month-calendar";
import type { LedgerState, Result, Snapshot } from "./types";

export type { CalendarMonth } from "./month-calendar";
export type MonthlyMoney = Readonly<{
  currentMonth: CalendarMonth;
  previousMonth: CalendarMonth;
  baseline: Snapshot | null;
  change: Result<number> | null;
}>;

/** Manual history never substitutes for an explicit completed calendar month. */
export function getMonthlyMoneyChange(
  state: LedgerState,
  asOf: Date,
): MonthlyMoney {
  const currentMonth = kyivMonth(asOf);
  const previousMonth = shiftMonth(currentMonth, -1);
  const baseline =
    state.snapshots.find(
      (snapshot) =>
        snapshot.closedMonth === monthKey(previousMonth) &&
        Date.parse(snapshot.createdAt) <= asOf.getTime(),
    ) ?? null;
  const current = state.accounts.reduce(
    (total, account) => total + BigInt(account.balanceMinor),
    0n,
  );
  return {
    currentMonth,
    previousMonth,
    baseline,
    change: baseline
      ? checkedMoney(current - BigInt(baseline.totalMinor))
      : null,
  };
}
