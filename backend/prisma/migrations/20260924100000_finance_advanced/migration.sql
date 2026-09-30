-- CreateEnum
CREATE TYPE "FinanceCategoryKind" AS ENUM ('contribution', 'income', 'expense');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "PledgeFrequency" AS ENUM ('one_time', 'weekly', 'monthly', 'quarterly', 'yearly');

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "campaign_id" UUID,
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "receipt_document_id" UUID;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "receipt_document_id" UUID;

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "kind" "FinanceCategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_campaigns" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "target_amount" DECIMAL(12,2),
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'active',
    "department_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_records" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "category_id" UUID,
    "campaign_id" UUID,
    "department_id" UUID,
    "receipt_document_id" UUID,
    "recorded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "closed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_pledges" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "member_id" UUID NOT NULL,
    "campaign_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "PledgeFrequency" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_pledges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_request_releases" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "money_request_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "receipt_document_id" UUID,
    "released_by" UUID NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_request_releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_fellowship_id_kind_name_key" ON "finance_categories"("fellowship_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_campaigns_fellowship_id_name_key" ON "contribution_campaigns"("fellowship_id", "name");

-- CreateIndex
CREATE INDEX "income_records_fellowship_id_date_idx" ON "income_records"("fellowship_id", "date");

-- CreateIndex
CREATE INDEX "financial_periods_fellowship_id_start_date_idx" ON "financial_periods"("fellowship_id", "start_date");

-- CreateIndex
CREATE INDEX "contribution_pledges_fellowship_id_idx" ON "contribution_pledges"("fellowship_id");

-- CreateIndex
CREATE INDEX "contribution_pledges_member_id_idx" ON "contribution_pledges"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_request_releases_money_request_id_key" ON "money_request_releases"("money_request_id");

-- CreateIndex
CREATE INDEX "money_request_releases_fellowship_id_released_at_idx" ON "money_request_releases"("fellowship_id", "released_at");

-- CreateIndex
CREATE INDEX "contributions_member_id_date_idx" ON "contributions"("member_id", "date");

-- CreateIndex
CREATE INDEX "contributions_campaign_id_idx" ON "contributions"("campaign_id");

-- CreateIndex
CREATE INDEX "expenses_department_id_date_idx" ON "expenses"("department_id", "date");

-- CreateIndex
CREATE INDEX "money_requests_department_id_idx" ON "money_requests"("department_id");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "contribution_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_records" ADD CONSTRAINT "income_records_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_records" ADD CONSTRAINT "income_records_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "contribution_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_pledges" ADD CONSTRAINT "contribution_pledges_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_pledges" ADD CONSTRAINT "contribution_pledges_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "contribution_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_request_releases" ADD CONSTRAINT "money_request_releases_money_request_id_fkey" FOREIGN KEY ("money_request_id") REFERENCES "money_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

