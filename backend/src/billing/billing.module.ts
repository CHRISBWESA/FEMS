import { Module } from '@nestjs/common';
import { BillingPlansService } from './billing-plans.service';
import { BillingSubscriptionsService } from './billing-subscriptions.service';
import { BillingInvoicesService } from './billing-invoices.service';
import { BillingWebhooksService } from './billing-webhooks.service';
import { BillingPlatformController, BillingTenantController, BillingWebhookController } from './billing.controllers';

// SaaS billing: the platform's own subscription billing for fellowships. It shares no tables and no code
// with the fellowship Finance module. The subscriptions service is exported so a signup approval can attach
// the requested plan to the fellowship it just created.
@Module({
  providers: [BillingPlansService, BillingSubscriptionsService, BillingInvoicesService, BillingWebhooksService],
  controllers: [BillingPlatformController, BillingTenantController, BillingWebhookController],
  exports: [BillingPlansService, BillingSubscriptionsService],
})
export class BillingModule {}
