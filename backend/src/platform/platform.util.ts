import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { isUuid } from '../shared/utils/uuid.util';

export function requirePermission(user: any, permission: string): void {
  if (!((user?.permissions as string[]) || []).includes(permission)) {
    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}

export function hasPermission(user: any, permission: string): boolean {
  return ((user?.permissions as string[]) || []).includes(permission);
}

export function requireUuid(field: string, value: unknown): string {
  if (!isUuid(value)) throw new BadRequestException(`${field} must be a valid id`);
  return value as string;
}

export function parsePaging(limit?: unknown, page?: unknown, defaultLimit = 50, max = 200): { take: number; skip: number } {
  const l = limit === undefined || limit === '' ? defaultLimit : Number(limit);
  const p = page === undefined || page === '' ? 1 : Number(page);
  if (!Number.isInteger(l) || l < 1 || l > max) throw new BadRequestException(`limit must be an integer between 1 and ${max}`);
  if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
  return { take: l, skip: (p - 1) * l };
}

export function text(field: string, value: unknown, opts: { min?: number; max: number; required?: boolean }): string | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new BadRequestException(`${field} must be a string`);
  const v = value.trim();
  if (!v) {
    if (opts.required) throw new BadRequestException(`${field} is required`);
    return null;
  }
  if (opts.min && v.length < opts.min) throw new BadRequestException(`${field} must be at least ${opts.min} characters`);
  if (v.length > opts.max) throw new BadRequestException(`${field} must be at most ${opts.max} characters`);
  return v;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function email(field: string, value: unknown): string {
  const v = text(field, value, { max: 254, required: true }) as string;
  const lower = v.toLowerCase();
  if (!EMAIL.test(lower)) throw new BadRequestException(`${field} must be a valid e-mail address`);
  return lower;
}

/** One-time temporary password (96 bits of randomness), shown to the operator once and never stored in clear. */
export function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}
