-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('new', 'good', 'fair', 'poor', 'damaged');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('available', 'checked_out', 'in_maintenance', 'retired', 'lost');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('scheduled', 'repair', 'inspection');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('created', 'updated', 'condition_changed', 'transferred', 'checked_out', 'checked_in', 'maintenance_scheduled', 'maintenance_started', 'maintenance_completed', 'maintenance_cancelled', 'quantity_adjusted', 'document_attached', 'document_removed', 'retired', 'lost');

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_locations" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "asset_tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "location_id" UUID,
    "serial_number" TEXT,
    "acquisition_date" TIMESTAMP(3),
    "acquisition_cost" DECIMAL(12,2),
    "acquisition_expense_id" UUID,
    "condition" "AssetCondition" NOT NULL DEFAULT 'good',
    "status" "AssetStatus" NOT NULL DEFAULT 'available',
    "is_consumable" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "reorder_level" INTEGER,
    "owning_department_id" UUID,
    "custodian_member_id" UUID,
    "notes" TEXT,
    "retired_at" TIMESTAMP(3),
    "retired_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_loans" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "asset_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "checked_out_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "checked_in_at" TIMESTAMP(3),
    "condition_out" "AssetCondition" NOT NULL,
    "condition_in" "AssetCondition",
    "checked_out_by" UUID NOT NULL,
    "checked_in_by" UUID,
    "notes" TEXT,

    CONSTRAINT "asset_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_maintenance" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "asset_id" UUID NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'scheduled',
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "performed_by" TEXT,
    "cost" DECIMAL(12,2),
    "condition_after" "AssetCondition",
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_history" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "asset_id" UUID NOT NULL,
    "event_type" "AssetEventType" NOT NULL,
    "actor_id" UUID,
    "member_id" UUID,
    "from_department_id" UUID,
    "to_department_id" UUID,
    "from_location_id" UUID,
    "to_location_id" UUID,
    "from_value" TEXT,
    "to_value" TEXT,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "asset_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "label" TEXT,
    "attached_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_fellowship_id_name_key" ON "asset_categories"("fellowship_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "asset_locations_fellowship_id_name_key" ON "asset_locations"("fellowship_id", "name");

-- CreateIndex
CREATE INDEX "assets_fellowship_id_status_idx" ON "assets"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "assets_owning_department_id_idx" ON "assets"("owning_department_id");

-- CreateIndex
CREATE INDEX "assets_custodian_member_id_idx" ON "assets"("custodian_member_id");

-- CreateIndex
CREATE INDEX "assets_category_id_idx" ON "assets"("category_id");

-- CreateIndex
CREATE INDEX "assets_location_id_idx" ON "assets"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_fellowship_id_asset_tag_key" ON "assets"("fellowship_id", "asset_tag");

-- CreateIndex
CREATE INDEX "asset_loans_asset_id_checked_in_at_idx" ON "asset_loans"("asset_id", "checked_in_at");

-- CreateIndex
CREATE INDEX "asset_loans_member_id_checked_in_at_idx" ON "asset_loans"("member_id", "checked_in_at");

-- CreateIndex
CREATE INDEX "asset_loans_fellowship_id_due_date_idx" ON "asset_loans"("fellowship_id", "due_date");

-- CreateIndex
CREATE INDEX "asset_maintenance_asset_id_status_idx" ON "asset_maintenance"("asset_id", "status");

-- CreateIndex
CREATE INDEX "asset_maintenance_fellowship_id_status_scheduled_for_idx" ON "asset_maintenance"("fellowship_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "asset_history_asset_id_occurred_at_idx" ON "asset_history"("asset_id", "occurred_at");

-- CreateIndex
CREATE INDEX "asset_history_fellowship_id_occurred_at_idx" ON "asset_history"("fellowship_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "asset_documents_asset_id_document_id_key" ON "asset_documents"("asset_id", "document_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "asset_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_owning_department_id_fkey" FOREIGN KEY ("owning_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_custodian_member_id_fkey" FOREIGN KEY ("custodian_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_loans" ADD CONSTRAINT "asset_loans_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_loans" ADD CONSTRAINT "asset_loans_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

