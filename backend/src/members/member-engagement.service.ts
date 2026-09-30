import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { MemberAccessService } from './member-access.service';
import { lastMonthKeys, monthKey, parseIntParam, startOfMonthsWindow } from './member.util';

const DAY_MS = 24 * 60 * 60 * 1000;

function topTags(lists: string[][], limit = 15): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const tag of list) counts.set(tag, (counts.get(tag) || 0) + 1);
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

// Engagement is reported as plain facts (counts, dates, memberships) - there is deliberately no
// composite "engagement score". Attendance figures only cover records that are linked to a member;
// historical attendance captured by name only cannot be attributed and is reported separately.
@Injectable()
export class MemberEngagementService {
  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
    private access: MemberAccessService,
  ) {}

  async getMemberEngagement(memberId: string, currentUser: any, daysRaw?: unknown): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_ENGAGEMENT_VIEW);
    const days = parseIntParam('days', daysRaw, { min: 1, max: 730, fallback: 90 }) as number;
    const member = await this.access.assertAccessible(memberId, currentUser);

    // Department leaders only see engagement in *their own department's* activities and never the
    // member's standing in other departments, groups or the youth programme.
    const scoped = this.access.isDepartmentLeader(currentUser);
    const departmentId: string | undefined = scoped ? currentUser.departmentId : undefined;
    const since = new Date(Date.now() - days * DAY_MS);

    const attendanceWhere = this.tenantScope.scopeWhere(currentUser, {
      member_id: memberId,
      ...(scoped ? { activity: { department_id: departmentId } } : {}),
    }) as Prisma.AttendanceWhereInput;

    const canSeeGroups = !scoped && this.access.hasPermission(currentUser, PERMISSIONS.MEMBER_GROUPS_VIEW);
    const canSeeProfile = this.access.hasPermission(currentUser, PERMISSIONS.MEMBER_PROFILE_VIEW);
    const canSeeYouth =
      !scoped &&
      this.access.hasPermission(currentUser, PERMISSIONS.YOUTH_VIEW) &&
      this.access.hasPermission(currentUser, PERMISSIONS.YOUTH_GUARDIANS_VIEW);

    const [attendance, departmentMemberships, leadership, groups, profile, guardianOfCount, youthProfile] =
      await Promise.all([
        this.prisma.attendance.findMany({
          where: attendanceWhere,
          select: { activity_id: true, recorded_at: true },
        }),
        this.prisma.departmentMember.findMany({
          where: { member_id: memberId, removed: false, ...(scoped ? { department_id: departmentId } : {}) },
          include: { department: { select: { id: true, name: true } } },
        }),
        member.user_id
          ? this.prisma.departmentLeader.findMany({
              where: { user_id: member.user_id, end_date: null, ...(scoped ? { department_id: departmentId } : {}) },
              include: { department: { select: { id: true, name: true } } },
            })
          : Promise.resolve([] as any[]),
        canSeeGroups
          ? this.prisma.memberGroupMember.findMany({
              where: { member_id: memberId },
              include: { group: { select: { id: true, name: true, is_active: true } } },
            })
          : Promise.resolve(null),
        canSeeProfile
          ? this.prisma.memberProfile.findUnique({
              where: { member_id: memberId },
              select: { service_interests: true },
            })
          : Promise.resolve(null),
        canSeeYouth
          ? this.prisma.youthGuardian.count({
              where: this.tenantScope.scopeWhere(currentUser, { guardian_member_id: memberId }) as any,
            })
          : Promise.resolve(null),
        canSeeYouth
          ? this.prisma.youthProfile.findFirst({
              where: this.tenantScope.scopeWhere(currentUser, { member_id: memberId }) as any,
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

    // Distinct activities, so a duplicated attendance row can never inflate the numbers.
    const attended = new Set<string>();
    const attendedInWindow = new Set<string>();
    let lastAttendedAt: Date | null = null;
    for (const row of attendance) {
      attended.add(row.activity_id);
      if (row.recorded_at >= since) attendedInWindow.add(row.activity_id);
      if (!lastAttendedAt || row.recorded_at > lastAttendedAt) lastAttendedAt = row.recorded_at;
    }

    return {
      memberId,
      window: { days, since },
      attendance: {
        scope: scoped ? 'department' : 'fellowship',
        activitiesAttended: attended.size,
        activitiesAttendedInWindow: attendedInWindow.size,
        lastAttendedAt,
      },
      departments: departmentMemberships.map((d: any) => ({
        departmentId: d.department_id,
        name: d.department?.name ?? null,
        joinedAt: d.joined_at,
      })),
      leadership: leadership.map((l: any) => ({
        departmentId: l.department_id,
        name: l.department?.name ?? null,
        role: l.role_in_department,
        since: l.start_date,
      })),
      groups: groups
        ? groups.map((g: any) => ({ groupId: g.group_id, name: g.group?.name ?? null, joinedAt: g.joined_at }))
        : null,
      serviceInterests: canSeeProfile ? (profile?.service_interests ?? []) : null,
      youth: canSeeYouth ? { guardianOfCount: guardianOfCount ?? 0, isYouthParticipant: !!youthProfile } : null,
    };
  }

  async getReportSummary(
    currentUser: any,
    query: { months?: unknown; days?: unknown; fellowshipId?: string },
  ): Promise<any> {
    this.access.requirePermission(currentUser, PERMISSIONS.MEMBER_REPORTS_VIEW);
    const months = parseIntParam('months', query.months, { min: 1, max: 36, fallback: 12 }) as number;
    const days = parseIntParam('days', query.days, { min: 1, max: 730, fallback: 90 }) as number;

    const scoped = this.access.isDepartmentLeader(currentUser);
    const departmentId: string | undefined = scoped ? currentUser.departmentId : undefined;
    if (scoped && !departmentId) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const canSeeTags = this.access.hasPermission(currentUser, PERMISSIONS.MEMBER_PROFILE_VIEW);

    const memberWhere = this.tenantScope.scopeWhere(
      currentUser,
      scoped ? { departmentMemberships: { some: { department_id: departmentId, removed: false } } } : {},
      query.fellowshipId,
    ) as Prisma.MemberWhereInput;

    const monthsSince = startOfMonthsWindow(months);
    const daysSince = new Date(Date.now() - days * DAY_MS);
    const earliest = monthsSince < daysSince ? monthsSince : daysSince;

    // Attendance is aggregated by the database. It used to be loaded row by row (tens of thousands of rows for a busy
    // fellowship) and counted in memory: 3.6 s per call at 50,000 attendance rows, now a few grouped queries.
    const tenant = this.tenantScope.scopeWhere(currentUser, {}, query.fellowshipId) as { fellowship_id?: string };
    const conds: Prisma.Sql[] = [
      Prisma.sql`a.recorded_at >= ${earliest}`,
      // Youth participants' attendance is youth-privileged data and never part of member reports.
      Prisma.sql`a.youth_profile_id IS NULL`,
    ];
    if (tenant.fellowship_id) conds.push(Prisma.sql`a.fellowship_id = ${tenant.fellowship_id}::uuid`);
    if (scoped) conds.push(Prisma.sql`act.department_id = ${departmentId}::uuid`);
    const attFrom = scoped ? Prisma.sql`attendance a JOIN activities act ON act.id = a.activity_id` : Prisma.sql`attendance a`;
    const attWhere = Prisma.join(conds, ' AND ');
    // Two records are the same attendance when they name the same member at the same activity, or (name-only records)
    // the same trimmed, case-insensitive name at the same activity.
    const nameKey = Prisma.sql`lower(regexp_replace(coalesce(a.recorded_by_name, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'))`;

    const [members, events, trendRows, windowRows, perMemberRows] = await Promise.all([
      this.prisma.member.findMany({
        where: memberWhere,
        select: {
          id: true,
          membership_status: true,
          departmentMemberships: { where: { removed: false }, select: { department_id: true } },
          ...(canSeeTags
            ? { profile: { select: { skills: true, interests: true, service_interests: true } } }
            : {}),
        },
      }),
      this.prisma.membershipHistory.findMany({
        where: {
          occurred_at: { gte: monthsSince },
          event_type: { in: ['registered', 'status_changed'] },
          member: memberWhere,
        },
        select: { event_type: true, to_status: true, occurred_at: true },
      }),
      this.prisma.$queryRaw<{ month: string; linked: bigint; name_only: bigint; members: bigint }[]>`
        SELECT to_char(a.recorded_at, 'YYYY-MM') AS month,
               COUNT(DISTINCT (a.activity_id, a.member_id)) FILTER (WHERE a.member_id IS NOT NULL) AS linked,
               COUNT(DISTINCT (a.activity_id, ${nameKey})) FILTER (WHERE a.member_id IS NULL) AS name_only,
               COUNT(DISTINCT a.member_id) AS members
        FROM ${attFrom} WHERE ${attWhere} GROUP BY 1`,
      this.prisma.$queryRaw<{ linked: bigint; name_only: bigint }[]>`
        SELECT COUNT(DISTINCT (a.activity_id, a.member_id)) FILTER (WHERE a.member_id IS NOT NULL) AS linked,
               COUNT(DISTINCT (a.activity_id, ${nameKey})) FILTER (WHERE a.member_id IS NULL) AS name_only
        FROM ${attFrom} WHERE ${attWhere} AND a.recorded_at >= ${daysSince}`,
      this.prisma.$queryRaw<{ member_id: string; n: bigint }[]>`
        SELECT a.member_id::text AS member_id, COUNT(DISTINCT a.activity_id) AS n
        FROM ${attFrom} WHERE ${attWhere} AND a.recorded_at >= ${daysSince} AND a.member_id IS NOT NULL
        GROUP BY a.member_id`,
    ]);

    // ---- totals ----
    const totals = { total: members.length, active: 0, inactive: 0, graduated: 0 };
    for (const m of members) totals[m.membership_status as 'active' | 'inactive' | 'graduated'] += 1;

    // ---- department distribution ----
    const deptCounts = new Map<string, number>();
    let noDepartment = 0;
    for (const m of members as any[]) {
      const ids = (m.departmentMemberships || [])
        .map((d: any) => d.department_id)
        .filter((id: string) => !scoped || id === departmentId);
      if (ids.length === 0) noDepartment += 1;
      for (const id of ids) deptCounts.set(id, (deptCounts.get(id) || 0) + 1);
    }
    const departmentRows = deptCounts.size
      ? await this.prisma.department.findMany({
          where: { id: { in: Array.from(deptCounts.keys()) } },
          select: { id: true, name: true },
        })
      : [];
    const deptName = new Map(departmentRows.map((d) => [d.id, d.name]));

    // ---- membership growth (from the auditable history) ----
    const growth = new Map(
      lastMonthKeys(months).map((key) => [key, { month: key, registered: 0, deactivated: 0, graduated: 0, reactivated: 0 }]),
    );
    for (const e of events) {
      const bucket = growth.get(monthKey(e.occurred_at));
      if (!bucket) continue;
      if (e.event_type === 'registered') bucket.registered += 1;
      else if (e.to_status === 'inactive') bucket.deactivated += 1;
      else if (e.to_status === 'graduated') bucket.graduated += 1;
      else if (e.to_status === 'active') bucket.reactivated += 1;
    }

    // ---- participation (member-linked vs name-only attendance) ----
    const trendByMonth = new Map(trendRows.map((r) => [r.month, r]));
    const trend = lastMonthKeys(months).map((key) => {
      const r = trendByMonth.get(key);
      return { month: key, linked: Number(r?.linked ?? 0), nameOnly: Number(r?.name_only ?? 0), members: Number(r?.members ?? 0) };
    });
    const linkedInWindow = Number(windowRows[0]?.linked ?? 0);
    const nameOnlyInWindow = Number(windowRows[0]?.name_only ?? 0);
    const perMemberInWindow = new Map(perMemberRows.map((r) => [r.member_id, Number(r.n)]));

    // Distribution is over ACTIVE members only; graduated/inactive members aren't expected to attend.
    const distribution = { none: 0, oneToTwo: 0, threeOrMore: 0 };
    for (const m of members) {
      if (m.membership_status !== 'active') continue;
      const n = perMemberInWindow.get(m.id) || 0;
      if (n === 0) distribution.none += 1;
      else if (n <= 2) distribution.oneToTwo += 1;
      else distribution.threeOrMore += 1;
    }

    return {
      scope: scoped ? 'department' : 'fellowship',
      generatedAt: new Date(),
      window: { months, days },
      totals,
      membershipGrowth: Array.from(growth.values()),
      departmentDistribution: {
        departments: Array.from(deptCounts.entries())
          .map(([id, count]) => ({ departmentId: id, name: deptName.get(id) ?? null, count }))
          .sort((a, b) => b.count - a.count),
        noDepartment,
      },
      participation: {
        trend: trend.map((t) => ({
          month: t.month,
          linkedRecords: t.linked,
          nameOnlyRecords: t.nameOnly,
          distinctMembers: t.members,
        })),
        distribution: { windowDays: days, ...distribution },
        dataQuality: { windowDays: days, linkedToMember: linkedInWindow, nameOnly: nameOnlyInWindow },
      },
      topTags: canSeeTags
        ? {
            skills: topTags((members as any[]).map((m) => m.profile?.skills || [])),
            interests: topTags((members as any[]).map((m) => m.profile?.interests || [])),
            serviceInterests: topTags((members as any[]).map((m) => m.profile?.service_interests || [])),
          }
        : null,
    };
  }
}
