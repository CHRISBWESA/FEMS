import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { BillingPlansService } from './billing-plans.service';
import { BillingSubscriptionsService } from './billing-subscriptions.service';
import { BillingInvoicesService } from './billing-invoices.service';
import { BillingWebhooksService } from './billing-webhooks.service';
import { Throttle } from '@nestjs/throttler';
import { PUBLIC_THROTTLE } from '../shared/throttle';
import { PlatformAccess } from '../shared/decorators/platform.decorators';
import { Public } from '../shared/decorators/public.decorator';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';

// Platform side: plans, subscriptions, invoices. The specific platform.billing_* permission is checked in each
// service method (support staff can read, only the platform administrator can change anything).
@PlatformAccess()
@Roles(ROLES.ADMIN, ROLES.PLATFORM_SUPPORT)
@Controller('platform/billing')
export class BillingPlatformController {
  constructor(
    private readonly plans: BillingPlansService,
    private readonly subs: BillingSubscriptionsService,
    private readonly invoices: BillingInvoicesService,
  ) {}

  @Get('plans') listPlans(@Req() req) { return this.plans.list(req.user); }
  @Post('plans') createPlan(@Body() b: any, @Req() req) { return this.plans.create(req.user, b); }
  @Put('plans/:id') updatePlan(@Param('id') id: string, @Body() b: any, @Req() req) { return this.plans.update(req.user, id, b); }

  @Get('subscriptions') listSubs(@Req() req, @Query() q: Record<string, string>) { return this.subs.list(req.user, q); }
  @Get('subscriptions/:fellowshipId') getSub(@Param('fellowshipId') id: string, @Req() req) { return this.subs.get(req.user, id); }
  @Post('subscriptions/:fellowshipId/assign') assign(@Param('fellowshipId') id: string, @Body() b: any, @Req() req) { return this.subs.assign(req.user, id, b); }
  @Post('subscriptions/:fellowshipId/change-plan') change(@Param('fellowshipId') id: string, @Body() b: any, @Req() req) { return this.subs.changePlan(req.user, id, b); }
  @Post('subscriptions/:fellowshipId/cancel') cancel(@Param('fellowshipId') id: string, @Body() b: any, @Req() req) { return this.subs.cancel(req.user, id, b); }
  @Post('subscriptions/:fellowshipId/reactivate') reactivate(@Param('fellowshipId') id: string, @Body() b: any, @Req() req) { return this.subs.reactivate(req.user, id, b); }
  @Post('subscriptions/:fellowshipId/invoices') issue(@Param('fellowshipId') id: string, @Body() b: any, @Req() req) { return this.invoices.issue(req.user, id, b); }

  @Get('invoices') listInvoices(@Req() req, @Query() q: Record<string, string>) { return this.invoices.list(req.user, q); }
  @Get('invoices/:id') getInvoice(@Param('id') id: string, @Req() req) { return this.invoices.get(req.user, id); }
  @Post('invoices/:id/mark-paid') markPaid(@Param('id') id: string, @Body() b: any, @Req() req) { return this.invoices.markPaid(req.user, id, b); }
  @Post('invoices/:id/void') voidInvoice(@Param('id') id: string, @Body() b: any, @Req() req) { return this.invoices.void(req.user, id, b); }

  @Post('maintenance') maintenance(@Req() req) { return this.subs.maintenance(req.user); }
  @Get('webhook-events') webhookEvents(@Req() req) { return this.subs.webhookEvents(req.user); }
}

// Fellowship side: the Secretary can SEE the plan, status, usage and invoices/receipts of their own fellowship.
// They cannot change anything (plan changes are a platform decision). Not a platform route.
@Roles(ROLES.SECRETARY)
@Controller('billing')
export class BillingTenantController {
  constructor(private readonly subs: BillingSubscriptionsService, private readonly invoices: BillingInvoicesService) {}

  @Get('subscription') mine(@Req() req) { return this.subs.tenantView(req.user); }
  @Get('invoices/:id') invoice(@Param('id') id: string, @Req() req) { return this.invoices.getForTenant(req.user, id); }
}

// Inbound provider notifications: public (the provider is not a FEMS user) and authenticated by signature.
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly webhooks: BillingWebhooksService) {}

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Post(':provider')
  @HttpCode(200)
  receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.webhooks.handle(provider, req.rawBody, req.headers as any);
  }
}
