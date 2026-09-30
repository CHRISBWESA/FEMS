import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementsService } from '../billing/entitlements.service';

const TTL_MS = 5_000;

/**
 * Which optional modules a fellowship has switched off. A missing row means "available", so tenants that
 * pre-date this feature are unaffected. Lookups are cached for a few seconds per process; changes made through
 * this instance take effect immediately (invalidate), other instances catch up within the TTL.
 */
@Injectable()
export class ModuleAvailabilityService {
  private cache = new Map<string, { at: number; disabled: Set<string> }>();

  constructor(private prisma: PrismaService, private entitlements: EntitlementsService) {}

  async disabledModules(fellowshipId: string | null | undefined): Promise<Set<string>> {
    if (!fellowshipId) return new Set();
    const hit = this.cache.get(fellowshipId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.disabled;
    const rows = await this.prisma.fellowshipModuleSetting.findMany({ where: { fellowship_id: fellowshipId, enabled: false }, select: { module_key: true } });
    // Off when the platform switched it off for this fellowship OR its subscription plan does not include it.
    const disabled = new Set([...rows.map((r) => r.module_key), ...(await this.entitlements.excludedModules(fellowshipId))]);
    this.cache.set(fellowshipId, { at: Date.now(), disabled });
    return disabled;
  }

  async isEnabled(fellowshipId: string | null | undefined, key: string): Promise<boolean> {
    return !(await this.disabledModules(fellowshipId)).has(key);
  }

  invalidate(fellowshipId: string): void {
    this.cache.delete(fellowshipId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
