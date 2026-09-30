import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';
import { EntitlementsService } from '../shared/billing/entitlements.service';
import { ENTITLING_STATUSES, LIMITS } from '../shared/billing/plan-config';
import { parsePaging, requirePermission, requireUuid, text } from '../platform/platform.util';
import { BillingPlansService } from './billing-plans.service';
import { BillingInvoicesService } from './billing-invoices.service';
import { GRACE_DAYS, addDays, addInterval } from './billing.util';

const ENTITLING = [...ENTITLING_STATUSES] as ('trialing' | 'active' | 'past_due')[];

// Subscription lifecycle. Statuses only ever change through the methods below, each a conditional write
// (`where status = <expected>`), and every change is appended to the subscription history. Nothing here touches
// authentication or roles, and nothing here touches the fellowship's own Finance data.
@Injectable()
export class BillingSubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private modules: ModuleAvailabilityService,
    private entitlements: EntitlementsService,
    private plans: BillingPlansService,
    private invoices: BillingInvoicesService,
  ) {}

  private present(sub: any) {
    return {
      id: sub.id, fellowshipId: sub.fellowship_id, status: sub.status, plan: sub.plan ? this.plans.present(sub.plan) : undefined,
      trialEndsAt: sub.trial_ends_at, currentPeriodStart: sub.current_period_start, currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end, cancelledAt: sub.cancelled_at, pastDueSince: sub.past_due_since, createdAt: sub.created_at,
    };
  }

  private async event(tx: Prisma.TransactionClient | PrismaService, fellowshipId: string, e: { type: string; from?: any; to?: any; fromPlan?: string | null; toPlan?: string | null; actor?: string | null; note?: string | null }) {
    await tx.saasSubscriptionEvent.create({ data: { fellowship_id: fellowshipId, event_type: e.type, from_status: e.from ?? null, to_status: e.to ?? null, from_plan_id: e.fromPlan ?? null, to_plan_id: e.toPlan ?? null, actor_id: e.actor ?? null, note: e.note ?? null } });
  }

  private async assertFitsPlan(fellowshipId: string, plan: any) {
    const v = await this.entitlements.violations(fellowshipId, (plan.limits as Record<string, number>) || {});
    if (v.length) {
      const text = v.map((x) => `${LIMITS[x.limit as keyof typeof LIMITS].label}: using ${x.used}, plan allows ${x.allowed}`).join('; ');
      throw new ConflictException(`This fellowship's current usage exceeds the plan's limits (${text}).`);
    }
  }

  private async loadTenant(fellowshipId: string) {
    requireUuid('fellowshipId', fellowshipId);
    const t = await this.prisma.fellowship.findUnique({ where: { id: fellowshipId }, select: { id: true, name: true } });
    if (!t) throw new NotFoundException('Fellowship not found');
    return t;
  }

  // ---------- reads ----------

  async list(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_VIEW);
    const { take, skip } = parsePaging(q.limit, q.page);
    const where: Prisma.SaasSubscriptionWhereInput = {};
    if (q.status) {
      if (!['trialing', 'active', 'past_due', 'cancelled', 'expired'].includes(q.status)) throw new BadRequestException('status is not valid');
      where.status = q.status as any;
    }
    const [rows, total] = await Promise.all([
      this.prisma.saasSubscription.findMany({ where, orderBy: { created_at: 'desc' }, take, skip, include: { plan: { select: { id: true, code: true, name: true } } } }),
      this.prisma.saasSubscription.count({ where }),
    ]);
    const names = rows.length ? await this.prisma.fellowship.findMany({ where: { id: { in: rows.map((r) => r.fellowship_id) } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return {
      data: rows.map((r) => ({ fellowshipId: r.fellowship_id, fellowship: nameOf.get(r.fellowship_id) ?? null, status: r.status, plan: r.plan, trialEndsAt: r.trial_ends_at, currentPeriodEnd: r.current_period_end, cancelAtPeriodEnd: r.cancel_at_period_end })),
      total,
    };
  }

  async get(user: any, fellowshipId: string) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_VIEW);
    const t = await this.loadTenant(fellowshipId);
    return this.detail(t.id, t.name);
  }

  private async detail(fellowshipId: string, fellowshipName?: string) {
    const sub = await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId }, include: { plan: true } });
    const usage = await this.entitlements.usage(fellowshipId);
    if (!sub) return { fellowshipId, fellowship: fellowshipName ?? null, managed: false, usage, subscription: null, history: [], invoices: [] };
    const [history, invoices] = await Promise.all([
      this.prisma.saasSubscriptionEvent.findMany({ where: { fellowship_id: fellowshipId }, orderBy: { occurred_at: 'desc' }, take: 50 }),
      this.prisma.saasInvoice.findMany({ where: { fellowship_id: fellowshipId }, orderBy: { issued_at: 'desc' }, take: 24 }),
    ]);
    const limits = (sub.plan.limits as Record<string, number>) || {};
    return {
      fellowshipId, fellowship: fellowshipName ?? null, managed: true, subscription: this.present(sub),
      usage: Object.fromEntries(Object.entries(usage).map(([k, used]) => [k, { used, limit: limits[k] ?? null }])),
      history: history.map((h) => ({ id: h.id, type: h.event_type, from: h.from_status, to: h.to_status, note: h.note, actor: h.actor_id, at: h.occurred_at })),
      invoices: invoices.map((i) => this.invoices.present(i)),
    };
  }

  /** What a fellowship's own Secretary sees: plan, status, usage against limits, invoices. Their own tenant only. */
  async tenantView(user: any) {
    const fellowshipId = this.invoices.requireTenantViewer(user);
    const d: any = await this.detail(fellowshipId);
    // History is internal; the tenant sees the current state and its own invoices/receipts.
    return { managed: d.managed, subscription: d.subscription, usage: d.usage, invoices: d.invoices };
  }

  // ---------- lifecycle ----------

  async assign(user: any, fellowshipId: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    const tenant = await this.loadTenant(fellowshipId);
    if (await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId }, select: { id: true } })) throw new ConflictException('This fellowship already has a subscription. Change its plan instead.');
    const planId = requireUuid('planId', dto?.planId);
    const plan = await this.prisma.saasPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.is_active) throw new ConflictException('This plan is no longer offered.');
    const startTrial = dto?.startTrial === true;
    if (dto?.startTrial !== undefined && typeof dto.startTrial !== 'boolean') throw new BadRequestException('startTrial must be true or false');
    if (startTrial && plan.trial_days <= 0) throw new BadRequestException('This plan has no trial period.');
    await this.assertFitsPlan(fellowshipId, plan);

    const now = new Date();
    let sub;
    try {
      sub = await this.prisma.$transaction(async (tx) => {
        const created = await tx.saasSubscription.create({
          data: {
            fellowship_id: fellowshipId, plan_id: plan.id, created_by: user.userId,
            status: startTrial ? 'trialing' : 'active',
            trial_ends_at: startTrial ? addDays(now, plan.trial_days) : null,
            current_period_start: startTrial ? null : now,
            current_period_end: startTrial ? null : addInterval(now, plan.billing_interval),
          },
        });
        await this.event(tx, fellowshipId, { type: startTrial ? 'trial_started' : 'created', to: created.status, toPlan: plan.id, actor: user.userId, note: plan.code });
        return created;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('This fellowship already has a subscription. Change its plan instead.');
      throw e;
    }
    this.modules.invalidate(fellowshipId);
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_subscription_assign', entityType: 'saas_subscription', entityId: sub.id, fellowshipId, newValue: { plan: plan.code, status: sub.status } });
    return this.detail(tenant.id, tenant.name);
  }

  async changePlan(user: any, fellowshipId: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    const tenant = await this.loadTenant(fellowshipId);
    const planId = requireUuid('planId', dto?.planId);
    const sub = await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId } });
    if (!sub) throw new NotFoundException('This fellowship has no subscription.');
    if (!ENTITLING.includes(sub.status as any)) throw new ConflictException(`A ${sub.status} subscription cannot change plan. Reactivate it first.`);
    if (sub.plan_id === planId) throw new ConflictException('The fellowship is already on this plan.');
    const plan = await this.prisma.saasPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.is_active) throw new ConflictException('This plan is no longer offered.');
    await this.assertFitsPlan(fellowshipId, plan);
    const flip = await this.prisma.saasSubscription.updateMany({ where: { id: sub.id, plan_id: sub.plan_id, status: { in: ENTITLING } }, data: { plan_id: plan.id } });
    if (flip.count !== 1) throw new ConflictException('The subscription changed while you were editing it. Reload and try again.');
    await this.event(this.prisma, fellowshipId, { type: 'plan_changed', from: sub.status, to: sub.status, fromPlan: sub.plan_id, toPlan: plan.id, actor: user.userId, note: plan.code });
    this.modules.invalidate(fellowshipId);
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_plan_change', entityType: 'saas_subscription', entityId: sub.id, fellowshipId, newValue: { plan: plan.code } });
    return this.detail(tenant.id, tenant.name);
  }

  async cancel(user: any, fellowshipId: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    const tenant = await this.loadTenant(fellowshipId);
    const reason = text('reason', dto?.reason, { min: 5, max: 500, required: true }) as string;
    const sub = await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId } });
    if (!sub) throw new NotFoundException('This fellowship has no subscription.');
    if (!ENTITLING.includes(sub.status as any)) throw new ConflictException(`This subscription is already ${sub.status}.`);
    // A subscription with a paid period runs to its end by default; a trial (no period) or an explicit request ends now.
    const immediately = dto?.immediately === true || sub.status === 'trialing' || !sub.current_period_end;
    if (immediately) {
      const flip = await this.prisma.saasSubscription.updateMany({ where: { id: sub.id, status: { in: ENTITLING } }, data: { status: 'cancelled', cancelled_at: new Date(), cancel_at_period_end: false, past_due_since: null } });
      if (flip.count !== 1) throw new ConflictException('The subscription changed while you were editing it. Reload and try again.');
      await this.event(this.prisma, fellowshipId, { type: 'cancelled', from: sub.status, to: 'cancelled', actor: user.userId, note: reason });
    } else {
      const flip = await this.prisma.saasSubscription.updateMany({ where: { id: sub.id, status: { in: ENTITLING }, cancel_at_period_end: false }, data: { cancel_at_period_end: true } });
      if (flip.count !== 1) throw new ConflictException('Cancellation at the end of the period is already scheduled.');
      await this.event(this.prisma, fellowshipId, { type: 'cancel_scheduled', from: sub.status, to: sub.status, actor: user.userId, note: reason });
    }
    this.modules.invalidate(fellowshipId);
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_subscription_cancel', entityType: 'saas_subscription', entityId: sub.id, fellowshipId, comment: reason, newValue: { immediately } });
    return this.detail(tenant.id, tenant.name);
  }

  async reactivate(user: any, fellowshipId: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    const tenant = await this.loadTenant(fellowshipId);
    const reason = text('reason', dto?.reason, { min: 5, max: 500, required: true }) as string;
    const sub = await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId }, include: { plan: true } });
    if (!sub) throw new NotFoundException('This fellowship has no subscription.');
    if (sub.status !== 'cancelled' && sub.status !== 'expired') throw new ConflictException(`A ${sub.status} subscription is already live.`);
    let plan = sub.plan;
    if (dto?.planId !== undefined && dto.planId !== sub.plan_id) {
      const p = await this.prisma.saasPlan.findUnique({ where: { id: requireUuid('planId', dto.planId) } });
      if (!p) throw new NotFoundException('Plan not found');
      if (!p.is_active) throw new ConflictException('This plan is no longer offered.');
      plan = p;
    }
    await this.assertFitsPlan(fellowshipId, plan);
    const now = new Date();
    const flip = await this.prisma.saasSubscription.updateMany({
      where: { id: sub.id, status: { in: ['cancelled', 'expired'] } },
      data: { status: 'active', plan_id: plan.id, current_period_start: now, current_period_end: addInterval(now, plan.billing_interval), cancel_at_period_end: false, cancelled_at: null, past_due_since: null, trial_ends_at: null },
    });
    if (flip.count !== 1) throw new ConflictException('The subscription changed while you were editing it. Reload and try again.');
    await this.event(this.prisma, fellowshipId, { type: 'reactivated', from: sub.status, to: 'active', fromPlan: sub.plan_id, toPlan: plan.id, actor: user.userId, note: reason });
    this.modules.invalidate(fellowshipId);
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_subscription_reactivate', entityType: 'saas_subscription', entityId: sub.id, fellowshipId, comment: reason });
    return this.detail(tenant.id, tenant.name);
  }

  /**
   * Time-driven transitions. There is no scheduler in this codebase, so a platform administrator (or a cron
   * job calling the endpoint) triggers it; it is idempotent and safe to run repeatedly:
   *   trial past its end                         -> expired
   *   active with an overdue open invoice        -> past_due
   *   past_due for longer than the grace period  -> expired
   *   cancellation scheduled and period ended    -> cancelled
   */
  async maintenance(user: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    const now = new Date();
    const changed: Record<string, number> = { trialsExpired: 0, pastDue: 0, expiredAfterGrace: 0, cancelledAtPeriodEnd: 0 };
    const touched = new Set<string>();
    const move = async (where: Prisma.SaasSubscriptionWhereInput, data: Prisma.SaasSubscriptionUpdateManyMutationInput, type: string, to: any, counter: string) => {
      const rows = await this.prisma.saasSubscription.findMany({ where, select: { id: true, fellowship_id: true, status: true } });
      for (const r of rows) {
        const flip = await this.prisma.saasSubscription.updateMany({ where: { AND: [where, { id: r.id, status: r.status }] }, data });
        if (flip.count !== 1) continue;
        await this.event(this.prisma, r.fellowship_id, { type, from: r.status, to, note: 'maintenance' });
        touched.add(r.fellowship_id);
        changed[counter]++;
      }
    };
    await move({ status: 'trialing', trial_ends_at: { lte: now } }, { status: 'expired' }, 'trial_ended', 'expired', 'trialsExpired');
    await move({ status: 'active', invoices: { some: { status: 'open', due_at: { lte: now } } } }, { status: 'past_due', past_due_since: now }, 'past_due', 'past_due', 'pastDue');
    await move({ status: 'past_due', past_due_since: { lte: addDays(now, -GRACE_DAYS) } }, { status: 'expired' }, 'expired', 'expired', 'expiredAfterGrace');
    await move({ status: { in: ['active', 'past_due'] }, cancel_at_period_end: true, current_period_end: { lte: now } }, { status: 'cancelled', cancelled_at: now, cancel_at_period_end: false }, 'cancelled', 'cancelled', 'cancelledAtPeriodEnd');
    for (const f of touched) this.modules.invalidate(f);
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_maintenance', entityType: 'saas_subscription', entityId: user.userId, fellowshipId: null, newValue: changed });
    return changed;
  }

  // Recent provider notifications for operators (no payloads).
  async webhookEvents(user: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_VIEW);
    const rows = await this.prisma.saasWebhookEvent.findMany({ orderBy: { received_at: 'desc' }, take: 100 });
    return rows.map((r) => ({ id: r.id, provider: r.provider, eventId: r.event_id, type: r.event_type, status: r.status, error: r.error, receivedAt: r.received_at, processedAt: r.processed_at }));
  }
}
