import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';
import { ENTITLING_STATUSES } from '../shared/billing/plan-config';
import { parsePaging, requirePermission, requireUuid, text } from '../platform/platform.util';
import { DEFAULT_DUE_DAYS, addDays, addInterval, invoiceNumber, receiptNumber } from './billing.util';

@Injectable()
export class BillingInvoicesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private modules: ModuleAvailabilityService,
  ) {}

  present(i: any) {
    return {
      id: i.id, number: invoiceNumber(i.number_seq), fellowshipId: i.fellowship_id, planName: i.plan_name, description: i.description,
      amount: i.amount.toFixed(2), currency: i.currency, periodStart: i.period_start, periodEnd: i.period_end, status: i.status,
      issuedAt: i.issued_at, dueAt: i.due_at, paidAt: i.paid_at, voidedAt: i.voided_at, voidReason: i.void_reason,
      ...(i.status === 'paid' ? { receipt: { number: receiptNumber(i.number_seq), paidAt: i.paid_at, method: i.payment_method, reference: i.payment_reference } } : {}),
    };
  }

  // ---------- platform side ----------

  async issue(user: any, fellowshipId: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    requireUuid('fellowshipId', fellowshipId);
    const dueDays = dto?.dueInDays === undefined ? DEFAULT_DUE_DAYS : Number(dto.dueInDays);
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 60) throw new BadRequestException('dueInDays must be a whole number between 0 and 60');
    const note = text('description', dto?.description, { max: 300 });

    const invoice = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId }, include: { plan: true } });
      if (!sub) throw new NotFoundException('This fellowship has no subscription.');
      // Lock the subscription row so two simultaneous requests cannot both issue an invoice.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM saas_subscriptions WHERE id = ${sub.id}::uuid FOR UPDATE`);
      if (!(ENTITLING_STATUSES as readonly string[]).includes(sub.status) && sub.status !== 'expired') throw new ConflictException(`A ${sub.status} subscription cannot be invoiced. Reactivate it first.`);
      if (sub.plan.price_amount.lte(0)) throw new ConflictException('This plan is free; there is nothing to invoice.');
      if (await tx.saasInvoice.count({ where: { subscription_id: sub.id, status: 'open' } })) throw new ConflictException('There is already an open invoice for this subscription.');
      const now = new Date();
      const start = sub.current_period_end && sub.current_period_end > now ? sub.current_period_end : sub.trial_ends_at && sub.trial_ends_at > now ? sub.trial_ends_at : now;
      const created = await tx.saasInvoice.create({
        data: {
          fellowship_id: fellowshipId, subscription_id: sub.id, plan_name: sub.plan.name,
          description: note ?? `${sub.plan.name} - ${sub.plan.billing_interval}ly subscription`,
          amount: sub.plan.price_amount, currency: sub.plan.currency,
          period_start: start, period_end: addInterval(start, sub.plan.billing_interval), due_at: addDays(now, dueDays), created_by: user.userId,
        },
      });
      await tx.saasSubscriptionEvent.create({ data: { fellowship_id: fellowshipId, event_type: 'invoice_issued', actor_id: user.userId, note: invoiceNumber(created.number_seq) } });
      return created;
    });
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_invoice_issue', entityType: 'saas_invoice', entityId: invoice.id, fellowshipId, newValue: { number: invoiceNumber(invoice.number_seq), amount: invoice.amount.toString(), currency: invoice.currency } });
    return this.present(invoice);
  }

  async list(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_VIEW);
    const { take, skip } = parsePaging(q.limit, q.page);
    const where: Prisma.SaasInvoiceWhereInput = {};
    if (q.fellowshipId) where.fellowship_id = requireUuid('fellowshipId', q.fellowshipId);
    if (q.status) {
      if (!['open', 'paid', 'void'].includes(q.status)) throw new BadRequestException('status must be open, paid or void');
      where.status = q.status as any;
    }
    const [rows, total] = await Promise.all([
      this.prisma.saasInvoice.findMany({
        where,
        orderBy: { issued_at: 'desc' },
        take,
        skip,
        // The fellowship name is registry data, not operational content, so the ledger can be read without a
        // second lookup per row on the client.
        include: { fellowship: { select: { name: true } } },
      }),
      this.prisma.saasInvoice.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({ ...this.present(r), fellowship: r.fellowship?.name ?? null })),
      total,
    };
  }

  async get(user: any, id: string) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_VIEW);
    requireUuid('id', id);
    const inv = await this.prisma.saasInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return this.present(inv);
  }

  /**
   * The ONE place a payment is applied, used by the administrator's "mark paid" and by the signed webhook.
   * Idempotent for the same reference: applying it to an invoice that is already paid with that reference is a
   * no-op. The invoice flip open -> paid is a conditional write, so a payment can never be applied twice.
   */
  async applyPayment(actorId: string | null, invoiceId: string, payment: { method: string; reference: string; providerEventId?: string }): Promise<{ invoice: any; alreadyApplied: boolean }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.saasInvoice.updateMany({
        where: { id: invoiceId, status: 'open' },
        data: { status: 'paid', paid_at: new Date(), payment_method: payment.method, payment_reference: payment.reference },
      });
      const inv = await tx.saasInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv) throw new NotFoundException('Invoice not found');
      if (flip.count !== 1) {
        if (inv.status === 'paid' && inv.payment_reference === payment.reference) return { inv, already: true };
        throw new ConflictException(inv.status === 'paid' ? 'This invoice has already been paid.' : `A ${inv.status} invoice cannot be paid.`);
      }
      // A payment restores an expired or overdue subscription and moves it to the invoiced period. A cancelled
      // subscription stays cancelled (the payment is still recorded).
      const sub = await tx.saasSubscription.findUnique({ where: { id: inv.subscription_id } });
      if (sub && sub.status !== 'cancelled') {
        await tx.saasSubscription.update({ where: { id: sub.id }, data: { status: 'active', current_period_start: inv.period_start, current_period_end: inv.period_end, past_due_since: null } });
      }
      await tx.saasSubscriptionEvent.create({
        data: { fellowship_id: inv.fellowship_id, event_type: 'payment_recorded', from_status: sub?.status ?? null, to_status: sub && sub.status !== 'cancelled' ? 'active' : sub?.status ?? null, actor_id: actorId, note: `${invoiceNumber(inv.number_seq)} - ${payment.reference}`, provider_event_id: payment.providerEventId },
      });
      return { inv, already: false };
    });
    if (!result.already) this.modules.invalidate(result.inv.fellowship_id);
    return { invoice: this.present(result.inv), alreadyApplied: result.already };
  }

  async markPaid(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    requireUuid('id', id);
    const reference = text('reference', dto?.reference, { min: 3, max: 120, required: true }) as string;
    const method = text('method', dto?.method, { max: 40 }) ?? 'offline';
    const { invoice } = await this.applyPayment(user.userId, id, { method, reference });
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_payment_recorded', entityType: 'saas_invoice', entityId: id, fellowshipId: invoice.fellowshipId, newValue: { number: invoice.number, method } });
    return invoice;
  }

  async void(user: any, id: string, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_BILLING_MANAGE);
    requireUuid('id', id);
    const reason = text('reason', dto?.reason, { min: 5, max: 300, required: true }) as string;
    const inv = await this.prisma.saasInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const flip = await this.prisma.saasInvoice.updateMany({ where: { id, status: 'open' }, data: { status: 'void', voided_at: new Date(), void_reason: reason } });
    if (flip.count !== 1) throw new ConflictException('Only an open invoice can be voided.');
    await this.prisma.saasSubscriptionEvent.create({ data: { fellowship_id: inv.fellowship_id, event_type: 'invoice_voided', actor_id: user.userId, note: invoiceNumber(inv.number_seq) } });
    await this.auditService.log({ userId: user.userId, action: 'platform.billing_invoice_void', entityType: 'saas_invoice', entityId: id, fellowshipId: inv.fellowship_id, comment: reason });
    return this.present((await this.prisma.saasInvoice.findUnique({ where: { id } }))!);
  }

  // ---------- fellowship side (read-only, own invoices only) ----------

  requireTenantViewer(user: any): string {
    requirePermission(user, PERMISSIONS.BILLING_VIEW);
    if (!user.fellowshipId) throw new ForbiddenException('You are not part of a fellowship.');
    return user.fellowshipId as string;
  }

  async listForTenant(user: any) {
    const fellowshipId = this.requireTenantViewer(user);
    const rows = await this.prisma.saasInvoice.findMany({ where: { fellowship_id: fellowshipId }, orderBy: { issued_at: 'desc' }, take: 60 });
    return rows.map((r) => this.present(r));
  }

  async getForTenant(user: any, id: string) {
    const fellowshipId = this.requireTenantViewer(user);
    requireUuid('id', id);
    const inv = await this.prisma.saasInvoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.fellowship_id !== fellowshipId) throw new ForbiddenException('You do not have access to this record');
    return this.present(inv);
  }
}
