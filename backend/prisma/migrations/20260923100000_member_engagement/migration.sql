-- CreateEnum
CREATE TYPE "MembershipEventType" AS ENUM ('registered', 'status_changed', 'department_joined', 'department_transferred', 'department_removed');

-- CreateTable
CREATE TABLE "member_profiles" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "fellowship_id" UUID,
    "occupation" TEXT,
    "membership_date" TIMESTAMP(3),
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relationship" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_history" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "fellowship_id" UUID,
    "event_type" "MembershipEventType" NOT NULL,
    "from_status" "MembershipStatus",
    "to_status" "MembershipStatus",
    "department_id" UUID,
    "related_department_id" UUID,
    "reason" TEXT,
    "recorded_by" UUID,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_groups" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_group_members" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "fellowship_id" UUID,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" UUID,

    CONSTRAINT "member_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_member_id_key" ON "member_profiles"("member_id");

-- CreateIndex
CREATE INDEX "member_profiles_fellowship_id_idx" ON "member_profiles"("fellowship_id");

-- CreateIndex
CREATE INDEX "membership_history_member_id_occurred_at_idx" ON "membership_history"("member_id", "occurred_at");

-- CreateIndex
CREATE INDEX "membership_history_fellowship_id_occurred_at_idx" ON "membership_history"("fellowship_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_groups_fellowship_id_name_key" ON "member_groups"("fellowship_id", "name");

-- CreateIndex
CREATE INDEX "member_group_members_member_id_idx" ON "member_group_members"("member_id");

-- CreateIndex
CREATE INDEX "member_group_members_fellowship_id_idx" ON "member_group_members"("fellowship_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_group_members_group_id_member_id_key" ON "member_group_members"("group_id", "member_id");

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_history" ADD CONSTRAINT "membership_history_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_group_members" ADD CONSTRAINT "member_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "member_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_group_members" ADD CONSTRAINT "member_group_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: seed a baseline timeline for members that already exist.
-- Ids are derived with md5()::uuid so no extension (pgcrypto/uuid-ossp) is required.
-- Only what is knowable from the members table is backfilled: registration at created_at, and
-- (for non-active members) one active -> current-status transition. Older intermediate status
-- changes are not reconstructable here (they live only in audit_logs JSON) and are not guessed.
INSERT INTO "membership_history" ("id", "member_id", "fellowship_id", "event_type", "from_status", "to_status", "recorded_by", "occurred_at")
SELECT md5(m."id"::text || ':registered')::uuid, m."id", m."fellowship_id", 'registered', NULL, 'active', m."created_by", m."created_at"
FROM "members" m;

INSERT INTO "membership_history" ("id", "member_id", "fellowship_id", "event_type", "from_status", "to_status", "reason", "recorded_by", "occurred_at")
SELECT md5(m."id"::text || ':status_backfill')::uuid, m."id", m."fellowship_id", 'status_changed', 'active', m."membership_status", 'Backfilled from current status', m."status_changed_by", COALESCE(m."status_changed_at", m."updated_at")
FROM "members" m
WHERE m."membership_status" <> 'active';
