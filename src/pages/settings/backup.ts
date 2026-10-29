import type { DocumentV1, LedgerState } from "../../domain/types";

export function documentCounts(state: LedgerState): string {
  return `Товаров: ${state.inventory.length}; счетов: ${state.accounts.length}; долгов: ${state.debts.length}; фиксаций балансов: ${state.snapshots.length}; счетов в фиксациях: ${state.snapshots.reduce((total, snapshot) => total + snapshot.accounts.length, 0)}; операций: ${state.audit.length}.`;
}
export function downloadBackup(json: string, prefix = "tradeledger"): void {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
export type ImportPreview = Readonly<{
  json: string;
  filename: string;
  document: DocumentV1;
  revision: number;
  original: LedgerState;
}>;
