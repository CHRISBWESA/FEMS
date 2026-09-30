import { BadRequestException } from '@nestjs/common';

export const COMM_CHANNELS = ['email', 'sms', 'phone', 'whatsapp', 'in_app'] as const;

export { isUuid } from '../shared/utils/uuid.util';

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 50;

// Tags are stored normalized (trimmed, lower-cased, de-duplicated) so array filters
// (has / hasSome) match reliably regardless of how they were typed.
export function normalizeTags(field: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`${field} must be an array of strings`);
  }
  const out = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException(`${field} must be an array of strings`);
    }
    const tag = normalizeTag(item);
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new BadRequestException(`${field}: each entry must be at most ${MAX_TAG_LENGTH} characters`);
    }
    out.add(tag);
  }
  if (out.size > MAX_TAGS) {
    throw new BadRequestException(`${field}: at most ${MAX_TAGS} entries are allowed`);
  }
  return Array.from(out);
}

// Comma-separated query-string list (e.g. ?skills=guitar,media) -> normalized tags.
export function parseTagList(field: string, raw: unknown, max = 20): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (typeof raw !== 'string') {
    throw new BadRequestException(`${field} must be a comma-separated list`);
  }
  const tags = Array.from(new Set(raw.split(',').map(normalizeTag).filter(Boolean)));
  if (tags.length > max) {
    throw new BadRequestException(`${field}: at most ${max} values are allowed`);
  }
  return tags;
}

export function parseIntParam(
  name: string,
  raw: unknown,
  opts: { min: number; max: number; fallback?: number },
): number | undefined {
  if (raw === undefined || raw === null || raw === '') return opts.fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < opts.min || n > opts.max) {
    throw new BadRequestException(`${name} must be an integer between ${opts.min} and ${opts.max}`);
  }
  return n;
}

// 'YYYY-MM-DD' upper bounds are inclusive of the whole day.
export function parseDateBoundary(name: string, raw: unknown, edge: 'start' | 'end'): Date | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') throw new BadRequestException(`${name} must be a date`);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = new Date(dateOnly ? `${raw}T${edge === 'end' ? '23:59:59.999' : '00:00:00.000'}Z` : raw);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be a valid date`);
  return d;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Last `count` calendar months (UTC), oldest first, ending with the current month.
export function lastMonthKeys(count: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

export function startOfMonthsWindow(count: number, now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - 1), 1));
}
