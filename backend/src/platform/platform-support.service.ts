import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ROLES } from '../shared/authorization/roles';
import { MODULE_KEYS, MODULE_LABELS } from '../shared/modules/modules';
import { parsePaging, requirePermission, requireUuid, text } from './platform.util';

// The ONLY things support access can unlock. Both are read-only and free of operational content (no members,
// finance, youth, resources, volunteers, attendance...). Anything more sensitive is deliberately not grantable.
export const SUPPORT_SCOPES = ['tenant_config', 'user_directory'] as const;
const MIN_MINUTES = 15;
const MAX_MINUTES = 240;
const MAX_PENDING_PER_TENANT = 10;

/**
 * Support access replaces impersonation. A platform user asks; the fellowship's Secretary decides; an approved
 * grant is scope-limited, time-boxed, revocable at any moment, checked on every call, and every use is audited
 * against the fellowship (so the fellowship sees it in its own audit trail).
 */
@Injectable()
export class PlatformSupportService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  // ================= platform side =================

  async request(user: any, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_SUPPORT_REQUEST);
    const fellowshipId = requireUuid('fellowshipId', dto?.fellowshipId);
    const reason = text('reason', dto?.reason, { min: 10, max: 500, required: true }) as string;
    const scopes = Array.isArray(dto?.scopes) ? Array.from(new Set(dto.scopes)) : [];
    if (scopes.length === 0 || !scopes.every((s) => (SUPPORT_SCOPES as readonly string[]).includes(s as string))) {
      throw new BadRequestException(`scopes must be a non-empty list of: ${SUPPORT_SCOPES.join(', ')}`);
    }
    const minutes = dto?.durationMinutes === undefined ? 60 : Number(dto.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      throw new BadRequestException(`durationMinutes must be a whole number between ${MIN_MINUTES} and ${MAX_MINUTES}`);
    }
    const tenant = await this.prisma.fellowship.findUnique({ where: { id: fellowshipId }, select: { id: true, status: true } });
    if (!tenant) throw new NotFoundException('Fellowship not found');
    if (tenant.status !== 'active') throw new ConflictException('Support access cannot be requested for a suspended fellowship.');
    const pending = await this.prisma.supportAccessGrant.count({ where: { fellowship_id: fellowshipId, status: 'requested' } });
    if (pending >= MAX_PENDING_PER_TENANT) throw new ConflictException('This fellowship already has too many pending support requests.');
    const mine = await this.prisma.supportAccessGrant.findFirst({ where: { fellowship_id: fellowshipId, requested_by: user.userId, status: 'requested' }, select: { id: true } });
    if (mine) throw new ConflictException('You already have a pending request for this fellowship.');

    const grant = await this.prisma.supportAccessGrant.create({ data: { fellowship_id: fellowshipId, requested_by: user.userId, reason, scopes: scopes as string[], duration_minutes: minutes } });
    await this.auditService.log({ userId: user.userId, action: 'support.request', entityType: 'support_grant', entityId: grant.id, fellowshipId, newValue: { scopes, minutes } });
    // Neutral notification (the reason is shown on the Support Access screen, not in the notification).
    const secretaries = await this.prisma.user.findMany({ where: { fellowship_id: fellowshipId, deleted_at: null, is_active: true, roles: { has: ROLES.SECRETARY } }, select: { id: true }, take: 20 });
    for (const s of secretaries) {
      await this.notificationEngine.create({ recipientUserId: s.id, eventType: 'support_request', title: 'Support access requested', message: 'The platform support team has asked for temporary, read-only access. Review it under Support Access.', entityType: 'support_grant', entityId: grant.id, fellowshipId });
    }
    return this.present(grant);
  }

  async listMine(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.PLATFORM_SUPPORT_REQUEST);
    const { take, skip } = parsePaging(q.limit, q.page);
    const where: Prisma.SupportAccessGrantWhereInput = this.canSeeAll(user) ? {} : { requested_by: user.userId };
    if (q.fellowshipId) where.fellowship_id = requireUuid('fellowshipId', q.fellowshipId);
    const rows = await this.prisma.supportAccessGrant.findMany({ where, orderBy: { created_at: 'desc' }, take, skip });
    return rows.map((g) => this.present(g));
  }

  private canSeeAll(user: any) {
    return ((user?.permissions as string[]) || []).includes(PERMISSIONS.PLATFORM_TENANTS_MANAGE);
  }

  // The requester withdraws their own request / ends their own access early.
  async cancel(user: any, id: string) {
    requirePermission(user, PERMISSIONS.PLATFORM_SUPPORT_REQUEST);
    requireUuid('id', id);
    const g = await this.prisma.supportAccessGrant.findUnique({ where: { id } });
    if (!g || g.requested_by !== user.userId) throw new NotFoundException('Support grant not found');
    const flip = await this.prisma.supportAccessGrant.updateMany({ where: { id, status: { in: ['requested', 'approved'] } }, data: { status: 'revoked', revoked_at: new Date() } });
    if (flip.count !== 1) throw new ConflictException('This grant is already closed.');
    await this.auditService.log({ userId: user.userId, action: 'support.cancel', entityType: 'support_grant', entityId: id, fellowshipId: g.fellowship_id });
    return { closed: true };
  }

  // Every read goes through this: an approved, unexpired grant of THIS user, for THIS fellowship, covering THIS scope.
  private async activeGrant(user: any, fellowshipId: string, scope: (typeof SUPPORT_SCOPES)[number]) {
    requirePermission(user, PERMISSIONS.PLATFORM_SUPPORT_VIEW);
    requireUuid('fellowshipId', fellowshipId);
    const grant = await this.prisma.supportAccessGrant.findFirst({
      where: { fellowship_id: fellowshipId, requested_by: user.userId, status: 'approved', expires_at: { gt: new Date() }, scopes: { has: scope } },
      orderBy: { expires_at: 'desc' },
    });
    if (!grant) throw new ForbiddenException('No active support access for this fellowship and scope.');
    return grant;
  }

  async viewConfig(user: any, fellowshipId: string) {
    const grant = await this.activeGrant(user, fellowshipId, 'tenant_config');
    const [t, departments, roleRows, settings] = await Promise.all([
      this.prisma.fellowship.findUnique({ where: { id: fellowshipId } }),
      this.prisma.department.findMany({ where: { fellowship_id: fellowshipId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }),
      this.prisma.$queryRaw<{ role: string; count: number }[]>(Prisma.sql`SELECT r AS role, COUNT(*)::int AS count FROM users u, unnest(u.roles) AS r WHERE u.fellowship_id = ${fellowshipId}::uuid AND u.deleted_at IS NULL GROUP BY r ORDER BY r`),
      this.prisma.fellowshipModuleSetting.findMany({ where: { fellowship_id: fellowshipId } }),
    ]);
    if (!t) throw new NotFoundException('Fellowship not found');
    const off = new Set(settings.filter((s) => !s.enabled).map((s) => s.module_key));
    await this.auditService.log({ userId: user.userId, action: 'support.view_config', entityType: 'support_grant', entityId: grant.id, fellowshipId });
    return {
      grant: { id: grant.id, expiresAt: grant.expires_at },
      fellowship: { id: t.id, name: t.name, location: t.location, description: t.description, status: t.status },
      modules: MODULE_KEYS.map((k) => ({ key: k, label: MODULE_LABELS[k], enabled: !off.has(k) })),
      departments,
      accountsByRole: roleRows,
    };
  }

  // Account directory for troubleshooting sign-in problems: no phone numbers, no password data, no member records.
  async viewUsers(user: any, fellowshipId: string, q: Record<string, string> = {}) {
    const grant = await this.activeGrant(user, fellowshipId, 'user_directory');
    const { take, skip } = parsePaging(q.limit, q.page, 50);
    const rows = await this.prisma.user.findMany({
      where: { fellowship_id: fellowshipId, deleted_at: null }, orderBy: { created_at: 'asc' }, take, skip,
      select: { id: true, email: true, first_name: true, last_name: true, roles: true, is_active: true, must_change_password: true, created_at: true },
    });
    await this.auditService.log({ userId: user.userId, action: 'support.view_users', entityType: 'support_grant', entityId: grant.id, fellowshipId, newValue: { returned: rows.length } });
    return rows.map((r) => ({ id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name, roles: r.roles, isActive: r.is_active, mustChangePassword: r.must_change_password, createdAt: r.created_at }));
  }

  // ================= fellowship side (the Secretary) =================

  private requireSecretaryOfTenant(user: any): string {
    requirePermission(user, PERMISSIONS.SUPPORT_ACCESS_MANAGE);
    if (!user.fellowshipId) throw new ForbiddenException('You are not part of a fellowship.');
    return user.fellowshipId as string;
  }

  async listForTenant(user: any) {
    const fellowshipId = this.requireSecretaryOfTenant(user);
    const rows = await this.prisma.supportAccessGrant.findMany({ where: { fellowship_id: fellowshipId }, orderBy: { created_at: 'desc' }, take: 100 });
    const people = await this.prisma.user.findMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.requested_by))) } }, select: { id: true, first_name: true, last_name: true } });
    const name = new Map(people.map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
    return rows.map((g) => ({ ...this.present(g), requestedByName: name.get(g.requested_by) ?? 'Platform support', reason: g.reason }));
  }

  private async loadForTenant(user: any, id: string) {
    const fellowshipId = this.requireSecretaryOfTenant(user);
    requireUuid('id', id);
    const g = await this.prisma.supportAccessGrant.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Support grant not found');
    if (g.fellowship_id !== fellowshipId) throw new ForbiddenException('You do not have access to this record');
    return g;
  }

  async decide(user: any, id: string, dto: any) {
    const g = await this.loadForTenant(user, id);
    const decision = dto?.decision;
    if (decision !== 'approve' && decision !== 'deny') throw new BadRequestException('decision must be approve or deny');
    const now = new Date();
    const flip = await this.prisma.supportAccessGrant.updateMany({
      where: { id, status: 'requested' },
      data: decision === 'approve'
        ? { status: 'approved', decided_by: user.userId, decided_at: now, expires_at: new Date(now.getTime() + g.duration_minutes * 60_000) }
        : { status: 'denied', decided_by: user.userId, decided_at: now },
    });
    if (flip.count !== 1) throw new ConflictException('This request has already been decided.');
    await this.auditService.log({ userId: user.userId, action: `support.grant_${decision}`, entityType: 'support_grant', entityId: id, fellowshipId: g.fellowship_id, newValue: { scopes: g.scopes, minutes: g.duration_minutes } });
    await this.notificationEngine.create({ recipientUserId: g.requested_by, eventType: 'support_decision', title: 'Support access decision', message: decision === 'approve' ? 'Your support access request was approved.' : 'Your support access request was declined.', entityType: 'support_grant', entityId: id, fellowshipId: g.fellowship_id });
    return this.present((await this.prisma.supportAccessGrant.findUnique({ where: { id } }))!);
  }

  // Takes effect on the very next support request: every call re-checks the grant.
  async revoke(user: any, id: string) {
    const g = await this.loadForTenant(user, id);
    const flip = await this.prisma.supportAccessGrant.updateMany({ where: { id, status: 'approved' }, data: { status: 'revoked', revoked_at: new Date() } });
    if (flip.count !== 1) throw new ConflictException('Only an approved grant can be revoked.');
    await this.auditService.log({ userId: user.userId, action: 'support.grant_revoke', entityType: 'support_grant', entityId: id, fellowshipId: g.fellowship_id });
    return { revoked: true };
  }

  private present(g: any) {
    const live = g.status === 'approved' && g.expires_at && g.expires_at > new Date();
    return {
      id: g.id, fellowshipId: g.fellowship_id, requestedBy: g.requested_by, scopes: g.scopes, durationMinutes: g.duration_minutes,
      status: g.status === 'approved' && !live ? 'expired' : g.status, decidedAt: g.decided_at, expiresAt: g.expires_at, createdAt: g.created_at,
    };
  }
}
