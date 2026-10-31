-- Two columns were added to schema.prisma in commit 807882b without a migration, so databases built from the
-- migrations (production included) lack them and every query loading a full member or attendance row fails with
-- "column does not exist". Additive only; existing rows get NULL.

-- AlterTable
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "leader_role" TEXT;

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "recorded_by_user_id" UUID;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_recorded_by_user_id_fkey') THEN
    ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_user_id_fkey"
      FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
