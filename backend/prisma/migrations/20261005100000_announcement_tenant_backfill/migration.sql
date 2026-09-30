UPDATE "announcements" AS announcement
SET "fellowship_id" = fellowship."fellowship_id"
FROM "users" AS fellowship
WHERE announcement."created_by" = fellowship."id"
  AND announcement."fellowship_id" IS NULL
  AND fellowship."fellowship_id" IS NOT NULL;
