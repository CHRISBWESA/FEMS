import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { MemberAccessService } from './member-access.service';

@Injectable()
export class MembershipHistoryService {
  constructor(
    private prisma: PrismaService,
    private access: MemberAccessService,
  ) {}

  // History rows carry free-text reasons, so this is gated separately (member.history_view) from
  // the member row itself. Newest first, capped so a very long timeline can't blow up a response.
  async list(memberId: string, currentUser: any): Promise<any[]> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_HISTORY_VIEW);
    await this.access.assertAccessible(memberId, currentUser);

    const rows = await this.prisma.membershipHistory.findMany({
      where: { member_id: memberId },
      orderBy: { occurred_at: 'desc' },
      take: 200,
    });

    const departmentIds = Array.from(
      new Set(
        rows.flatMap((r) => [r.department_id, r.related_department_id]).filter((id): id is string => !!id),
      ),
    );
    const userIds = Array.from(new Set(rows.map((r) => r.recorded_by).filter((id): id is string => !!id)));

    const [departments, users] = await Promise.all([
      departmentIds.length
        ? this.prisma.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, first_name: true, last_name: true },
          })
        : Promise.resolve([]),
    ]);
    const departmentName = new Map(departments.map((d) => [d.id, d.name]));
    const userName = new Map(users.map((u) => [u.id, `${u.first_name} ${u.last_name}`.trim()]));

    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      department: r.department_id
        ? { id: r.department_id, name: departmentName.get(r.department_id) ?? null }
        : null,
      relatedDepartment: r.related_department_id
        ? { id: r.related_department_id, name: departmentName.get(r.related_department_id) ?? null }
        : null,
      reason: r.reason,
      // null recordedBy = system-generated event (e.g. automatic graduation, or backfill).
      recordedBy: r.recorded_by ? { id: r.recorded_by, name: userName.get(r.recorded_by) ?? null } : null,
      occurredAt: r.occurred_at,
    }));
  }
}
