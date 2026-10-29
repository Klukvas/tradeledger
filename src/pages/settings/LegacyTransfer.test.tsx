import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyProvider } from "../../auth/LegacySource";
import type {
  ImportResponse,
  LegacyLedger,
  LegacyTransferStatus,
} from "../../data";
import type { DocumentV1, Result } from "../../domain/types";
import { createDocument, createEmptyState } from "../../test/fixtures";
import { LegacyTransfer } from "./LegacyTransfer";

const read = vi.fn<() => Promise<Result<LegacyLedger>>>();
const status = vi.fn<() => Promise<Result<LegacyTransferStatus>>>();
const transfer =
  vi.fn<
    (
      document: DocumentV1,
      revision: number,
      requestId: string,
    ) => Promise<Result<ImportResponse>>
  >();
vi.mock("../../data", () => ({
  readLegacyLedger: () => read(),
  getLegacyTransferStatus: () => status(),
  transferLegacy: (document: DocumentV1, revision: number, requestId: string) =>
    transfer(document, revision, requestId),
}));
const source = createDocument({
  state: createEmptyState({
    accounts: [
      {
        id: "local",
        name: "Старый счёт",
        owner: "Владелец",
        provider: "MONO",
        balanceMinor: 12,
      },
    ],
  }),
});
const destination = createDocument({
  revision: 7,
  state: createEmptyState({
    inventory: [
      {
        id: "server",
        name: "Товар",
        sku: "S",
        quantity: 1,
        stockValueMinor: 1,
      },
    ],
  }),
});
const complete: ImportResponse = {
  document: { ...source, revision: 9 },
  receipt: {
    requestId: "stable-transfer",
    datasetId: "dataset",
    sourceHash: "a".repeat(64),
    committedRevision: 9,
    counts: {
      inventory: 0,
      accounts: 1,
      debts: 0,
      snapshots: 0,
      snapshotAccounts: 0,
      audit: 0,
    },
  },
  replayed: false,
};
function panel(
  document = destination,
  refresh = vi.fn().mockResolvedValue(undefined),
) {
  return (
    <LegacyProvider>
      <LegacyTransfer
        email="target@example.test"
        document={document}
        serverBusy={false}
        refresh={refresh}
      />
    </LegacyProvider>
  );
}
beforeEach(() => {
  read
    .mockReset()
    .mockResolvedValue({
      ok: true,
      value: {
        status: "ready",
        document: source,
        rawBackup: JSON.stringify(source),
      },
    });
  status
    .mockReset()
    .mockResolvedValue({
      ok: true,
      value: {
        fingerprint: "a".repeat(64),
        requestId: "stable-transfer",
        transferred: false,
      },
    });
  transfer.mockReset().mockResolvedValue({ ok: true, value: complete });
});
describe("legacy transfer", () => {
  it("does not upload automatically and requires preview, target and replacement confirmation", async () => {
    const user = userEvent.setup();
    let finish: ((result: Result<ImportResponse>) => void) | undefined;
    transfer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(panel());
    const preview = await screen.findByRole("button", {
      name: "Проверить перенос в аккаунт",
    });
    await waitFor(() => expect(preview).toBeEnabled());
    expect(transfer).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Скачать исходную копию" }),
    ).toBeInTheDocument();
    await user.click(preview);
    expect(screen.getByText(/Аккаунт назначения:/)).toHaveTextContent(
      "target@example.test",
    );
    expect(screen.getByText(/На сервере:/)).toHaveTextContent(
      "Товаров: 1; счетов: 0",
    );
    expect(screen.getByText(/После переноса:/)).toHaveTextContent(
      "Товаров: 0; счетов: 1",
    );
    const submit = screen.getByRole("button", {
      name: "Перенести данные в аккаунт",
    });
    expect(submit).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Подтверждаю архивирование и полную замену записей аккаунта",
      }),
    );
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(transfer).toHaveBeenCalledOnce();
    expect(transfer).toHaveBeenCalledWith(source, 7, "stable-transfer");
    expect(
      screen.queryByText("Перенос подтверждён сервером"),
    ).not.toBeInTheDocument();
    await act(async () => finish?.({ ok: true, value: complete }));
    expect(
      await screen.findByText("Перенос подтверждён сервером"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ревизия переноса: 9.")).toBeInTheDocument();
  });
  it("keeps the original preview on 409 and uses a new revision only after explicit review", async () => {
    const user = userEvent.setup();
    transfer.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "Состав изменился" },
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = render(panel(destination, refresh));
    const preview = await screen.findByRole("button", {
      name: "Проверить перенос в аккаунт",
    });
    await waitFor(() => expect(preview).toBeEnabled());
    await user.click(preview);
    view.rerender(panel({ ...destination, revision: 8 }, refresh));
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Перенести данные в аккаунт" }),
    );
    expect(transfer.mock.calls[0]).toEqual([source, 7, "stable-transfer"]);
    expect(screen.getByText("Предпросмотр переноса")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Обновить данные перед переносом" }),
    );
    expect(refresh).toHaveBeenCalledOnce();
    await user.click(
      screen.getByRole("button", {
        name: "Состав проверен, продолжить перенос",
      }),
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Перенести данные в аккаунт" }),
    );
    expect(transfer.mock.calls[1]).toEqual([source, 8, "stable-transfer"]);
  });
  it("shows retained-source completion and never offers an automatic repeat", async () => {
    status.mockResolvedValue({
      ok: true,
      value: {
        fingerprint: "a".repeat(64),
        requestId: "stable-transfer",
        transferred: true,
      },
    });
    render(panel());
    expect(
      await screen.findByText(/Эта исходная копия уже перенесена/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Проверить перенос в аккаунт" }),
    ).not.toBeInTheDocument();
    expect(transfer).not.toHaveBeenCalled();
  });
  it("allows only raw download and retry when the source is corrupt", async () => {
    read.mockResolvedValue({
      ok: true,
      value: {
        status: "corrupt",
        error: { code: "CORRUPT", message: "Некорректная копия" },
        rawBackup: "{broken",
      },
    });
    render(panel());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Некорректная копия",
    );
    expect(
      screen.getByRole("button", { name: "Скачать исходную копию" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Повторить чтение прежних данных" }),
    ).toBeInTheDocument();
    expect(status).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();
  });
});
