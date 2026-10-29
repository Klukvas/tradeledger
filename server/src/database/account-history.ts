import type { Account } from "../../../src/domain/types";
import type { Tx } from "./types";

/** PostgreSQL now() is transaction-start time and can predate a waited workspace lock. */
export async function serializedTime(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<
    Readonly<{ at: Date }>[]
  >`SELECT date_trunc('milliseconds', clock_timestamp()) AS "at"`;
  const at = rows[0]?.at;
  if (!at) throw new Error("Serialized account timestamp unavailable");
  return at;
}

export async function ensureAccountHistory(
  tx: Tx,
  datasetId: string,
  revision: bigint,
  at: Date,
): Promise<Date> {
  const dataset = await tx.dataset.findUniqueOrThrow({
    where: { id: datasetId },
    select: { accountHistoryStartedAt: true },
  });
  if (dataset.accountHistoryStartedAt) return dataset.accountHistoryStartedAt;
  const accounts = await tx.account.findMany({
    where: { datasetId },
    orderBy: { position: "asc" },
  });
  if (accounts.length)
    await tx.accountHistory.createMany({
      data: accounts.map((account) => ({
        datasetId,
        accountId: account.id,
        name: account.name,
        owner: account.owner,
        provider: account.provider,
        balanceMinor: account.balanceMinor,
        position: account.position,
        revision,
        effectiveAt: at,
      })),
    });
  await tx.dataset.update({
    where: { id: datasetId },
    data: { accountHistoryStartedAt: at },
  });
  return at;
}

export async function appendAccountHistory(
  tx: Tx,
  datasetId: string,
  account: Account,
  revision: bigint,
  effectiveAt: Date,
): Promise<void> {
  const row = await tx.account.findUniqueOrThrow({
    where: { datasetId_id: { datasetId, id: account.id } },
    select: { position: true },
  });
  await tx.accountHistory.create({
    data: {
      datasetId,
      accountId: account.id,
      name: account.name,
      owner: account.owner,
      provider: account.provider,
      balanceMinor: BigInt(account.balanceMinor),
      position: row.position,
      revision,
      effectiveAt,
    },
  });
}
