-- Existing datasets start with no invented historical coverage. Runtime anchors them
-- under their workspace lock using current account state and clock_timestamp().
ALTER TABLE "Dataset" ADD COLUMN "accountHistoryStartedAt" TIMESTAMPTZ(3);
ALTER TABLE "Snapshot" ADD COLUMN "closedMonth" VARCHAR(7);
-- Every existing row is NULL, so duplicate manual snapshots remain untouched.
CREATE UNIQUE INDEX "Snapshot_datasetId_closedMonth_key" ON "Snapshot"("datasetId", "closedMonth");
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_closedMonth_format" CHECK
  ("closedMonth" IS NULL OR "closedMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
CREATE TABLE "AccountHistory" (
  "datasetId" UUID NOT NULL,
  "accountId" VARCHAR(128) NOT NULL,
  "revision" BIGINT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "owner" VARCHAR(120) NOT NULL,
  "provider" VARCHAR(16) NOT NULL,
  "balanceMinor" BIGINT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "AccountHistory_pkey" PRIMARY KEY ("datasetId", "accountId", "revision"),
  CONSTRAINT "AccountHistory_account_fkey" FOREIGN KEY ("datasetId", "accountId")
    REFERENCES "Account"("datasetId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AccountHistory_money" CHECK ("balanceMinor" BETWEEN -9007199254740991 AND 9007199254740991),
  CONSTRAINT "AccountHistory_revision" CHECK ("revision" BETWEEN 0 AND 9007199254740991),
  CONSTRAINT "AccountHistory_position" CHECK ("position" >= 0),
  CONSTRAINT "AccountHistory_provider" CHECK ("provider" IN ('MONO','NovaPay','other'))
);
CREATE INDEX "AccountHistory_datasetId_accountId_effectiveAt_revision_idx"
  ON "AccountHistory"("datasetId", "accountId", "effectiveAt", "revision");
