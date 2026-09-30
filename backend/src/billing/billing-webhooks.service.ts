import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';
import { ENTITLING_STATUSES } from '../shared/billing/plan-config';
import { isUuid } from '../shared/utils/uuid.util';
import { BillingInvoicesService } from './billing-invoices.service';
import { PAYMENT_PROVIDERS, ProviderEvent } from './payment-provider';

/**
 * Inbound provider notifications. Order of defence: (1) the provider adapter authenticates the request
 * (signature over timestamp + body, so replays outside a 5-minute window are refused); (2) the event id is
 * recorded under a UNIQUE (provider, event_id), so a redelivered event is acknowledged without being applied
 * again, and reusing an id with a different body is refused; (3) events can only act on invoices/subscriptions
 * by id and payments must match the invoice's amount and currency; (4) every outcome is recorded and audited.
 */
@Injectable()
export class BillingWebhooksService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private invoices: BillingInvoicesService,
    private modules: ModuleAvailabilityService,
  ) {}

  async handle(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<{ status: string }> {
    const provider = PAYMENT_PROVIDERS[providerName];
    if (!provider) throw new NotFoundException('Unknown payment provider');
    if (!provider.isConfigured()) throw new ServiceUnavailableException('Payment notifications are not configured.');
    if (!rawBody || rawBody.length === 0) throw new BadRequestException('Empty body');

    const event = provider.verifyWebhook(rawBody, headers); // throws 401 on a bad or stale signature
    const hash = createHash('sha256').update(rawBody).digest('hex');

    let record;
    try {
      record = await this.prisma.saasWebhookEvent.create({ data: { provider: provider.name, event_id: event.eventId, event_type: event.type, payload_hash: hash } });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      const existing = await this.prisma.saasWebhookEvent.findUnique({ where: { provider_event_id: { provider: provider.name, event_id: event.eventId } } });
      if (!existing) throw e;
      if (existing.payload_hash !== hash) throw new ConflictException('This event id was already used with a different payload.');
      if (existing.status !== 'failed') return { status: 'duplicate' }; // processed, or being processed right now
      // A previously failed event may be retried by the provider: re-arm it (atomically) and try again.
      const rearm = await this.prisma.saasWebhookEvent.updateMany({ where: { id: existing.id, status: 'failed' }, data: { status: 'received', error: null } });
      if (rearm.count !== 1) return { status: 'duplicate' };
      record = existing;
    }

    try {
      const outcome = await this.process(event);
      await this.prisma.saasWebhookEvent.update({ where: { id: record.id }, data: { status: 'processed', processed_at: new Date(), fellowship_id: outcome.fellowshipId ?? null } });
      await this.auditService.log({ userId: undefined, action: 'billing.webhook_processed', entityType: 'saas_webhook_event', entityId: record.id, fellowshipId: outcome.fellowshipId ?? null, newValue: { provider: provider.name, type: event.type, result: outcome.result } });
      return { status: outcome.result };
    } catch (e: any) {
      const message = String(e?.message ?? e).slice(0, 300);
      await this.prisma.saasWebhookEvent.update({ where: { id: record.id }, data: { status: 'failed', error: message } });
      await this.auditService.log({ userId: undefined, action: 'billing.webhook_failed', entityType: 'saas_webhook_event', entityId: record.id, fellowshipId: null, newValue: { provider: provider.name, type: event.type, error: message } });
      // Permanent problems (bad data) are 422 so the provider does not retry forever; anything else is a server error.
      if (e instanceof HttpException && e.getStatus() < 500) throw new UnprocessableEntityException(message);
      throw e;
    }
  }

  private async process(event: ProviderEvent): Promise<{ result: string; fellowshipId?: string }> {
    const d = event.data;
    switch (event.type) {
      case 'invoice.paid': {
        const inv = await this.loadInvoice(d.invoiceId);
        if (String(d.currency ?? '').toUpperCase() !== inv.currency) throw new BadRequestException('Currency does not match the invoice.');
        if (!/^\d+(\.\d{1,2})?$/.test(String(d.amount ?? '')) || Number(d.amount) !== Number(inv.amount.toString())) throw new BadRequestException('Amount does not match the invoice.');
        const reference = typeof d.reference === 'string' && d.reference.trim() ? d.reference.trim().slice(0, 120) : event.eventId;
        const r = await this.invoices.applyPayment(null, inv.id, { method: 'provider', reference, providerEventId: event.eventId });
        return { result: r.alreadyApplied ? 'already_applied' : 'processed', fellowshipId: inv.fellowship_id };
      }
      case 'payment.failed': {
        const inv = await this.loadInvoice(d.invoiceId);
        const flip = await this.prisma.saasSubscription.updateMany({ where: { id: inv.subscription_id, status: 'active' }, data: { status: 'past_due', past_due_since: new Date() } });
        if (flip.count === 1) {
          await this.prisma.saasSubscriptionEvent.create({ data: { fellowship_id: inv.fellowship_id, event_type: 'payment_failed', from_status: 'active', to_status: 'past_due', note: 'provider notification', provider_event_id: event.eventId } });
          this.modules.invalidate(inv.fellowship_id);
        }
        return { result: flip.count === 1 ? 'processed' : 'no_change', fellowshipId: inv.fellowship_id };
      }
      case 'subscription.cancelled': {
        if (!isUuid(d.fellowshipId)) throw new BadRequestException('fellowshipId is required');
        const sub = await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: d.fellowshipId } });
        if (!sub) throw new NotFoundException('Subscription not found');
        const flip = await this.prisma.saasSubscription.updateMany({ where: { id: sub.id, status: { in: [...ENTITLING_STATUSES] as any } }, data: { status: 'cancelled', cancelled_at: new Date(), cancel_at_period_end: false } });
        if (flip.count === 1) {
          await this.prisma.saasSubscriptionEvent.create({ data: { fellowship_id: sub.fellowship_id, event_type: 'cancelled', from_status: sub.status, to_status: 'cancelled', note: 'provider notification', provider_event_id: event.eventId } });
          this.modules.invalidate(sub.fellowship_id);
        }
        return { result: flip.count === 1 ? 'processed' : 'no_change', fellowshipId: sub.fellowship_id };
      }
      default:
        return { result: 'ignored' }; // acknowledged so the provider stops retrying an event type we do not act on
    }
  }

  private async loadInvoice(id: unknown) {
    if (!isUuid(id)) throw new BadRequestException('invoiceId is required');
    const inv = await this.prisma.saasInvoice.findUnique({ where: { id: id as string } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }
}
