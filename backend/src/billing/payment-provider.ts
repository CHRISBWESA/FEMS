import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export interface ProviderEvent {
  eventId: string;
  type: string;
  data: Record<string, any>;
}

/**
 * How FEMS talks to a payment provider. NO real provider (Stripe, Paystack, M-Pesa, ...) is integrated: card
 * and bank details never reach FEMS, and nothing here pretends a payment happened. A provider adapter
 * implements `verifyWebhook` (authenticate the notification and translate it into a ProviderEvent) and would
 * later add checkout/customer calls. Until an adapter exists, payments are recorded by a platform administrator
 * (offline) and the only inbound channel is the provider-neutral signed webhook below.
 */
export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent;
}

const TOLERANCE_SECONDS = 300;

/**
 * A provider-neutral, HMAC-signed JSON webhook for whatever gateway or automation confirms payments.
 *   header  X-Fems-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *   body    { "id": "<unique event id>", "type": "invoice.paid", "data": { ... } }
 * The signature covers the timestamp, so a captured request cannot be replayed later (5-minute window), and the
 * event id makes redelivery idempotent (see BillingWebhooksService).
 */
export class SignedWebhookProvider implements PaymentProvider {
  readonly name = 'signed';

  private secret(): string | null {
    const s = process.env.BILLING_WEBHOOK_SECRET;
    return s && s.length >= 32 ? s : null;
  }

  isConfigured(): boolean {
    return this.secret() !== null;
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent {
    const secret = this.secret();
    if (!secret) throw new UnauthorizedException('Invalid signature');
    const header = headers['x-fems-signature'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new UnauthorizedException('Invalid signature');

    const parts = Object.fromEntries(value.split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
    const t = Number(parts.t);
    const sig = parts.v1;
    if (!Number.isInteger(t) || typeof sig !== 'string' || !/^[0-9a-f]{64}$/i.test(sig)) throw new UnauthorizedException('Invalid signature');

    const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
    const given = Buffer.from(sig, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException('Invalid signature');
    // Only after the signature checks out: refuse stale (replayed) or future-dated requests.
    if (Math.abs(Math.floor(Date.now() / 1000) - t) > TOLERANCE_SECONDS) throw new UnauthorizedException('Invalid signature');

    let body: any;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new BadRequestException('Body must be valid JSON'); }
    if (!body || typeof body !== 'object' || typeof body.id !== 'string' || body.id.length < 8 || body.id.length > 128) throw new BadRequestException('id is required (8-128 characters)');
    if (typeof body.type !== 'string' || !body.type || body.type.length > 80) throw new BadRequestException('type is required');
    if (body.data !== undefined && (typeof body.data !== 'object' || body.data === null || Array.isArray(body.data))) throw new BadRequestException('data must be an object');
    return { eventId: body.id, type: body.type, data: body.data ?? {} };
  }
}

export const PAYMENT_PROVIDERS: Record<string, PaymentProvider> = { signed: new SignedWebhookProvider() };
