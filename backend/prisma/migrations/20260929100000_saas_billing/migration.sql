-- CreateEnum
CREATE TYPE "SaasBillingInterval" AS ENUM ('month', 'year');

-- CreateEnum
CREATE TYPE "SaasSubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "SaasInvoiceStatus" AS ENUM ('open', 'paid', 'void');

-- CreateEnum
CREATE TYPE "SaasWebhookStatus" AS ENUM ('received', 'processed', 'failed');

-- CreateTable
CREATE TABLE "saas_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billing_interval" "SaasBillingInterval" NOT NULL DEFAULT 'month',
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_subscriptions" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SaasSubscriptionStatus" NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "past_due_since" TIMESTAMP(3),
    "provider" TEXT,
    "provider_customer_ref" TEXT,
    "provider_subscription_ref" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saas_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_invoices" (
    "id" UUID NOT NULL,
    "number_seq" SERIAL NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_name" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "SaasInvoiceStatus" NOT NULL DEFAULT 'open',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payment_method" TEXT,
    "payment_reference" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_by" UUID NOT NULL,

    CONSTRAINT "saas_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_subscription_events" (
    "id" UUID NOT NULL,
    "fellowship_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "SaasSubscriptionStatus",
    "to_status" "SaasSubscriptionStatus",
    "from_plan_id" UUID,
    "to_plan_id" UUID,
    "actor_id" UUID,
    "note" TEXT,
    "provider_event_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saas_subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" "SaasWebhookStatus" NOT NULL DEFAULT 'received',
    "error" TEXT,
    "fellowship_id" UUID,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "saas_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saas_plans_code_key" ON "saas_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "saas_subscriptions_fellowship_id_key" ON "saas_subscriptions"("fellowship_id");

-- CreateIndex
CREATE INDEX "saas_subscriptions_status_idx" ON "saas_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "saas_invoices_number_seq_key" ON "saas_invoices"("number_seq");

-- CreateIndex
CREATE INDEX "saas_invoices_fellowship_id_status_idx" ON "saas_invoices"("fellowship_id", "status");

-- CreateIndex
CREATE INDEX "saas_invoices_status_due_at_idx" ON "saas_invoices"("status", "due_at");

-- CreateIndex
CREATE INDEX "saas_subscription_events_fellowship_id_occurred_at_idx" ON "saas_subscription_events"("fellowship_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "saas_webhook_events_provider_event_id_key" ON "saas_webhook_events"("provider", "event_id");

-- AddForeignKey
ALTER TABLE "saas_subscriptions" ADD CONSTRAINT "saas_subscriptions_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_subscriptions" ADD CONSTRAINT "saas_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "saas_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_fellowship_id_fkey" FOREIGN KEY ("fellowship_id") REFERENCES "fellowships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "saas_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules the API also enforces (defence in depth)
ALTER TABLE "saas_plans" ADD CONSTRAINT "saas_plans_price_chk" CHECK ("price_amount" >= 0);
ALTER TABLE "saas_plans" ADD CONSTRAINT "saas_plans_trial_chk" CHECK ("trial_days" >= 0 AND "trial_days" <= 365);
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "saas_invoices" ADD CONSTRAINT "saas_invoices_period_chk" CHECK ("period_end" > "period_start");
