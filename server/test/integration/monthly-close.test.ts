import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  kyivMonth,
  monthBoundary,
  monthKey,
  shiftMonth,
} from "../../../src/domain/month-calendar";
import type { Snapshot } from "../../../src/domain/types";
import { closeDueMonths } from "../../src/database/close-months";
import { serializedTime } from "../../src/database/account-history";
import { startHarness, type Actor, type Harness, value } from "./harness";
import type { ImportResponse } from "../../../shared/api";

const compiled = createRequire(resolve(__dirname, "../../package.json"));
const { MonthlyCloseService } = compiled(
  "./dist/server/src/monthly-close/monthly-close.service.js",
) as typeof import("../../src/monthly-close/monthly-close.service");
const { SchedulerRegistry } = compiled(
  "@nestjs/schedule",
) as typeof import("@nestjs/schedule");
const now = new Date();
const current = kyivMonth(now);
const boundary = monthBoundary(current);
const previousBoundary = monthBoundary(shiftMonth(current, -1));
const firstBoundary = monthBoundary(shiftMonth(current, -2));
const floor = new Date(firstBoundary.getTime() - 86_400_000);
const before = (at: Date) => new Date(at.getTime() - 1_000);
let harness: Harness;

async function journalTime(
  actor: Actor,
  accountId: string,
  at: Date,
): Promise<void> {
  const workspace = await harness.workspace(actor);
  const row = await harness.database.accountHistory.findFirstOrThrow({
    where: { datasetId: workspace.activeDatasetId ?? "", accountId },
    orderBy: { revision: "desc" },
  });
  await harness.database.accountHistory.update({
    where: {
      datasetId_accountId_revision: {
        datasetId: row.datasetId,
        accountId,
        revision: row.revision,
      },
    },
    data: { effectiveAt: at },
  });
}
async function close(actor: Actor, at = now): Promise<number> {
  return harness.repository.withLockedWorkspace(
    actor.id,
    async (tx, workspace) => {
      const count = await closeDueMonths(tx, workspace, at);
      if (count)
        await tx.workspace.update({
          where: { id: workspace.id },
          data: { revision: workspace.revision + 1n, updatedAt: at },
        });
      return count;
    },
  );
}
async function create(
  actor: Actor,
  id: string,
  balanceMinor: number,
): Promise<void> {
  await harness.execute(actor, {
    type: "account.create",
    id,
    name: `Original ${id}`,
    owner: "Owner",
    provider: "MONO",
    balanceMinor,
  });
}
async function setFloor(actor: Actor, at = floor): Promise<void> {
  const workspace = await harness.workspace(actor);
  await harness.database.dataset.update({
    where: { id: workspace.activeDatasetId ?? "" },
    data: { accountHistoryStartedAt: at },
  });
}

beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness.close();
});

describe("automatic month closing with real locked PostgreSQL", () => {
  it("runs a single Kyiv cron across both DST offsets and catches up all historical boundaries exactly once", async () => {
    const registry =
      harness.app.get<InstanceType<typeof SchedulerRegistry>>(
        SchedulerRegistry,
      );
    expect([...registry.getCronJobs().keys()]).toEqual([
      "monthly-account-close",
    ]);
    const cron = registry.getCronJob("monthly-account-close");
    expect(cron.cronTime.timeZone).toBe("Europe/Kyiv");
    expect(cron.waitForCompletion).toBe(true);
    expect(
      cron.cronTime
        .getNextDateFrom(new Date("2026-03-31T20:59:59Z"), "Europe/Kyiv")
        .toUTC()
        .toISO(),
    ).toBe("2026-03-31T21:00:00.000Z");
    expect(
      cron.cronTime
        .getNextDateFrom(new Date("2026-10-31T21:59:59Z"), "Europe/Kyiv")
        .toUTC()
        .toISO(),
    ).toBe("2026-10-31T22:00:00.000Z");

    const actor = await harness.register();
    await create(actor, "cash", 10000);
    await journalTime(actor, "cash", floor);
    await create(actor, "negative", -1000);
    await journalTime(actor, "negative", floor);
    await setFloor(actor);
    await harness.execute(actor, {
      type: "account.setBalance",
      id: "cash",
      balanceMinor: 12000,
    });
    await journalTime(actor, "cash", before(previousBoundary));
    await harness.execute(actor, {
      type: "account.update",
      id: "cash",
      name: "Renamed this month",
      owner: "Later owner",
      provider: "NovaPay",
    });
    await journalTime(actor, "cash", boundary);
    await create(actor, "new-this-month", 5000);
    await journalTime(actor, "new-this-month", boundary);
    expect(await Promise.all([close(actor), close(actor)])).toEqual(
      expect.arrayContaining([3, 0]),
    );
    const document = await harness.read(actor);
    const snapshots = document.state.snapshots;
    expect(snapshots.map((snapshot) => snapshot.createdAt)).toEqual(
      [firstBoundary, previousBoundary, boundary].map((date) =>
        date.toISOString(),
      ),
    );
    expect(snapshots.map((snapshot) => snapshot.totalMinor)).toEqual([
      9000, 11000, 11000,
    ]);
    expect(
      snapshots.at(-1)?.accounts.map((account) => account.accountId),
    ).toEqual(["cash", "negative"]);
    expect(snapshots.at(-1)?.accounts[0]).toMatchObject({
      name: "Original cash",
      owner: "Owner",
      provider: "MONO",
      balanceMinor: 12000,
    });
    expect(await close(actor)).toBe(0);
    expect(await harness.read(actor)).toEqual(document);
  });

  it("keeps a trusted empty anchor distinct from missing pre-import history, preserving explicit backup evidence", async () => {
    const emptyActor = await harness.register();
    await setFloor(emptyActor, before(boundary));
    expect(await close(emptyActor)).toBe(1);
    expect((await harness.read(emptyActor)).state.snapshots[0]).toMatchObject({
      totalMinor: 0,
      accounts: [],
      closedMonth: monthKey(shiftMonth(current, -1)),
    });

    const actor = await harness.register();
    await create(actor, "imported", 12300);
    const source = await harness.read(actor);
    const marker = monthKey(shiftMonth(current, -1));
    const account = source.state.accounts[0];
    if (!account) throw new Error("Missing test account");
    const evidence: Snapshot = {
      id: "official-source",
      label: "Restored monthly evidence",
      closedMonth: marker,
      createdAt: boundary.toISOString(),
      totalMinor: 10000,
      accounts: [
        {
          accountId: account.id,
          name: account.name,
          owner: account.owner,
          provider: account.provider,
          balanceMinor: 10000,
        },
      ],
    };
    const manual: Snapshot = {
      ...evidence,
      id: "manual-source",
      label: "Manual source",
      createdAt: before(boundary).toISOString(),
    };
    const unmarked = { id: manual.id, createdAt: manual.createdAt, label: manual.label, accounts: manual.accounts, totalMinor: manual.totalMinor };
    const input = {
      ...source,
      updatedAt: "2000-01-01T00:00:00Z",
      state: { ...source.state, snapshots: [unmarked, evidence] },
    };
    const result = value<ImportResponse>(
      await harness
        .post(
          "/ledger/import",
          {
            requestId: randomUUID(),
            expectedRevision: source.revision,
            source: "backup",
            document: input,
          },
          actor,
        )
        .expect(200),
    );
    const imported = await harness.database.dataset.findUniqueOrThrow({
      where: { id: result.receipt.datasetId },
    });
    expect(imported.accountHistoryStartedAt?.getTime()).toBeGreaterThan(
      boundary.getTime(),
    );
    expect(await close(actor)).toBe(0);
    expect((await harness.read(actor)).state.snapshots).toEqual([
      unmarked,
      evidence,
    ]);
    const opening = await harness.database.balanceChange.findFirstOrThrow({
      where: { datasetId: result.receipt.datasetId },
    });
    expect(opening).toMatchObject({ kind: "import_opening", occurredAt: null });
    expect(
      (
        await harness.database.accountHistory.findMany({
          where: { datasetId: result.receipt.datasetId },
        })
      )[0]?.effectiveAt.getTime(),
    ).toBe(imported.accountHistoryStartedAt?.getTime());
  });

  it("closes the previous active dataset before an import can archive it and preserves the import CAS", async () => {
    const actor = await harness.register();
    await create(actor, "archive-cash", 111);
    await journalTime(actor, "archive-cash", before(boundary));
    await setFloor(actor, before(boundary));
    const old = await harness.workspace(actor);
    const source = await harness.read(actor);
    const response = value<ImportResponse>(
      await harness
        .post(
          "/ledger/import",
          {
            requestId: randomUUID(),
            expectedRevision: source.revision,
            source: "backup",
            document: source,
          },
          actor,
        )
        .expect(200),
    );
    expect(response.document.revision).toBe(source.revision + 2);
    const oldDataset = await harness.database.dataset.findUniqueOrThrow({
      where: { id: old.activeDatasetId ?? "" },
    });
    expect(oldDataset.archivedRevision).toBe(BigInt(source.revision + 1));
    expect(oldDataset.archivedDocumentUpdatedAt?.toISOString()).toBe(
      response.document.updatedAt,
    );
    const archived = await harness.database.snapshot.findMany({
      where: { datasetId: old.activeDatasetId ?? "" },
    });
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({
      closedMonth: monthKey(shiftMonth(current, -1)),
      totalMinor: 111n,
    });
    expect(response.document.state.snapshots).toEqual([]);
  });

  it("uses post-lock wall clock rather than transaction-start time, and revision breaks millisecond ties", async () => {
    const actor = await harness.register();
    await create(actor, "tie", 1);
    await journalTime(actor, "tie", before(boundary));
    await setFloor(actor, before(boundary));
    await harness.execute(actor, {
      type: "account.setBalance",
      id: "tie",
      balanceMinor: 2,
    });
    await journalTime(actor, "tie", before(boundary));
    await harness.execute(actor, {
      type: "account.setBalance",
      id: "tie",
      balanceMinor: 3,
    });
    await journalTime(actor, "tie", before(boundary));
    expect(await close(actor)).toBe(1);
    expect((await harness.read(actor)).state.snapshots[0]?.totalMinor).toBe(3);
    await harness.repository.withLockedWorkspace(actor.id, async (tx) => {
      const [row] = await tx.$queryRaw<
        { started: Date }[]
      >`SELECT transaction_timestamp() AS started`;
      await tx.$queryRaw`SELECT 1 AS waited FROM pg_sleep(0.02)`;
      expect((await serializedTime(tx)).getTime()).toBeGreaterThan(
        row?.started.getTime() ?? 0,
      );
    });
    const document = await harness.read(actor);
    await harness
      .post(
        "/ledger/commands",
        {
          expectedRevision: document.revision,
          command: {
            type: "snapshot.create",
            id: "forbidden",
            label: "Manual",
            meta: { commandId: randomUUID(), at: now.toISOString() },
          },
        },
        actor,
      )
      .expect(400);
    expect(await harness.read(actor)).toEqual(document);
  });

  it.each([0, 333])('keeps a single import transition time across a month boundary (balance %s)', async (balanceMinor) => {
    const actor = await harness.register()
    if (balanceMinor !== 0) await create(actor, 'midnight-import', balanceMinor)
    const source = await harness.read(actor)
    const nextBoundary = monthBoundary(shiftMonth(current, 1))
    const transitionAt = new Date(nextBoundary.getTime() - 1)
    const physicalInsertAt = new Date(nextBoundary.getTime() + 1)
    const history = compiled('./dist/server/src/database/account-history.js') as typeof import('../../src/database/account-history')
    const clock = vi.spyOn(history, 'serializedTime').mockResolvedValueOnce(transitionAt).mockResolvedValueOnce(physicalInsertAt)
    let imported: ImportResponse
    try {
      imported = value<ImportResponse>(await harness.post('/ledger/import', {
        requestId: randomUUID(), expectedRevision: source.revision, source: 'backup', document: source,
      }, actor).expect(200))
      expect(clock).toHaveBeenCalledTimes(1)
    } finally { clock.mockRestore() }
    const dataset = await harness.database.dataset.findUniqueOrThrow({ where: { id: imported.receipt.datasetId } })
    expect(dataset.accountHistoryStartedAt).toEqual(transitionAt)
    expect(imported.document.updatedAt).toBe(transitionAt.toISOString())
    expect(await close(actor, nextBoundary)).toBe(1)
    expect((await harness.read(actor)).state.snapshots[0]).toMatchObject({
      closedMonth: monthKey(current), createdAt: nextBoundary.toISOString(), totalMinor: balanceMinor,
    })
  })

  it("serializes an account mutation racing a close without admitting its current-month value into the baseline", async () => {
    const actor = await harness.register();
    await create(actor, "race", 700);
    await journalTime(actor, "race", before(boundary));
    await setFloor(actor, before(boundary));
    const document = await harness.read(actor);
    const [count, response] = await Promise.all([
      close(actor),
      harness.post(
        "/ledger/commands",
        {
          expectedRevision: document.revision,
          command: {
            type: "account.setBalance",
            id: "race",
            balanceMinor: 999,
            meta: { commandId: randomUUID(), at: "2000-01-01T00:00:00Z" },
          },
        },
        actor,
      ),
    ]);
    expect(count).toBe(1);
    expect([200, 409]).toContain(response.status);
    expect((await harness.read(actor)).state.snapshots[0]?.totalMinor).toBe(
      700,
    );
  });

  it("recovers missed boundaries on application startup while retaining the same isolated database", async () => {
    const actor = await harness.register();
    await create(actor, "restart", 900);
    await journalTime(actor, "restart", before(boundary));
    await setFloor(actor, before(boundary));
    const databaseName = harness.databaseName;
    await harness.close();
    harness = await startHarness({ reuseDatabaseName: databaseName });
    const snapshot = (await harness.read(actor)).state.snapshots[0];
    expect(snapshot).toMatchObject({
      closedMonth: monthKey(shiftMonth(current, -1)),
      totalMinor: 900,
    });
    const service =
      harness.app.get<InstanceType<typeof MonthlyCloseService>>(
        MonthlyCloseService,
      );
    await service.closeAll();
    expect((await harness.read(actor)).state.snapshots).toEqual([snapshot]);
  });
});
