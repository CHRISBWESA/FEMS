import { Injectable, ForbiddenException } from '@nestjs/common';
import { ROLES } from '../authorization/roles';

export interface RequesterLike {
  userId?: string;
  roles?: string[];
  fellowshipId?: string | null;
}

/**
 * Central multi-tenancy helper.
 *
 * Rules:
 *  - An `admin` is global: they see every fellowship. When a `queryFellowshipId`
 *    is supplied they are narrowed to that fellowship only.
 *  - Every other role is strictly scoped to the fellowship on their own user record.
 *    Records without a matching `fellowship_id` are invisible to them.
 */
@Injectable()
export class TenantScopeService {
  isAdmin(user?: RequesterLike): boolean {
    return !!user?.roles?.includes(ROLES.ADMIN);
  }

  /** Merge the requester's fellowship scope into a Prisma `where`. */
  scopeWhere(
    user: RequesterLike | undefined,
    extra?: Record<string, any>,
    queryFellowshipId?: string,
  ): Record<string, any> {
    const where = { ...(extra || {}) };
    if (!user) return where;
    if (this.isAdmin(user)) {
      if (queryFellowshipId) where.fellowship_id = queryFellowshipId;
      return where;
    }
    where.fellowship_id = user.fellowshipId ?? '__unscoped__';
    return where;
  }

  /** Resolve the fellowship_id to stamp on a record being created by this requester. */
  resolveFellowshipId(user: RequesterLike | undefined, bodyFellowshipId?: string): string | null {
    if (this.isAdmin(user)) {
      return bodyFellowshipId ?? null;
    }
    return user?.fellowshipId ?? null;
  }

  /** Ensure a single record is within the requester's scope. */
  assertInScope(
    user: RequesterLike | undefined,
    record: { fellowship_id?: string | null } | null,
    queryFellowshipId?: string,
  ): void {
    if (!user || !record) return;
    if (this.isAdmin(user)) {
      if (queryFellowshipId && record.fellowship_id !== queryFellowshipId) {
        throw new ForbiddenException('Not accessible in the selected fellowship');
      }
      return;
    }
    if (record.fellowship_id !== (user.fellowshipId ?? '__unscoped__')) {
      throw new ForbiddenException('You do not have access to this record');
    }
  }
}
