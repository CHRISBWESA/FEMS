-- AlterTable
ALTER TABLE "deleted_records" ADD COLUMN     "fellowship_id" UUID;

-- CreateIndex
CREATE INDEX "deleted_records_fellowship_id_deleted_at_idx" ON "deleted_records"("fellowship_id", "deleted_at");

-- Attribute existing rows to their fellowship: the snapshot's own fellowship_id when it has one, otherwise the
-- fellowship of the user who deleted it. Rows that cannot be attributed stay NULL and are unreachable via the API.
UPDATE "deleted_records" d
SET "fellowship_id" = COALESCE(
  CASE WHEN d."original_data"->>'fellowship_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (d."original_data"->>'fellowship_id')::uuid END,
  (SELECT u."fellowship_id" FROM "users" u WHERE u."id" = d."deleted_by")
)
WHERE d."fellowship_id" IS NULL;
