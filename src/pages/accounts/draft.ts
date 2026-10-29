import { parseMoney } from "../../domain/money";
import type {
  Account,
  AccountProvider,
  Command,
  CommandMeta,
} from "../../domain/types";

export type AccountAction = "create" | "update" | "balance";
export type AccountDraft = Readonly<{
  action: AccountAction;
  id: string;
  meta: CommandMeta;
  revision: number;
  name: string;
  owner: string;
  provider: AccountProvider;
  balance: string;
  original: Account | null;
}>;
export type DraftErrors = Partial<Record<"name" | "owner" | "balance", string>>;
type DraftResult =
  { ok: true; command: Command } | { ok: false; errors: DraftErrors };

export const providerLabels: Record<AccountProvider, string> = {
  MONO: "MONO",
  NovaPay: "NovaPay",
  other: "Другой",
};
export const actionTitles: Record<AccountAction, string> = {
  create: "Добавить счёт",
  update: "Изменить данные счёта",
  balance: "Обновить баланс",
};

/** Decimal text without floating-point division or locale grouping. */
export function balanceInput(minor: number): string {
  const exact = BigInt(minor);
  const absolute = exact < 0n ? -exact : exact;
  return `${exact < 0n ? "-" : ""}${absolute / 100n},${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function validateDraft(draft: AccountDraft): DraftResult {
  const errors: DraftErrors = {};
  if (draft.action !== "balance") {
    if (!draft.name.trim() || draft.name.trim().length > 120)
      errors.name = "Введите название счёта: от 1 до 120 символов.";
    if (!draft.owner.trim() || draft.owner.trim().length > 120)
      errors.owner = "Введите ФОП: от 1 до 120 символов.";
  }
  const balance = parseMoney(draft.balance, true);
  if (draft.action !== "update" && !balance.ok)
    errors.balance = balance.error.message;
  if (Object.keys(errors).length) return { ok: false, errors };
  const base = { id: draft.id, meta: draft.meta };
  const details = {
    name: draft.name.trim(),
    owner: draft.owner.trim(),
    provider: draft.provider,
  };
  if (draft.action === "update")
    return {
      ok: true,
      command: { ...base, ...details, type: "account.update" },
    };
  if (!balance.ok)
    return { ok: false, errors: { balance: balance.error.message } };
  return {
    ok: true,
    command:
      draft.action === "create"
        ? {
            ...base,
            ...details,
            type: "account.create",
            balanceMinor: balance.value,
          }
        : { ...base, type: "account.setBalance", balanceMinor: balance.value },
  };
}
