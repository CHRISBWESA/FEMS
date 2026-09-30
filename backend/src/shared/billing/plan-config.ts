import { BadRequestException } from '@nestjs/common';
import { MODULE_KEYS, isModuleKey } from '../modules/modules';

// The single place that defines what a plan can limit. Adding a limit means adding one entry here plus one
// enforcement call at the place that creates the counted thing (see EntitlementsService.assertWithinLimit);
// plans themselves are data (saas_plans), never hard-coded checks.
export const LIMITS = {
  max_users: { label: 'user accounts', unit: 'accounts' },
  max_members: { label: 'members', unit: 'members' },
  max_storage_mb: { label: 'MB of document storage', unit: 'MB' },
} as const;

export type LimitKey = keyof typeof LIMITS;
export const LIMIT_KEYS = Object.keys(LIMITS) as LimitKey[];

// A subscription in one of these states entitles the fellowship to its plan. Any other state (cancelled,
// expired) means optional modules are off and nothing new can be added; existing data is kept.
export const ENTITLING_STATUSES = ['trialing', 'active', 'past_due'] as const;
export const isEntitling = (status: string): boolean => (ENTITLING_STATUSES as readonly string[]).includes(status);

const MAX_LIMIT = 1_000_000_000;

/** Validates a `limits` object from the API: known keys only, whole positive numbers; null/absent = unlimited. */
export function parseLimits(input: unknown): Record<string, number> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('limits must be an object');
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in LIMITS)) throw new BadRequestException(`Unknown limit: ${k}. Known limits: ${LIMIT_KEYS.join(', ')}`);
    if (v === null) continue; // unlimited
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_LIMIT) {
      throw new BadRequestException(`limits.${k} must be a whole number between 1 and ${MAX_LIMIT} (omit it for unlimited)`);
    }
    out[k] = v;
  }
  return out;
}

export function parsePlanModules(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestException('modules must be a list');
  const bad = input.filter((m) => !isModuleKey(m));
  if (bad.length) throw new BadRequestException(`Unknown module(s): ${bad.join(', ')}. Known modules: ${MODULE_KEYS.join(', ')}`);
  return Array.from(new Set(input as string[]));
}
