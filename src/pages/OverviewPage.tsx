import type { ReactElement } from "react";
import { useLedger } from "../data";
import { DashboardMoney } from "./overview/dashboard/DashboardMoney";
import { OverviewDashboard } from "./overview/dashboard/OverviewDashboard";
import {
  getAccountsTotal,
  getStockTotal,
  getDebtTotals,
} from "../domain/selectors";
import { EmptyState, PageHeader, StatCard } from "../ui";
import { SnapshotHistory } from "./overview/SnapshotHistory";
import { MonthlyMoneyStat } from "./shared/MonthlyMoneyStat";

export function OverviewPage(): ReactElement {
  const { snapshot } = useLedger();
  if (snapshot.status !== "ready")
    return (
      <section className="page">
        <PageHeader
          title="Обзор"
          description="Остатки и обязательства на сегодня"
        />
      </section>
    );
  const state = snapshot.document.state;
  const debts = getDebtTotals(state);
  const hasAccounts = state.accounts.length > 0;
  const isEmpty =
    !hasAccounts && state.inventory.length === 0 && state.debts.length === 0;
  return (
    <section className="page">
      <PageHeader
        title="Обзор"
        description="Остатки и обязательства на сегодня"
      />
      <div className="stats-grid overview-stats">
        <StatCard
          label="Деньги на счетах"
          value={<DashboardMoney minor={getAccountsTotal(state)} />}
          hint={`${state.accounts.length} счетов · UAH`}
        />
        <StatCard
          label="Стоимость склада"
          value={<DashboardMoney minor={getStockTotal(state)} />}
          hint="По закупочной стоимости"
        />
        <StatCard
          label="К оплате"
          value={<DashboardMoney minor={debts.payable} />}
          hint="Остаток наших обязательств"
        />
        <StatCard
          label="К получению"
          value={<DashboardMoney minor={debts.receivable} />}
          hint="Остаток долгов перед нами"
        />
        <MonthlyMoneyStat
          state={state}
          renderMoney={(minor) => <DashboardMoney minor={minor} />}
        />
      </div>
      <p className="text-muted text-small">
        Изменение денег за месяц — текущая сумма всех счетов минус сумма на
        конец прошлого календарного месяца. Балансы закрываются автоматически
        первого числа в 00:00 по Киеву. Пропущенные закрытия восстанавливаются
        при запуске сервера, если есть история счетов. Закупки и обязательства
        учитываются отдельно; эта разница не является прибылью.
      </p>
      {isEmpty && (
        <section className="panel">
          <EmptyState
            title="Начните с текущих остатков"
            description="Перенесите счета, товары и долги из вашей таблицы. Первое месячное сравнение появится после автоматического закрытия месяца."
            action={
              <div className="inline-actions">
                <a className="button button-primary" href="#accounts">
                  Добавить счёт
                </a>
                <a className="button button-secondary" href="#inventory">
                  Добавить товар
                </a>
                <a className="button button-secondary" href="#debts">
                  Добавить долг
                </a>
              </div>
            }
          />
        </section>
      )}
      <OverviewDashboard state={state} currentMinor={getAccountsTotal(state)} />
      <section className="panel stack" aria-labelledby="overview-accounts">
        <div className="panel-header">
          <h2 id="overview-accounts">Текущие счета</h2>
          <a href="#accounts">Все счета</a>
        </div>
        {hasAccounts ? (
          <>
            <div
              className="table-wrap desktop-table"
              tabIndex={0}
              role="region"
              aria-label="Балансы счетов"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Счёт</th>
                    <th scope="col">Владелец ФОП</th>
                    <th scope="col">Провайдер</th>
                    <th scope="col" className="money">
                      Баланс
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.name}</td>
                      <td>{account.owner}</td>
                      <td>
                        {account.provider === "other"
                          ? "Другой"
                          : account.provider}
                      </td>
                      <td className="money">
                        <DashboardMoney minor={account.balanceMinor} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="record-cards overview-account-cards"
              role="list"
              aria-label="Балансы счетов"
            >
              {state.accounts.map((account) => (
                <article
                  className="record-card"
                  role="listitem"
                  key={account.id}
                >
                  <h3>{account.name}</h3>
                  <p className="money">
                    <DashboardMoney minor={account.balanceMinor} />
                  </p>
                  <dl className="record-details">
                    <dt>Владелец ФОП</dt>
                    <dd>{account.owner}</dd>
                    <dt>Провайдер</dt>
                    <dd>
                      {account.provider === "other"
                        ? "Другой"
                        : account.provider}
                    </dd>
                  </dl>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted">
            Добавьте хотя бы один <a href="#accounts">счёт</a>, чтобы видеть
            остатки и месячное изменение.
          </p>
        )}
      </section>
      <SnapshotHistory snapshots={state.snapshots} />
    </section>
  );
}
