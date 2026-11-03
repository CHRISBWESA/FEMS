-- Contribution Drives: an event / project / activity / outreach / membership drive that people pledge or give cash to.
-- Additive only: drives reuse the existing contribution_campaigns table; nothing is dropped or rewritten.
ALTER TABLE "contribution_campaigns" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'event';

-- A drive's own spending.
ALTER TABLE "expenses" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "contribution_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "expenses_campaign_id_idx" ON "expenses"("campaign_id");
