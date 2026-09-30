import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MODULE_KEYS } from '../modules/modules';
import { LIMITS, LimitKey, isEntitling } from './plan-config';

export interface Entitlement {
  managed: boolean; // false = no subscription row: the fellowship is not under plan enforcement
  entitling: boolean;
  status: string | null;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  modules: string[]; // optional modules the plan includes (meaningful when managed)
  limits: Record<string, number>;
}

const UNMANAGED: Entitlement = { managed: false, entitling: true, status: null, planId: null, planCode: null, planName: null, modules: [...MODULE_KEYS], limits: {} };

/**
 * What a fellowship's subscription entitles it to. This never decides who may sign in or what a role may do
 * (authentication and RBAC are untouched); it only narrows which optional modules exist for the fellowship and
 * how much it may add. A fellowship with no subscription is unmanaged and unaffected.
 */
@Injectable()
export class EntitlementsService {
  constructor(private prisma: PrismaService) {}

  async get(fellowshipId: string | null | undefined): Promise<Entitlement> {
    if (!fellowshipId) return UNMANAGED;
    const sub = await this.prisma.saasSubscription.findUnique({ where: { fellowship_id: fellowshipId }, include: { plan: true } });
    if (!sub) return UNMANAGED;
    return {
      managed: true,
      entitling: isEntitling(sub.status),
      status: sub.status,
      planId: sub.plan_id,
      planCode: sub.plan.code,
      planName: sub.plan.name,
      modules: sub.plan.modules,
      limits: (sub.plan.limits as Record<string, number>) || {},
    };
  }

  /** Optional modules this fellowship's plan does NOT entitle it to (all of them once the subscription lapses). */
  async excludedModules(fellowshipId: string | null | undefined): Promise<string[]> {
    const e = await this.get(fellowshipId);
    if (!e.managed) return [];
    if (!e.entitling) return [...MODULE_KEYS];
    return MODULE_KEYS.filter((k) => !e.modules.includes(k));
  }

  async usage(fellowshipId: string): Promise<Record<LimitKey, number>> {
    const [users, members, storage] = await Promise.all([
      this.prisma.user.count({ where: { fellowship_id: fellowshipId, deleted_at: null } }),
      this.prisma.member.count({ where: { fellowship_id: fellowshipId } }),
      this.prisma.documentEntity.aggregate({ where: { fellowship_id: fellowshipId }, _sum: { file_size: true } }),
    ]);
    return { max_users: users, max_members: members, max_storage_mb: Math.round(((storage._sum.file_size ?? 0) / (1024 * 1024)) * 100) / 100 };
  }

  /** Limits a plan would put on a fellowship that its current usage already exceeds (for plan changes). */
  async violations(fellowshipId: string, limits: Record<string, number>): Promise<{ limit: string; allowed: number; used: number }[]> {
    const used = await this.usage(fellowshipId);
    return (Object.entries(limits) as [LimitKey, number][])
      .filter(([k, allowed]) => k in used && used[k] > allowed)
      .map(([k, allowed]) => ({ limit: k, allowed, used: used[k] }));
  }

  /**
   * Call before adding `adding` units of a counted thing. Soft limit: two simultaneous additions can overshoot by
   * a unit or two (there is no lock), which is acceptable for a plan quota.
   */
  async assertWithinLimit(fellowshipId: string | null | undefined, key: LimitKey, adding = 1): Promise<void> {
    const e = await this.get(fellowshipId);
    if (!e.managed) return;
    if (!e.entitling) throw new ForbiddenException('Your fellowship\'s subscription is not active, so nothing new can be added. Please contact your platform administrator.');
    const limit = e.limits[key];
    if (limit === undefined) return;
    const used = (await this.usage(fellowshipId!))[key];
    const extra = key === 'max_storage_mb' ? adding / (1024 * 1024) : adding;
    if (used + extra > limit) {
      throw new ForbiddenException(`Your ${e.planName} plan allows at most ${limit} ${LIMITS[key].label}. Ask your platform administrator to upgrade the plan to add more.`);
    }
  }
}
