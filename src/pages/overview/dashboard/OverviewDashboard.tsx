import type { ReactElement } from "react";
import type { LedgerState } from "../../../domain/types";
import { AccountBalances, InventoryValues } from "./BalancePanels";
import { MoneyTrend } from "./MoneyTrend";
import "./dashboard.css";

export function OverviewDashboard({
  state,
  currentMinor,
}: {
  state: LedgerState;
  currentMinor: number;
}): ReactElement {
  return (
    <div className="overview-dashboard stack">
      <MoneyTrend
        snapshots={state.snapshots}
        currentMinor={currentMinor}
        hasAccounts={state.accounts.length > 0}
      />
      <div className="dashboard-comparisons">
        <AccountBalances accounts={state.accounts} />
        <InventoryValues inventory={state.inventory} />
      </div>
    </div>
  );
}
