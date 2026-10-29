import { useEffect, useState } from "react";
import {
  getMonthlyMoneyChange,
  type CalendarMonth,
  type MonthlyMoney,
} from "../../domain/monthly-money";
import type { LedgerState } from "../../domain/types";

const monthFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});
const snapshotFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Kyiv",
  dateStyle: "short",
  timeStyle: "short",
});
function monthLabel(month: CalendarMonth): string {
  return monthFormatter
    .format(new Date(Date.UTC(month.year, month.month - 1, 1)))
    .replace(/ г\.$/, "");
}

export function useMonthlyMoney(
  state: LedgerState,
): MonthlyMoney & Readonly<{ hint: string }> {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = (): void => setNow(new Date());
    const interval = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const monthly = getMonthlyMoneyChange(state, now);
  const period = `${monthLabel(monthly.currentMonth)} − ${monthLabel(monthly.previousMonth)}`;
  const source = monthly.baseline
    ? `Закрыт месяц: ${monthLabel(monthly.previousMonth)}. Граница закрытия: ${snapshotFormatter.format(new Date(monthly.baseline.createdAt))} (Киев).`
    : "Подтверждённого закрытия прошлого месяца пока нет.";
  return { ...monthly, hint: `${period}. ${source}` };
}
