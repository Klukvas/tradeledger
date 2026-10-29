import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Account,
  DocumentV1,
  LedgerContextValue,
  Result,
} from "../../domain/types";
import { createDocument, createEmptyState } from "../../test/fixtures";
import { AccountsPage } from "../AccountsPage";

vi.mock("../../data", async (original) => ({
  ...(await original<typeof import("../../data")>()),
  useLedger: () => ledger,
}));
const account: Account = {
  id: "account",
  name: "Основной",
  owner: "ФОП Анна",
  provider: "MONO",
  balanceMinor: 12345,
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

function ready(
  revision = 4,
  accounts: readonly Account[] = [account],
): LedgerContextValue["snapshot"] {
  return {
    status: "ready",
    document: createDocument({
      revision,
      state: createEmptyState({ accounts }),
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

describe("AccountsPage", () => {
  it("shows an actionable empty state and exact searchable balances", async () => {
    const user = userEvent.setup();
    ledger = { ...ledger, snapshot: ready(4, []) };
    const { rerender } = render(<AccountsPage />);
    expect(
      screen.getByRole("button", { name: "Добавить первый счёт" }),
    ).toBeInTheDocument();
    ledger = { ...ledger, snapshot: ready() };
    rerender(<AccountsPage />);
    const row = screen.getByRole("row", { name: /Основной/ });
    expect(within(row).getByText(/123,45/)).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "анна");
    expect(row).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "не найдено");
    expect(screen.getByText("Счета не найдены")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Очистить поиск" }));
    expect(screen.getByRole("row", { name: /Основной/ })).toBeInTheDocument();
  });

  it("validates required trimmed metadata and creates a negative current balance", async () => {
    const user = userEvent.setup();
    render(<AccountsPage />);
    await user.click(screen.getByRole("button", { name: "Добавить счёт" }));
    expect(
      screen.getByLabelText("Текущий баланс, UAH"),
    ).toHaveAccessibleDescription(
      "Введите начальный фактический остаток нового счёта.",
    );
    await user.type(screen.getByLabelText("Название счёта"), "   ");
    await user.type(screen.getByLabelText("Текущий баланс, UAH"), "1e3");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Название счёта")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Владелец (ФОП)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Текущий баланс, UAH")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.clear(screen.getByLabelText("Название счёта"));
    await user.type(screen.getByLabelText("Название счёта"), "  Новый  ");
    await user.type(screen.getByLabelText("Владелец (ФОП)"), "  ФОП Иван  ");
    await user.selectOptions(screen.getByLabelText("Провайдер"), "other");
    await user.clear(screen.getByLabelText("Текущий баланс, UAH"));
    await user.type(screen.getByLabelText("Текущий баланс, UAH"), "-12,50");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "account.create",
        name: "Новый",
        owner: "ФОП Иван",
        provider: "other",
        balanceMinor: -1250,
      }),
      4,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Счёт добавлен.");
  });

  it("edits metadata independently without sending a balance change", async () => {
    const user = userEvent.setup();
    render(<AccountsPage />);
    await user.click(
      screen.getByRole("button", {
        name: "Изменить данные: Основной, ФОП Анна",
      }),
    );
    expect(
      screen.queryByLabelText("Текущий баланс, UAH"),
    ).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Провайдер"), "NovaPay");
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    const command = dispatch.mock.calls[0]?.[0];
    expect(command).toEqual(
      expect.objectContaining({
        type: "account.update",
        id: "account",
        provider: "NovaPay",
      }),
    );
    expect(command).not.toHaveProperty("balanceMinor");
  });

  it("replaces balance, guards duplicate submits and preserves the draft and key after failure", async () => {
    const user = userEvent.setup();
    let finish: ((result: Result<DocumentV1>) => void) | undefined;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AccountsPage />);
    await user.click(
      screen.getByRole("button", {
        name: "Обновить баланс: Основной, ФОП Анна",
      }),
    );
    expect(
      screen.getByText(
        "Введите фактический остаток на счёте. Это заменит баланс, а не добавит сумму.",
      ),
    ).toBeInTheDocument();
    const balance = screen.getByLabelText("Текущий баланс, UAH");
    expect(balance).toHaveValue("123,45");
    await user.clear(balance);
    await user.type(balance, "-0,01");
    const save = screen.getByRole("button", { name: "Сохранить" });
    const form = save.closest("form");
    if (!form) throw new Error("Account form missing");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    if (!finish) throw new Error("Pending dispatch missing");
    finish({
      ok: false,
      error: { code: "STORAGE", message: "Ошибка хранения" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ошибка хранения",
    );
    expect(balance).toHaveValue("-0,01");
    await user.click(save);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ type: "account.setBalance", balanceMinor: -1 }),
    );
    expect(dispatch.mock.calls[1]?.[0]).toEqual(dispatch.mock.calls[0]?.[0]);
  });

  it("captures opening revision and requires refresh plus explicit balance review before retry", async () => {
    const user = userEvent.setup();
    dispatch.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "Данные изменились" },
    });
    const { rerender } = render(<AccountsPage />);
    await user.click(
      screen.getByRole("button", {
        name: "Обновить баланс: Основной, ФОП Анна",
      }),
    );
    await user.clear(screen.getByLabelText("Текущий баланс, UAH"));
    await user.type(screen.getByLabelText("Текущий баланс, UAH"), "100");
    ledger = {
      ...ledger,
      snapshot: ready(5, [{ ...account, balanceMinor: 20000 }]),
    };
    rerender(<AccountsPage />);
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(dispatch.mock.calls[0]?.[1]).toBe(4);
    expect(
      screen.queryByRole("button", { name: "Сверился, повторить сохранение" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeDisabled();
    expect(screen.getByText(/При открытии:/)).toHaveTextContent(/123,45/);
    expect(screen.getByText(/Сейчас:/)).toHaveTextContent(/200,00/);
    await user.click(
      screen.getByRole("button", { name: "Сверился, повторить сохранение" }),
    );
    expect(dispatch.mock.calls[1]?.[1]).toBe(5);
    expect(dispatch.mock.calls[1]?.[0].meta).toEqual(
      dispatch.mock.calls[0]?.[0].meta,
    );
    expect(dispatch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ balanceMinor: 10000 }),
    );
  });

  it("keeps conflict retry blocked when refresh resolves with a storage error", async () => {
    const user = userEvent.setup();
    dispatch.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "Данные изменились" },
    });
    refresh.mockImplementationOnce(async () => {
      const snapshot = ready();
      if (snapshot.status === "ready")
        ledger = {
          ...ledger,
          snapshot: {
            ...snapshot,
            error: { code: "STORAGE", message: "Ошибка чтения" },
          },
        };
    });
    render(<AccountsPage />);
    await user.click(
      screen.getByRole("button", {
        name: "Обновить баланс: Основной, ФОП Анна",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Сохранить" }));
    await user.click(screen.getByRole("button", { name: "Обновить данные" }));
    expect(
      screen.getByText(
        "Не удалось получить актуальные данные. Повторите обновление.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Сверился, повторить сохранение" }),
    ).not.toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Текущий баланс, UAH")).toHaveValue("123,45");
  });
});
