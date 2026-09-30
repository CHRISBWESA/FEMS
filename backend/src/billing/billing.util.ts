// Small helpers shared by the SaaS billing services. Kept dependency-free so they can be unit-tested.

export type Interval = 'month' | 'year';

/** Adds whole months/years in UTC, clamping to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addInterval(from: Date, interval: Interval, count = 1): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (interval === 'month') d.setUTCMonth(d.getUTCMonth() + count);
  else d.setUTCFullYear(d.getUTCFullYear() + count);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

export const invoiceNumber = (seq: number): string => `INV-${String(seq).padStart(6, '0')}`;
export const receiptNumber = (seq: number): string => `RCP-${String(seq).padStart(6, '0')}`;

export const GRACE_DAYS = 14; // past_due -> expired after this long without payment
export const DEFAULT_DUE_DAYS = 14;
