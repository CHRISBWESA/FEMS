import { BadRequestException } from '@nestjs/common';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_SHIFT_HOURS = 72;
export const MAX_CAPACITY = 1000;

export function parseDateTime(field: string, value: unknown): Date {
  if (typeof value !== 'string' && !(value instanceof Date)) throw new BadRequestException(`${field} is required`);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be a valid date and time`);
  if (d < new Date('2000-01-01')) throw new BadRequestException(`${field} is not plausible`);
  return d;
}

// Shift windows: end after start, no longer than MAX_SHIFT_HOURS, and (when creating/moving) in the near future.
export function validateShiftWindow(startsAt: Date, endsAt: Date, now = new Date()): void {
  if (endsAt.getTime() <= startsAt.getTime()) throw new BadRequestException('endsAt must be after startsAt');
  if (endsAt.getTime() - startsAt.getTime() > MAX_SHIFT_HOURS * 60 * 60 * 1000) {
    throw new BadRequestException(`A shift cannot be longer than ${MAX_SHIFT_HOURS} hours`);
  }
  if (startsAt.getTime() <= now.getTime()) throw new BadRequestException('startsAt must be in the future');
  if (startsAt.getTime() > now.getTime() + 2 * 366 * DAY_MS) throw new BadRequestException('startsAt is too far in the future');
}

export function validateCapacity(value: unknown, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new BadRequestException('capacity is required');
  }
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_CAPACITY) {
    throw new BadRequestException(`capacity must be a whole number between 1 and ${MAX_CAPACITY}`);
  }
  return n;
}

export function validateEnum<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

export function hoursBetween(start: Date, end: Date): number {
  return Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 100) / 100;
}
