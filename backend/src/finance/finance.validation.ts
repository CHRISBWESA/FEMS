import { BadRequestException } from '@nestjs/common';
import { isUuid } from '../shared/utils/uuid.util';

export const MAX_AMOUNT = 999_999_999.99;

// Money is validated strictly: a positive, finite number with at most two decimals. Returned as a
// fixed 2-decimal string so Prisma's Decimal never sees a binary-float artifact.
export function validateAmount(field: string, value: unknown, opts: { allowZero?: boolean } = {}): string {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new BadRequestException(`${field} must be a number`);
  }
  if (opts.allowZero ? n < 0 : n <= 0) {
    throw new BadRequestException(`${field} must be greater than zero`);
  }
  if (n > MAX_AMOUNT) {
    throw new BadRequestException(`${field} is too large`);
  }
  if (Math.abs(Math.round(n * 100) / 100 - n) > 1e-9) {
    throw new BadRequestException(`${field} can have at most two decimal places`);
  }
  return n.toFixed(2);
}

export function validateDate(
  field: string,
  value: unknown,
  opts: { maxFutureDays?: number; required?: boolean } = {},
): Date | undefined {
  if (value === undefined || value === null || value === '') {
    if (opts.required === false) return undefined;
    throw new BadRequestException(`${field} is required`);
  }
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new BadRequestException(`${field} must be a date`);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  if (d < new Date('2000-01-01')) {
    throw new BadRequestException(`${field} is not plausible`);
  }
  const maxFuture = Date.now() + (opts.maxFutureDays ?? 1) * 24 * 60 * 60 * 1000;
  if (d.getTime() > maxFuture) {
    throw new BadRequestException(`${field} cannot be in the future`);
  }
  return d;
}

export function validateText(field: string, value: unknown, max: number, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  }
  return trimmed;
}

export function validateOptionalUuid(field: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isUuid(value)) {
    throw new BadRequestException(`${field} must be a valid id`);
  }
  return value;
}

export function validateRequiredUuid(field: string, value: unknown): string {
  const v = validateOptionalUuid(field, value);
  if (!v) throw new BadRequestException(`${field} is required`);
  return v;
}

// A closed financial period rejects any new/edited/deleted record dated inside it.
export async function assertPeriodOpen(
  db: { financialPeriod: { findFirst: (args: any) => Promise<any> } },
  fellowshipId: string | null,
  date: Date | undefined | null,
): Promise<void> {
  if (!date) return;
  const closed = await db.financialPeriod.findFirst({
    where: { fellowship_id: fellowshipId, is_closed: true, start_date: { lte: date }, end_date: { gte: date } },
    select: { name: true },
  });
  if (closed) {
    throw new BadRequestException(`The financial period "${closed.name}" is closed; records dated in it can no longer be changed.`);
  }
}

// Expected number of payments a pledge would have produced from `start` up to `asOf`.
export function expectedInstallments(
  frequency: 'one_time' | 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  start: Date,
  asOf: Date,
  end?: Date | null,
): number {
  const stop = end && end < asOf ? end : asOf;
  if (stop < start) return 0;
  if (frequency === 'one_time') return 1;
  if (frequency === 'weekly') {
    return Math.floor((stop.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  }
  const months =
    (stop.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (stop.getUTCMonth() - start.getUTCMonth()) -
    (stop.getUTCDate() < start.getUTCDate() ? 1 : 0);
  const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  return Math.floor(months / step) + 1;
}
