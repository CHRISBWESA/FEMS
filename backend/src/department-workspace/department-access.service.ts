import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../shared/utils/uuid.util';
import { LeaderRole } from './department.util';

export interface LeaderDepartment {
  departmentId: string;
  name: string;
  description: string | null;
  role: LeaderRole;
  since: Date;
}

/**
 * The single place that decides who may act for a department.
 *
 * A department leader's access comes from their CURRENT leadership appointments (department_leaders rows with an
 * active_role), read from the database on every request. Replacing a leader therefore revokes their access to that
 * department immediately, and a person who leads two departments can act for both and for no other.
 */
@Injectable()
export class DepartmentAccessService {
  constructor(private prisma: PrismaService) {}

  roles(user: any): string[] {
    return (user?.roles as string[]) || [];
  }

  /** The Fellowship Secretary's office (the Assistant Secretary deputises). */
  isFellowshipSecretary(user: any): boolean {
    const r = this.roles(user);
    return r.includes('secretary') || r.includes('assistant_secretary');
  }

  isFellowshipChair(user: any): boolean {
    const r = this.roles(user);
    return r.includes('chairperson') || r.includes('assistant_chairperson');
  }

  isTreasurer(user: any): boolean {
    return this.roles(user).includes('treasurer');
  }

  requireFellowship(user: any): string {
    if (!user?.fellowshipId)
      throw new ForbiddenException('You do not have permission to perform this action.');
    return user.fellowshipId;
  }

  requireSecretary(user: any): string {
    if (!this.isFellowshipSecretary(user)) {
      throw new ForbiddenException('Only the Fellowship Secretary can do this.');
    }
    return this.requireFellowship(user);
  }

  /** Every department this user currently leads (active departments of their own fellowship only). */
  async leaderDepartments(user: any): Promise<LeaderDepartment[]> {
    if (!user?.userId || !user?.fellowshipId) return [];
    const rows = await this.prisma.departmentLeader.findMany({
      where: {
        user_id: user.userId,
        active_role: { not: null },
        department: { fellowship_id: user.fellowshipId, is_active: true },
      },
      include: { department: { select: { id: true, name: true, description: true } } },
      orderBy: { start_date: 'asc' },
    });
    return rows.map((r) => ({
      departmentId: r.department.id,
      name: r.department.name,
      description: r.department.description,
      role: r.active_role as LeaderRole,
      since: r.start_date,
    }));
  }

  /**
   * The department, if the user currently leads it. Anything else - a bad id, another fellowship's department, a
   * department they used to lead - is refused the same way, so ids cannot be probed.
   */
  async assertLeader(
    user: any,
    departmentId: string,
  ): Promise<{ department: any; role: LeaderRole }> {
    if (!isUuid(departmentId) || !user?.fellowshipId)
      throw new NotFoundException('Department not found');
    const row = await this.prisma.departmentLeader.findFirst({
      where: {
        department_id: departmentId,
        user_id: user.userId,
        active_role: { not: null },
        department: { fellowship_id: user.fellowshipId },
      },
      include: { department: true },
    });
    if (!row) throw new ForbiddenException('You are not a current leader of this department.');
    if (!row.department.is_active) throw new ForbiddenException('This department is inactive.');
    return { department: row.department, role: row.active_role as LeaderRole };
  }

  /** A department of the caller's own fellowship (used by the Secretary and reviewers). */
  async loadInFellowship(user: any, departmentId: string): Promise<any> {
    const fellowshipId = this.requireFellowship(user);
    if (!isUuid(departmentId)) throw new NotFoundException('Department not found');
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department || department.fellowship_id !== fellowshipId)
      throw new NotFoundException('Department not found');
    return department;
  }

  /** User ids of a department's current leaders (for notifications). */
  async currentLeaderUserIds(departmentId: string): Promise<string[]> {
    const rows = await this.prisma.departmentLeader.findMany({
      where: { department_id: departmentId, active_role: { not: null } },
      select: { user_id: true },
    });
    return Array.from(new Set(rows.map((r) => r.user_id)));
  }

  /** Active accounts of the fellowship holding any of these roles. */
  async usersWithRoles(fellowshipId: string | null, roles: string[]): Promise<string[]> {
    if (!fellowshipId) return [];
    const users = await this.prisma.user.findMany({
      where: {
        fellowship_id: fellowshipId,
        roles: { hasSome: roles },
        is_active: true,
        deleted_at: null,
      },
      select: { id: true },
      take: 50,
    });
    return users.map((u) => u.id);
  }
}
