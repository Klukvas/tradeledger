import type { ReactElement } from "react";
import { Field, MoneyInput } from "../../ui";
import type { DraftErrors, InventoryDraft } from "./draft";

type Props = {
  draft: InventoryDraft;
  errors: DraftErrors;
  disabled: boolean;
  onChange: (
    field: "sku" | "name" | "quantity" | "cost" | "reason",
    value: string,
  ) => void;
};

export function InventoryFields({
  draft,
  errors,
  disabled,
  onChange,
}: Props): ReactElement {
  const isDetails = draft.action === "create" || draft.action === "update";
  return (
    <div className="form-grid">
      {isDetails && (
        <>
          <Field
            label="Артикул (SKU)"
            {...(errors.sku ? { error: errors.sku } : {})}
          >
            <input
              name="sku"
              autoComplete="off"
              required
              maxLength={80}
              value={draft.sku}
              disabled={disabled}
              onChange={(event) => onChange("sku", event.target.value)}
            />
          </Field>
          <Field
            label="Название товара"
            {...(errors.name ? { error: errors.name } : {})}
          >
            <input
              name="name"
              autoComplete="off"
              required
              maxLength={120}
              value={draft.name}
              disabled={disabled}
              onChange={(event) => onChange("name", event.target.value)}
            />
          </Field>
        </>
      )}
      {draft.action !== "update" && (
        <Field
          label={
            draft.action === "create"
              ? "Начальное количество, шт."
              : "Количество, шт."
          }
          hint={
            draft.action === "create"
              ? "Целое число от 0."
              : "Целое число больше 0."
          }
          {...(errors.quantity ? { error: errors.quantity } : {})}
        >
          <input
            name="quantity"
            autoComplete="off"
            inputMode="numeric"
            required
            value={draft.quantity}
            disabled={disabled}
            onChange={(event) => onChange("quantity", event.target.value)}
          />
        </Field>
      )}
      {(draft.action === "create" || draft.action === "receive") && (
        <Field
          label="Закупочная цена за единицу, UAH"
          hint="Допускается 0. До двух знаков после запятой."
          {...(errors.cost ? { error: errors.cost } : {})}
        >
          <MoneyInput
            name="cost"
            autoComplete="off"
            required
            value={draft.cost}
            disabled={disabled}
            onChange={(event) => onChange("cost", event.target.value)}
          />
        </Field>
      )}
      {draft.action === "issue" && (
        <div className="form-full">
          <Field
            label="Причина списания"
            hint="Например: продажа, повреждение или личное использование."
            {...(errors.reason ? { error: errors.reason } : {})}
          >
            <textarea
              name="reason"
              autoComplete="off"
              required
              maxLength={300}
              rows={3}
              value={draft.reason}
              disabled={disabled}
              onChange={(event) => onChange("reason", event.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
