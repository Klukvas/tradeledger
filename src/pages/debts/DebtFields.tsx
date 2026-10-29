import type { ReactElement } from "react";
import type { Debt, DebtDirection } from "../../domain/types";
import { formatMoney } from "../../domain/money";
import { Button, Field, MoneyInput } from "../../ui";
import {
  directionLabels,
  minorToInput,
  outstanding,
  type DebtDraft,
  type DebtErrors,
} from "./draft";

export function DebtAmounts({
  debt,
  heading,
}: {
  debt: Debt;
  heading: string;
}): ReactElement {
  return (
    <div className="notice">
      <strong>
        {heading}: {debt.counterparty}
      </strong>
      <dl className="record-details">
        <dt>Сумма долга</dt>
        <dd className="money">{formatMoney(debt.principalMinor)}</dd>
        <dt>Погашено</dt>
        <dd className="money">{formatMoney(debt.repaidMinor)}</dd>
        <dt>Осталось</dt>
        <dd className="money">{formatMoney(outstanding(debt))}</dd>
      </dl>
    </div>
  );
}

type Props = {
  draft: DebtDraft;
  errors: DebtErrors;
  disabled: boolean;
  onChange: (
    field: "counterparty" | "principal" | "note" | "amount" | "direction",
    value: string,
  ) => void;
};

export function DebtFields({
  draft,
  errors,
  disabled,
  onChange,
}: Props): ReactElement {
  if (draft.action === "repay")
    return (
      <div className="stack">
        <Field
          label="Сумма погашения, UAH"
          {...(errors.amount ? { error: errors.amount } : {})}
        >
          <MoneyInput
            name="repayment"
            value={draft.amount}
            required
            autoComplete="off"
            disabled={disabled}
            onChange={(event) => onChange("amount", event.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={
            disabled || !draft.original || outstanding(draft.original) === 0
          }
          onClick={() => {
            if (draft.original)
              onChange("amount", minorToInput(outstanding(draft.original)));
          }}
        >
          Всю оставшуюся сумму
        </Button>
      </div>
    );
  return (
    <div className="form-grid">
      {draft.action === "create" ? (
        <Field label="Направление долга">
          <select
            name="debt-direction"
            value={draft.direction}
            disabled={disabled}
            onChange={(event) =>
              onChange("direction", event.target.value as DebtDirection)
            }
          >
            <option value="payable">Я должен</option>
            <option value="receivable">Мне должны</option>
          </select>
        </Field>
      ) : (
        <p className="notice">
          Направление: {directionLabels[draft.direction]}
        </p>
      )}
      <Field
        label="Контрагент"
        {...(errors.counterparty ? { error: errors.counterparty } : {})}
      >
        <input
          name="counterparty"
          value={draft.counterparty}
          required
          autoComplete="off"
          maxLength={120}
          disabled={disabled}
          onChange={(event) => onChange("counterparty", event.target.value)}
        />
      </Field>
      <Field
        label="Сумма долга, UAH"
        {...(errors.principal ? { error: errors.principal } : {})}
      >
        <MoneyInput
          name="principal"
          value={draft.principal}
          required
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onChange("principal", event.target.value)}
        />
      </Field>
      <div className="form-full">
        <Field
          label="Примечание (необязательно)"
          {...(errors.note ? { error: errors.note } : {})}
        >
          <textarea
            name="debt-note"
            value={draft.note}
            maxLength={1000}
            disabled={disabled}
            onChange={(event) => onChange("note", event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}
