import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';
import { MODULE_KEYS, MODULE_LABELS, isModuleKey } from '../shared/modules/modules';
import { parsePaging, requirePermission, requireUuid, text } from './platform.util';

// Platform-level view of tenants. It deliberately exposes only registry data and aggregate counts: no member,
// finance, youth or other operational content of a fellowship ever passes through here.
@Injectable()
export class PlatformTenantsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private modules: ModuleAvailabilityService,
  ) {}

  private async load(id: string) {
    requireUuid('id', id);
    const t = await this.prisma.fellowship.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Fellowship not found');
    return t;
  }

  async list(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_VIEW);
    const { take, skip } = parsePaging(q.limit, q.page);
    const where: Prisma.FellowshipWhereInput = {};
    if (q.status) {
      if (q.status !== 'active' && q.status !== 'suspended') throw new BadRequestException('status must be active or suspended');
      where.status = q.status;
    }
    const search = text('search', q.search, { max: 100 });
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { location: { contains: search, mode: 'insensitive' } }];

    const [rows, total] = await Promise.all([
      this.prisma.fellowship.findMany({ where, orderBy: { created_at: 'desc' }, take, skip }),
      this.prisma.fellowship.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    // Aggregate counts only, in three grouped queries (not one per tenant).
    const [users, members, disabled] = ids.length
      ? await Promise.all([
          this.prisma.user.groupBy({ by: ['fellowship_id'], where: { fellowship_id: { in: ids }, deleted_at: null }, _count: { _all: true } }),
          this.prisma.member.groupBy({ by: ['fellowship_id'], where: { fellowship_id: { in: ids } }, _count: { _all: true } }),
          this.prisma.fellowshipModuleSetting.groupBy({ by: ['fellowship_id'], where: { fellowship_id: { in: ids }, enabled: false }, _count: { _all: true } }),
        ])
      : [[], [], []];
    const by = (list: any[]) => new Map<string, number>(list.map((r) => [r.fellowship_id as string, r._count._all as number]));
    const u = by(users), m = by(members), d = by(disabled);
    return {
      data: rows.map((r) => ({
        id: r.id, name: r.name, location: r.location, status: r.status, createdAt: r.created_at,
        suspendedAt: r.suspended_at, users: u.get(r.id) ?? 0, members: m.get(r.id) ?? 0, modulesDisabled: d.get(r.id) ?? 0,
      })),
      total,
    };
  }

  async get(user: any, id: string) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_VIEW);
    const t = await this.load(id);
    const [users, activeSecretaries, members, settings, grants] = await Promise.all([
      this.prisma.user.count({ where: { fellowship_id: id, deleted_at: null } }),
      this.prisma.user.count({ where: { fellowship_id: id, deleted_at: null, is_active: true, roles: { has: 'secretary' } } }),
      this.prisma.member.count({ where: { fellowship_id: id } }),
      this.prisma.fellowshipModuleSetting.findMany({ where: { fellowship_id: id } }),
      this.prisma.supportAccessGrant.findMany({ where: { fellowship_id: id }, orderBy: { created_at: 'desc' }, take: 20 }),
    ]);
    const off = new Set(settings.filter((s) => !s.enabled).map((s) => s.module_key));
    return {
      id: t.id, name: t.name, location: t.location, description: t.description, status: t.status,
      suspendedAt: t.suspended_at, suspensionReason: t.suspension_reason, createdAt: t.created_at,
      counts: { users, members, activeSecretaries },
      modules: MODULE_KEYS.map((k) => ({ key: k, label: MODULE_LABELS[k], enabled: !off.has(k) })),
      supportGrants: grants.map((g) => ({ id: g.id, status: g.status, scopes: g.scopes, requestedBy: g.requested_by, expiresAt: g.expires_at, createdAt: g.created_at })),
    };
  }

  async update(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_MANAGE);
    const t = await this.load(id);
    const data: Record<string, any> = {};
    if (dto?.name !== undefined) {
      const name = text('name', dto.name, { min: 2, max: 120, required: true }) as string;
      const clash = await this.prisma.fellowship.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, NOT: { id } }, select: { id: true } });
      if (clash) throw new BadRequestException('A fellowship with this name already exists');
      data.name = name;
    }
    if (dto?.location !== undefined) data.location = text('location', dto.location, { max: 200 });
    if (dto?.description !== undefined) data.description = text('description', dto.description, { max: 1000 });
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');
    const updated = await this.prisma.fellowship.update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: 'platform.tenant_update', entityType: 'fellowship', entityId: id, fellowshipId: id, oldValue: { name: t.name, location: t.location }, newValue: data });
    return { id: updated.id, name: updated.name, location: updated.location, description: updated.description, status: updated.status };
  }

  // ---------- lifecycle ----------

  async suspend(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_MANAGE);
    await this.load(id);
    const reason = text('reason', dto?.reason, { min: 5, max: 500, required: true }) as string;
    // Conditional write: two concurrent requests cannot both "suspend".
    const flip = await this.prisma.fellowship.updateMany({
      where: { id, status: 'active' },
      data: { status: 'suspended', is_active: false, suspended_at: new Date(), suspended_by: user.userId, suspension_reason: reason },
    });
    if (flip.count !== 1) throw new ConflictException('This fellowship is already suspended.');
    // Any open or approved support access ends with the suspension.
    await this.prisma.supportAccessGrant.updateMany({ where: { fellowship_id: id, status: { in: ['requested', 'approved'] } }, data: { status: 'revoked', revoked_at: new Date() } });
    await this.auditService.log({ userId: user.userId, action: 'platform.tenant_suspend', entityType: 'fellowship', entityId: id, fellowshipId: id, newValue: { reason }, comment: reason });
    return this.get(user, id);
  }

  async reactivate(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_MANAGE);
    await this.load(id);
    const reason = text('reason', dto?.reason, { max: 500 });
    const flip = await this.prisma.fellowship.updateMany({
      where: { id, status: 'suspended' },
      data: { status: 'active', is_active: true, suspended_at: null, suspended_by: null, suspension_reason: null },
    });
    if (flip.count !== 1) throw new ConflictException('This fellowship is not suspended.');
    await this.auditService.log({ userId: user.userId, action: 'platform.tenant_reactivate', entityType: 'fellowship', entityId: id, fellowshipId: id, comment: reason ?? undefined });
    return this.get(user, id);
  }

  // ---------- module availability ----------

  async setModules(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_MANAGE);
    await this.load(id);
    const input = dto?.modules;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length === 0) {
      throw new BadRequestException('modules must be an object such as { "youth": false }');
    }
    for (const [k, v] of Object.entries(input)) {
      if (!isModuleKey(k)) throw new BadRequestException(`Unknown module: ${k}`);
      if (typeof v !== 'boolean') throw new BadRequestException(`modules.${k} must be true or false`);
    }
    const before = await this.prisma.fellowshipModuleSetting.findMany({ where: { fellowship_id: id } });
    const was = new Map(before.map((b) => [b.module_key, b.enabled]));
    await this.prisma.$transaction(
      Object.entries(input as Record<string, boolean>).map(([key, enabled]) =>
        this.prisma.fellowshipModuleSetting.upsert({
          where: { fellowship_id_module_key: { fellowship_id: id, module_key: key } },
          create: { fellowship_id: id, module_key: key, enabled, updated_by: user.userId },
          update: { enabled, updated_by: user.userId },
        }),
      ),
    );
    this.modules.invalidate(id);
    const changed = Object.fromEntries(Object.entries(input as Record<string, boolean>).map(([k, v]) => [k, { from: was.get(k) ?? true, to: v }]));
    await this.auditService.log({ userId: user.userId, action: 'platform.tenant_modules', entityType: 'fellowship', entityId: id, fellowshipId: id, newValue: changed });
    return (await this.get(user, id)).modules;
  }

  // ---------- platform dashboard ----------

  async dashboard(user: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_ANALYTICS_VIEW);
    const now = new Date();
    const withSecretary = (await this.prisma.user.findMany({ where: { deleted_at: null, is_active: true, roles: { has: 'secretary' }, fellowship_id: { not: null } }, select: { fellowship_id: true }, distinct: ['fellowship_id'] })).map((u) => u.fellowship_id as string);
    const [
      byStatus, userTotals, platformAccounts, disabled, recent, pendingRequests, activeGrants, noSecretary,
      subsByStatus, plans, trialing, invoices, webhooks,
    ] = await Promise.all([
      this.prisma.fellowship.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['is_active'], where: { deleted_at: null, fellowship_id: { not: null } }, _count: { _all: true } }),
      this.prisma.user.count({ where: { deleted_at: null, fellowship_id: null, OR: [{ roles: { has: 'admin' } }, { roles: { has: 'platform_support' } }] } }),
      this.prisma.fellowshipModuleSetting.groupBy({ by: ['module_key'], where: { enabled: false }, _count: { _all: true } }),
      this.prisma.fellowship.findMany({ orderBy: { created_at: 'desc' }, take: 5, select: { id: true, name: true, status: true, created_at: true } }),
      this.prisma.supportAccessGrant.count({ where: { status: 'requested' } }),
      this.prisma.supportAccessGrant.count({ where: { status: 'approved', expires_at: { gt: now } } }),
      // Health signal: active tenants that nobody can administer.
      this.prisma.fellowship.count({ where: { status: 'active', NOT: { id: { in: withSecretary } } } }),
      // ---- SaaS billing posture. Read from the existing saas_* tables; no aggregate is stored anywhere. ----
      this.prisma.saasSubscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.saasPlan.findMany({ where: { is_active: true }, select: { id: true, name: true, price_amount: true, currency: true, billing_interval: true, _count: { select: { subscriptions: true } } }, orderBy: { price_amount: 'asc' } }),
      // A fellowship is "on trial" while it holds a trialing subscription whose trial has not ended yet.
      this.prisma.saasSubscription.count({ where: { status: 'trialing', trial_ends_at: { gt: now } } }),
      this.prisma.saasInvoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.saasWebhookEvent.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const tenants = { total: 0, active: 0, suspended: 0 };
    for (const r of byStatus) { tenants[r.status] = r._count._all; tenants.total += r._count._all; }

    const off = new Map(disabled.map((d) => [d.module_key, d._count._all]));

    // Subscription status counts. Every status is reported, including zeroes, so the screen cannot imply a
    // category is missing just because no row happens to exist.
    const subscriptionStatuses = ['trialing', 'active', 'past_due', 'cancelled', 'expired'] as const;
    const subCount = (s: string) => subsByStatus.find((r) => r.status === s)?._count._all ?? 0;

    // Invoiced / collected / outstanding are summed per currency and never added together, because amounts
    // denominated in different currencies are not comparable.
    const [byCurrency, paidByCurrency, openByCurrency] = await Promise.all([
      this.prisma.saasInvoice.groupBy({ by: ['currency'], _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.saasInvoice.groupBy({ by: ['currency'], where: { status: 'paid' }, _sum: { amount: true } }),
      this.prisma.saasInvoice.groupBy({ by: ['currency'], where: { status: 'open' }, _sum: { amount: true } }),
    ]);
    const collected = new Map(paidByCurrency.map((r) => [r.currency, Number(r._sum.amount ?? 0)]));
    const outstanding = new Map(openByCurrency.map((r) => [r.currency, Number(r._sum.amount ?? 0)]));
    const revenue = byCurrency.map((r) => ({
      currency: r.currency,
      invoiced: Number(r._sum.amount ?? 0),
      collected: collected.get(r.currency) ?? 0,
      outstanding: outstanding.get(r.currency) ?? 0,
      invoices: r._count._all,
    }));
    const invoiceCount = (s: string) => invoices.find((r) => r.status === s)?._count._all ?? 0;

    return {
      generatedAt: now,
      tenants,
      users: { active: userTotals.find((r) => r.is_active)?._count._all ?? 0, inactive: userTotals.find((r) => !r.is_active)?._count._all ?? 0, platformAccounts },
      tenantsWithoutActiveSecretary: noSecretary,
      modules: MODULE_KEYS.map((k) => ({ key: k, label: MODULE_LABELS[k], tenantsWithModuleOff: off.get(k) ?? 0 })),
      support: { pendingRequests, activeGrants },
      recentTenants: recent.map((r) => ({ id: r.id, name: r.name, status: r.status, createdAt: r.created_at })),
      subscriptions: {
        total: subsByStatus.reduce((n, r) => n + r._count._all, 0),
        // A tenant with no subscription row is not on a plan at all, which is a different state from "expired".
        tenantsWithoutSubscription: tenants.total - subsByStatus.reduce((n, r) => n + r._count._all, 0),
        trialing: trialing,
        byStatus: subscriptionStatuses.map((s) => ({ status: s, count: subCount(s) })),
        expiringSoon: await this.prisma.saasSubscription.count({
          where: { status: { in: ['trialing', 'active'] }, current_period_end: { gt: now, lt: new Date(now.getTime() + 30 * 86_400_000) } },
        }),
      },
      plans: plans.map((p) => ({
        id: p.id, name: p.name, price: Number(p.price_amount), currency: p.currency,
        billingInterval: p.billing_interval, subscribers: p._count.subscriptions,
      })),
      billing: {
        invoices: {
          open: invoiceCount('open'),
          paid: invoiceCount('paid'),
          void: invoiceCount('void'),
          total: invoices.reduce((n, r) => n + r._count._all, 0),
        },
        revenue,
        webhooks: {
          received: webhooks.find((r) => r.status === 'received')?._count._all ?? 0,
          processed: webhooks.find((r) => r.status === 'processed')?._count._all ?? 0,
          failed: webhooks.find((r) => r.status === 'failed')?._count._all ?? 0,
        },
      },
    };
  }
}
