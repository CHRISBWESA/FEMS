import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { PLATFORM_ROLES, permissionsForRoles } from '../shared/authorization/roles';
import { parsePaging, requirePermission, requireUuid, text } from './platform.util';

// A platform administrator may act as a fellowship user, but only inside hard limits:
//   * the target must be a real, active TENANT account - a platform account can never be impersonated;
//   * a reason is mandatory and is shown to the client;
//   * the session is time-boxed and expires on its own, with no way to extend it;
//   * the client is notified, sees the session in their own audit trail, and can end it at any moment;
//   * the administrator's real identity is kept on every entry, so the trail cannot be laundered.
// The one-time-code step is deliberately left for later: `approval_token`/`approved_at` already exist, so adding
// it needs no migration. Until then the client is notified and can revoke, which is what makes this defensible.
const MIN_MINUTES = 5;
const MAX_MINUTES = 120;
const DEFAULT_MINUTES = 30;

@Injectable()
export class ImpersonationService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private notifications: NotificationEngineService,
  ) {}

  // ---------- platform side ----------

  /** Accounts an administrator may act as: active, non-deleted, tenant accounts only. */
  async targets(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.ADMIN_IMPERSONATE);
    const { take, skip } = parsePaging(q.limit, q.page, 50);
    const search = text('search', q.search, { max: 100 });
    const where: Prisma.UserWhereInput = {
      deleted_at: null,
      is_active: true,
      // A platform account belongs to no fellowship; impersonating one would be a no-op at best and a
      // privilege-escalation route at worst.
      fellowship_id: { not: null },
      NOT: { roles: { hasSome: [...PLATFORM_ROLES] } },
    };
    if (q.fellowshipId) where.fellowship_id = requireUuid('fellowshipId', q.fellowshipId);
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [rows, total, fells] = await Promise.all([
      this.prisma.user.findMany({
        where, orderBy: { created_at: 'asc' }, take, skip,
        select: { id: true, email: true, first_name: true, last_name: true, roles: true, fellowship_id: true, must_change_password: true },
      }),
      this.prisma.user.count({ where }),
      this.prisma.fellowship.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const nameOf = new Map(fells.map((f) => [f.id, f.name]));
    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        name: `${r.first_name} ${r.last_name}`.trim(),
        email: r.email,
        roles: r.roles,
        fellowshipId: r.fellowship_id,
        fellowship: nameOf.get(r.fellowship_id as string) ?? null,
      })),
    };
  }

  /**
   * Start acting as a tenant user. Returns a token for the TARGET, not the administrator: from here on every
   * request is authorised as that person, which is the point, while the session row keeps the real actor.
   */
  async start(user: any, dto: any) {
    requirePermission(user, PERMISSIONS.ADMIN_IMPERSONATE);
    const targetUserId = requireUuid('targetUserId', dto?.targetUserId);
    const reason = text('reason', dto?.reason, { min: 10, max: 500, required: true }) as string;
    const minutes = dto?.durationMinutes === undefined ? DEFAULT_MINUTES : Number(dto.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      throw new BadRequestException(`durationMinutes must be a whole number between ${MIN_MINUTES} and ${MAX_MINUTES}`);
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, first_name: true, last_name: true, roles: true, fellowship_id: true, is_active: true, deleted_at: true, token_version: true, department_id: true, must_change_password: true },
    });
    if (!target || target.deleted_at || !target.is_active) throw new NotFoundException('That account is not available.');
    if (!target.fellowship_id) {
      throw new ForbiddenException('A platform account cannot be impersonated. Only fellowship accounts can.');
    }
    if ((target.roles || []).some((r) => PLATFORM_ROLES.has(r as any))) {
      throw new ForbiddenException('That account holds a platform role and cannot be impersonated.');
    }

    const tenant = await this.prisma.fellowship.findUnique({ where: { id: target.fellowship_id }, select: { id: true, name: true, status: true } });
    if (!tenant) throw new NotFoundException('Fellowship not found');
    if (tenant.status !== 'active') {
      throw new ConflictException('That fellowship is suspended, so its accounts cannot be signed in.');
    }

    // One live session per administrator: a second tab must not quietly create a second identity.
    const live = await this.prisma.impersonationSession.findFirst({
      where: { admin_user_id: user.userId, status: 'active', expires_at: { gt: new Date() } },
      select: { id: true },
    });
    if (live) throw new ConflictException('You already have an active impersonation session. End it first.');

    const now = new Date();
    const session = await this.prisma.impersonationSession.create({
      data: {
        admin_user_id: user.userId,
        target_user_id: target.id,
        target_email: target.email,
        fellowship_id: target.fellowship_id,
        reason,
        // No client approval is required yet, so the session is live the moment it is created. The token is
        // unused until the one-time-code step; it is NOT a secret anyone can act on today.
        approval_token: 'not-required',
        status: 'active',
        approved_at: now,
        started_at: now,
        expires_at: new Date(now.getTime() + minutes * 60_000),
      },
    });

    const roles = target.roles || [];
    const payload = {
      sub: target.id,
      email: target.email,
      roles,
      permissions: permissionsForRoles(roles),
      departmentId: target.department_id,
      mustChangePassword: !!target.must_change_password,
      tv: target.token_version ?? 0,
      // Carried in the token so the strategy re-checks the session on every single request.
      imp: session.id,
      impBy: user.userId,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any });
    // The impersonation token can never be exchanged for a refresh token, so it cannot outlive the session.
    const refreshToken = this.jwt.sign(
      { sub: target.id, tokenType: 'refresh', tv: target.token_version ?? 0, imp: session.id },
      { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any },
    );

    // Tell the person being acted as. This is what makes the session defensible without a code: the client is
    // notified, the entry lands in their own trail, and they can end it.
    await this.notifications.create({
      recipientUserId: target.id,
      eventType: 'impersonation_started',
      title: 'Platform support signed in as you',
      message: `A platform administrator is acting as your account until ${new Date(session.expires_at!).toLocaleString()}. Reason: ${reason}`,
      entityType: 'impersonation_session',
      entityId: session.id,
      fellowshipId: target.fellowship_id,
    });
    await this.audit.log({
      userId: user.userId,
      action: 'impersonation.start',
      entityType: 'impersonation_session',
      entityId: session.id,
      fellowshipId: target.fellowship_id,
      comment: reason,
      impersonationSessionId: session.id,
      newValue: { targetEmail: target.email, targetRoles: roles, minutes, fellowship: tenant.name },
    });
    // A second entry in the CLIENT's trail, so it is visible to anyone who reads the fellowship's audit and
    // not only to the administrator.
    await this.audit.log({
      userId: user.userId,
      action: 'impersonation.start',
      entityType: 'impersonation_session',
      entityId: session.id,
      fellowshipId: target.fellowship_id,
      comment: `A platform administrator began acting as ${target.email}. Reason: ${reason}`,
      impersonationSessionId: session.id,
      newValue: { targetUserId: target.id, targetEmail: target.email, minutes, expiresAt: session.expires_at },
    });

    return {
      session: this.present(session),
      accessToken,
      refreshToken,
      target: { id: target.id, name: `${target.first_name} ${target.last_name}`.trim(), email: target.email, fellowship: tenant.name },
      note: 'Every action is recorded against both the administrator and this account. The fellowship can end the session at any time.',
    };
  }

  /** End early. Callable by the administrator or by the impersonated user - that is the point. */
  async end(user: any, id: string, dto: any, opts: { asClient?: boolean } = {}) {
    requireUuid('id', id);
    const session = await this.prisma.impersonationSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');

    if (!opts.asClient) requirePermission(user, PERMISSIONS.ADMIN_IMPERSONATE);
    // A client may only end a session aimed at them; an administrator may only end their own.
    else if (session.target_user_id !== user.userId) {
      throw new ForbiddenException('This session is not one of yours.');
    }
    if (session.admin_user_id !== user.userId && !opts.asClient) {
      throw new ForbiddenException('This is not your impersonation session.');
    }
    if (session.status !== 'active') throw new ConflictException('This session has already ended.');

    const endReason = text('reason', dto?.reason, { max: 300 });
    const ended = await this.prisma.impersonationSession.update({
      where: { id },
      data: { status: 'expired', ended_at: new Date(), ended_by: user.userId, end_reason: endReason ?? (opts.asClient ? 'Ended by the account holder' : 'Ended by the administrator') },
    });
    await this.audit.log({
      userId: user.userId,
      action: 'impersonation.end',
      entityType: 'impersonation_session',
      entityId: id,
      fellowshipId: session.fellowship_id,
      comment: endReason ?? (opts.asClient ? 'Ended by the account holder' : 'Ended by the administrator'),
      impersonationSessionId: id,
      newValue: { startedAt: session.started_at, expiresAt: session.expires_at, endedBy: opts.asClient ? 'the account holder' : 'the administrator' },
    });
    return this.present(ended);
  }

  async list(user: any, q: Record<string, string> = {}) {
    requirePermission(user, PERMISSIONS.ADMIN_IMPERSONATE);
    const { take, skip } = parsePaging(q.limit, q.page, 50);
    const where: Prisma.ImpersonationSessionWhereInput = {};
    if (q.status) {
      if (!['requested', 'approved', 'active', 'expired', 'cancelled'].includes(q.status)) {
        throw new BadRequestException('status must be requested, approved, active, expired or cancelled');
      }
      where.status = q.status as any;
    }
    const [rows, total] = await Promise.all([
      this.prisma.impersonationSession.findMany({ where, orderBy: { created_at: 'desc' }, take, skip }),
      this.prisma.impersonationSession.count({ where }),
    ]);
    const adminIds = Array.from(new Set(rows.map((r) => r.admin_user_id)));
    const people = adminIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, first_name: true, last_name: true, email: true } })
      : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    return {
      total,
      data: rows.map((r) => ({
        ...this.present(r),
        admin: byId.get(r.admin_user_id)
          ? { id: r.admin_user_id, name: `${byId.get(r.admin_user_id)!.first_name} ${byId.get(r.admin_user_id)!.last_name}`.trim(), email: byId.get(r.admin_user_id)!.email }
          : { id: r.admin_user_id, name: 'Unknown administrator', email: null },
        // A session past its expiry is reported as ended even if nothing has swept the row yet.
        live: r.status === 'active' && !!r.expires_at && r.expires_at > new Date(),
      })),
    };
  }

  /** What the impersonated person can see and act on: their own live session. */
  async myActiveSession(user: any) {
    const session = await this.prisma.impersonationSession.findFirst({
      where: { target_user_id: user.userId, status: 'active', expires_at: { gt: new Date() } },
      orderBy: { started_at: 'desc' },
    });
    if (!session) return { active: false, session: null };
    const admin = await this.prisma.user.findUnique({ where: { id: session.admin_user_id }, select: { first_name: true, last_name: true } });
    return {
      active: true,
      session: {
        id: session.id,
        reason: session.reason,
        startedAt: session.started_at,
        expiresAt: session.expires_at,
        adminName: admin ? `${admin.first_name} ${admin.last_name}`.trim() : 'A platform administrator',
      },
    };
  }

  private present(s: any) {
    return {
      id: s.id, targetUserId: s.target_user_id, targetEmail: s.target_email, fellowshipId: s.fellowship_id,
      reason: s.reason, status: s.status, startedAt: s.started_at, expiresAt: s.expires_at,
      endedAt: s.ended_at, endReason: s.end_reason, createdAt: s.created_at,
    };
  }
}
