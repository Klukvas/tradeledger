import { randomUUID } from "node:crypto";
import {
  kyivMonth,
  monthBoundary,
  monthKey,
  shiftMonth,
} from "../../../src/domain/month-calendar";
import type { Snapshot } from "../../../src/domain/types";
import type { AccountHistory } from "../generated/prisma/client";
import { ApiException } from "../http";
import { ensureAccountHistory } from "./account-history";
import { insertSnapshot } from "./insert-document";
import { safeNumber } from "./mapping";
import type { LockedWorkspace, Tx } from "./types";

async function accountsBefore(
  tx: Tx,
  datasetId: string,
  boundary: Date,
): Promise<Snapshot["accounts"]> {
  const rows = await tx.$queryRaw<
    AccountHistory[]
  >`SELECT DISTINCT ON ("accountId") * FROM "AccountHistory"
    WHERE "datasetId" = ${datasetId}::uuid AND "effectiveAt" < ${boundary}
    ORDER BY "accountId", "effectiveAt" DESC, "revision" DESC`;
  return [...rows]
    .sort((left, right) => left.position - right.position)
    .map((row) => ({
      accountId: row.accountId,
      name: row.name,
      owner: row.owner,
      provider: row.provider as Snapshot["accounts"][number]["provider"],
      balanceMinor: safeNumber(row.balanceMinor),
    }));
}

/** Caller holds the workspace lock. Imports use this before archiving the old dataset. */
export async function closeDueMonths(
  tx: Tx,
  workspace: LockedWorkspace,
  asOf: Date,
): Promise<number> {
  const datasetId = workspace.activeDatasetId;
  const floor = await ensureAccountHistory(
    tx,
    datasetId,
    workspace.revision,
    asOf,
  );
  const first = shiftMonth(kyivMonth(floor), 1);
  const last = kyivMonth(asOf);
  const existing = await tx.snapshot.findMany({
    where: { datasetId, closedMonth: { not: null } },
    select: { closedMonth: true },
  });
  const completed = new Set(existing.map((row) => row.closedMonth));
  const [snapshotPosition, auditPosition] = await Promise.all([
    tx.snapshot.count({ where: { datasetId } }),
    tx.auditEvent.count({ where: { datasetId } }),
  ]);
  let inserted = 0;
  for (
    let month = first;
    monthKey(month) <= monthKey(last);
    month = shiftMonth(month, 1)
  ) {
    const boundary = monthBoundary(month);
    const closedMonth = monthKey(shiftMonth(month, -1));
    if (boundary > asOf || boundary <= floor || completed.has(closedMonth))
      continue;
    const accounts = await accountsBefore(tx, datasetId, boundary);
    const total = accounts.reduce(
      (sum, account) => sum + BigInt(account.balanceMinor),
      0n,
    );
    if (
      total < -BigInt(Number.MAX_SAFE_INTEGER) ||
      total > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new ApiException(
        500,
        "CORRUPT",
        "Историческая сумма счетов выходит за допустимый диапазон.",
      );
    }
    const id = `monthly-${randomUUID()}`;
    const snapshot: Snapshot = {
      id,
      createdAt: boundary.toISOString(),
      label: `Закрытие ${closedMonth}`,
      closedMonth,
      accounts,
      totalMinor: Number(total),
    };
    await insertSnapshot(tx, datasetId, snapshot, snapshotPosition + inserted);
    await tx.auditEvent.create({
      data: {
        datasetId,
        id: `close-${randomUUID()}`,
        at: asOf.toISOString(),
        type: "snapshot.create",
        entityId: id,
        summary: `Автоматическое закрытие месяца ${closedMonth}; счетов: ${accounts.length}.`,
        position: auditPosition + inserted,
      },
    });
    inserted += 1;
  }
  return inserted;
}
