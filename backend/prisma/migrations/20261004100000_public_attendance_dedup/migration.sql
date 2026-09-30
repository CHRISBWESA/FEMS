ALTER TABLE "attendance" ADD COLUMN "public_checkin_key" VARCHAR(300);

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "activity_id", lower(btrim(regexp_replace(regexp_replace("recorded_by_name", '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')))
      ORDER BY "recorded_at" ASC, "id" ASC
    ) AS row_number
  FROM "attendance"
  WHERE "member_id" IS NULL
    AND "youth_profile_id" IS NULL
    AND "recorded_by_name" IS NOT NULL
)
UPDATE "attendance" AS attendance
SET "public_checkin_key" = lower(btrim(regexp_replace(regexp_replace(attendance."recorded_by_name", '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g')))
FROM ranked
WHERE attendance."id" = ranked."id"
  AND ranked."row_number" = 1;

CREATE UNIQUE INDEX "attendance_public_checkin_key_key"
ON "attendance" ("activity_id", "public_checkin_key")
WHERE "public_checkin_key" IS NOT NULL;
