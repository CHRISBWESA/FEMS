-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "youth_profile_id" UUID;

-- CreateTable
CREATE TABLE "age_groups" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "min_age" INTEGER NOT NULL,
    "max_age" INTEGER NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "age_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youth_profiles" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "member_id" UUID,
    "full_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "age_group_id" UUID,
    "department_id" UUID,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youth_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "youth_guardians" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "youth_id" UUID NOT NULL,
    "guardian_member_id" UUID NOT NULL,
    "relationship_type" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "consent_status" TEXT NOT NULL DEFAULT 'granted',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youth_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "age_groups_fellowship_id_idx" ON "age_groups"("fellowship_id");

-- CreateIndex
CREATE UNIQUE INDEX "youth_profiles_member_id_key" ON "youth_profiles"("member_id");

-- CreateIndex
CREATE INDEX "youth_profiles_fellowship_id_idx" ON "youth_profiles"("fellowship_id");

-- CreateIndex
CREATE INDEX "youth_profiles_department_id_idx" ON "youth_profiles"("department_id");

-- CreateIndex
CREATE INDEX "youth_profiles_age_group_id_idx" ON "youth_profiles"("age_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "youth_guardians_youth_id_guardian_member_id_key" ON "youth_guardians"("youth_id", "guardian_member_id");

-- CreateIndex
CREATE INDEX "youth_guardians_fellowship_id_idx" ON "youth_guardians"("fellowship_id");

-- CreateIndex
CREATE INDEX "youth_guardians_guardian_member_id_idx" ON "youth_guardians"("guardian_member_id");

-- CreateIndex
CREATE INDEX "attendance_youth_profile_id_idx" ON "attendance"("youth_profile_id");

-- AddForeignKey
ALTER TABLE "youth_profiles" ADD CONSTRAINT "youth_profiles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youth_profiles" ADD CONSTRAINT "youth_profiles_age_group_id_fkey" FOREIGN KEY ("age_group_id") REFERENCES "age_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youth_profiles" ADD CONSTRAINT "youth_profiles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youth_guardians" ADD CONSTRAINT "youth_guardians_youth_id_fkey" FOREIGN KEY ("youth_id") REFERENCES "youth_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "youth_guardians" ADD CONSTRAINT "youth_guardians_guardian_member_id_fkey" FOREIGN KEY ("guardian_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_youth_profile_id_fkey" FOREIGN KEY ("youth_profile_id") REFERENCES "youth_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
