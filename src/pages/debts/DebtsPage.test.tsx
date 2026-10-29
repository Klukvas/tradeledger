import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyCommand } from "../../domain/commands";
import { formatMoney } from "../../domain/money";
import type {
  Debt,
  DocumentV1,
  LedgerContextValue,
  Result,
} from "../../domain/types";
import { createDocument, createEmptyState } from "../../test/fixtures";
import { DebtsPage } from "../DebtsPage";
import { minorToInput } from "./draft";

vi.mock("../../data", async (original) => ({
  ...(await original<typeof import("../../data")>()),
  useLedger: () => ledger,
}));

const debt: Debt = {
  id: "loan",
  direction: "payable",
  counterparty: "Анна",
  principalMinor: 10001,
  repaidMinor: 2000,
  note: "На ремонт",
};
const account = {
  id: "account",
  name: "MONO",
  owner: "ФОП",
  provider: "MONO" as const,
  balanceMinor: 50000,
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

function moneyText(minor: number): string {
  return formatMoney(minor).replace(/\s/g, " ");
}

function ready(
  debts: readonly Debt[] = [debt],
  revision = 4,
): LedgerContextValue["snapshot"] {
  return {
    status: "ready",
    document: createDocument({
      revision,
      state: createEmptyState({ debts, accounts: [account] }),
    }),
    busy: false,
    error: null,
  };
}

beforeEach(() => {
  dispatch.mockReset().mockImplementation(async (command, expectedRevision) => {
    if (ledger.snapshot.status !== "ready") throw new Error("Store not ready");
    const document = ledger.snapshot.document;
    if (document.revision !== expectedRevision)
      return {
        ok: false,
        error: { code: "CONFLICT", message: "Данные изменились" },
      };
    const result = applyCommand(document.state, command);
    if (!result.ok) return result;
    const value = {
      ...document,
      revision: document.revision + 1,
      state: result.value,
    };
    ledger = {
      ...ledger,
      snapshot: { status: "ready", document: value, busy: false, error: null },
    };
    return { ok: true, value };
  });
  refresh.mockReset().mockImplementation(async () => {
    if (ledger.snapshot.status === "ready")
      ledger = { ...ledger, snapshot: { ...ledger.snapshot, error: null } };
  });
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
  cleanup();
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

describe("DebtsPage", () => {
  it.each(["create", "update"] as const)(
    "%s accepts 120 counterparty characters through the domain and rejects 121 in the form",
    async (action) => {
      const user = userEvent.setup();
      render(<DebtsPage />);
      await user.click(
        screen.getByRole("button", {
          name: action === "create" ? "Добавить долг" : "Изменить: Анна",
        }),
      );
      const counterparty = screen.getByLabelText("Контрагент");
      expect(counterparty).toHaveAttribute("maxlength", "120");
      fireEvent.change(counterparty, { target: { value: "А".repeat(121) } });
      if (action === "create")
        await user.type(screen.getByLabelText("Сумма долга, UAH"), "100");
      await user.click(screen.getByRole("button", { name: "Сохранить" }));
      expect(counterparty).toHaveAttribute("aria-invalid", "true");
      expect(
        screen.getByText("Укажите контрагента: от 1 до 120 символов."),
      ).toBeInTheDocument();
      expect(dispatch).not.toHaveBeenCalled();
      fireEvent.change(counterparty, { target: { value: "А".repeat(120) } });
      await user.click(screen.getByRole("button", { name: "Сохранить" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("row", { name: /А{120}/ })).toBeInTheDocument();
      expect(dispatch).toHaveBeenCalledOnce();
      if (ledger.snapshot.status !== "ready")
        throw new Error("Store not ready");
      expect(
        ledger.snapshot.document.state.debts.some(
          (entry) => entry.counterparty === "А".repeat(120),
        ),
      ).toBe(true);
    },
  );

  it.each(["payable", "receivable"] as const)(
    "creates a %s loan using exact kopecks",
    async (direction) => {
      const user = userEvent.setup();
      ledger = { ...ledger, snapshot: ready([]) };
      render(<DebtsPage />);
      if (direction === "receivable")
        await user.click(screen.getByRole("button", { name: "Мне должны" }));
      await user.click(screen.getByRole("button", { name: "Добавить долг" }));
      expect(screen.getByLabelText("Направление долга")).toHaveValue(direction);
      await user.type(screen.getByLabelText("Контрагент"), "  Борис  ");
      await user.type(screen.getByLabelText("Сумма долга, UAH"), "123,45");
      await user.click(screen.getByRole("button", { name: "Сохранить" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const row = screen.getByRole("row", { name: /Борис/ });
      expect(within(row).getAllByText(moneyText(12345))).toHaveLength(2);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "debt.create",
          direction,
          principalMinor: 12345,
          counterparty: "Борис",
          note: "",
        }),
        4,
      );
    },
  );

  it("filters by note, direction and closed state while keeping direction totals", async () => {
    const user = userEvent.setup();
    ledger = {
      ...ledger,
      snapshot: ready([
        debt,
        {
          ...debt,
          id: "other",
          direction: "receivable",
          counterparty: "Борис",
          principalMinor: 50000,
          repaidMinor: 0,
        },
        {
          ...debt,
          id: "closed",
          counterparty: "Вера",
          repaidMinor: debt.principalMinor,
        },
      ]),
    };
    render(<DebtsPage />);
    expect(screen.getAllByText(moneyText(8001))).toHaveLength(2);
    expect(screen.getByText(moneyText(50000))).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "РЕМОНТ");
    expect(screen.getByRole("row", { name: /Анна/ })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "ничего");
    expect(screen.getByText("Долги не найдены")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Очистить поиск" }));
    await user.click(screen.getByRole("button", { name: "Закрытые" }));
    expect(
      screen.getByRole("button", { name: "Погасить: Вера" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Изменить: Вера" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Изменить: Вера" }));
    expect(
      screen.queryByLabelText("Направление долга"),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Контрагент"));
    await user.type(screen.getByLabelText("Контрагент"), "Вера Петрова");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(
      screen.getByRole("row", { name: /Вера Петрова/ }),
    ).toBeInTheDocument();
  });

  it("partially repays then fills and submits the exact remaining sum without changing accounts", async () => {
    const user = userEvent.setup();
    render(<DebtsPage />);
    await user.click(screen.getByRole("button", { name: "Погасить: Анна" }));
    await user.type(screen.getByLabelText("Сумма погашения, UAH"), "30,01");
    await user.click(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    );
    const row = screen.getByRole("row", { name: /Анна/ });
    expect(within(row).getByText(moneyText(5000))).toBeInTheDocument();
    expect(within(row).getByText(moneyText(5001))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Погасить: Анна" }));
    await user.click(
      screen.getByRole("button", { name: "Всю оставшуюся сумму" }),
    );
    expect(screen.getByLabelText("Сумма погашения, UAH")).toHaveValue("50,00");
    expect(dispatch).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    );
    expect(screen.getByText("Активных долгов пока нет")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Закрытые" }));
    expect(
      screen.getByRole("button", { name: "Погасить: Анна" }),
    ).toBeDisabled();
    if (ledger.snapshot.status !== "ready") throw new Error("Store not ready");
    expect(ledger.snapshot.document.state.accounts).toEqual([account]);
    expect(ledger.snapshot.document.state.audit).toHaveLength(2);
  });

  it("rejects overpayment, zero and malformed amounts and a principal below already repaid", async () => {
    const user = userEvent.setup();
    render(<DebtsPage />);
    await user.click(screen.getByRole("button", { name: "Погасить: Анна" }));
    for (const invalid of ["80,02", "0", "1e2", "-1"]) {
      await user.clear(screen.getByLabelText("Сумма погашения, UAH"));
      await user.type(screen.getByLabelText("Сумма погашения, UAH"), invalid);
      await user.click(
        screen.getByRole("button", { name: "Сохранить погашение" }),
      );
      expect(screen.getByLabelText("Сумма погашения, UAH")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    }
    expect(dispatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Отмена" }));
    await user.click(screen.getByRole("button", { name: "Изменить: Анна" }));
    await user.clear(screen.getByLabelText("Сумма долга, UAH"));
    await user.type(screen.getByLabelText("Сумма долга, UAH"), "19,99");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(
      screen.getByText(/не может быть меньше уже погашенной/),
    ).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("preserves a failed repayment draft and key, guards synchronous duplicate submissions and close", async () => {
    const user = userEvent.setup();
    let finish: ((result: Result<DocumentV1>) => void) | undefined;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<DebtsPage />);
    await user.click(screen.getByRole("button", { name: "Погасить: Анна" }));
    await user.type(screen.getByLabelText("Сумма погашения, UAH"), "12,34");
    const save = screen.getByRole("button", { name: "Сохранить погашение" });
    const form = save.closest("form");
    if (!form) throw new Error("Form missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Закрыть диалог" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(save).toBeDisabled();
    if (!finish) throw new Error("Pending save missing");
    finish({
      ok: false,
      error: { code: "STORAGE", message: "Ошибка хранения" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ошибка хранения",
    );
    expect(screen.getByLabelText("Сумма погашения, UAH")).toHaveValue("12,34");
    await user.click(save);
    expect(dispatch.mock.calls[1]).toEqual(dispatch.mock.calls[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("captures the opening revision and requires refresh plus explicit review before retrying against new amounts", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DebtsPage />);
    await user.click(screen.getByRole("button", { name: "Погасить: Анна" }));
    await user.click(
      screen.getByRole("button", { name: "Всю оставшуюся сумму" }),
    );
    ledger = {
      ...ledger,
      snapshot: ready([{ ...debt, repaidMinor: 8000 }], 5),
    };
    rerender(<DebtsPage />);
    await user.click(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    );
    expect(dispatch.mock.calls[0]?.[1]).toBe(4);
    expect(screen.getByText("Текущие данные: Анна")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByText(moneyText(2001)),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Сумма погашения, UAH")).toHaveValue("80,01");
    expect(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: "Данные проверены, разрешить повтор",
      }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    expect(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name: "Данные проверены, разрешить повтор",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Погашение не может превышать остаток/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Всю оставшуюся сумму" }),
    );
    expect(screen.getByLabelText("Сумма погашения, UAH")).toHaveValue("20,01");
    await user.click(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    );
    expect(dispatch.mock.calls[1]?.[1]).toBe(5);
    expect(dispatch.mock.calls[1]?.[0].meta).toEqual(
      dispatch.mock.calls[0]?.[0].meta,
    );
  });

  it("does not enable conflict acceptance when refreshing reports a storage failure", async () => {
    const user = userEvent.setup();
    dispatch.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "Данные изменились" },
    });
    refresh.mockImplementationOnce(async () => {
      if (ledger.snapshot.status === "ready")
        ledger = {
          ...ledger,
          snapshot: {
            ...ledger.snapshot,
            error: { code: "STORAGE", message: "Ошибка чтения" },
          },
        };
    });
    render(<DebtsPage />);
    await user.click(screen.getByRole("button", { name: "Погасить: Анна" }));
    await user.click(
      screen.getByRole("button", { name: "Всю оставшуюся сумму" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    );
    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    expect(
      screen.getByRole("button", {
        name: "Данные проверены, разрешить повтор",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Сохранить погашение" }),
    ).toBeDisabled();
  });

  it("round-trips the largest supported loan amount into an editable decimal", () => {
    expect(minorToInput(Number.MAX_SAFE_INTEGER)).toBe("90071992547409,91");
  });
});
