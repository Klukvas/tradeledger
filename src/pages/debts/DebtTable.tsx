import type { ReactElement } from "react";
import { formatMoney } from "../../domain/money";
import type { Debt } from "../../domain/types";
import { Badge, Button } from "../../ui";
import { outstanding } from "./draft";

type Props = {
  debts: readonly Debt[];
  busy: boolean;
  onEdit: (debt: Debt) => void;
  onRepay: (debt: Debt) => void;
};

export function DebtTable({
  debts,
  busy,
  onEdit,
  onRepay,
}: Props): ReactElement {
  return (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label="Таблица долгов: прокрутите для просмотра всех столбцов"
    >
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Контрагент / примечание</th>
            <th scope="col" className="text-right">
              Сумма долга
            </th>
            <th scope="col" className="text-right">
              Погашено
            </th>
            <th scope="col" className="text-right">
              Осталось
            </th>
            <th scope="col">Статус</th>
            <th scope="col">Действия</th>
          </tr>
        </thead>
        <tbody>
          {debts.map((debt) => {
            const remaining = outstanding(debt);
            return (
              <tr key={debt.id}>
                <td>
                  <strong>{debt.counterparty}</strong>
                  {debt.note && (
                    <div className="text-muted text-small">{debt.note}</div>
                  )}
                </td>
                <td className="money">{formatMoney(debt.principalMinor)}</td>
                <td className="money">{formatMoney(debt.repaidMinor)}</td>
                <td className="money">{formatMoney(remaining)}</td>
                <td>
                  <Badge tone={remaining === 0 ? "positive" : "default"}>
                    {remaining === 0 ? "Закрыт" : "Активен"}
                  </Badge>
                </td>
                <td>
                  <div className="row-actions">
                    <Button
                      variant="secondary"
                      disabled={busy || remaining === 0}
                      aria-label={`Погасить: ${debt.counterparty}`}
                      onClick={() => onRepay(debt)}
                    >
                      Погасить
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Изменить: ${debt.counterparty}`}
                      onClick={() => onEdit(debt)}
                    >
                      Изменить
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
