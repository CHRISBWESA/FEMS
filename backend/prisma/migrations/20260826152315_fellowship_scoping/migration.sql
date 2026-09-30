-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "department_leaders" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "fellowship_id" UUID,
ALTER COLUMN "is_active" SET DEFAULT false;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "leadership_history" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "money_requests" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "programmes" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "fellowship_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fellowship_id" UUID;

-- CreateTable
CREATE TABLE "fellowships" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fellowships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fellowships_name_key" ON "fellowships"("name");

-- CreateIndex
CREATE INDEX "activities_fellowship_id_idx" ON "activities"("fellowship_id");

-- CreateIndex
CREATE INDEX "announcements_fellowship_id_idx" ON "announcements"("fellowship_id");

-- CreateIndex
CREATE INDEX "approvals_fellowship_id_idx" ON "approvals"("fellowship_id");

-- CreateIndex
CREATE INDEX "attendance_fellowship_id_idx" ON "attendance"("fellowship_id");

-- CreateIndex
CREATE INDEX "budgets_fellowship_id_idx" ON "budgets"("fellowship_id");

-- CreateIndex
CREATE INDEX "comments_fellowship_id_idx" ON "comments"("fellowship_id");

-- CreateIndex
CREATE INDEX "contributions_fellowship_id_idx" ON "contributions"("fellowship_id");

-- CreateIndex
CREATE INDEX "department_leaders_fellowship_id_idx" ON "department_leaders"("fellowship_id");

-- CreateIndex
CREATE INDEX "departments_fellowship_id_idx" ON "departments"("fellowship_id");

-- CreateIndex
CREATE INDEX "documents_fellowship_id_idx" ON "documents"("fellowship_id");

-- CreateIndex
CREATE INDEX "expenses_fellowship_id_idx" ON "expenses"("fellowship_id");

-- CreateIndex
CREATE INDEX "leadership_history_fellowship_id_idx" ON "leadership_history"("fellowship_id");

-- CreateIndex
CREATE INDEX "members_fellowship_id_idx" ON "members"("fellowship_id");

-- CreateIndex
CREATE INDEX "money_requests_fellowship_id_idx" ON "money_requests"("fellowship_id");

-- CreateIndex
CREATE INDEX "notifications_fellowship_id_idx" ON "notifications"("fellowship_id");

-- CreateIndex
CREATE INDEX "programmes_fellowship_id_idx" ON "programmes"("fellowship_id");

-- CreateIndex
CREATE INDEX "reports_fellowship_id_idx" ON "reports"("fellowship_id");

-- CreateIndex
CREATE INDEX "users_fellowship_id_idx" ON "users"("fellowship_id");
