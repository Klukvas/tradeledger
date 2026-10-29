import { formatMoney, parseMoney } from "../../domain/money";
import type {
  Command,
  CommandMeta,
  Debt,
  DebtDirection,
} from "../../domain/types";

export type DebtAction = "create" | "update" | "repay";
export type DebtDraft = Readonly<{
  action: DebtAction;
  id: string;
  meta: CommandMeta;
  revision: number;
  direction: DebtDirection;
  counterparty: string;
  principal: string;
  note: string;
  amount: string;
  original: Debt | undefined;
}>;
export type DebtErrors = Partial<
  Record<"counterparty" | "principal" | "note" | "amount", string>
>;
type DraftResult =
  { ok: true; command: Command } | { ok: false; errors: DebtErrors };

export const directionLabels: Record<DebtDirection, string> = {
  payable: "Я должен",
  receivable: "Мне должны",
};
export const actionTitles: Record<DebtAction, string> = {
  create: "Добавить долг",
  update: "Изменить долг",
  repay: "Погасить долг",
};
export const repaymentNotice =
  "Погашение долга не меняет остатки счетов — обновите их отдельно";

export function outstanding(debt: Debt): number {
  return debt.principalMinor - debt.repaidMinor;
}

/** Editable decimal text must retain every kopeck, including near the safe integer limit. */
export function minorToInput(minor: number): string {
  const exact = BigInt(minor);
  return `${exact / 100n},${(exact % 100n).toString().padStart(2, "0")}`;
}

export function validateDebtDraft(draft: DebtDraft): DraftResult {
  const base = { id: draft.id, meta: draft.meta };
  if (draft.action === "repay") {
    const amount = parseMoney(draft.amount);
    if (!amount.ok)
      return { ok: false, errors: { amount: amount.error.message } };
    if (amount.value <= 0)
      return {
        ok: false,
        errors: { amount: "Введите сумму погашения больше нуля." },
      };
    if (!draft.original || amount.value > outstanding(draft.original))
      return {
        ok: false,
        errors: {
          amount: `Погашение не может превышать остаток: ${formatMoney(draft.original ? outstanding(draft.original) : 0)}.`,
        },
      };
    return {
      ok: true,
      command: { ...base, type: "debt.repay", amountMinor: amount.value },
    };
  }
  const errors: DebtErrors = {};
  const principal = parseMoney(draft.principal);
  if (!draft.counterparty.trim() || draft.counterparty.trim().length > 120)
    errors.counterparty = "Укажите контрагента: от 1 до 120 символов.";
  if (draft.note.trim().length > 1000)
    errors.note = "Примечание должно быть не длиннее 1000 символов.";
  if (!principal.ok) errors.principal = principal.error.message;
  else if (principal.value <= 0)
    errors.principal = "Сумма долга должна быть больше нуля.";
  else if (draft.original && principal.value < draft.original.repaidMinor)
    errors.principal = `Сумма долга не может быть меньше уже погашенной: ${formatMoney(draft.original.repaidMinor)}.`;
  if (Object.keys(errors).length || !principal.ok) return { ok: false, errors };
  const details = {
    ...base,
    counterparty: draft.counterparty.trim(),
    principalMinor: principal.value,
    note: draft.note.trim(),
  };
  return {
    ok: true,
    command:
      draft.action === "create"
        ? { ...details, type: "debt.create", direction: draft.direction }
        : { ...details, type: "debt.update" },
  };
}
