-- Resource management: ownership classes (fellowship / department / donated / borrowed), assignments, transfers,
-- requests and bookings, incidents and disposals, stock movements and settings. Additive only.

-- CreateEnum
CREATE TYPE "AssetOwnership" AS ENUM ('fellowship', 'department', 'donated', 'borrowed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetCondition" ADD VALUE 'excellent';
ALTER TYPE "AssetCondition" ADD VALUE 'under_repair';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetEventType" ADD VALUE 'assigned';
ALTER TYPE "AssetEventType" ADD VALUE 'assignment_ended';
ALTER TYPE "AssetEventType" ADD VALUE 'ownership_transferred';
ALTER TYPE "AssetEventType" ADD VALUE 'status_changed';
ALTER TYPE "AssetEventType" ADD VALUE 'request_approved';
ALTER TYPE "AssetEventType" ADD VALUE 'handed_over';
ALTER TYPE "AssetEventType" ADD VALUE 'returned';
ALTER TYPE "AssetEventType" ADD VALUE 'borrowed_external';
ALTER TYPE "AssetEventType" ADD VALUE 'returned_external';
ALTER TYPE "AssetEventType" ADD VALUE 'incident_reported';
ALTER TYPE "AssetEventType" ADD VALUE 'disposal_requested';
ALTER TYPE "AssetEventType" ADD VALUE 'disposed';
ALTER TYPE "AssetEventType" ADD VALUE 'stock_received';
ALTER TYPE "AssetEventType" ADD VALUE 'stock_issued';
ALTER TYPE "AssetEventType" ADD VALUE 'stock_adjusted';
ALTER TYPE "AssetEventType" ADD VALUE 'stock_transferred';
ALTER TYPE "AssetEventType" ADD VALUE 'maintenance_reported';
ALTER TYPE "AssetEventType" ADD VALUE 'maintenance_approved';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetStatus" ADD VALUE 'assigned';
ALTER TYPE "AssetStatus" ADD VALUE 'reserved';
ALTER TYPE "AssetStatus" ADD VALUE 'borrowed';
ALTER TYPE "AssetStatus" ADD VALUE 'disposed';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MaintenanceStatus" ADD VALUE 'reported';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'pending_review';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'approved';

-- AlterTable
ALTER TABLE "asset_maintenance" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "estimated_cost" DECIMAL(12,2),
ADD COLUMN     "expense_id" UUID,
ADD COLUMN     "reported_by" UUID,
ADD COLUMN     "technician" TEXT;

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "acquisition_method" TEXT,
ADD COLUMN     "acquisition_source" TEXT,
ADD COLUMN     "actual_return_date" TIMESTAMP(3),
ADD COLUMN     "assigned_department_id" UUID,
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "borrowed_on" TIMESTAMP(3),
ADD COLUMN     "condition_received" "AssetCondition",
ADD COLUMN     "condition_returned" "AssetCondition",
ADD COLUMN     "disposal_method" TEXT,
ADD COLUMN     "disposed_at" TIMESTAMP(3),
ADD COLUMN     "donation_date" TIMESTAMP(3),
ADD COLUMN     "donor_contact" TEXT,
ADD COLUMN     "donor_name" TEXT,
ADD COLUMN     "estimated_value" DECIMAL(12,2),
ADD COLUMN     "expected_return_date" TIMESTAMP(3),
ADD COLUMN     "external_owner_contact" TEXT,
ADD COLUMN     "external_owner_name" TEXT,
ADD COLUMN     "last_inspected_at" TIMESTAMP(3),
ADD COLUMN     "ownership_type" "AssetOwnership" NOT NULL DEFAULT 'fellowship',
ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "storage_location" TEXT,
ADD COLUMN     "unit" TEXT;

-- CreateTable
CREATE TABLE "resource_settings" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "tag_prefix" TEXT NOT NULL DEFAULT 'AST',
    "units" TEXT[] DEFAULT ARRAY['piece', 'set', 'box', 'pack', 'ream', 'litre', 'kg', 'metre']::TEXT[],
    "maintenance_categories" TEXT[] DEFAULT ARRAY['repair', 'service', 'inspection', 'cleaning']::TEXT[],
    "major_disposal_value" DECIMAL(12,2),
    "low_stock_notifications" BOOLEAN NOT NULL DEFAULT true,
    "return_reminder_days" INTEGER NOT NULL DEFAULT 2,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "responsible_member_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "handed_over_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condition_at_handover" "AssetCondition" NOT NULL,
    "authorized_by" UUID NOT NULL,
    "notes" TEXT,
    "active_key" TEXT,
    "ended_at" TIMESTAMP(3),
    "ended_by" UUID,
    "condition_at_return" "AssetCondition",
    "end_notes" TEXT,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_transfers" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_ownership" "AssetOwnership" NOT NULL,
    "to_ownership" "AssetOwnership" NOT NULL,
    "from_department_id" UUID,
    "to_department_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "from_custodian_id" UUID,
    "to_custodian_id" UUID,
    "transfer_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "condition_before" "AssetCondition" NOT NULL,
    "condition_after" "AssetCondition",
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_workflow_id" UUID,
    "initiated_by" UUID NOT NULL,
    "approved_by" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_requests" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "department_id" UUID,
    "borrower_member_id" UUID,
    "activity_id" UUID,
    "project_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "purpose" TEXT NOT NULL,
    "needed_from" TIMESTAMP(3) NOT NULL,
    "needed_until" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "supporting_info" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "issued_at" TIMESTAMP(3),
    "issued_by" UUID,
    "condition_out" "AssetCondition",
    "quantity_returned" INTEGER NOT NULL DEFAULT 0,
    "returned_at" TIMESTAMP(3),
    "received_by" UUID,
    "condition_in" "AssetCondition",
    "return_notes" TEXT,
    "return_evidence" JSONB NOT NULL DEFAULT '[]',
    "last_reminded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_incidents" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "incident_number" TEXT NOT NULL,
    "asset_id" UUID NOT NULL,
    "incident_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reported_by" UUID NOT NULL,
    "department_id" UUID,
    "investigation_notes" TEXT,
    "proposed_action" TEXT NOT NULL,
    "disposal_method" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "approval_workflow_id" UUID,
    "outcome" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "department_id" UUID,
    "member_id" UUID,
    "related_asset_id" UUID,
    "reference" TEXT,
    "reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resource_settings_fellowship_id_key" ON "resource_settings"("fellowship_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_assignments_active_key_key" ON "asset_assignments"("active_key");

-- CreateIndex
CREATE INDEX "asset_assignments_asset_id_handed_over_at_idx" ON "asset_assignments"("asset_id", "handed_over_at");

-- CreateIndex
CREATE INDEX "asset_assignments_department_id_ended_at_idx" ON "asset_assignments"("department_id", "ended_at");

-- CreateIndex
CREATE INDEX "asset_transfers_asset_id_created_at_idx" ON "asset_transfers"("asset_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "asset_transfers_fellowship_id_transfer_number_key" ON "asset_transfers"("fellowship_id", "transfer_number");

-- CreateIndex
CREATE INDEX "resource_requests_asset_id_status_needed_from_idx" ON "resource_requests"("asset_id", "status", "needed_from");

-- CreateIndex
CREATE INDEX "resource_requests_fellowship_id_status_idx" ON "resource_requests"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "resource_requests_department_id_status_idx" ON "resource_requests"("department_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "resource_requests_fellowship_id_request_number_key" ON "resource_requests"("fellowship_id", "request_number");

-- CreateIndex
CREATE INDEX "asset_incidents_asset_id_created_at_idx" ON "asset_incidents"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "asset_incidents_fellowship_id_status_idx" ON "asset_incidents"("fellowship_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "asset_incidents_fellowship_id_incident_number_key" ON "asset_incidents"("fellowship_id", "incident_number");

-- CreateIndex
CREATE INDEX "stock_movements_asset_id_created_at_idx" ON "stock_movements"("asset_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_fellowship_id_created_at_idx" ON "stock_movements"("fellowship_id", "created_at");

-- CreateIndex
CREATE INDEX "assets_assigned_department_id_idx" ON "assets"("assigned_department_id");

-- CreateIndex
CREATE INDEX "assets_fellowship_id_ownership_type_idx" ON "assets"("fellowship_id", "ownership_type");


-- Data: assets that already belonged to a department (Phase 16 "owning department") keep that meaning as
-- department-owned resources; everything else is fellowship-owned (the column default). Retired assets keep
-- their retired status and history.
UPDATE "assets" SET "ownership_type" = 'department' WHERE "owning_department_id" IS NOT NULL;
UPDATE "assets" SET "acquisition_method" = 'purchase' WHERE "acquisition_expense_id" IS NOT NULL AND "acquisition_method" IS NULL;
