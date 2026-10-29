import type { ReactElement } from "react";
import type { Snapshot } from "../../../domain/types";
import { moneyPoints, trendGeometry } from "./deriveDashboard";
import { DashboardMoney } from "./DashboardMoney";

const fullDate = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Kyiv",
});
const compact = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const bound = (minor: number): string => `≈ ${compact.format(minor / 100)} UAH`;

export function MoneyTrend({
  snapshots,
  currentMinor,
  hasAccounts,
}: {
  snapshots: readonly Snapshot[];
  currentMinor: number;
  hasAccounts: boolean;
}): ReactElement {
  const geometry = trendGeometry(moneyPoints(snapshots, currentMinor));
  const historical = geometry.points.filter((point) => !point.isCurrent);
  const current = geometry.points.at(-1);
  const last = historical.at(-1);
  const first = historical[0];
  return (
    <section
      className="panel stack dashboard-trend"
      aria-labelledby="money-trend-title"
    >
      <div className="panel-header">
        <div>
          <h2 id="money-trend-title">Динамика балансов</h2>
          <p className="text-muted text-small">
            Сумма счетов: зафиксированные балансы и текущий остаток
          </p>
        </div>
        <span className="dashboard-current numeric">
          <span className="text-muted text-small">Сейчас</span>
          <strong>
            <DashboardMoney minor={currentMinor} />
          </strong>
        </span>
      </div>
      {!hasAccounts ? (
        <p className="text-muted">
          Добавьте <a href="#accounts">счёт</a>, чтобы видеть динамику балансов.
        </p>
      ) : snapshots.length === 0 ? (
        <p className="text-muted">
          После первого автоматического закрытия месяца здесь появится динамика
          балансов.
        </p>
      ) : (
        <>
          <div className="dashboard-chart" aria-hidden="true">
            <div className="dashboard-chart-bounds numeric">
              <span>Верх шкалы: {bound(geometry.maximum)}</span>
              <span>Низ шкалы: {bound(geometry.minimum)}</span>
            </div>
            <div className="dashboard-plot">
              <svg
                viewBox="0 0 640 220"
                preserveAspectRatio="none"
                className="dashboard-trend-svg"
              >
                <line
                  x1="24"
                  x2="616"
                  y1={geometry.zeroY}
                  y2={geometry.zeroY}
                  className="dashboard-zero-line"
                />
                <text
                  x="24"
                  y={
                    geometry.zeroY > 165
                      ? geometry.zeroY - 8
                      : geometry.zeroY + 16
                  }
                  className="dashboard-zero-label"
                >
                  0
                </text>
                <polyline
                  points={historical
                    .map((point) => `${point.x},${point.y}`)
                    .join(" ")}
                  className="dashboard-history-line"
                />
                {last && current && (
                  <line
                    x1={last.x}
                    y1={last.y}
                    x2={current.x}
                    y2={current.y}
                    className="dashboard-current-line"
                  />
                )}
              </svg>
              {geometry.points.map((point) => (
                <span
                  key={point.isCurrent ? "current" : `snapshot:${point.id}`}
                  className={
                    point.isCurrent
                      ? "dashboard-current-point"
                      : "dashboard-history-point"
                  }
                  style={{
                    left: `${(point.x / 640) * 100}%`,
                    top: `${(point.y / 220) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
          <p className="dashboard-snapshot-dates text-small text-muted">
            <span>
              Первая показанная фиксация:{" "}
              {first?.createdAt
                ? fullDate.format(new Date(first.createdAt))
                : ""}
              .
            </span>
            <span>
              Последняя показанная фиксация:{" "}
              {last?.createdAt ? fullDate.format(new Date(last.createdAt)) : ""}
              .
            </span>
          </p>
          <div className="dashboard-chart-note text-small text-muted">
            <span>
              Время — Киев. Расстояние между точками не отражает прошедшее
              время.
            </span>
            <span className="dashboard-legend">
              <i /> Фиксации балансов <i className="dashboard-legend-current" />{" "}
              Сейчас
            </span>
          </div>
          {snapshots.length > 12 && (
            <p className="text-muted text-small">
              Показаны последние 12 из {snapshots.length} фиксаций балансов и
              текущая сумма.
            </p>
          )}
          <details className="dashboard-values">
            <summary>Значения графика</summary>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Значения графика балансов"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Дата · Киев</th>
                    <th scope="col">Фиксация</th>
                    <th scope="col" className="money">
                      Сумма счетов
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {geometry.points.map((point) => (
                    <tr
                      key={`${point.isCurrent ? "current" : "snapshot"}-${point.id}`}
                    >
                      <td>
                        {point.createdAt ? (
                          <time dateTime={point.createdAt}>
                            {fullDate.format(new Date(point.createdAt))}
                          </time>
                        ) : (
                          "Текущий остаток"
                        )}
                      </td>
                      <td>{point.label}</td>
                      <td className="money">
                        <DashboardMoney minor={point.totalMinor} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
