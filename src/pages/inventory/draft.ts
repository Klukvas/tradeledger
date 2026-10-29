import { parseMoney, formatMoney } from "../../domain/money";
import type { Command, CommandMeta, InventoryItem } from "../../domain/types";

export type InventoryAction = "create" | "update" | "receive" | "issue";
export type InventoryDraft = Readonly<{
  action: InventoryAction;
  id: string;
  meta: CommandMeta;
  revision: number;
  sku: string;
  name: string;
  quantity: string;
  cost: string;
  reason: string;
}>;
export type DraftErrors = Partial<
  Record<"sku" | "name" | "quantity" | "cost" | "reason", string>
>;
export type DraftResult =
  { ok: true; command: Command } | { ok: false; errors: DraftErrors };

export const actionTitles: Record<InventoryAction, string> = {
  create: "Добавить товар",
  update: "Изменить товар",
  receive: "Приход товара",
  issue: "Списать товар",
};

function quantityValue(input: string, minimum: number): number | null {
  const text = input.trim();
  const value = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(value) && value >= minimum
    ? value
    : null;
}

export function validateDraft(
  draft: InventoryDraft,
  current?: InventoryItem,
): DraftResult {
  const errors: DraftErrors = {};
  const isDetails = draft.action === "create" || draft.action === "update";
  if (isDetails && (!draft.sku.trim() || draft.sku.trim().length > 80))
    errors.sku = "Введите артикул: от 1 до 80 символов.";
  if (isDetails && (!draft.name.trim() || draft.name.trim().length > 120))
    errors.name = "Введите название: от 1 до 120 символов.";
  const quantity = quantityValue(
    draft.quantity,
    draft.action === "create" ? 0 : 1,
  );
  if (draft.action !== "update" && quantity === null)
    errors.quantity =
      draft.action === "create"
        ? "Введите целое неотрицательное количество в допустимом диапазоне."
        : "Введите целое количество больше нуля в допустимом диапазоне.";
  if (
    draft.action === "issue" &&
    quantity !== null &&
    current &&
    quantity > current.quantity
  )
    errors.quantity = `На складе только ${current.quantity} шт.`;
  const cost = parseMoney(draft.cost);
  if ((draft.action === "create" || draft.action === "receive") && !cost.ok)
    errors.cost = cost.error.message;
  if (
    draft.action === "issue" &&
    (!draft.reason.trim() || draft.reason.trim().length > 300)
  )
    errors.reason = "Укажите причину списания: от 1 до 300 символов.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const base = { id: draft.id, meta: draft.meta };
  if (draft.action === "update")
    return {
      ok: true,
      command: {
        ...base,
        type: "inventory.update",
        sku: draft.sku.trim(),
        name: draft.name.trim(),
      },
    };
  if (quantity === null)
    return { ok: false, errors: { quantity: "Проверьте количество." } };
  if (draft.action === "issue")
    return {
      ok: true,
      command: {
        ...base,
        type: "inventory.issue",
        quantity,
        reason: draft.reason.trim(),
      },
    };
  if (!cost.ok) return { ok: false, errors: { cost: cost.error.message } };
  return {
    ok: true,
    command:
      draft.action === "create"
        ? {
            ...base,
            type: "inventory.create",
            sku: draft.sku.trim(),
            name: draft.name.trim(),
            quantity,
            unitCostMinor: cost.value,
          }
        : {
            ...base,
            type: "inventory.receive",
            quantity,
            unitCostMinor: cost.value,
          },
  };
}

export function averageCost(item: InventoryItem): string {
  if (item.quantity === 0) return "—";
  const quantity = BigInt(item.quantity);
  const roundedMinor =
    (2n * BigInt(item.stockValueMinor) + quantity) / (2n * quantity);
  return formatMoney(Number(roundedMinor));
}
