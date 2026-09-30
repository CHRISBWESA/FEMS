import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';

const DEPARTMENT_LEADER_ROLES = ['department_secretary', 'department_chairperson'];
export const MAX_PAGE = 200;
export const ACTIVE_STATUSES = ['applied', 'confirmed'] as const;
export const FILLED_STATUSES = ['confirmed', 'attended'] as const;

export type StaffMode = 'manager' | 'department' | null;

@Injectable()
export class VolunteersAccessService {
  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
    private notificationEngine: NotificationEngineService,
  ) {}

  hasPermission(user: any, permission: string): boolean {
    return ((user?.permissions as string[]) || []).includes(permission);
  }

  requirePermission(user: any, permission: string): void {
    if (!this.hasPermission(user, permission)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  isDepartmentLeader(user: any): boolean {
    const roles: string[] = user?.roles || [];
    return DEPARTMENT_LEADER_ROLES.some((r) => roles.includes(r));
  }

  // 'manager'    = volunteer.manage (fellowship-wide).
  // 'department' = a department leader with volunteer.department_manage: only their own department's opportunities.
  // null         = everyone else (they may still coordinate a specific opportunity - see canCoordinate()).
  staffMode(user: any): StaffMode {
    if (this.hasPermission(user, PERMISSIONS.VOLUNTEER_MANAGE)) return 'manager';
    if (this.hasPermission(user, PERMISSIONS.VOLUNTEER_DEPARTMENT_MANAGE) && this.isDepartmentLeader(user) && user.departmentId) return 'department';
    return null;
  }

  resolveFellowship(user: any, bodyFellowshipId?: unknown): string {
    if (bodyFellowshipId !== undefined && bodyFellowshipId !== null && bodyFellowshipId !== '' && !isUuid(bodyFellowshipId)) {
      throw new BadRequestException('fellowshipId must be a valid id');
    }
    const f = this.tenantScope.resolveFellowshipId(user, bodyFellowshipId as string | undefined);
    if (!f) throw new BadRequestException('A fellowship is required (administrators must supply fellowshipId).');
    return f;
  }

  parsePaging(limit?: unknown, page?: unknown, defaultLimit = 50): { take: number; skip: number } {
    const l = limit === undefined || limit === '' ? defaultLimit : Number(limit);
    const p = page === undefined || page === '' ? 1 : Number(page);
    if (!Number.isInteger(l) || l < 1 || l > MAX_PAGE) throw new BadRequestException(`limit must be an integer between 1 and ${MAX_PAGE}`);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return { take: l, skip: (p - 1) * l };
  }

  /** The member record linked to the signed-in account (null for accounts with no member profile). */
  async myMember(user: any): Promise<{ id: string; full_name: string; fellowship_id: string | null } | null> {
    if (!user?.userId) return null;
    return this.prisma.member.findFirst({ where: { user_id: user.userId }, select: { id: true, full_name: true, fellowship_id: true } });
  }

  async requireMyMember(user: any) {
    const m = await this.myMember(user);
    if (!m) throw new NotFoundException('No member profile is linked to your account.');
    return m;
  }

  // ---- loaders: malformed/missing ids are 404, other tenants are 403 like the rest of the app ----

  async loadOpportunity(id: string, user: any): Promise<any> {
    if (!isUuid(id)) throw new NotFoundException('Opportunity not found');
    const opp = await this.prisma.serviceOpportunity.findUnique({ where: { id } });
    if (!opp) throw new NotFoundException('Opportunity not found');
    this.tenantScope.assertInScope(user, opp);
    return opp;
  }

  async loadShift(id: string, user: any): Promise<{ shift: any; opp: any }> {
    if (!isUuid(id)) throw new NotFoundException('Shift not found');
    const shift = await this.prisma.serviceShift.findUnique({ where: { id }, include: { opportunity: true } });
    if (!shift) throw new NotFoundException('Shift not found');
    this.tenantScope.assertInScope(user, shift);
    const { opportunity, ...rest } = shift;
    return { shift: rest, opp: opportunity };
  }

  async loadAssignment(id: string, user: any): Promise<{ assignment: any; shift: any; opp: any }> {
    if (!isUuid(id)) throw new NotFoundException('Assignment not found');
    const a = await this.prisma.serviceAssignment.findUnique({ where: { id }, include: { shift: { include: { opportunity: true } }, member: { select: { id: true, full_name: true, user_id: true } } } });
    if (!a) throw new NotFoundException('Assignment not found');
    this.tenantScope.assertInScope(user, a);
    const { shift, ...assignment } = a;
    const { opportunity, ...shiftRest } = shift;
    return { assignment, shift: shiftRest, opp: opportunity };
  }

  // Managers, the owning department's leaders, and the opportunity's own coordinator.
  async canCoordinate(user: any, opp: any): Promise<boolean> {
    const mode = this.staffMode(user);
    if (mode === 'manager') return true;
    if (mode === 'department' && opp.department_id && opp.department_id === user.departmentId) return true;
    if (opp.coordinator_member_id) {
      const me = await this.myMember(user);
      if (me && me.id === opp.coordinator_member_id) return true;
    }
    return false;
  }

  async assertCanCoordinate(user: any, opp: any): Promise<void> {
    if (!(await this.canCoordinate(user, opp))) throw new ForbiddenException('You do not have permission to perform this action.');
  }

  // Changing the opportunity itself (title, status, department, coordinator): managers and the owning department only.
  assertCanManage(user: any, opp: any): void {
    const mode = this.staffMode(user);
    if (mode === 'manager') return;
    if (mode === 'department' && opp.department_id && opp.department_id === user.departmentId) return;
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  /** Who may see this opportunity at all: staff, its coordinator, or anybody once it is open. */
  async canView(user: any, opp: any): Promise<boolean> {
    if (opp.status === 'open') return true;
    return this.canCoordinate(user, opp);
  }

  // ---- reference checks (same fellowship, else "not found") ----

  async assertMember(memberId: string, fellowshipId: string | null) {
    const m = await this.prisma.member.findFirst({ where: { id: memberId, fellowship_id: fellowshipId }, select: { id: true, full_name: true, user_id: true } });
    if (!m) throw new NotFoundException('Member not found');
    return m;
  }

  async assertDepartment(departmentId: string, fellowshipId: string | null) {
    const d = await this.prisma.department.findFirst({ where: { id: departmentId, fellowship_id: fellowshipId }, select: { id: true, name: true } });
    if (!d) throw new NotFoundException('Department not found');
    return d;
  }

  // Row locks. Every code path takes the shift lock BEFORE the member lock, so two transactions can never
  // wait on each other; together they serialise capacity checks (per shift) and conflict checks (per member).
  async lockShift(tx: Prisma.TransactionClient, shiftId: string): Promise<any> {
    const rows = await tx.$queryRaw<any[]>(Prisma.sql`SELECT id, status, starts_at, ends_at, capacity, fellowship_id, opportunity_id FROM service_shifts WHERE id = ${shiftId}::uuid FOR UPDATE`);
    if (!rows.length) throw new NotFoundException('Shift not found');
    return rows[0];
  }

  async lockMember(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM members WHERE id = ${memberId}::uuid FOR UPDATE`);
  }

  // Neutral, single-purpose notification to a member's own account (if they have one).
  async notify(userId: string | null | undefined, eventType: string, title: string, message: string, entityId: string, fellowshipId: string | null): Promise<void> {
    if (!userId) return;
    await this.notificationEngine.create({ recipientUserId: userId, eventType, title, message, entityType: 'service_shift', entityId, fellowshipId });
  }
}
