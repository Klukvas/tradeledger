import type { ReactElement, ReactNode } from "react";
import { formatMoney } from "../../domain/money";
import type { LedgerState } from "../../domain/types";
import { StatCard } from "../../ui";
import { useMonthlyMoney } from "./useMonthlyMoney";

export function MonthlyMoneyStat({
  state,
  renderMoney = formatMoney,
}: {
  state: LedgerState;
  renderMoney?: (minor: number) => ReactNode;
}): ReactElement {
  const monthly = useMonthlyMoney(state);
  const change = monthly.change?.ok ? monthly.change.value : null;
  return (
    <StatCard
      label="Изменение денег за месяц"
      value={
        monthly.change === null
          ? "Нет данных за прошлый месяц"
          : !monthly.change.ok
            ? "Сумма вне диапазона"
            : renderMoney(monthly.change.value)
      }
      hint={`${monthly.hint}${monthly.change && !monthly.change.ok ? " Разница превышает допустимый диапазон." : ""}`}
      tone={
        change === null || change === 0
          ? "default"
          : change > 0
            ? "positive"
            : "negative"
      }
    />
  );
}
