import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../shared/utils/uuid.util';

export type LeaderRole = 'department_chairperson' | 'department_secretary';

/** Central fellowship officers who may SEE all finances (oversight). Only the Treasurer manages central money. */
export const CENTRAL_VIEWERS = ['treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson'];

/**
 * Who may see and who may act on which money.
 *
 *  - Central fellowship finances (department_id = null): managed by the Treasurer; overseen (read-only) by the
 *    Fellowship Secretary and Chairperson and their assistants.
 *  - A department's finances (department_id = X): managed by X's CURRENT leaders (read from the database on every
 *    request, so a replaced leader loses access at once); the Treasurer and central officers have oversight.
 *    A department never sees another department's private records.
 */
@Injectable()
export class FinanceScopeService {
  constructor(private prisma: PrismaService) {}

  roles(user: any): string[] {
    return (user?.roles as string[]) || [];
  }

  has(user: any, ...roles: string[]): boolean {
    const mine = this.roles(user);
    return roles.some((r) => mine.includes(r));
  }

  isTreasurer(user: any) { return this.has(user, 'treasurer'); }
  isCentralViewer(user: any) { return this.has(user, ...CENTRAL_VIEWERS); }
  isSecretary(user: any) { return this.has(user, 'secretary', 'assistant_secretary'); }
  isChair(user: any) { return this.has(user, 'chairperson', 'assistant_chairperson'); }

  fellowship(user: any): string {
    if (!user?.fellowshipId) throw new ForbiddenException('You do not have permission to perform this action.');
    return user.fellowshipId;
  }

  /** The department ids this user currently leads, with the office held in each. */
  async leaderships(user: any): Promise<Map<string, LeaderRole>> {
    const map = new Map<string, LeaderRole>();
    if (!user?.userId || !user?.fellowshipId) return map;
    const rows = await this.prisma.departmentLeader.findMany({
      where: { user_id: user.userId, active_role: { not: null }, department: { fellowship_id: user.fellowshipId, is_active: true } },
      select: { department_id: true, active_role: true },
    });
    for (const r of rows) map.set(r.department_id, r.active_role as LeaderRole);
    return map;
  }

  async leaderRole(user: any, departmentId: string): Promise<LeaderRole | null> {
    return (await this.leaderships(user)).get(departmentId) ?? null;
  }

  /** A department of the caller's fellowship (404 for anything else, so ids cannot be probed). */
  async department(user: any, departmentId: string) {
    const fellowshipId = this.fellowship(user);
    if (!isUuid(departmentId)) throw new NotFoundException('Department not found');
    const d = await this.prisma.department.findFirst({ where: { id: departmentId, fellowship_id: fellowshipId }, select: { id: true, name: true, is_active: true } });
    if (!d) throw new NotFoundException('Department not found');
    return d;
  }

  /** May this user SEE the finances of this scope (null = central)? */
  async requireView(user: any, departmentId: string | null): Promise<void> {
    this.fellowship(user);
    if (this.isCentralViewer(user)) {
      if (departmentId) await this.department(user, departmentId);
      return;
    }
    if (departmentId && (await this.leaderRole(user, departmentId))) return;
    throw new ForbiddenException(departmentId ? 'You can only see the finances of a department you lead.' : 'You do not have access to the fellowship\'s central finances.');
  }

  /**
   * May this user RECORD money for this scope? Central: the Treasurer (plus any extra central roles named).
   * Department: a current leader of that department (or only the named office).
   */
  async requireManage(user: any, departmentId: string | null, opts: { central?: string[]; office?: LeaderRole } = {}): Promise<LeaderRole | 'central'> {
    this.fellowship(user);
    if (!departmentId) {
      if (this.has(user, ...(opts.central ?? ['treasurer']))) return 'central';
      throw new ForbiddenException('Only the Treasurer manages the fellowship\'s central finances.');
    }
    await this.department(user, departmentId);
    const role = await this.leaderRole(user, departmentId);
    if (!role) throw new ForbiddenException('Only the current leaders of this department can manage its finances.');
    if (opts.office && role !== opts.office) {
      throw new ForbiddenException(opts.office === 'department_chairperson' ? 'Only the Department Chairperson can do this.' : 'Only the Department Secretary can do this.');
    }
    return role;
  }

  /**
   * The department filter for a list. Central viewers see everything, or narrow with ?departmentId=<id> / =central.
   * Department leaders see only departments they lead (and never central records).
   */
  async listScope(user: any, departmentIdQuery?: string): Promise<{ department_id?: any }> {
    this.fellowship(user);
    if (departmentIdQuery !== undefined && departmentIdQuery !== '' && departmentIdQuery !== 'central' && !isUuid(departmentIdQuery)) {
      throw new BadRequestException('departmentId must be a valid id');
    }
    if (this.isCentralViewer(user)) {
      if (departmentIdQuery === 'central') return { department_id: null };
      if (departmentIdQuery) return { department_id: departmentIdQuery };
      return {};
    }
    const led = Array.from((await this.leaderships(user)).keys());
    if (departmentIdQuery && departmentIdQuery !== 'central') {
      if (!led.includes(departmentIdQuery)) throw new ForbiddenException('You can only see the finances of a department you lead.');
      return { department_id: departmentIdQuery };
    }
    if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
    return { department_id: { in: led } };
  }

  /** Current leaders of a department (for notifications). */
  async departmentLeaderIds(departmentId: string, office?: LeaderRole): Promise<string[]> {
    const rows = await this.prisma.departmentLeader.findMany({
      where: { department_id: departmentId, active_role: office ?? { not: null } },
      select: { user_id: true },
    });
    return Array.from(new Set(rows.map((r) => r.user_id)));
  }

  async usersWithRoles(fellowshipId: string, roles: string[]): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { fellowship_id: fellowshipId, roles: { hasSome: roles }, is_active: true, deleted_at: null },
      select: { id: true },
      take: 50,
    });
    return users.map((u) => u.id);
  }
}
