import type { ReactElement } from "react";
import { checkedMoney, formatMoney } from "../../domain/money";
import type { Snapshot } from "../../domain/types";
import { EmptyState } from "../../ui";
import { snapshotPeriod } from "../shared/snapshotPeriod";

const timestamp = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});
function previousChange(current: number, previous: number): string {
  const result = checkedMoney(BigInt(current) - BigInt(previous));
  return result.ok
    ? formatMoney(result.value)
    : "Разница вне допустимого диапазона";
}
export function SnapshotHistory({
  snapshots,
}: {
  snapshots: readonly Snapshot[];
}): ReactElement {
  const entries = snapshots
    .map((snapshot, index) => ({ snapshot, previous: snapshots[index - 1] }))
    .reverse();
  return (
    <section className="panel stack" aria-labelledby="snapshot-history">
      <div className="panel-header">
        <h2 id="snapshot-history">История балансов</h2>
        <span className="text-muted text-small">Время — Киев</span>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="Балансы ещё не зафиксированы"
          description="Первое закрытие появится автоматически первого числа в 00:00 по Киеву."
        />
      ) : (
        <div
          className="table-wrap"
          role="region"
          tabIndex={0}
          aria-label="Таблица истории балансов"
        >
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Дата и название</th>
                <th scope="col" className="money">
                  Сумма счетов
                </th>
                <th scope="col" className="money">
                  К предыдущей фиксации
                </th>
                <th scope="col">Состав фиксации</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ snapshot, previous }) => (
                <tr key={snapshot.id}>
                  <td>
                    <strong>{snapshot.label}</strong>
                    <br />
                    {snapshot.closedMonth && (
                      <>
                        <span className="text-small">
                          Закрыт месяц: {snapshotPeriod(snapshot.closedMonth)}
                        </span>
                        <br />
                      </>
                    )}
                    <time
                      className="text-small text-muted numeric"
                      dateTime={snapshot.createdAt}
                    >
                      {timestamp.format(new Date(snapshot.createdAt))}
                    </time>
                  </td>
                  <td className="money">{formatMoney(snapshot.totalMinor)}</td>
                  <td className="money">
                    {previous
                      ? previousChange(snapshot.totalMinor, previous.totalMinor)
                      : "Первая фиксация"}
                  </td>
                  <td>
                    <details>
                      <summary className="button button-secondary">
                        Счета: {snapshot.accounts.length}
                      </summary>
                      <ul>
                        {snapshot.accounts.map((account) => (
                          <li key={account.accountId}>
                            {account.name} · {account.owner} ·{" "}
                            {account.provider === "other"
                              ? "Другой"
                              : account.provider}
                            :{" "}
                            <span className="money">
                              {formatMoney(account.balanceMinor)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
