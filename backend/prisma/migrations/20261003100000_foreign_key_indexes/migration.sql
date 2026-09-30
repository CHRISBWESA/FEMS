-- CreateIndex
CREATE INDEX "approval_steps_approval_id_idx" ON "approval_steps"("approval_id");

-- CreateIndex
CREATE INDEX "contribution_pledges_campaign_id_idx" ON "contribution_pledges"("campaign_id");

-- CreateIndex
CREATE INDEX "contributions_category_id_idx" ON "contributions"("category_id");

-- CreateIndex
CREATE INDEX "department_leaders_department_id_idx" ON "department_leaders"("department_id");

-- CreateIndex
CREATE INDEX "department_members_member_id_idx" ON "department_members"("member_id");

-- CreateIndex
CREATE INDEX "expenses_category_id_idx" ON "expenses"("category_id");

-- CreateIndex
CREATE INDEX "income_records_campaign_id_idx" ON "income_records"("campaign_id");

-- CreateIndex
CREATE INDEX "income_records_category_id_idx" ON "income_records"("category_id");

-- CreateIndex
CREATE INDEX "notifications_actor_user_id_idx" ON "notifications"("actor_user_id");

-- CreateIndex
CREATE INDEX "saas_invoices_subscription_id_idx" ON "saas_invoices"("subscription_id");

-- CreateIndex
CREATE INDEX "saas_subscriptions_plan_id_idx" ON "saas_subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "service_shifts_activity_id_idx" ON "service_shifts"("activity_id");

-- CreateIndex
CREATE INDEX "service_shifts_role_id_idx" ON "service_shifts"("role_id");

