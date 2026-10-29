import type { ReactElement } from "react";
import { formatMoney } from "../../domain/money";
import type { Account, AccountProvider } from "../../domain/types";
import { Field, MoneyInput } from "../../ui";
import { providerLabels, type AccountDraft, type DraftErrors } from "./draft";

type Props = {
  draft: AccountDraft;
  errors: DraftErrors;
  disabled: boolean;
  onChange: (
    changes: Partial<
      Pick<AccountDraft, "name" | "owner" | "provider" | "balance">
    >,
  ) => void;
};

export function AccountFields({
  draft,
  errors,
  disabled,
  onChange,
}: Props): ReactElement {
  return (
    <div className="form-grid">
      {draft.action !== "balance" && (
        <>
          <Field
            label="Название счёта"
            {...(errors.name ? { error: errors.name } : {})}
          >
            <input
              name="account-name"
              autoComplete="off"
              required
              maxLength={120}
              value={draft.name}
              disabled={disabled}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>
          <Field
            label="Владелец (ФОП)"
            {...(errors.owner ? { error: errors.owner } : {})}
          >
            <input
              name="account-owner"
              autoComplete="off"
              required
              maxLength={120}
              value={draft.owner}
              disabled={disabled}
              onChange={(event) => onChange({ owner: event.target.value })}
            />
          </Field>
          <Field label="Провайдер">
            <select
              name="account-provider"
              required
              value={draft.provider}
              disabled={disabled}
              onChange={(event) =>
                onChange({ provider: event.target.value as AccountProvider })
              }
            >
              {Object.entries(providerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {draft.action !== "update" && (
        <div className="form-full">
          <Field
            label="Текущий баланс, UAH"
            {...(errors.balance ? { error: errors.balance } : {})}
            hint={
              draft.action === "create"
                ? "Введите начальный фактический остаток нового счёта."
                : "Введите фактический остаток на счёте. Это заменит баланс, а не добавит сумму."
            }
          >
            <MoneyInput
              name="account-balance"
              autoComplete="off"
              required
              value={draft.balance}
              disabled={disabled}
              onChange={(event) => onChange({ balance: event.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export function AccountReview({
  draft,
  current,
}: {
  draft: AccountDraft;
  current: Account | undefined;
}): ReactElement {
  return (
    <div className="notice">
      <p>Сверьте актуальные данные с черновиком перед повторным сохранением.</p>
      {draft.original && (
        <p>
          При открытии: {draft.original.name} · {draft.original.owner} ·{" "}
          {providerLabels[draft.original.provider]}. Баланс:{" "}
          <span className="money">
            {formatMoney(draft.original.balanceMinor)}
          </span>
          .
        </p>
      )}
      {current ? (
        <p>
          Сейчас: {current.name} · {current.owner} ·{" "}
          {providerLabels[current.provider]}. Баланс:{" "}
          <span className="money">{formatMoney(current.balanceMinor)}</span>.
        </p>
      ) : draft.action !== "create" ? (
        <p>
          Счёт больше не найден. Закройте черновик и проверьте список счетов.
        </p>
      ) : (
        <p>Новый счёт будет добавлен к актуальному списку.</p>
      )}
      {draft.action === "balance" && (
        <p>
          Баланс из черновика:{" "}
          <strong>{draft.balance || "не указан"} UAH</strong>. Он заменит
          текущий баланс.
        </p>
      )}
      {draft.action === "update" && (
        <p>
          Данные из черновика: {draft.name} · {draft.owner} ·{" "}
          {providerLabels[draft.provider]}.
        </p>
      )}
    </div>
  );
}
