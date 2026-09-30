-- Per-fellowship department and programme names.
--
-- `departments.name` and `programmes.name` were unique GLOBALLY, which is wrong for a multi-tenant system: only one
-- congregation in the whole platform could ever have a "Choir", a "Media" department or a "Worship" programme. The
-- seed had left twelve ownerless departments behind (fellowship_id IS NULL) that squatted on the most common names
-- a church would want, so in practice the Secretary could not create them at all.
--
-- Uniqueness therefore moves to (fellowship_id, name). The columns stay nullable in the schema, and Postgres treats
-- each NULL as distinct, so any number of unowned rows may coexist - the same behaviour as before for orphans.

-- 1. Remove the ownerless seed departments, but only those nothing refers to. The NOT EXISTS guards mirror the
--    foreign keys that point at departments: two of them cascade, so an unguarded DELETE here could silently take
--    members with it. Anything that IS referenced is left alone and reported instead.
DELETE FROM "departments" d
WHERE d."fellowship_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "department_members"  dm WHERE dm."department_id" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "department_leaders"  dl WHERE dl."department_id" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "youth_profiles"     yp WHERE yp."department_id" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "assets"              a WHERE a."owning_department_id" = d."id")
  AND NOT EXISTS (SELECT 1 FROM "service_opportunities" s WHERE s."department_id" = d."id");

-- Anything the guards refused to delete is still squatting a name; say so rather than failing the migration.
DO $$
DECLARE leftover TEXT;
BEGIN
  SELECT string_agg(name, ', ') INTO leftover
  FROM "departments" WHERE "fellowship_id" IS NULL;
  IF leftover IS NOT NULL THEN
    RAISE NOTICE 'departments still unowned (referenced, so kept): %', leftover;
  END IF;
END $$;

-- 2. Swap global uniqueness for per-fellowship uniqueness.
DROP INDEX IF EXISTS "departments_name_key";
CREATE UNIQUE INDEX "departments_fellowship_id_name_key" ON "departments"("fellowship_id", "name");

DROP INDEX IF EXISTS "programmes_name_key";
CREATE UNIQUE INDEX "programmes_fellowship_id_name_key" ON "programmes"("fellowship_id", "name");
