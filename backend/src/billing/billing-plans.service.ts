import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';
import { parseLimits, parsePlanModules } from '../shared/billing/plan-config';
import { validateAmount } from '../finance/finance.validation';
import { requirePermission, requireUuid, text } from '../platform/platform.util';

const CODE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const CURRENCY = /^[A-Z]{3}$/;

@Injectable()
export class BillingPlansService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private modules: ModuleAvailabilityService,
  ) {}

  present(p: any, subscribers?: number) {
    return {
      id: p.id, code: p.code, name: p.name, description: p.description, price: p.price_amount.toFixed(2), currency: p.currency,
      billingInterval: p.billing_interval, trialDays: p.trial_days, modules: p.modules, limits: p.limits ?? {}, isActive: p.is_active,
      createdAt: p.created_at, ...(subscribers !== undefined ? { subscribers } : {}),
    };
  }

  async list(user: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_VIEW);
    const [plans, counts] = await Promise.all([
      this.prisma.saasPlan.findMany({ orderBy: [{ is_active: 'desc' }, { price_amount: 'asc' }, { name: 'asc' }], take: 200 }),
      this.prisma.saasSubscription.groupBy({ by: ['plan_id'], _count: { _all: true } }),
    ]);
    const n = new Map(counts.map((c) => [c.plan_id, c._count._all]));
    return plans.map((p) => this.present(p, n.get(p.id) ?? 0));
  }

  async create(user: any, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    const code = text('code', dto?.code, { min: 2, max: 40, required: true }) as string;
    if (!CODE.test(code)) throw new BadRequestException('code must be lower-case letters, digits, "-" or "_" (2-40 characters)');
    const name = text('name', dto?.name, { min: 2, max: 80, required: true }) as string;
    const description = text('description', dto?.description, { max: 500 });
    const price = validateAmount('price', dto?.price ?? 0, { allowZero: true });
    const currency = dto?.currency === undefined ? 'USD' : String(dto.currency);
    if (!CURRENCY.test(currency)) throw new BadRequestException('currency must be a 3-letter ISO 4217 code such as USD');
    const interval = dto?.billingInterval === undefined ? 'month' : dto.billingInterval;
    if (interval !== 'month' && interval !== 'year') throw new BadRequestException('billingInterval must be month or year');
    const trialDays = this.trialDays(dto?.trialDays);
    const modules = parsePlanModules(dto?.modules);
    const limits = parseLimits(dto?.limits);
    if (await this.prisma.saasPlan.findUnique({ where: { code }, select: { id: true } })) throw new ConflictException('A plan with this code already exists.');

    const plan = await this.prisma.saasPlan.create({ data: { code, name, description, price_amount: price, currency, billing_interval: interval, trial_days: trialDays, modules, limits, created_by: user.userId } });
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_plan_create', entityType: 'saas_plan', entityId: plan.id, fellowshipId: null, newValue: { code, price, currency, interval, modules, limits } });
    return this.present(plan, 0);
  }

  private trialDays(v: unknown): number {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 90) throw new BadRequestException('trialDays must be a whole number between 0 and 90');
    return n;
  }

  async update(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    requireUuid('id', id);
    const plan = await this.prisma.saasPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (dto?.code !== undefined && dto.code !== plan.code) throw new BadRequestException('A plan code cannot be changed.');
    const data: Record<string, any> = {};
    if (dto?.name !== undefined) data.name = text('name', dto.name, { min: 2, max: 80, required: true });
    if (dto?.description !== undefined) data.description = text('description', dto.description, { max: 500 });
    if (dto?.price !== undefined) data.price_amount = validateAmount('price', dto.price, { allowZero: true });
    if (dto?.trialDays !== undefined) data.trial_days = this.trialDays(dto.trialDays);
    if (dto?.modules !== undefined) data.modules = parsePlanModules(dto.modules);
    if (dto?.limits !== undefined) data.limits = parseLimits(dto.limits);
    if (dto?.isActive !== undefined) {
      if (typeof dto.isActive !== 'boolean') throw new BadRequestException('isActive must be true or false');
      data.is_active = dto.isActive;
    }
    if (dto?.currency !== undefined || dto?.billingInterval !== undefined) {
      const inUse = await this.prisma.saasSubscription.count({ where: { plan_id: id } });
      if (inUse > 0 && ((dto.currency !== undefined && dto.currency !== plan.currency) || (dto.billingInterval !== undefined && dto.billingInterval !== plan.billing_interval))) {
        throw new ConflictException('Currency and billing interval cannot be changed while fellowships are subscribed to the plan.');
      }
      if (dto.currency !== undefined) { if (!CURRENCY.test(String(dto.currency))) throw new BadRequestException('currency must be a 3-letter ISO 4217 code'); data.currency = dto.currency; }
      if (dto.billingInterval !== undefined) { if (dto.billingInterval !== 'month' && dto.billingInterval !== 'year') throw new BadRequestException('billingInterval must be month or year'); data.billing_interval = dto.billingInterval; }
    }
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');
    const updated = await this.prisma.saasPlan.update({ where: { id }, data });
    // Module/limit changes apply to every fellowship on the plan straight away.
    this.modules.invalidateAll();
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_plan_update', entityType: 'saas_plan', entityId: id, fellowshipId: null, newValue: { fields: Object.keys(data) } });
    return this.present(updated);
  }
}
