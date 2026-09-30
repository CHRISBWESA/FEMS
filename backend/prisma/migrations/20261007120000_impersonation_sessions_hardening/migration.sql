-- AlterTable
ALTER TABLE "impersonation_sessions"
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "target_email" TEXT,
ADD COLUMN     "fellowship_id" UUID,
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "ended_by" UUID,
ADD COLUMN     "end_reason" TEXT;

-- CreateIndex
CREATE INDEX "impersonation_sessions_admin_user_id_status_idx" ON "impersonation_sessions"("admin_user_id", "status");

-- CreateIndex
CREATE INDEX "impersonation_sessions_target_user_id_status_idx" ON "impersonation_sessions"("target_user_id", "status");

-- CreateIndex
CREATE INDEX "impersonation_sessions_fellowship_id_status_idx" ON "impersonation_sessions"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "impersonation_sessions_expires_at_idx" ON "impersonation_sessions"("expires_at");
