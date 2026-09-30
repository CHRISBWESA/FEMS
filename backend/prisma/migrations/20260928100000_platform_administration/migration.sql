-- CreateEnum
CREATE TYPE "FellowshipStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "SupportGrantStatus" AS ENUM ('requested', 'approved', 'denied', 'revoked');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "fellowships" ADD COLUMN     "status" "FellowshipStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by" UUID,
ADD COLUMN     "suspension_reason" TEXT;

-- CreateTable
CREATE TABLE "fellowship_module_settings" (
    "fellowship_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fellowship_module_settings_pkey" PRIMARY KEY ("fellowship_id","module_key")
);

-- CreateTable
CREATE TABLE "support_access_grants" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "scopes" TEXT[],
    "duration_minutes" INTEGER NOT NULL,
    "status" "SupportGrantStatus" NOT NULL DEFAULT 'requested',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_access_grants_fellowship_id_status_idx" ON "support_access_grants"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "support_access_grants_requested_by_status_idx" ON "support_access_grants"("requested_by", "status");

-- CreateIndex
CREATE INDEX "audit_logs_fellowship_id_timestamp_idx" ON "audit_logs"("fellowship_id", "timestamp");

-- AddForeignKey
ALTER TABLE "fellowship_module_settings" ADD CONSTRAINT "fellowship_module_settings_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing state into the new lifecycle / tenant columns (data-preserving; nothing is deleted).
UPDATE "fellowships" SET "status" = 'suspended', "suspended_at" = "updated_at", "suspension_reason" = 'Deactivated before the platform lifecycle existed' WHERE "is_active" = FALSE;
UPDATE "audit_logs" a SET "fellowship_id" = u."fellowship_id" FROM "users" u WHERE a."user_id" = u."id" AND a."fellowship_id" IS NULL AND u."fellowship_id" IS NOT NULL;
