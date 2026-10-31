-- Finance, projects and department financial management: accounts, an immutable ledger, transfers, projects,
-- allocations, membership fees, line-item budgets, revisions, budget calls and fundraising pages.
-- Additive only: no table or column is dropped, and no existing value is changed except to add ledger links.

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('cash', 'bank', 'mobile_money', 'other');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('opening_balance', 'contribution', 'income', 'expense', 'transfer_in', 'transfer_out', 'reversal', 'adjustment');

-- CreateEnum
CREATE TYPE "ContributorType" AS ENUM ('member', 'external', 'anonymous');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'RETURNED', 'APPROVED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FeeFrequency" AS ENUM ('monthly', 'semester', 'annual', 'one_time', 'custom');

-- CreateEnum
CREATE TYPE "PledgeStatus" AS ENUM ('pending', 'partially_fulfilled', 'fulfilled', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignStatus" ADD VALUE 'draft';
ALTER TYPE "CampaignStatus" ADD VALUE 'paused';

-- DropForeignKey
ALTER TABLE "contribution_pledges" DROP CONSTRAINT "contribution_pledges_member_id_fkey";

-- DropForeignKey
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_member_id_fkey";

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "activity_id" UUID,
ADD COLUMN     "budget_call_id" UUID,
ADD COLUMN     "budget_number" TEXT,
ADD COLUMN     "budget_type" TEXT NOT NULL DEFAULT 'annual',
ADD COLUMN     "period_end" TIMESTAMP(3),
ADD COLUMN     "period_start" TIMESTAMP(3),
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "contribution_campaigns" ADD COLUMN     "budget_breakdown" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "is_public" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "public_slug" TEXT,
ADD COLUMN     "published_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contribution_pledges" ADD COLUMN     "amount_fulfilled" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "contributor_name" TEXT,
ADD COLUMN     "contributor_phone" TEXT,
ADD COLUMN     "contributor_type" "ContributorType" NOT NULL DEFAULT 'member',
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "due_date" TIMESTAMP(3),
ADD COLUMN     "last_reminded_at" TIMESTAMP(3),
ADD COLUMN     "pledge_number" TEXT,
ADD COLUMN     "pledged_at" TIMESTAMP(3),
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "status" "PledgeStatus" NOT NULL DEFAULT 'pending',
ALTER COLUMN "member_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "contributor_email" TEXT,
ADD COLUMN     "contributor_name" TEXT,
ADD COLUMN     "contributor_phone" TEXT,
ADD COLUMN     "contributor_type" "ContributorType" NOT NULL DEFAULT 'member',
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "membership_fee_id" UUID,
ADD COLUMN     "payment_dedupe_key" TEXT,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "payment_reference" TEXT,
ADD COLUMN     "pledge_applied" DECIMAL(12,2),
ADD COLUMN     "pledge_id" UUID,
ADD COLUMN     "receipt_number" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ALTER COLUMN "member_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "activity_id" UUID,
ADD COLUMN     "already_incurred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "amount_approved" DECIMAL(12,2),
ADD COLUMN     "amount_paid" DECIMAL(12,2),
ADD COLUMN     "attachments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "budget_id" UUID,
ADD COLUMN     "budget_line_id" UUID,
ADD COLUMN     "expense_number" TEXT,
ADD COLUMN     "money_request_id" UUID,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "paid_by" UUID,
ADD COLUMN     "payee" TEXT,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "payment_reference" TEXT,
ADD COLUMN     "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" UUID,
ADD COLUMN     "verified_at" TIMESTAMP(3),
ADD COLUMN     "verified_by" UUID;

-- AlterTable
ALTER TABLE "financial_periods" ADD COLUMN     "closure_status" TEXT,
ADD COLUMN     "closure_workflow_id" UUID,
ADD COLUMN     "period_type" TEXT NOT NULL DEFAULT 'custom',
ADD COLUMN     "reopen_reason" TEXT,
ADD COLUMN     "reopened_at" TIMESTAMP(3),
ADD COLUMN     "reopened_by" UUID;

-- AlterTable
ALTER TABLE "income_records" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "funding_source" TEXT,
ADD COLUMN     "payment_method" TEXT,
ADD COLUMN     "payment_reference" TEXT,
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "receipt_number" TEXT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "reversed_by" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "money_request_releases" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "expense_id" UUID;

-- AlterTable
ALTER TABLE "money_requests" ADD COLUMN     "budget_id" UUID,
ADD COLUMN     "budget_line_id" UUID,
ADD COLUMN     "preferred_payment_method" TEXT,
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "request_number" TEXT,
ADD COLUMN     "required_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "finance_settings" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "receipt_prefix" TEXT NOT NULL DEFAULT 'RCT',
    "major_expense_threshold" DECIMAL(12,2),
    "budget_warning_percent" INTEGER NOT NULL DEFAULT 80,
    "financial_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "payment_methods" TEXT[] DEFAULT ARRAY['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other']::TEXT[],
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_counters" (
    "fellowship_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "finance_counters_pkey" PRIMARY KEY ("fellowship_id","key","year")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "department_id" UUID,
    "name" TEXT NOT NULL,
    "account_type" "FinancialAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "reference" TEXT,
    "description" TEXT,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "default_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_reconciled_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "department_id" UUID,
    "project_id" UUID,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balance_after" DECIMAL(14,2) NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "dedupe_key" TEXT,
    "reverses_entry_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transfers" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transfer_date" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_workflow_id" UUID,
    "recorded_by" UUID NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_reconciliations" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "statement_date" TIMESTAMP(3) NOT NULL,
    "statement_balance" DECIMAL(14,2) NOT NULL,
    "system_balance" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "adjustment_entry_id" UUID,
    "notes" TEXT,
    "reconciled_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "project_number" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'fellowship',
    "department_id" UUID,
    "coordinating_department_id" UUID,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "description" TEXT,
    "project_type" TEXT,
    "coordinator_member_id" UUID,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "location" TEXT,
    "budget_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_workflow_id" UUID,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "closure_workflow_id" UUID,
    "closure_status" TEXT,
    "final_report" TEXT,
    "unspent_disposition" TEXT,
    "carry_forward_project_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_funding_sources" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expected_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_funding_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_allocations" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "contribution_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ended_by" UUID,
    "end_reason" TEXT,

    CONSTRAINT "contribution_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_allocations" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "allocation_number" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approval_workflow_id" UUID,
    "related_project_id" UUID,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_updates" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "campaign_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_line_items" (
    "id" UUID NOT NULL,
    "budget_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_revisions" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID,
    "budget_id" UUID NOT NULL,
    "from_version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "proposed_lines" JSONB NOT NULL,
    "proposed_amount" DECIMAL(14,2) NOT NULL,
    "previous_lines" JSONB,
    "previous_amount" DECIMAL(14,2),
    "status" "ApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "approval_workflow_id" UUID,
    "created_by" UUID NOT NULL,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_calls" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "instructions" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "all_departments" BOOLEAN NOT NULL DEFAULT true,
    "department_ids" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_fees" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "frequency" "FeeFrequency" NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "due_dates" JSONB NOT NULL DEFAULT '[]',
    "eligible_member_ids" JSONB,
    "allow_partial" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_fellowship_id_key" ON "finance_settings"("fellowship_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_default_key_key" ON "financial_accounts"("default_key");

-- CreateIndex
CREATE INDEX "financial_accounts_fellowship_id_department_id_idx" ON "financial_accounts"("fellowship_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_dedupe_key_key" ON "ledger_entries"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_reverses_entry_id_key" ON "ledger_entries"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "ledger_entries_fellowship_id_entry_date_idx" ON "ledger_entries"("fellowship_id", "entry_date");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_entry_date_idx" ON "ledger_entries"("account_id", "entry_date");

-- CreateIndex
CREATE INDEX "ledger_entries_source_type_source_id_idx" ON "ledger_entries"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "ledger_entries_department_id_entry_date_idx" ON "ledger_entries"("department_id", "entry_date");

-- CreateIndex
CREATE INDEX "ledger_entries_project_id_idx" ON "ledger_entries"("project_id");

-- CreateIndex
CREATE INDEX "financial_transfers_from_account_id_idx" ON "financial_transfers"("from_account_id");

-- CreateIndex
CREATE INDEX "financial_transfers_to_account_id_idx" ON "financial_transfers"("to_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transfers_fellowship_id_transfer_number_key" ON "financial_transfers"("fellowship_id", "transfer_number");

-- CreateIndex
CREATE INDEX "account_reconciliations_account_id_statement_date_idx" ON "account_reconciliations"("account_id", "statement_date");

-- CreateIndex
CREATE INDEX "projects_fellowship_id_status_idx" ON "projects"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "projects_department_id_idx" ON "projects"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_fellowship_id_project_number_key" ON "projects"("fellowship_id", "project_number");

-- CreateIndex
CREATE INDEX "project_funding_sources_project_id_idx" ON "project_funding_sources"("project_id");

-- CreateIndex
CREATE INDEX "contribution_allocations_contribution_id_is_active_idx" ON "contribution_allocations"("contribution_id", "is_active");

-- CreateIndex
CREATE INDEX "contribution_allocations_project_id_is_active_idx" ON "contribution_allocations"("project_id", "is_active");

-- CreateIndex
CREATE INDEX "project_allocations_project_id_idx" ON "project_allocations"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_allocations_fellowship_id_allocation_number_key" ON "project_allocations"("fellowship_id", "allocation_number");

-- CreateIndex
CREATE INDEX "campaign_updates_campaign_id_created_at_idx" ON "campaign_updates"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "budget_line_items_budget_id_idx" ON "budget_line_items"("budget_id");

-- CreateIndex
CREATE INDEX "budget_revisions_budget_id_idx" ON "budget_revisions"("budget_id");

-- CreateIndex
CREATE INDEX "budget_calls_fellowship_id_status_idx" ON "budget_calls"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "membership_fees_department_id_is_active_idx" ON "membership_fees"("department_id", "is_active");

-- CreateIndex
CREATE INDEX "budgets_department_id_idx" ON "budgets"("department_id");

-- CreateIndex
CREATE INDEX "budgets_project_id_idx" ON "budgets"("project_id");

-- CreateIndex
CREATE INDEX "budgets_budget_call_id_idx" ON "budgets"("budget_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_fellowship_id_budget_number_key" ON "budgets"("fellowship_id", "budget_number");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_campaigns_public_slug_key" ON "contribution_campaigns"("public_slug");

-- CreateIndex
CREATE INDEX "contribution_campaigns_project_id_idx" ON "contribution_campaigns"("project_id");

-- CreateIndex
CREATE INDEX "contribution_pledges_project_id_idx" ON "contribution_pledges"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_pledges_fellowship_id_pledge_number_key" ON "contribution_pledges"("fellowship_id", "pledge_number");

-- CreateIndex
CREATE INDEX "contributions_department_id_date_idx" ON "contributions"("department_id", "date");

-- CreateIndex
CREATE INDEX "contributions_pledge_id_idx" ON "contributions"("pledge_id");

-- CreateIndex
CREATE INDEX "contributions_membership_fee_id_idx" ON "contributions"("membership_fee_id");

-- CreateIndex
CREATE INDEX "contributions_account_id_idx" ON "contributions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_fellowship_id_receipt_number_key" ON "contributions"("fellowship_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_fellowship_id_payment_dedupe_key_key" ON "contributions"("fellowship_id", "payment_dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_money_request_id_key" ON "expenses"("money_request_id");

-- CreateIndex
CREATE INDEX "expenses_project_id_idx" ON "expenses"("project_id");

-- CreateIndex
CREATE INDEX "expenses_budget_id_idx" ON "expenses"("budget_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_fellowship_id_expense_number_key" ON "expenses"("fellowship_id", "expense_number");

-- CreateIndex
CREATE INDEX "income_records_project_id_idx" ON "income_records"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "income_records_fellowship_id_receipt_number_key" ON "income_records"("fellowship_id", "receipt_number");

-- CreateIndex
CREATE INDEX "money_requests_project_id_idx" ON "money_requests"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_requests_fellowship_id_request_number_key" ON "money_requests"("fellowship_id", "request_number");

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_records" ADD CONSTRAINT "income_records_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_pledges" ADD CONSTRAINT "contribution_pledges_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transfers" ADD CONSTRAINT "financial_transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_reconciliations" ADD CONSTRAINT "account_reconciliations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_funding_sources" ADD CONSTRAINT "project_funding_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_allocations" ADD CONSTRAINT "contribution_allocations_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_allocations" ADD CONSTRAINT "contribution_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_allocations" ADD CONSTRAINT "project_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_updates" ADD CONSTRAINT "campaign_updates_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "contribution_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_line_items" ADD CONSTRAINT "budget_line_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_revisions" ADD CONSTRAINT "budget_revisions_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================================================
-- Data: bring the money already recorded into the ledger, so every account balance is explained by its entries.
-- A default central "Cash in hand" account is created for each fellowship that already has recorded money.
-- ============================================================================================================
INSERT INTO "financial_accounts" ("id", "fellowship_id", "name", "account_type", "currency", "opening_balance", "balance",
  "is_default", "default_key", "is_active", "description", "created_by", "created_at", "updated_at")
SELECT gen_random_uuid(), f.fid, 'Cash in hand', 'cash', 'TZS', 0, 0, true, f.fid::text || ':central', true,
  'Created automatically for money recorded before accounts existed.', '00000000-0000-0000-0000-000000000000', now(), now()
FROM (
  SELECT DISTINCT "fellowship_id" AS fid FROM "contributions" WHERE "fellowship_id" IS NOT NULL
  UNION SELECT DISTINCT "fellowship_id" FROM "income_records" WHERE "fellowship_id" IS NOT NULL
  UNION SELECT DISTINCT "fellowship_id" FROM "money_request_releases" WHERE "fellowship_id" IS NOT NULL
) f;

-- Reference numbers for existing records ("L" marks a number given during this migration).
UPDATE "contributions" SET "receipt_number" = 'RCT-' || to_char("date", 'YYYY') || '-L' || upper(substr(replace("id"::text, '-', ''), 1, 8))
  WHERE "receipt_number" IS NULL;
UPDATE "income_records" SET "receipt_number" = 'INC-' || to_char("date", 'YYYY') || '-L' || upper(substr(replace("id"::text, '-', ''), 1, 8))
  WHERE "receipt_number" IS NULL;
UPDATE "expenses" SET "expense_number" = 'EXP-' || to_char("date", 'YYYY') || '-L' || upper(substr(replace("id"::text, '-', ''), 1, 8))
  WHERE "expense_number" IS NULL;
UPDATE "money_requests" SET "request_number" = 'MR-' || to_char("created_at", 'YYYY') || '-L' || upper(substr(replace("id"::text, '-', ''), 1, 8))
  WHERE "request_number" IS NULL;
UPDATE "budgets" SET "budget_number" = 'BGT-' || to_char("created_at", 'YYYY') || '-L' || upper(substr(replace("id"::text, '-', ''), 1, 8))
  WHERE "budget_number" IS NULL;
UPDATE "budgets" SET "budget_type" = 'department' WHERE "department_id" IS NOT NULL;

-- Ledger entries for existing contributions, other income and money-request payouts.
INSERT INTO "ledger_entries" ("id", "fellowship_id", "account_id", "entry_type", "amount", "balance_after", "entry_date",
  "source_type", "source_id", "reference", "description", "dedupe_key", "created_by", "created_at")
SELECT gen_random_uuid(), c."fellowship_id", a."id", 'contribution', c."amount", 0, c."date", 'contribution', c."id",
  c."receipt_number", 'Recorded before the ledger was introduced', 'contribution:' || c."id"::text || ':contribution', c."recorded_by", now()
FROM "contributions" c JOIN "financial_accounts" a ON a."default_key" = c."fellowship_id"::text || ':central';

INSERT INTO "ledger_entries" ("id", "fellowship_id", "account_id", "department_id", "entry_type", "amount", "balance_after", "entry_date",
  "source_type", "source_id", "reference", "description", "dedupe_key", "created_by", "created_at")
SELECT gen_random_uuid(), i."fellowship_id", a."id", NULL, 'income', i."amount", 0, i."date", 'income', i."id",
  i."receipt_number", 'Recorded before the ledger was introduced', 'income:' || i."id"::text || ':income', i."recorded_by", now()
FROM "income_records" i JOIN "financial_accounts" a ON a."default_key" = i."fellowship_id"::text || ':central';

INSERT INTO "ledger_entries" ("id", "fellowship_id", "account_id", "entry_type", "amount", "balance_after", "entry_date",
  "source_type", "source_id", "reference", "description", "dedupe_key", "created_by", "created_at")
SELECT gen_random_uuid(), r."fellowship_id", a."id", 'expense', -r."amount", 0, r."released_at", 'money_request_release', r."id",
  r."reference", 'Released before the ledger was introduced', 'money_request_release:' || r."id"::text || ':expense', r."released_by", now()
FROM "money_request_releases" r JOIN "financial_accounts" a ON a."default_key" = r."fellowship_id"::text || ':central';

UPDATE "contributions" c SET "account_id" = a."id" FROM "financial_accounts" a
  WHERE a."default_key" = c."fellowship_id"::text || ':central' AND c."account_id" IS NULL;
UPDATE "income_records" i SET "account_id" = a."id" FROM "financial_accounts" a
  WHERE a."default_key" = i."fellowship_id"::text || ':central' AND i."account_id" IS NULL;
UPDATE "money_request_releases" r SET "account_id" = a."id" FROM "financial_accounts" a
  WHERE a."default_key" = r."fellowship_id"::text || ':central' AND r."account_id" IS NULL;

-- Running balances and the account balance, both derived from the entries.
UPDATE "ledger_entries" l SET "balance_after" = x.running
FROM (SELECT "id", SUM("amount") OVER (PARTITION BY "account_id" ORDER BY "entry_date", "created_at", "id") AS running FROM "ledger_entries") x
WHERE x."id" = l."id";
UPDATE "financial_accounts" a SET "balance" = COALESCE((SELECT SUM(l."amount") FROM "ledger_entries" l WHERE l."account_id" = a."id"), 0);
