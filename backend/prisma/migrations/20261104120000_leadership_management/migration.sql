-- Leadership management: configurable positions and the central appointment record (current and history).
-- Additive only. Existing department, group and fellowship leaders are brought in as appointments.

-- AlterTable
ALTER TABLE "members" ADD COLUMN     "photo_url" TEXT;

-- CreateTable
CREATE TABLE "leadership_positions" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "system_role" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leadership_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leadership_appointments" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "member_id" UUID,
    "member_name" TEXT NOT NULL,
    "member_code" TEXT,
    "level" TEXT NOT NULL,
    "department_id" UUID,
    "group_id" UUID,
    "appointment_date" TIMESTAMP(3) NOT NULL,
    "term_start" TIMESTAMP(3) NOT NULL,
    "term_end" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "active_key" TEXT,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "end_notes" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "notes" TEXT,
    "appointed_by" UUID,
    "ended_by" UUID,
    "source" TEXT NOT NULL DEFAULT 'leadership',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leadership_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leadership_positions_fellowship_id_key_key" ON "leadership_positions"("fellowship_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "leadership_appointments_active_key_key" ON "leadership_appointments"("active_key");

-- CreateIndex
CREATE INDEX "leadership_appointments_fellowship_id_status_idx" ON "leadership_appointments"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "leadership_appointments_member_id_idx" ON "leadership_appointments"("member_id");

-- CreateIndex
CREATE INDEX "leadership_appointments_position_id_idx" ON "leadership_appointments"("position_id");

-- CreateIndex
CREATE INDEX "leadership_appointments_department_id_idx" ON "leadership_appointments"("department_id");

-- CreateIndex
CREATE INDEX "leadership_appointments_group_id_idx" ON "leadership_appointments"("group_id");

-- AddForeignKey
ALTER TABLE "leadership_appointments" ADD CONSTRAINT "leadership_appointments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "leadership_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leadership_appointments" ADD CONSTRAINT "leadership_appointments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------------
-- The built-in FEMS offices (shared by every fellowship).
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO "leadership_positions" ("id", "fellowship_id", "key", "name", "level", "system_role", "is_system", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), NULL, 'chairperson', 'Fellowship Chairperson', 'fellowship', 'chairperson', true, 10, now()),
  (gen_random_uuid(), NULL, 'assistant_chairperson', 'Assistant Chairperson', 'fellowship', 'assistant_chairperson', true, 20, now()),
  (gen_random_uuid(), NULL, 'secretary', 'Fellowship Secretary', 'fellowship', 'secretary', true, 30, now()),
  (gen_random_uuid(), NULL, 'assistant_secretary', 'Assistant Secretary', 'fellowship', 'assistant_secretary', true, 40, now()),
  (gen_random_uuid(), NULL, 'treasurer', 'Fellowship Treasurer', 'fellowship', 'treasurer', true, 50, now()),
  (gen_random_uuid(), NULL, 'department_chairperson', 'Department Chairperson', 'department', 'department_chairperson', true, 60, now()),
  (gen_random_uuid(), NULL, 'department_secretary', 'Department Secretary', 'department', 'department_secretary', true, 70, now()),
  (gen_random_uuid(), NULL, 'group_male_leader', 'Group Male Leader', 'group', 'male_leader', true, 80, now()),
  (gen_random_uuid(), NULL, 'group_female_leader', 'Group Female Leader', 'group', 'female_leader', true, 90, now());

-- ---------------------------------------------------------------------------------------------------------
-- Existing leaders become appointments, so nothing has to be entered again.
-- ---------------------------------------------------------------------------------------------------------

-- Department offices, current and past (department_leaders already keeps the history).
INSERT INTO "leadership_appointments" ("id", "fellowship_id", "position_id", "member_id", "member_name", "member_code", "level",
  "department_id", "appointment_date", "term_start", "status", "active_key", "ended_at", "end_reason", "end_notes",
  "appointed_by", "ended_by", "source", "updated_at")
SELECT gen_random_uuid(), d."fellowship_id", p."id", m."id", m."full_name", m."member_code", 'department',
  dl."department_id", dl."start_date", dl."start_date",
  CASE WHEN dl."active_role" IS NOT NULL THEN 'active' ELSE 'former' END,
  CASE WHEN dl."active_role" IS NOT NULL THEN d."fellowship_id"::text || ':' || p."id"::text || ':' || dl."department_id"::text END,
  CASE WHEN dl."active_role" IS NULL THEN COALESCE(dl."end_date", dl."start_date") END,
  CASE WHEN dl."active_role" IS NULL THEN (CASE WHEN dl."end_reason" = 'replaced' THEN 'replaced' ELSE 'other' END) END,
  CASE WHEN dl."active_role" IS NULL THEN dl."end_reason" END,
  dl."appointed_by", dl."ended_by", 'migration', now()
FROM "department_leaders" dl
JOIN "departments" d ON d."id" = dl."department_id"
JOIN "members" m ON m."id" = dl."member_id"
JOIN "leadership_positions" p ON p."fellowship_id" IS NULL AND p."key" = dl."role_in_department"
WHERE d."fellowship_id" IS NOT NULL
ON CONFLICT ("active_key") DO NOTHING;

-- Current group leaders.
INSERT INTO "leadership_appointments" ("id", "fellowship_id", "position_id", "member_id", "member_name", "member_code", "level",
  "group_id", "appointment_date", "term_start", "status", "active_key", "source", "updated_at")
SELECT gen_random_uuid(), g."fellowship_id", p."id", m."id", m."full_name", m."member_code", 'group',
  gm."group_id", gm."joined_at", gm."joined_at", 'active',
  g."fellowship_id"::text || ':' || p."id"::text || ':' || gm."group_id"::text, 'migration', now()
FROM "member_group_members" gm
JOIN "member_groups" g ON g."id" = gm."group_id"
JOIN "members" m ON m."id" = gm."member_id"
JOIN "leadership_positions" p ON p."fellowship_id" IS NULL AND p."system_role" = gm."leader_role"
WHERE gm."leader_role" IS NOT NULL AND g."fellowship_id" IS NOT NULL
ON CONFLICT ("active_key") DO NOTHING;

-- Current fellowship officers (accounts holding an office, linked to their member record). If two accounts hold
-- the same office, the earliest is recorded and the other is left for the Fellowship Administrator to resolve.
INSERT INTO "leadership_appointments" ("id", "fellowship_id", "position_id", "member_id", "member_name", "member_code", "level",
  "appointment_date", "term_start", "status", "active_key", "source", "updated_at")
SELECT gen_random_uuid(), u."fellowship_id", p."id", m."id", m."full_name", m."member_code", 'fellowship',
  u."created_at", u."created_at", 'active',
  u."fellowship_id"::text || ':' || p."id"::text || ':fellowship', 'migration', now()
FROM (SELECT * FROM "users" ORDER BY "created_at") u
JOIN "members" m ON m."user_id" = u."id"
JOIN "leadership_positions" p ON p."fellowship_id" IS NULL AND p."level" = 'fellowship' AND p."system_role" = ANY(u."roles")
WHERE u."fellowship_id" IS NOT NULL AND u."is_active" = true AND u."deleted_at" IS NULL
ON CONFLICT ("active_key") DO NOTHING;
