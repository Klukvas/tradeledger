# PostgreSQL HTTP integration tests

Run from the repository root after starting the task-owned local database:

```sh
node scripts/local-stack.mjs db
npm run server:build
npm run server:integration
```

Node 24 and the installed workspace dependencies are required. Docker must expose the owned PostgreSQL instance at `127.0.0.1:5439`. The suite checks the database/container ownership through [db-env.mjs](../../../scripts/db-env.mjs); it never accepts an arbitrary `DATABASE_URL` or uses another project's database.

Each run creates a new random `tradeledger_it_*` database and applies the real Prisma migrations. Administrative credentials are recovered in memory and passed to the migration child only through its environment. The HTTP application and SQL assertions use `tradeledger_app`, with SELECT/INSERT/UPDATE and sequence access, without schema creation, DELETE or migration-table access. Credentials, session cookies and password hashes are never logged. Only the isolated database name is reported.

Fixture data and the isolated database are retained after the run. The suite never resets or drops a database, deletes fixtures, or modifies the ordinary `tradeledger` database. Repeated runs therefore consume additional local database storage. Cleanup requires an explicit separate decision.

The test harness loads **compiled** Nest modules from `server/dist` so constructor metadata and provider-symbol identity match the real application. Rebuild after changing server code; Vitest's source transform does not emit the implicit Nest injection metadata. The harness creates its own application and ephemeral HTTP listener through Supertest, then closes the application, Prisma pool and assertion connection. No frontend or shared development API process is used. The auth limiter quota is raised for this isolated test application; no auth, CSRF or tenant guard is bypassed.

The suite follows [API_CONTRACTS.md](../../../API_CONTRACTS.md) and exercises auth, logout/expiry, CSRF, tenant boundaries, the ten allowed HTTP command variants, rejection of legacy `snapshot.create` with 400, normalized movement/balance/repayment/snapshot persistence, safe-integer SQL constraints, immutable archive export and imported ISO/order fidelity. Command and import concurrency use separately committed real transactions and PostgreSQL workspace locks, without an outer rollback transaction. Post-persistence fault injection verifies transactional rollback, and a narrowly injected readiness outage checks HTTP sanitization without stopping PostgreSQL. The JSON envelope and validated source limits both return 413 while malformed/schema-invalid requests return 400.

[monthly-close.test.ts](./monthly-close.test.ts) additionally checks Kyiv month boundaries across DST, historical account states, catchup, concurrent/idempotent closes, imports and serialized operation time. [monthly-migration.test.ts](./monthly-migration.test.ts) applies the additive monthly migration to populated old tables and checks that existing history is preserved without fabricating earlier coverage.

For source-only review, `npm run typecheck:server` and `npx eslint server/test/integration --max-warnings 0` do not execute the database mutation suite.
