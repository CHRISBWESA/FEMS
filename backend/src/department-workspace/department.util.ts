import { BadRequestException } from '@nestjs/common';

export const LEADER_ROLES = ['department_chairperson', 'department_secretary'] as const;
export type LeaderRole = (typeof LEADER_ROLES)[number];

export const LEADER_ROLE_LABEL: Record<LeaderRole, string> = {
  department_chairperson: 'Department Chairperson',
  department_secretary: 'Department Secretary',
};

/**
 * Initial password for a department leader account created on appointment, as the fellowship requires. The account
 * is created with must_change_password, and the server refuses every other request until the leader has chosen a
 * strong password of their own (see MustChangePasswordGuard and the password policy).
 */
export const INITIAL_LEADER_PASSWORD = '123456';

/** The ten departments the fellowship starts with; the Secretary may add more. */
export const STANDARD_DEPARTMENTS = [
  'Praise',
  'Choir',
  'Evangelism',
  'Prayers',
  'Events',
  'Word',
  'Deacon',
  'IT',
  'Music',
  'Decoration',
];

export function isLeaderRole(value: unknown): value is LeaderRole {
  return value === 'department_chairperson' || value === 'department_secretary';
}

export interface Attachment {
  url: string;
  name: string;
  publicId?: string;
  type?: string;
  bytes?: number;
}

const MAX_ATTACHMENTS = 10;

/**
 * Attachments are files already uploaded through the department upload endpoint. Only https links to the
 * configured Cloudinary account are accepted, so a report cannot be made to point at an arbitrary site.
 */
export function validateAttachments(field: string, value: unknown): Attachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${field} must be a list`);
  if (value.length > MAX_ATTACHMENTS)
    throw new BadRequestException(`${field} can have at most ${MAX_ATTACHMENTS} files`);
  return value.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new BadRequestException(`${field}[${i}] is invalid`);
    const a = raw as Record<string, unknown>;
    if (
      typeof a.url !== 'string' ||
      !/^https:\/\/res\.cloudinary\.com\/[\w-]+\//.test(a.url) ||
      a.url.length > 1000
    ) {
      throw new BadRequestException(`${field}[${i}] must be a file uploaded to FEMS`);
    }
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 200) : 'file';
    const out: Attachment = { url: a.url, name };
    if (typeof a.publicId === 'string') out.publicId = a.publicId.slice(0, 300);
    if (typeof a.type === 'string') out.type = a.type.slice(0, 100);
    if (typeof a.bytes === 'number' && Number.isFinite(a.bytes)) out.bytes = a.bytes;
    return out;
  });
}

export function parseOptionalDate(field: string, value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date))
    throw new BadRequestException(`${field} must be a date`);
  const d = new Date(value as string);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return d;
}

export function parseRequiredDate(field: string, value: unknown): Date {
  const d = parseOptionalDate(field, value);
  if (!d) throw new BadRequestException(`${field} is required`);
  return d;
}

/** Date-range filter from ?from=YYYY-MM-DD&to=YYYY-MM-DD; `to` includes the whole day. */
export function dateRange(from?: unknown, to?: unknown): { gte?: Date; lte?: Date } | undefined {
  const f = parseOptionalDate('from', from);
  const t = parseOptionalDate('to', to);
  if (t && typeof to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(to)) t.setUTCHours(23, 59, 59, 999);
  if (f && t && f > t) throw new BadRequestException('from must be before to');
  if (!f && !t) return undefined;
  return { ...(f ? { gte: f } : {}), ...(t ? { lte: t } : {}) };
}

export function parsePaging(
  page?: unknown,
  limit?: unknown,
  maxLimit = 100,
): { skip: number; take: number; page: number; limit: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const l = Math.max(1, Math.min(maxLimit, Math.floor(Number(limit) || 20)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
}

/** RFC 4180 CSV with a BOM so Excel opens UTF-8 (Swahili names, etc.) correctly. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Neutralise spreadsheet formulas in user-supplied text.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function genderOf(g: unknown): 'male' | 'female' | null {
  const v = typeof g === 'string' ? g.trim().toLowerCase() : '';
  return v === 'male' || v === 'female' ? v : null;
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}
