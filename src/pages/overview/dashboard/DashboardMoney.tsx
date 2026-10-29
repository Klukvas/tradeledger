import { Fragment, type ReactElement } from "react";
import { formatMoney } from "../../../domain/money";

export function DashboardMoney({ minor }: { minor: number }): ReactElement {
  const formatted = formatMoney(minor);
  const currency = formatted.match(/\s(грн\.|₴|UAH)$/u);
  if (!currency || currency.index === undefined) return <>{formatted}</>;
  const groups = formatted.slice(0, currency.index).split(/(?<=\s)/u);
  return (
    <span className="dashboard-money">
      {groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          <span className="dashboard-money-group">
            {group}
            {index === groups.length - 1 ? currency[0] : ""}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
