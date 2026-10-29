-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "activeDatasetId" UUID,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "sourceHash" VARCHAR(64),
    "sourceRevision" BIGINT NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),
    "archivedRevision" BIGINT,
    "archivedDocumentUpdatedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "datasetId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "skuKey" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "quantity" BIGINT NOT NULL,
    "stockValueMinor" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("datasetId","id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "itemId" VARCHAR(128) NOT NULL,
    "commandId" VARCHAR(128),
    "kind" VARCHAR(32) NOT NULL,
    "quantityDelta" BIGINT NOT NULL,
    "valueDeltaMinor" BIGINT NOT NULL,
    "resultingQuantity" BIGINT NOT NULL,
    "resultingValueMinor" BIGINT NOT NULL,
    "reason" VARCHAR(1000),
    "occurredAt" TIMESTAMPTZ(3),
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "datasetId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "owner" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "balanceMinor" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("datasetId","id")
);

-- CreateTable
CREATE TABLE "BalanceChange" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "accountId" VARCHAR(128) NOT NULL,
    "commandId" VARCHAR(128),
    "kind" VARCHAR(32) NOT NULL,
    "beforeMinor" BIGINT,
    "afterMinor" BIGINT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3),
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debt" (
    "datasetId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "direction" VARCHAR(16) NOT NULL,
    "counterparty" VARCHAR(120) NOT NULL,
    "principalMinor" BIGINT NOT NULL,
    "repaidMinor" BIGINT NOT NULL,
    "note" VARCHAR(1000) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("datasetId","id")
);

-- CreateTable
CREATE TABLE "Repayment" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "debtId" VARCHAR(128) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "commandId" VARCHAR(128),
    "occurredAt" TIMESTAMPTZ(3),
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "datasetId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "createdAt" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("datasetId","id")
);

-- CreateTable
CREATE TABLE "SnapshotAccount" (
    "datasetId" UUID NOT NULL,
    "snapshotId" VARCHAR(128) NOT NULL,
    "accountId" VARCHAR(128) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "owner" VARCHAR(120) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "balanceMinor" BIGINT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SnapshotAccount_pkey" PRIMARY KEY ("datasetId","snapshotId","accountId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "datasetId" UUID NOT NULL,
    "id" VARCHAR(128) NOT NULL,
    "at" VARCHAR(40) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "entityId" VARCHAR(128),
    "summary" VARCHAR(1000) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("datasetId","id")
);

-- CreateTable
CREATE TABLE "CommandReceipt" (
    "workspaceId" UUID NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "requestKind" VARCHAR(16) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "datasetId" UUID NOT NULL,
    "committedRevision" BIGINT NOT NULL,
    "committedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceHash" VARCHAR(64),
    "counts" JSONB,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("workspaceId","requestId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_userId_key" ON "Workspace"("userId");

-- CreateIndex
CREATE INDEX "Dataset_workspaceId_archivedAt_idx" ON "Dataset"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_workspaceId_id_key" ON "Dataset"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_datasetId_skuKey_key" ON "InventoryItem"("datasetId", "skuKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_datasetId_position_key" ON "InventoryItem"("datasetId", "position");

-- CreateIndex
CREATE INDEX "InventoryMovement_datasetId_itemId_recordedAt_idx" ON "InventoryMovement"("datasetId", "itemId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_datasetId_position_key" ON "Account"("datasetId", "position");

-- CreateIndex
CREATE INDEX "BalanceChange_datasetId_accountId_recordedAt_idx" ON "BalanceChange"("datasetId", "accountId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_datasetId_position_key" ON "Debt"("datasetId", "position");

-- CreateIndex
CREATE INDEX "Repayment_datasetId_debtId_recordedAt_idx" ON "Repayment"("datasetId", "debtId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_datasetId_position_key" ON "Snapshot"("datasetId", "position");

-- CreateIndex
CREATE INDEX "SnapshotAccount_datasetId_accountId_idx" ON "SnapshotAccount"("datasetId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapshotAccount_datasetId_snapshotId_position_key" ON "SnapshotAccount"("datasetId", "snapshotId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_datasetId_position_key" ON "AuditEvent"("datasetId", "position");

-- CreateIndex
CREATE INDEX "CommandReceipt_workspaceId_datasetId_idx" ON "CommandReceipt"("workspaceId", "datasetId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_id_activeDatasetId_fkey" FOREIGN KEY ("id", "activeDatasetId") REFERENCES "Dataset"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_datasetId_itemId_fkey" FOREIGN KEY ("datasetId", "itemId") REFERENCES "InventoryItem"("datasetId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceChange" ADD CONSTRAINT "BalanceChange_datasetId_accountId_fkey" FOREIGN KEY ("datasetId", "accountId") REFERENCES "Account"("datasetId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repayment" ADD CONSTRAINT "Repayment_datasetId_debtId_fkey" FOREIGN KEY ("datasetId", "debtId") REFERENCES "Debt"("datasetId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotAccount" ADD CONSTRAINT "SnapshotAccount_datasetId_snapshotId_fkey" FOREIGN KEY ("datasetId", "snapshotId") REFERENCES "Snapshot"("datasetId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapshotAccount" ADD CONSTRAINT "SnapshotAccount_datasetId_accountId_fkey" FOREIGN KEY ("datasetId", "accountId") REFERENCES "Account"("datasetId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_workspaceId_datasetId_fkey" FOREIGN KEY ("workspaceId", "datasetId") REFERENCES "Dataset"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_domain_0" CHECK ("revision" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_domain_0" CHECK ("sourceRevision" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_domain_1" CHECK ("archivedRevision" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_domain_2" CHECK ("source" IN ('empty','backup','legacy'));

ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_domain_3" CHECK (("archivedAt" IS NULL AND "archivedRevision" IS NULL AND "archivedDocumentUpdatedAt" IS NULL) OR ("archivedAt" IS NOT NULL AND "archivedRevision" IS NOT NULL AND "archivedDocumentUpdatedAt" IS NOT NULL));

ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_domain_4" CHECK (("source" = 'empty' AND "sourceHash" IS NULL) OR ("source" <> 'empty' AND "sourceHash" ~ '^[a-f0-9]{64}$'));

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_domain_0" CHECK ("quantity" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_domain_1" CHECK ("stockValueMinor" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_domain_2" CHECK ("quantity" <> 0 OR "stockValueMinor" = 0);

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_domain_3" CHECK ("position" >= 0);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_domain_0" CHECK ("quantityDelta" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_domain_1" CHECK ("valueDeltaMinor" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_domain_2" CHECK ("resultingQuantity" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_domain_3" CHECK ("resultingValueMinor" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_domain_4" CHECK ("kind" IN ('create','receive','issue','import_opening'));

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_domain_5" CHECK ("resultingQuantity" <> 0 OR "resultingValueMinor" = 0);

ALTER TABLE "Account" ADD CONSTRAINT "Account_domain_0" CHECK ("balanceMinor" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "Account" ADD CONSTRAINT "Account_domain_1" CHECK ("provider" IN ('MONO','NovaPay','other'));

ALTER TABLE "Account" ADD CONSTRAINT "Account_domain_2" CHECK ("position" >= 0);

ALTER TABLE "BalanceChange" ADD CONSTRAINT "BalanceChange_domain_0" CHECK ("beforeMinor" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "BalanceChange" ADD CONSTRAINT "BalanceChange_domain_1" CHECK ("afterMinor" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "BalanceChange" ADD CONSTRAINT "BalanceChange_domain_2" CHECK ("kind" IN ('create','set_balance','import_opening'));

ALTER TABLE "Debt" ADD CONSTRAINT "Debt_domain_0" CHECK ("principalMinor" BETWEEN 1 AND 9007199254740991);

ALTER TABLE "Debt" ADD CONSTRAINT "Debt_domain_1" CHECK ("repaidMinor" BETWEEN 0 AND "principalMinor");

ALTER TABLE "Debt" ADD CONSTRAINT "Debt_domain_2" CHECK ("direction" IN ('payable','receivable'));

ALTER TABLE "Debt" ADD CONSTRAINT "Debt_domain_3" CHECK ("position" >= 0);

ALTER TABLE "Repayment" ADD CONSTRAINT "Repayment_domain_0" CHECK ("amountMinor" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "Repayment" ADD CONSTRAINT "Repayment_domain_1" CHECK ("kind" IN ('repay','import_opening'));

ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_domain_0" CHECK ("totalMinor" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_domain_1" CHECK ("position" >= 0);

ALTER TABLE "SnapshotAccount" ADD CONSTRAINT "SnapshotAccount_domain_0" CHECK ("balanceMinor" BETWEEN -9007199254740991 AND 9007199254740991);

ALTER TABLE "SnapshotAccount" ADD CONSTRAINT "SnapshotAccount_domain_1" CHECK ("provider" IN ('MONO','NovaPay','other'));

ALTER TABLE "SnapshotAccount" ADD CONSTRAINT "SnapshotAccount_domain_2" CHECK ("position" >= 0);

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_domain_0" CHECK ("type" IN ('inventory.create','inventory.update','inventory.receive','inventory.issue','account.create','account.update','account.setBalance','debt.create','debt.update','debt.repay','snapshot.create'));

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_domain_1" CHECK ("position" >= 0);

ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_domain_0" CHECK ("committedRevision" BETWEEN 0 AND 9007199254740991);

ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_domain_1" CHECK ("requestKind" IN ('command','backup','legacy'));

ALTER TABLE "CommandReceipt" ADD CONSTRAINT "CommandReceipt_domain_2" CHECK ("requestHash" ~ '^[a-f0-9]{64}$');
