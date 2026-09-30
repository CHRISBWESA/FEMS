import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from './member.util';

const DEPARTMENT_LEADER_ROLES = ['department_secretary', 'department_chairperson'];

// Single place that decides "may this caller touch this member?" for every Phase 14 endpoint:
// tenant scope first, then department-leader scope. Unlike the older members.findOne check, the
// department test requires an ACTIVE membership (removed = false) so a leader can't keep reading
// members that have already left their department.
@Injectable()
export class MemberAccessService {
  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
  ) {}

  hasPermission(currentUser: any, permission: string): boolean {
    return ((currentUser?.permissions as string[]) || []).includes(permission);
  }

  requirePermission(currentUser: any, permission: string): void {
    if (!this.hasPermission(currentUser, permission)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  isDepartmentLeader(currentUser: any): boolean {
    const roles: string[] = currentUser?.roles || [];
    return DEPARTMENT_LEADER_ROLES.some((r) => roles.includes(r));
  }

  async assertAccessible(memberId: string, currentUser: any): Promise<any> {
    // Malformed ids are treated as "not found" instead of surfacing a database error.
    if (!isUuid(memberId)) {
      throw new NotFoundException('Member not found');
    }

    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) {
      throw new NotFoundException('Member not found');
    }
    this.tenantScope.assertInScope(currentUser, member);

    if (this.isDepartmentLeader(currentUser)) {
      if (!currentUser.departmentId) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
      const membership = await this.prisma.departmentMember.findFirst({
        where: { member_id: memberId, department_id: currentUser.departmentId, removed: false },
        select: { id: true },
      });
      if (!membership) {
        throw new ForbiddenException('You can only access members of your own department.');
      }
    }

    return member;
  }
}
