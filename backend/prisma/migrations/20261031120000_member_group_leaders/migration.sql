-- Group leadership: each member group may have one male leader and one female leader.
--
-- Leadership is stored on the membership row itself, so a leader is always a member of the group and removing
-- someone from the group (or deleting the member, which cascades) clears their leadership with no extra step.
-- Additive only: existing rows get NULL (no leadership) and nothing else changes.

ALTER TABLE "member_group_members" ADD COLUMN "leader_role" TEXT;

-- Only the two known values. Prisma does not manage CHECK constraints, so this adds no schema drift.
ALTER TABLE "member_group_members"
  ADD CONSTRAINT "member_group_members_leader_role_check"
  CHECK ("leader_role" IS NULL OR "leader_role" IN ('male_leader', 'female_leader'));

-- One holder per role per group. Postgres treats NULLs as distinct, so ordinary members are unaffected.
CREATE UNIQUE INDEX "member_group_members_group_id_leader_role_key"
  ON "member_group_members"("group_id", "leader_role");
