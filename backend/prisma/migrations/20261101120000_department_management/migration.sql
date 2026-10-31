-- Departments management module.
--
-- Additive only: new enum values, new nullable/defaulted columns, new tables and indexes. Nothing is dropped or
-- rewritten. The data steps at the end only fill the new columns from data that already exists.

-- A department may hold each member only once (removing sets removed=true; re-adding reactivates the row).
-- Refuse to continue rather than guess which duplicate to keep: nothing is deleted by this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "department_members" GROUP BY "department_id", "member_id" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'department_members has duplicate (department_id, member_id) rows; resolve them before applying this migration';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'PENDING_SECRETARY', 'RETURNED', 'PENDING_CHAIRPERSON', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'RETURNED';

-- AlterEnum
ALTER TYPE "ApprovalStepStatus" ADD VALUE 'returned';

-- AlterTable
ALTER TABLE "department_leaders" ADD COLUMN     "active_role" TEXT,
ADD COLUMN     "appointed_by" UUID,
ADD COLUMN     "end_reason" TEXT,
ADD COLUMN     "ended_by" UUID,
ADD COLUMN     "member_id" UUID;

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "approval_workflow_id" UUID,
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "objectives" TEXT,
ADD COLUMN     "status" "ActivityStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "supporting_info" TEXT,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "achievements" TEXT,
ADD COLUMN     "activity_date" TIMESTAMP(3),
ADD COLUMN     "activity_id" UUID,
ADD COLUMN     "activity_title" TEXT,
ADD COLUMN     "challenges" TEXT,
ADD COLUMN     "documents" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "objectives" TEXT,
ADD COLUMN     "outcomes" TEXT,
ADD COLUMN     "participants" INTEGER,
ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "recommendations" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "money_requests" ADD COLUMN     "activity_id" UUID,
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "expense_breakdown" JSONB,
ADD COLUMN     "justification" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "report_submissions" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "fellowship_id" UUID,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_events" (
    "id" UUID NOT NULL,
    "approval_id" UUID NOT NULL,
    "fellowship_id" UUID,
    "action" TEXT NOT NULL,
    "stage_order" INTEGER,
    "approver_role" TEXT,
    "comment" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_announcements" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "target_all" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "published_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_announcement_targets" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,

    CONSTRAINT "department_announcement_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_submissions_report_id_version_key" ON "report_submissions"("report_id", "version");

-- CreateIndex
CREATE INDEX "approval_events_approval_id_created_at_idx" ON "approval_events"("approval_id", "created_at");

-- CreateIndex
CREATE INDEX "department_announcements_fellowship_id_status_published_at_idx" ON "department_announcements"("fellowship_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "department_announcement_targets_department_id_idx" ON "department_announcement_targets"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_announcement_targets_announcement_id_department__key" ON "department_announcement_targets"("announcement_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_members_department_id_member_id_key" ON "department_members"("department_id", "member_id");

-- CreateIndex
CREATE INDEX "department_leaders_user_id_idx" ON "department_leaders"("user_id");

-- CreateIndex
CREATE INDEX "department_leaders_member_id_idx" ON "department_leaders"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_leaders_department_id_active_role_key" ON "department_leaders"("department_id", "active_role");

-- CreateIndex
CREATE INDEX "activities_department_id_status_idx" ON "activities"("department_id", "status");

-- CreateIndex
CREATE INDEX "reports_department_id_status_idx" ON "reports"("department_id", "status");

-- AddForeignKey
ALTER TABLE "department_leaders" ADD CONSTRAINT "department_leaders_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_submissions" ADD CONSTRAINT "report_submissions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_announcement_targets" ADD CONSTRAINT "department_announcement_targets_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "department_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_announcement_targets" ADD CONSTRAINT "department_announcement_targets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Data: carry existing records into the new columns ----------

-- Current leaders: mark the most recent current appointment per (department, role) as the active holder.
UPDATE "department_leaders" dl
SET "active_role" = dl."role_in_department"
FROM (
  SELECT DISTINCT ON ("department_id", "role_in_department") "id"
  FROM "department_leaders"
  WHERE "end_date" IS NULL
  ORDER BY "department_id", "role_in_department", "start_date" DESC, "created_at" DESC
) cur
WHERE dl."id" = cur."id";

-- Link each leadership to the member record of the leader's account, where one exists.
UPDATE "department_leaders" dl
SET "member_id" = m."id"
FROM "members" m
WHERE m."user_id" = dl."user_id" AND dl."member_id" IS NULL;

-- Activities cancelled the old way (a "[CANCELLED] " title prefix) get the new status. Titles are left as they are.
UPDATE "activities" SET "status" = 'CANCELLED' WHERE "title" LIKE '[CANCELLED]%';
