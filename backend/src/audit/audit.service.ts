import { Injectable, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLog, Prisma } from '@prisma/client';
import { isPlatformPrincipal } from '../shared/authorization/platform-boundary.guard';

export interface AuditFilters {
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown) => typeof v === 'string' && UUID_RE.test(v);

@Injectable()
export class AuditQueryService {
  private readonly logger = new Logger(AuditQueryService.name);

  constructor(private prisma: PrismaService) {}

  private assertCanView(currentUser: any): void {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('chairperson') && !roles.includes('assistant_chairperson')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  // Who may read which entries:
  //  - a fellowship's secretary/chairperson: only entries of THEIR fellowship (previously every fellowship's
  //    entries were readable by any secretary or chairperson);
  //  - the platform administrator: only platform-level entries (platform.* / support.* actions and anything done
  //    by a platform account) - never the operational audit trail of a tenant, whose old/new values can hold
  //    member or finance data.
  private async scope(currentUser: any): Promise<Prisma.AuditLogWhereInput> {
    if (isPlatformPrincipal(currentUser.roles)) {
      const platformUsers = await this.prisma.user.findMany({
        where: { OR: [{ roles: { has: 'admin' } }, { roles: { has: 'platform_support' } }] },
        select: { id: true },
        take: 1000,
      });
      return {
        OR: [
          { action: { startsWith: 'platform.' } },
          { action: { startsWith: 'support.' } },
          { user_id: { in: platformUsers.map((u) => u.id) } },
        ],
      };
    }
    // The nil UUID matches nothing: an account with no fellowship sees no entries.
    return { fellowship_id: currentUser.fellowshipId ?? '00000000-0000-0000-0000-000000000000' };
  }

  async findAll(filters: AuditFilters, currentUser: any): Promise<{ data: any[]; total: number }> {
    this.assertCanView(currentUser);

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
    const skip = (page - 1) * limit;

    const and: Prisma.AuditLogWhereInput[] = [await this.scope(currentUser)];
    if (filters.userId) {
      if (!isUuid(filters.userId)) throw new BadRequestException('userId must be a valid id');
      and.push({ user_id: filters.userId });
    }
    if (filters.action) and.push({ action: { contains: String(filters.action), mode: 'insensitive' } });
    if (filters.entityType) and.push({ entity_type: String(filters.entityType) });
    if (filters.entityId) {
      if (!isUuid(filters.entityId)) throw new BadRequestException('entityId must be a valid id');
      and.push({ entity_id: filters.entityId });
    }
    if (filters.from || filters.to) {
      const ts: Prisma.DateTimeFilter = {};
      if (filters.from) {
        const d = new Date(filters.from);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('from must be a valid date');
        ts.gte = d;
      }
      if (filters.to) {
        const d = new Date(filters.to);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('to must be a valid date');
        ts.lte = d;
      }
      and.push({ timestamp: ts });
    }
    const where: Prisma.AuditLogWhereInput = { AND: and };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip, take: limit }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Resolve actors in one query so the trail can show a name instead of a bare UUID. The original
    // user_id is kept on each row, so nothing that relied on it changes.
    const actorIds = Array.from(new Set(data.map((r) => r.user_id).filter((v): v is string => !!v)));
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, first_name: true, last_name: true, email: true, roles: true } })
      : [];
    const actorBy = new Map(actors.map((a) => [a.id, a]));

    return {
      total,
      data: data.map((r) => {
        const actor = r.user_id ? actorBy.get(r.user_id) : undefined;
        return {
          ...r,
          actor: actor
            ? { id: actor.id, name: `${actor.first_name} ${actor.last_name}`.trim(), email: actor.email, roles: actor.roles }
            : r.user_id
              ? { id: r.user_id, name: 'Deleted or unknown account', email: null, roles: [] }
              : null,
        };
      }),
    };
  }

  async getStats(currentUser: any): Promise<any> {
    this.assertCanView(currentUser);
    const where = await this.scope(currentUser);
    const [totalEntries, recentActions] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, take: 20 }),
    ]);

    return { totalEntries, recentActions };
  }

  /**
   * The platform administrator's own view. Same scope() guarantee as findAll (platform.* / support.* entries and
   * anything a platform account did), but the rows are resolved to a readable actor and tenant and the free-form
   * payload columns are dropped: nothing in the platform audit screen renders them, and old_value/new_value can
   * hold tenant-adjacent detail that has no business travelling to a browser.
   */
  async findForPlatform(filters: AuditFilters, currentUser: any): Promise<{ data: any[]; total: number }> {
    this.assertCanView(currentUser);

    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
    const skip = (page - 1) * limit;

    const and: Prisma.AuditLogWhereInput[] = [await this.scope(currentUser)];
    if (filters.userId) {
      if (!UUID_RE.test(String(filters.userId))) throw new BadRequestException('userId must be a valid id');
      and.push({ user_id: String(filters.userId) });
    }
    if (filters.action) and.push({ action: { contains: String(filters.action), mode: 'insensitive' as const } });
    if (filters.entityType) and.push({ entity_type: String(filters.entityType) });
    if (filters.from || filters.to) {
      const ts: Prisma.DateTimeFilter = {};
      if (filters.from) {
        const d = new Date(String(filters.from));
        if (Number.isNaN(d.getTime())) throw new BadRequestException('from must be a valid date');
        ts.gte = d;
      }
      if (filters.to) {
        const d = new Date(String(filters.to));
        if (Number.isNaN(d.getTime())) throw new BadRequestException('to must be a valid date');
        ts.lte = d;
      }
      and.push({ timestamp: ts });
    }
    const where: Prisma.AuditLogWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, timestamp: true, action: true, entity_type: true, entity_id: true,
          user_id: true, fellowship_id: true, comment: true, ip_address: true, device_info: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Resolve actors and tenants in two queries rather than one per row.
    const actorIds = Array.from(new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v)));
    const tenantIds = Array.from(new Set(rows.map((r) => r.fellowship_id).filter((v): v is string => !!v)));
    const [actors, tenants] = await Promise.all([
      actorIds.length
        ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, first_name: true, last_name: true, email: true, roles: true } })
        : ([] as { id: string; first_name: string; last_name: string; email: string; roles: string[] }[]),
      tenantIds.length
        ? this.prisma.fellowship.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
        : ([] as { id: string; name: string }[]),
    ]);
    const actorBy = new Map<string, (typeof actors)[number]>(actors.map((a) => [a.id, a]));
    const tenantBy = new Map<string, string>(tenants.map((t) => [t.id, t.name]));

    return {
      total,
      data: rows.map((r) => {
        const actor = r.user_id ? actorBy.get(r.user_id) : undefined;
        return {
          id: r.id,
          timestamp: r.timestamp,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          comment: r.comment,
          ipAddress: r.ip_address,
          deviceInfo: r.device_info,
          actor: actor
            ? { id: actor.id, name: `${actor.first_name} ${actor.last_name}`.trim(), email: actor.email, roles: actor.roles }
            : r.user_id
              ? { id: r.user_id, name: 'Deleted or unknown account', email: null, roles: [] }
              : null,
          tenant: r.fellowship_id ? { id: r.fellowship_id, name: tenantBy.get(r.fellowship_id) ?? 'Unknown fellowship' } : null,
        };
      }),
    };
  }
}
