import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerContextValue } from "../../domain/types";
import { createDocument, createEmptyState } from "../../test/fixtures";
import { SettingsPage } from "../SettingsPage";

vi.mock("../../data", () => ({
  useLedger: () => ledger,
  exportServerBackup: () => serverExport(),
}));
const serverExport =
  vi.fn<() => Promise<import("../../domain/types").Result<string>>>();
let ledger: LedgerContextValue;
const restore = vi.fn<LedgerContextValue["importBackup"]>();
const refresh = vi.fn<LedgerContextValue["refresh"]>();
const original = createDocument({
  revision: 7,
  state: createEmptyState({
    accounts: [
      {
        id: "old",
        name: "Старый",
        owner: "Иван",
        provider: "MONO",
        balanceMinor: 10000,
      },
    ],
  }),
});
const imported = createDocument({
  state: createEmptyState({
    inventory: [
      {
        id: "new",
        sku: "A",
        name: "Товар",
        quantity: 1,
        stockValueMinor: 2300,
      },
    ],
  }),
});
const json = JSON.stringify(imported);
function file(content = json): File {
  const value = new File([content], "copy.json", { type: "application/json" });
  Object.defineProperty(value, "text", {
    configurable: true,
    value: async () => content,
  });
  return value;
}
beforeEach(() => {
  serverExport
    .mockReset()
    .mockResolvedValue({ ok: true, value: JSON.stringify(original) });
  restore.mockReset().mockResolvedValue({ ok: true, value: imported });
  refresh.mockReset().mockResolvedValue(undefined);
  ledger = {
    snapshot: { status: "ready", document: original, busy: false, error: null },
    dispatch: vi.fn(),
    refresh,
    importBackup: restore,
    exportBackup: () => ({ ok: true, value: JSON.stringify(original) }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("settings backup", () => {
  it("keeps the backup heading consistent while loading and ready", () => {
    const readySnapshot = ledger.snapshot;
    ledger = { ...ledger, snapshot: { status: "loading" } };
    const view = render(<SettingsPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Резервная копия",
    );
    ledger = { ...ledger, snapshot: readySnapshot };
    view.rerender(<SettingsPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Резервная копия",
    );
  });
  it("rejects invalid and oversized backups before writes and preserves original data", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const input = screen.getByLabelText("Файл резервной копии");
    await user.upload(input, file("{wrong"));
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON");
    expect(restore).not.toHaveBeenCalled();
    const large = file();
    const read = vi.fn();
    Object.defineProperty(large, "size", { value: 5 * 1024 * 1024 + 1 });
    Object.defineProperty(large, "text", { configurable: true, value: read });
    await user.upload(input, large);
    expect(screen.getByRole("alert")).toHaveTextContent("5 МБ");
    expect(read).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(
      ledger.snapshot.status === "ready" && ledger.snapshot.document,
    ).toEqual(original);
  });
  it("requires preview and explicit confirmation before replacing once", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const input = screen.getByLabelText("Файл резервной копии");
    expect(
      screen.queryByRole("button", {
        name: "Заменить данные резервной копией",
      }),
    ).not.toBeInTheDocument();
    await user.upload(input, file());
    await screen.findByText("Предпросмотр: copy.json");
    expect(screen.getByText(/В копии:/)).toHaveTextContent(
      "Товаров: 1; счетов: 0",
    );
    const replace = screen.getByRole("button", {
      name: "Заменить данные резервной копией",
    });
    expect(replace).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    fireEvent.click(replace);
    fireEvent.click(replace);
    await screen.findByText("Данные заменены резервной копией.");
    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(json, 7);
    expect(input).toHaveValue("");
  });
  it("preserves selected file on revision conflict and requires a new reviewed preview", async () => {
    const user = userEvent.setup();
    restore.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "Данные изменились" },
    });
    const view = render(<SettingsPage />);
    await user.upload(screen.getByLabelText("Файл резервной копии"), file());
    await screen.findByText("Предпросмотр: copy.json");
    ledger = {
      ...ledger,
      snapshot: {
        status: "ready",
        document: { ...original, revision: 8 },
        busy: false,
        error: null,
      },
    };
    view.rerender(<SettingsPage />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Заменить данные резервной копией" }),
    );
    expect(restore.mock.calls[0]?.[1]).toBe(7);
    expect(screen.getByText("Предпросмотр: copy.json")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Обновить предпросмотр" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Состав проверен, подтвердить предпросмотр",
      }),
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Заменить данные резервной копией" }),
    );
    expect(restore.mock.calls[1]).toEqual([json, 8]);
  });
  it("downloads the real document JSON with a filename and revokes the object URL", async () => {
    const user = userEvent.setup();
    const objectUrl = vi.fn<(blob: Blob) => string>(() => "blob:backup");
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = objectUrl;
        static revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(/^tradeledger-\d{4}-\d{2}-\d{2}\.json$/);
        expect(this.href).toBe("blob:backup");
      });
    render(<SettingsPage />);
    await user.click(
      screen.getByRole("button", { name: "Скачать резервную копию" }),
    );
    expect(click).toHaveBeenCalledOnce();
    const blob = objectUrl.mock.calls[0]?.[0] as Blob | undefined;
    if (!blob) throw new Error("Missing backup blob");
    const result = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(JSON.parse(result)).toEqual(original);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:backup"));
    vi.unstubAllGlobals();
  });
  it("waits for a fresh server export, guards duplicate clicks and reports network errors", async () => {
    let finish:
      | ((result: import("../../domain/types").Result<string>) => void)
      | undefined;
    serverExport.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<SettingsPage />);
    const download = screen.getByRole("button", {
      name: "Скачать резервную копию",
    });
    fireEvent.click(download);
    fireEvent.click(download);
    expect(serverExport).toHaveBeenCalledOnce();
    expect(download).toBeDisabled();
    await act(async () =>
      finish?.({
        ok: false,
        error: { code: "STORAGE", message: "Сервер недоступен" },
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Сервер недоступен");
    expect(download).toBeEnabled();
  });
});
