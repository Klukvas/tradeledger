import type { ReactElement } from "react";
import type { Account, InventoryItem } from "../../../domain/types";
import { EmptyState } from "../../../ui";
import { accountBalances, inventoryValues } from "./deriveDashboard";
import { DashboardMoney } from "./DashboardMoney";

export function AccountBalances({
  accounts,
}: {
  accounts: readonly Account[];
}): ReactElement {
  const { rows, remainingCount } = accountBalances(accounts);
  return (
    <section
      className="panel stack dashboard-balances"
      aria-labelledby="account-balances-title"
    >
      <div className="panel-header">
        <div>
          <h2 id="account-balances-title">Балансы счетов</h2>
          <p className="text-muted text-small">
            Текущие остатки относительно нуля
          </p>
        </div>
        <a href="#accounts">Все счета</a>
      </div>
      {accounts.length === 0 ? (
        <EmptyState
          title="Счетов пока нет"
          description="Добавьте текущие остатки в разделе счетов."
          action={<a href="#accounts">Перейти к счетам</a>}
        />
      ) : (
        <>
          <div
            className="dashboard-balance-axis text-small text-muted"
            aria-hidden="true"
          >
            <span>−</span>
            <span>0</span>
            <span>+</span>
          </div>
          <ul className="dashboard-rank-list">
            {rows.map((account) => (
              <li className="dashboard-rank-row" key={account.id}>
                <div className="dashboard-row-heading">
                  <div>
                    <strong>{account.name}</strong>
                    <span className="text-small text-muted">
                      {account.owner} ·{" "}
                      {account.provider === "other"
                        ? "Другой"
                        : account.provider}
                    </span>
                  </div>
                  <span
                    className={`money ${account.balanceMinor < 0 ? "text-negative" : ""}`}
                  >
                    <DashboardMoney minor={account.balanceMinor} />
                  </span>
                </div>
                <div className="dashboard-balance-track" aria-hidden="true">
                  <span
                    className={`dashboard-balance-fill ${account.balanceMinor < 0 ? "is-negative" : "is-positive"}`}
                    style={{
                      width: `${account.width}%`,
                      left:
                        account.balanceMinor < 0
                          ? `${50 - account.width}%`
                          : "50%",
                    }}
                  />
                  <span className="dashboard-center-axis" />
                  {account.balanceMinor === 0 && (
                    <span className="dashboard-zero-marker" />
                  )}
                </div>
              </li>
            ))}
          </ul>
          {remainingCount > 0 && (
            <a className="text-small" href="#overview-accounts">
              Ещё {remainingCount} счетов — в списке ниже
            </a>
          )}
        </>
      )}
    </section>
  );
}

export function InventoryValues({
  inventory,
}: {
  inventory: readonly InventoryItem[];
}): ReactElement {
  const { rows, quantity, withoutStock, isZeroValue } =
    inventoryValues(inventory);
  return (
    <section
      className="panel stack dashboard-inventory"
      aria-labelledby="inventory-values-title"
    >
      <div className="panel-header">
        <div>
          <h2 id="inventory-values-title">Стоимость товаров</h2>
          <p className="text-muted text-small">
            Текущий остаток по закупочной стоимости
          </p>
        </div>
        <a href="#inventory">Весь склад</a>
      </div>
      {inventory.length === 0 ? (
        <EmptyState
          title="Товаров пока нет"
          description="Добавьте товары, количество и закупочную цену."
          action={<a href="#inventory">Перейти к складу</a>}
        />
      ) : (
        <>
          <p className="text-small text-muted numeric">
            Позиций: {inventory.length} · Единиц: {quantity} · Без остатка:{" "}
            {withoutStock}
          </p>
          {isZeroValue && (
            <p className="text-small text-muted">
              Закупочная стоимость остатков равна нулю.
            </p>
          )}
          <ul className="dashboard-rank-list">
            {rows.map((item) => (
              <li
                className={`dashboard-rank-row ${item.isRemainder ? "dashboard-remainder" : ""}`}
                key={
                  item.isRemainder ? "aggregate:remainder" : `item:${item.id}`
                }
              >
                <div className="dashboard-row-heading">
                  <div>
                    <strong>{item.name}</strong>
                    <span className="text-small text-muted">
                      {item.detail}
                      {item.quantity === 0n && " · Нет в наличии"}
                    </span>
                  </div>
                  <span className="money">
                    <DashboardMoney minor={item.valueMinor} />
                  </span>
                </div>
                <div className="dashboard-stock-track" aria-hidden="true">
                  <span
                    className="dashboard-stock-fill"
                    style={{ width: `${item.width}%` }}
                  />
                  {item.valueMinor === 0 && (
                    <span className="dashboard-stock-zero" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
