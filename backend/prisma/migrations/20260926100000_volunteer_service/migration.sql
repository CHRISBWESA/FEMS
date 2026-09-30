-- CreateEnum
CREATE TYPE "ServiceOpportunityStatus" AS ENUM ('draft', 'open', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "ServiceShiftStatus" AS ENUM ('scheduled', 'cancelled');

-- CreateEnum
CREATE TYPE "ServiceAssignmentStatus" AS ENUM ('applied', 'confirmed', 'rejected', 'withdrawn', 'cancelled', 'attended', 'no_show');

-- CreateTable
CREATE TABLE "service_roles" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "required_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_opportunities" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "department_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "coordinator_member_id" UUID,
    "status" "ServiceOpportunityStatus" NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_shifts" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "opportunity_id" UUID NOT NULL,
    "role_id" UUID,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "activity_id" UUID,
    "status" "ServiceShiftStatus" NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_assignments" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "shift_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "status" "ServiceAssignmentStatus" NOT NULL,
    "note" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_roles_fellowship_id_name_key" ON "service_roles"("fellowship_id", "name");

-- CreateIndex
CREATE INDEX "service_opportunities_fellowship_id_status_idx" ON "service_opportunities"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "service_opportunities_department_id_idx" ON "service_opportunities"("department_id");

-- CreateIndex
CREATE INDEX "service_opportunities_coordinator_member_id_idx" ON "service_opportunities"("coordinator_member_id");

-- CreateIndex
CREATE INDEX "service_shifts_opportunity_id_starts_at_idx" ON "service_shifts"("opportunity_id", "starts_at");

-- CreateIndex
CREATE INDEX "service_shifts_fellowship_id_starts_at_idx" ON "service_shifts"("fellowship_id", "starts_at");

-- CreateIndex
CREATE INDEX "service_assignments_member_id_status_idx" ON "service_assignments"("member_id", "status");

-- CreateIndex
CREATE INDEX "service_assignments_fellowship_id_status_idx" ON "service_assignments"("fellowship_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_assignments_shift_id_member_id_key" ON "service_assignments"("shift_id", "member_id");

-- AddForeignKey
ALTER TABLE "service_opportunities" ADD CONSTRAINT "service_opportunities_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_opportunities" ADD CONSTRAINT "service_opportunities_coordinator_member_id_fkey" FOREIGN KEY ("coordinator_member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_shifts" ADD CONSTRAINT "service_shifts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "service_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_shifts" ADD CONSTRAINT "service_shifts_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "service_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_shifts" ADD CONSTRAINT "service_shifts_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_assignments" ADD CONSTRAINT "service_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "service_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_assignments" ADD CONSTRAINT "service_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Integrity rules the API also enforces (defence in depth)
ALTER TABLE "service_shifts" ADD CONSTRAINT "service_shifts_time_order_chk" CHECK ("ends_at" > "starts_at");
ALTER TABLE "service_shifts" ADD CONSTRAINT "service_shifts_capacity_chk" CHECK ("capacity" >= 1 AND "capacity" <= 1000);
