import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentV1,
  InventoryItem,
  LedgerContextValue,
  Result,
} from "../../domain/types";
import { createDocument, createEmptyState } from "../../test/fixtures";
import { InventoryPage } from "../InventoryPage";
import { applyCommand } from "../../domain/commands";

vi.mock("../../data", async (original) => ({
  ...(await original<typeof import("../../data")>()),
  useLedger: () => ledger,
}));

const item: InventoryItem = {
  id: "product",
  sku: "SKU-1",
  name: "Товар",
  quantity: 3,
  stockValueMinor: 1000,
};
let ledger: LedgerContextValue;
const dispatch = vi.fn<LedgerContextValue["dispatch"]>();
const refresh = vi.fn<LedgerContextValue["refresh"]>();
const modalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

function ready(revision = 4): LedgerContextValue["snapshot"] {
  return {
    status: "ready",
    document: createDocument({
      revision,
      state: createEmptyState({ inventory: [item] }),
    }),
    busy: false,
    error: null,
  };
}

beforeEach(() => {
  dispatch
    .mockReset()
    .mockResolvedValue({ ok: true, value: createDocument({ revision: 5 }) });
  refresh.mockReset().mockResolvedValue(undefined);
  ledger = {
    snapshot: ready(),
    dispatch,
    refresh,
    exportBackup: () => ({ ok: true, value: "" }),
    importBackup: async () => ({ ok: true, value: createDocument() }),
  };
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  if (modalDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      modalDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("InventoryPage", () => {
  it.each(["create", "update"] as const)(
    "enforces the domain name boundary for %s: 120 accepted, 121 rejected",
    async (action) => {
      const user = userEvent.setup();
      render(<InventoryPage />);
      await user.click(
        screen.getByRole("button", {
          name: action === "create" ? "Добавить товар" : "Изменить: Товар",
        }),
      );
      const name = screen.getByLabelText("Название товара");
      expect(name).toHaveAttribute("maxlength", "120");
      if (action === "create") {
        await user.type(screen.getByLabelText("Артикул (SKU)"), "NEW");
        await user.type(
          screen.getByLabelText("Закупочная цена за единицу, UAH"),
          "0",
        );
      }
      fireEvent.change(name, { target: { value: "А".repeat(121) } });
      await user.click(screen.getByRole("button", { name: "Сохранить" }));
      expect(name).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByText("Введите название: от 1 до 120 символов."),
      ).toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();
      fireEvent.change(name, { target: { value: "А".repeat(120) } });
      await user.click(screen.getByRole("button", { name: "Сохранить" }));
      const command = dispatch.mock.calls[0]?.[0];
      if (
        !command ||
        (command.type !== "inventory.create" &&
          command.type !== "inventory.update")
      )
        throw new Error("Missing inventory details command");
      const state = createEmptyState({ inventory: [item] });
      expect(applyCommand(state, command).ok).toBe(true);
      expect(
        applyCommand(state, { ...command, name: "А".repeat(121) }).ok,
      ).toBe(false);
    },
  );

  it("enforces the domain reason boundary: 300 accepted, 301 rejected", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    await user.click(screen.getByRole("button", { name: "Списать: Товар" }));
    const reason = screen.getByLabelText("Причина списания");
    expect(reason).toHaveAttribute("maxlength", "300");
    await user.type(screen.getByLabelText("Количество, шт."), "1");
    fireEvent.change(reason, { target: { value: "А".repeat(301) } });
    await user.click(screen.getByRole("button", { name: "Списать" }));
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Укажите причину списания: от 1 до 300 символов."),
    ).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: "А".repeat(300) } });
    await user.click(screen.getByRole("button", { name: "Списать" }));
    const command = dispatch.mock.calls[0]?.[0];
    if (!command || command.type !== "inventory.issue")
      throw new Error("Missing issue command");
    const state = createEmptyState({ inventory: [item] });
    expect(applyCommand(state, command).ok).toBe(true);
    expect(
      applyCommand(state, { ...command, reason: "А".repeat(301) }).ok,
    ).toBe(false);
  });

  it("shows exact stored value, approximate average and actionable search results", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    expect(
      screen.getByRole("columnheader", { name: "Средняя закупочная ≈" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /SKU-1/ });
    expect(within(row).getByText(/3,33/)).toBeInTheDocument();
    expect(within(row).getByText(/10,00/)).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "missing");
    expect(screen.getByText("Товары не найдены")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(screen.getByRole("row", { name: /SKU-1/ })).toBeInTheDocument();
  });

  it("validates integer quantity and money before creating an item with zero initial stock", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    await user.click(screen.getByRole("button", { name: "Добавить товар" }));
    await user.type(screen.getByLabelText("Артикул (SKU)"), "NEW");
    await user.type(screen.getByLabelText("Название товара"), "Новый товар");
    const quantity = screen.getByLabelText("Начальное количество, шт.");
    await user.clear(quantity);
    await user.type(quantity, "1e2");
    await user.type(
      screen.getByLabelText("Закупочная цена за единицу, UAH"),
      "-1",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    await user.clear(quantity);
    await user.type(quantity, "0");
    const cost = screen.getByLabelText("Закупочная цена за единицу, UAH");
    await user.clear(cost);
    await user.type(cost, "0");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "inventory.create",
        sku: "NEW",
        quantity: 0,
        unitCostMinor: 0,
      }),
      4,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Товар добавлен.");
  });

  it("keeps a receipt draft and stable command key after save failure; guards duplicate submits", async () => {
    const user = userEvent.setup();
    let finish: ((result: Result<DocumentV1>) => void) | undefined;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<InventoryPage />);
    await user.click(screen.getByRole("button", { name: "Приход: Товар" }));
    await user.type(screen.getByLabelText("Количество, шт."), "2");
    await user.type(
      screen.getByLabelText("Закупочная цена за единицу, UAH"),
      "12,50",
    );
    const save = screen.getByRole("button", { name: "Сохранить" });
    const form = save.closest("form");
    if (!form) throw new Error("Receipt form missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    if (!finish) throw new Error("Pending save missing");
    finish({
      ok: false,
      error: { code: "STORAGE", message: "Ошибка хранения" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ошибка хранения",
    );
    expect(screen.getByLabelText("Количество, шт.")).toHaveValue("2");
    expect(
      screen.getByLabelText("Закупочная цена за единицу, UAH"),
    ).toHaveValue("12,50");
    await user.click(save);
    const first = dispatch.mock.calls[0]?.[0];
    const retry = dispatch.mock.calls[1]?.[0];
    expect(first?.type).toBe("inventory.receive");
    expect(first).toEqual(retry);
    expect(first).toEqual(
      expect.objectContaining({ quantity: 2, unitCostMinor: 1250 }),
    );
  });

  it("requires a reason and refuses to issue beyond stock", async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);
    await user.click(screen.getByRole("button", { name: "Списать: Товар" }));
    expect(screen.getByText(/Текущий остаток:/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Количество, шт."), "4");
    await user.click(screen.getByRole("button", { name: "Списать" }));
    expect(screen.getByText("На складе только 3 шт.")).toBeInTheDocument();
    expect(screen.getByLabelText("Причина списания")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(dispatch).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Количество, шт."));
    await user.type(screen.getByLabelText("Количество, шт."), "3");
    await user.type(screen.getByLabelText("Причина списания"), "Продажа");
    await user.click(screen.getByRole("button", { name: "Списать" }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "inventory.issue",
        quantity: 3,
        reason: "Продажа",
      }),
      4,
    );
  });

  it("captures opening revision and requires explicit review after a conflict", async () => {
    const user = userEvent.setup();
    dispatch.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "Данные изменились" },
    });
    const { rerender } = render(<InventoryPage />);
    await user.click(screen.getByRole("button", { name: "Изменить: Товар" }));
    await user.clear(screen.getByLabelText("Название товара"));
    await user.type(screen.getByLabelText("Название товара"), "Исправленный");
    ledger = { ...ledger, snapshot: ready(5) };
    rerender(<InventoryPage />);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch.mock.calls[0]?.[1]).toBe(4);
    expect(screen.getByLabelText("Название товара")).toHaveValue(
      "Исправленный",
    );
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name: "Данные проверены, разрешить повтор",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch.mock.calls[1]?.[1]).toBe(5);
    expect(dispatch.mock.calls[1]?.[0].meta).toEqual(
      dispatch.mock.calls[0]?.[0].meta,
    );
  });
});
