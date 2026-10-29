import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { expect, it } from "vitest";

type Helpers = Readonly<{
  credentials: () => Promise<{ admin: string; app: string }>;
  databaseUrl: (password: string, options: { admin: boolean }) => string;
}>;

it("applies the additive monthly migration to populated old tables without fabricating or rewriting history", async () => {
  const root = resolve(__dirname, "../../..");
  const helpers = (await import(
    /* @vite-ignore */ pathToFileURL(resolve(root, "scripts/db-env.mjs")).href
  )) as Helpers;
  const keys = await helpers.credentials();
  const databaseName = `tradeledger_it_migration_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  if (!/^tradeledger_it_[a-z0-9_]+$/.test(databaseName))
    throw new Error("Invalid isolated fixture database");
  const url = new URL(helpers.databaseUrl(keys.admin, { admin: true }));
  if (url.hostname !== "127.0.0.1" || url.port !== "5439")
    throw new Error("Migration fixture requires the owned local database");
  const admin = new Client({ connectionString: url.href });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${databaseName}`;
  const sql = new Client({ connectionString: url.href });
  try {
    await sql.connect();
    for (const name of ["202610290001_initial", "202610290002_sku_unicode"]) {
      await sql.query(
        await readFile(
          resolve(root, `server/prisma/migrations/${name}/migration.sql`),
          "utf8",
        ),
      );
    }
    const user = randomUUID();
    const workspace = randomUUID();
    const dataset = randomUUID();
    await sql.query(
      'INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,$2,$3)',
      [user, `old-${user}@example.test`, "synthetic-migration-fixture"],
    );
    await sql.query('INSERT INTO "Workspace" (id,"userId") VALUES ($1,$2)', [
      workspace,
      user,
    ]);
    await sql.query(
      'INSERT INTO "Dataset" (id,"workspaceId",source,"sourceRevision","sourceUpdatedAt") VALUES ($1,$2,$3,0,$4)',
      [dataset, workspace, "empty", "2020-01-01T00:00:00Z"],
    );
    await sql.query('UPDATE "Workspace" SET "activeDatasetId"=$1 WHERE id=$2', [
      dataset,
      workspace,
    ]);
    await sql.query(
      'INSERT INTO "Account" ("datasetId",id,name,owner,provider,"balanceMinor",position) VALUES ($1,$2,$3,$4,$5,10000,0)',
      [dataset, "legacy", "Legacy name", "Legacy owner", "MONO"],
    );
    await sql.query(
      'INSERT INTO "BalanceChange" (id,"datasetId","accountId",kind,"afterMinor") VALUES ($1,$2,$3,$4,10000)',
      [randomUUID(), dataset, "legacy", "import_opening"],
    );
    for (const [id, position] of [
      ["manual-one", 0],
      ["manual-two", 1],
    ]) {
      await sql.query(
        'INSERT INTO "Snapshot" ("datasetId",id,"createdAt",label,"totalMinor",position) VALUES ($1,$2,$3,$4,10000,$5)',
        [dataset, id, "2026-09-15T12:00:00Z", "Untouched manual", position],
      );
    }
    const before = (
      await sql.query(
        'SELECT (SELECT jsonb_agg(a) FROM "Account" a) AS accounts, (SELECT jsonb_agg(s ORDER BY position) FROM "Snapshot" s) AS snapshots, (SELECT jsonb_agg(b) FROM "BalanceChange" b) AS balances',
      )
    ).rows[0];
    await sql.query(
      await readFile(
        resolve(
          root,
          "server/prisma/migrations/202610290003_monthly_closing/migration.sql",
        ),
        "utf8",
      ),
    );
    const after = (
      await sql.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(a)) FROM "Account" a) AS accounts,
      (SELECT jsonb_agg(to_jsonb(s) - 'closedMonth' ORDER BY position) FROM "Snapshot" s) AS snapshots,
      (SELECT jsonb_agg(b) FROM "BalanceChange" b) AS balances`)
    ).rows[0];
    expect(after).toEqual(before);
    expect(
      (await sql.query('SELECT "accountHistoryStartedAt" FROM "Dataset"')).rows,
    ).toEqual([{ accountHistoryStartedAt: null }]);
    expect(
      (await sql.query('SELECT "closedMonth" FROM "Snapshot"')).rows,
    ).toEqual([{ closedMonth: null }, { closedMonth: null }]);
    expect(
      (await sql.query('SELECT count(*)::int AS count FROM "AccountHistory"'))
        .rows,
    ).toEqual([{ count: 0 }]);
    process.stdout.write(
      `[integration] Retained populated migration fixture: ${databaseName}\n`,
    );
  } finally {
    await sql.end();
  }
});
