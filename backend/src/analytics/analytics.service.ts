import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { lastMonthKeys, monthKey, parseDateBoundary, parseIntParam, startOfMonthsWindow } from '../members/member.util';
import { FinanceReportsService } from '../finance/finance-reports.service';
import { ResourcesReportsService } from '../resources/resources-reports.service';
import { VolunteerReportsService } from '../volunteers/volunteer-reports.service';
import { YouthService } from '../youth/youth.service';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 5 * 366 * DAY_MS;
const MAX_EVENT_ROWS = 2000;
const LEADER_ROLES = ['department_secretary', 'department_chairperson'];

export const SECTIONS = ['membership', 'participation', 'finance', 'youth', 'resources', 'volunteers'] as const;
export type Section = (typeof SECTIONS)[number];

interface Filters {
  from: Date;
  to: Date;
  months: number;
  fellowshipId?: string;
  departmentId?: string; // effective department filter (forced to the caller's own for department leaders)
  activityId?: string;
  deptScoped: boolean;
  period?: { id: string; name: string };
}

/**
 * Read-only analytics over the existing modules. Nothing is copied or stored: every figure is computed from
 * the source tables on request, and the sections that already have an authoritative report (finance, youth,
 * resources, volunteers) are delegated to that module's own service so its permission and scope rules apply
 * unchanged. Only membership and participation have SQL of their own here.
 */
@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);

  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
    private financeReports: FinanceReportsService,
    private resourcesReports: ResourcesReportsService,
    private volunteerReports: VolunteerReportsService,
    private youth: YouthService,
    private modules: ModuleAvailabilityService,
  ) {}

  // ---------- access ----------

  private has(user: any, permission: string): boolean {
    return ((user?.permissions as string[]) || []).includes(permission);
  }

  private isLeader(user: any): boolean {
    const roles: string[] = user?.roles || [];
    return LEADER_ROLES.some((r) => roles.includes(r));
  }

  // Sections that belong to an optional module are unavailable while a platform administrator has that module
  // switched off for the caller's fellowship (the controller-level guard only covers /analytics itself).
  private static readonly MODULE_OF: Partial<Record<Section, string>> = { finance: 'finance', youth: 'youth', resources: 'resources', volunteers: 'volunteers' };

  private async assertModule(user: any, section: Section): Promise<void> {
    const key = AnalyticsService.MODULE_OF[section];
    if (key && !(await this.modules.isEnabled(user.fellowshipId, key))) throw new ForbiddenException('This module is not enabled for your fellowship.');
  }

  /** Which sections the caller is entitled to (a UI hint; each section re-checks on its own). */
  async availableSections(user: any): Promise<Section[]> {
    const off = await this.modules.disabledModules(user.fellowshipId);
    const out: Section[] = [];
    if (this.has(user, PERMISSIONS.MEMBER_REPORTS_VIEW)) out.push('membership', 'participation');
    if (this.has(user, PERMISSIONS.FINANCE_REPORTS_VIEW) || this.has(user, PERMISSIONS.FINANCE_DEPARTMENT_VIEW)) out.push('finance');
    if (this.has(user, PERMISSIONS.YOUTH_REPORTS_VIEW)) out.push('youth');
    if (this.has(user, PERMISSIONS.RESOURCES_REPORTS_VIEW) || this.has(user, PERMISSIONS.RESOURCES_DEPARTMENT_VIEW)) out.push('resources');
    if (this.has(user, PERMISSIONS.VOLUNTEER_REPORTS_VIEW)) out.push('volunteers');
    return out.filter((s) => { const k = AnalyticsService.MODULE_OF[s]; return !k || !off.has(k); });
  }

  private requireMemberReports(user: any): void {
    if (!this.has(user, PERMISSIONS.MEMBER_REPORTS_VIEW)) throw new ForbiddenException('You do not have permission to perform this action.');
  }

  // ---------- filters ----------

  private async parseFilters(user: any, q: Record<string, any>): Promise<Filters> {
    const fellowshipId = q.fellowshipId;
    if (fellowshipId !== undefined && fellowshipId !== '' && !isUuid(fellowshipId)) throw new BadRequestException('fellowshipId must be a valid id');
    const scopedFellowship = fellowshipId || undefined;

    let to = parseDateBoundary('to', q.to, 'end') ?? new Date();
    let from = parseDateBoundary('from', q.from, 'start');
    let period: Filters['period'];

    if (q.periodId !== undefined && q.periodId !== '') {
      if (!isUuid(q.periodId)) throw new BadRequestException('periodId must be a valid id');
      const p = await this.prisma.financialPeriod.findFirst({ where: this.tenantScope.scopeWhere(user, { id: q.periodId }, scopedFellowship) as any });
      if (!p) throw new NotFoundException('Financial period not found');
      period = { id: p.id, name: p.name };
      from = p.start_date;
      to = p.end_date.getTime() > Date.now() ? new Date() : p.end_date; // nothing has happened in the future yet
    }
    if (to.getTime() > Date.now() + DAY_MS) throw new BadRequestException('to cannot be in the future');
    if (!from) from = new Date(to.getTime() - 90 * DAY_MS);
    if (from > to) throw new BadRequestException('from cannot be after to');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException('The reporting range cannot exceed five years');

    const months = parseIntParam('months', q.months, { min: 1, max: 36, fallback: 12 }) as number;

    const deptScoped = this.isLeader(user);
    let departmentId: string | undefined;
    if (deptScoped) {
      if (!user.departmentId) throw new ForbiddenException('You are not assigned to a department.');
      if (q.departmentId && q.departmentId !== user.departmentId) throw new ForbiddenException('You can only view your own department.');
      departmentId = user.departmentId;
    } else if (q.departmentId !== undefined && q.departmentId !== '') {
      if (!isUuid(q.departmentId)) throw new BadRequestException('departmentId must be a valid id');
      const d = await this.prisma.department.findFirst({ where: this.tenantScope.scopeWhere(user, { id: q.departmentId }, scopedFellowship) as any, select: { id: true } });
      if (!d) throw new NotFoundException('Department not found');
      departmentId = d.id;
    }

    let activityId: string | undefined;
    if (q.activityId !== undefined && q.activityId !== '') {
      if (!isUuid(q.activityId)) throw new BadRequestException('activityId must be a valid id');
      activityId = q.activityId;
    }
    return { from, to, months, fellowshipId: scopedFellowship, departmentId, activityId, deptScoped, period };
  }

  private fellowshipSql(user: any, column: string, q?: string): Prisma.Sql {
    if (this.tenantScope.isAdmin(user)) return q ? Prisma.sql`AND ${Prisma.raw(column)} = ${q}::uuid` : Prisma.empty;
    return user.fellowshipId ? Prisma.sql`AND ${Prisma.raw(column)} = ${user.fellowshipId}::uuid` : Prisma.sql`AND FALSE`;
  }

  // ---------- membership ----------

  async membership(user: any, q: Record<string, any> = {}) {
    this.requireMemberReports(user);
    const f = await this.parseFilters(user, q);
    const deptRel = f.departmentId ? { departmentMemberships: { some: { department_id: f.departmentId, removed: false } } } : {};
    const memberWhere = this.tenantScope.scopeWhere(user, deptRel, f.fellowshipId) as Prisma.MemberWhereInput;
    const since = startOfMonthsWindow(f.months);
    const deptExists = f.departmentId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM department_members dm WHERE dm.member_id = h.member_id AND dm.department_id = ${f.departmentId}::uuid AND dm.removed = FALSE)`
      : Prisma.empty;

    const [statusRows, growthRows, deptRows, noDepartment] = await Promise.all([
      this.prisma.member.groupBy({ by: ['membership_status'], where: memberWhere, _count: { _all: true } }),
      this.prisma.$queryRaw<{ month: string; event_type: string; to_status: string | null; count: number }[]>(Prisma.sql`
        SELECT to_char(date_trunc('month', h.occurred_at), 'YYYY-MM') AS month, h.event_type::text AS event_type,
               h.to_status::text AS to_status, COUNT(*)::int AS count
        FROM membership_history h
        WHERE h.occurred_at >= ${since} AND h.event_type IN ('registered', 'status_changed')
          ${this.fellowshipSql(user, 'h.fellowship_id', f.fellowshipId)} ${deptExists}
        GROUP BY 1, 2, 3`),
      // Active members currently in each department (a member in two departments counts in both).
      this.prisma.departmentMember.groupBy({
        by: ['department_id'],
        where: {
          removed: false,
          member: { membership_status: 'active', ...(this.tenantScope.scopeWhere(user, {}, f.fellowshipId) as object) },
          ...(f.departmentId ? { department_id: f.departmentId } : { department: this.tenantScope.scopeWhere(user, {}, f.fellowshipId) as any }),
        },
        _count: { _all: true },
      }),
      f.departmentId
        ? Promise.resolve(null)
        : this.prisma.member.count({ where: this.tenantScope.scopeWhere(user, { membership_status: 'active', departmentMemberships: { none: { removed: false } } }, f.fellowshipId) as any }),
    ]);

    const totals = { total: 0, active: 0, inactive: 0, graduated: 0 };
    for (const r of statusRows) {
      totals[r.membership_status as 'active' | 'inactive' | 'graduated'] = r._count._all;
      totals.total += r._count._all;
    }
    const growth = new Map(lastMonthKeys(f.months).map((k) => [k, { month: k, registered: 0, deactivated: 0, graduated: 0, reactivated: 0 }]));
    for (const r of growthRows) {
      const b = growth.get(r.month);
      if (!b) continue;
      if (r.event_type === 'registered') b.registered += r.count;
      else if (r.to_status === 'inactive') b.deactivated += r.count;
      else if (r.to_status === 'graduated') b.graduated += r.count;
      else if (r.to_status === 'active') b.reactivated += r.count;
    }
    const names = deptRows.length
      ? await this.prisma.department.findMany({ where: { id: { in: deptRows.map((d) => d.department_id) } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(names.map((d) => [d.id, d.name]));

    return {
      scope: f.deptScoped ? 'department' : f.departmentId ? 'department-filter' : 'fellowship',
      generatedAt: new Date(),
      window: { months: f.months },
      totals,
      growth: Array.from(growth.values()),
      byDepartment: deptRows.map((d) => ({ departmentId: d.department_id, name: nameOf.get(d.department_id) ?? null, activeMembers: d._count._all })).sort((a, b) => b.activeMembers - a.activeMembers),
      activeWithoutDepartment: noDepartment,
    };
  }

  // ---------- participation (events + attendance) ----------

  async participation(user: any, q: Record<string, any> = {}) {
    this.requireMemberReports(user);
    const f = await this.parseFilters(user, q);
    const fel = this.fellowshipSql(user, 'a.fellowship_id', f.fellowshipId);
    const dept = f.departmentId ? Prisma.sql`AND a.department_id = ${f.departmentId}::uuid` : Prisma.empty;
    const win = Prisma.sql`a.date >= ${f.from} AND a.date <= ${f.to}`;
    const activeMemberWhere = this.tenantScope.scopeWhere(
      user,
      { membership_status: 'active', ...(f.departmentId ? { departmentMemberships: { some: { department_id: f.departmentId, removed: false } } } : {}) },
      f.fellowshipId,
    ) as Prisma.MemberWhereInput;

    // One row per event (bounded), attendance aggregated in SQL. Youth participants' attendance is
    // youth-privileged data and is never part of these figures; attendee names are never returned.
    const [events, eventCount, unique, activeMembers] = await Promise.all([
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT a.id, a.title, a.date, a.audience_type::text AS audience, a.department_id AS "departmentId",
               COUNT(DISTINCT at.member_id)::int AS linked,
               (COUNT(DISTINCT lower(btrim(at.recorded_by_name))) FILTER (WHERE at.member_id IS NULL AND btrim(coalesce(at.recorded_by_name, '')) <> ''))::int AS "nameOnly"
        FROM activities a
        LEFT JOIN attendance at ON at.activity_id = a.id AND at.youth_profile_id IS NULL
        WHERE ${win} ${fel} ${dept}
        GROUP BY a.id
        ORDER BY a.date DESC
        LIMIT ${MAX_EVENT_ROWS}`),
      this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS count FROM activities a WHERE ${win} ${fel} ${dept}`),
      this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT at.member_id)::int AS count
        FROM attendance at JOIN activities a ON a.id = at.activity_id
        WHERE at.member_id IS NOT NULL AND at.youth_profile_id IS NULL AND ${win} ${fel} ${dept}`),
      this.prisma.member.count({ where: activeMemberWhere }),
    ]);

    const totalEvents = eventCount[0]?.count ?? 0;
    const linked = events.reduce((n, e) => n + e.linked, 0);
    const nameOnly = events.reduce((n, e) => n + e.nameOnly, 0);
    const uniqueAttendees = unique[0]?.count ?? 0;

    // month buckets across the window (capped), byAudience, byDepartment
    const monthly = new Map<string, { month: string; events: number; linked: number; nameOnly: number }>();
    for (let d = new Date(Date.UTC(f.from.getUTCFullYear(), f.from.getUTCMonth(), 1)); d <= f.to && monthly.size < 62; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      monthly.set(monthKey(d), { month: monthKey(d), events: 0, linked: 0, nameOnly: 0 });
    }
    const audience = new Map<string, { audience: string; events: number; attendance: number }>();
    const byDept = new Map<string, { departmentId: string | null; events: number; attendance: number }>();
    for (const e of events) {
      const m = monthly.get(monthKey(new Date(e.date)));
      if (m) { m.events += 1; m.linked += e.linked; m.nameOnly += e.nameOnly; }
      const a = audience.get(e.audience) ?? { audience: e.audience, events: 0, attendance: 0 };
      a.events += 1; a.attendance += e.linked + e.nameOnly; audience.set(e.audience, a);
      const key = e.departmentId ?? '';
      const d = byDept.get(key) ?? { departmentId: e.departmentId, events: 0, attendance: 0 };
      d.events += 1; d.attendance += e.linked + e.nameOnly; byDept.set(key, d);
    }
    const deptIds = Array.from(byDept.values()).map((d) => d.departmentId).filter((x): x is string => !!x);
    const deptNames = deptIds.length ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }) : [];
    const nameOf = new Map(deptNames.map((d) => [d.id, d.name]));

    const result: any = {
      scope: f.deptScoped ? 'department' : f.departmentId ? 'department-filter' : 'fellowship',
      generatedAt: new Date(),
      window: { from: f.from, to: f.to },
      totals: {
        events: totalEvents,
        attendanceRecords: linked + nameOnly,
        memberLinked: linked,
        nameOnly,
        uniqueAttendees,
        activeMembers,
        averagePerEvent: events.length ? Math.round(((linked + nameOnly) / events.length) * 10) / 10 : null,
        participationRate: activeMembers > 0 ? Math.min(100, Math.round((uniqueAttendees / activeMembers) * 1000) / 10) : null,
        memberLinkedShare: linked + nameOnly > 0 ? Math.round((linked / (linked + nameOnly)) * 1000) / 10 : null,
      },
      monthly: Array.from(monthly.values()),
      byAudience: Array.from(audience.values()),
      byDepartment: Array.from(byDept.values()).map((d) => ({ ...d, name: d.departmentId ? nameOf.get(d.departmentId) ?? null : 'Not department-specific' })),
      recentEvents: events.slice(0, 20).map((e) => ({ id: e.id, title: e.title, date: e.date, audience: e.audience, department: e.departmentId ? nameOf.get(e.departmentId) ?? null : null, memberLinked: e.linked, nameOnly: e.nameOnly })),
      truncated: totalEvents > events.length,
    };
    if (f.activityId) result.event = await this.eventDetail(user, f);
    return result;
  }

  private async eventDetail(user: any, f: Filters) {
    const activity = await this.prisma.activity.findUnique({ where: { id: f.activityId! } });
    if (!activity) throw new NotFoundException('Activity not found');
    this.tenantScope.assertInScope(user, activity, f.fellowshipId);
    // Department leaders (and anyone filtering by department) may only drill into that department's events.
    if (f.departmentId && activity.department_id !== f.departmentId) throw new ForbiddenException('You do not have access to this activity.');
    const [counts, byDept] = await Promise.all([
      this.prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT COUNT(DISTINCT at.member_id)::int AS linked,
               (COUNT(DISTINCT lower(btrim(at.recorded_by_name))) FILTER (WHERE at.member_id IS NULL AND btrim(coalesce(at.recorded_by_name, '')) <> ''))::int AS "nameOnly"
        FROM attendance at WHERE at.activity_id = ${activity.id}::uuid AND at.youth_profile_id IS NULL`),
      f.deptScoped
        ? Promise.resolve([])
        : this.prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT d.id AS "departmentId", d.name, COUNT(DISTINCT at.member_id)::int AS attendees
            FROM attendance at
            JOIN department_members dm ON dm.member_id = at.member_id AND dm.removed = FALSE
            JOIN departments d ON d.id = dm.department_id
            WHERE at.activity_id = ${activity.id}::uuid AND at.youth_profile_id IS NULL AND at.member_id IS NOT NULL
            GROUP BY d.id, d.name ORDER BY attendees DESC LIMIT 50`),
    ]);
    return {
      id: activity.id, title: activity.title, date: activity.date, audience: activity.audience_type,
      memberLinked: counts[0]?.linked ?? 0, nameOnly: counts[0]?.nameOnly ?? 0,
      attendeesByDepartment: byDept,
    };
  }

  // ---------- delegated sections (the source module's own rules apply) ----------

  async finance(user: any, q: Record<string, any> = {}) {
    await this.assertModule(user, 'finance');
    const f = await this.parseFilters(user, q);
    const data = await this.financeReports.summary(user, {
      from: f.from.toISOString(), to: f.to.toISOString(), fellowshipId: f.fellowshipId,
      departmentId: f.deptScoped ? undefined : f.departmentId,
    });
    return { ...data, period: f.period ?? null };
  }

  async youthSection(user: any, q: Record<string, any> = {}) {
    await this.assertModule(user, 'youth');
    const f = await this.parseFilters(user, q);
    return this.youth.reportsSummary(user, f.fellowshipId);
  }

  async resources(user: any, q: Record<string, any> = {}) {
    await this.assertModule(user, 'resources');
    const f = await this.parseFilters(user, q);
    return this.resourcesReports.summary(user, { from: f.from.toISOString(), to: f.to.toISOString(), fellowshipId: f.fellowshipId });
  }

  async volunteers(user: any, q: Record<string, any> = {}) {
    await this.assertModule(user, 'volunteers');
    const f = await this.parseFilters(user, q);
    return this.volunteerReports.summary(user, { from: f.from.toISOString(), to: f.to.toISOString(), fellowshipId: f.fellowshipId });
  }

  // ---------- overview ----------

  /** Headline numbers from every section the caller may see; sections that fail are reported, not fatal. */
  async overview(user: any, q: Record<string, any> = {}) {
    const f = await this.parseFilters(user, q);
    const available = await this.availableSections(user);
    const jobs: Record<string, () => Promise<any>> = {
      membership: async () => { const d = await this.membership(user, q); return { total: d.totals.total, active: d.totals.active, newInPeriod: d.growth.reduce((n: number, g: any) => n + g.registered, 0) }; },
      participation: async () => { const d = await this.participation(user, q); return { events: d.totals.events, uniqueAttendees: d.totals.uniqueAttendees, participationRate: d.totals.participationRate, averagePerEvent: d.totals.averagePerEvent }; },
      finance: async () => {
        const d = await this.finance(user, q);
        return {
          scope: d.scope,
          expensesApproved: d.expenses?.approvedTotal ?? null,
          pendingApprovals: d.expenses?.pendingApprovalCount ?? null,
          moneyRequestsAwaitingRelease: d.moneyRequests?.awaitingRelease ?? null,
          ...(d.contributions ? { contributions: d.contributions.total, income: d.income?.total ?? null } : {}),
        };
      },
      youth: async () => { const d = await this.youthSection(user, q); return { participants: d.totalParticipants, active: d.activeParticipants }; },
      resources: async () => { const d = await this.resources(user, q); return { available: d.totals?.available ?? 0, onLoan: d.totals?.checked_out ?? 0, inMaintenance: d.totals?.in_maintenance ?? 0, overdueLoans: d.loans?.overdue ?? 0, overdueMaintenance: d.maintenance?.overdue ?? 0 }; },
      volunteers: async () => { const d = await this.volunteers(user, q); return { volunteers: d.participation.volunteers, hoursServed: d.participation.hoursServed, attendanceRate: d.participation.attendanceRate, unfilledShifts: d.upcoming.unfilled }; },
    };
    const kpis: Record<string, any> = {};
    const unavailable: string[] = [];
    await Promise.all(available.map(async (section) => {
      try {
        kpis[section] = await jobs[section]();
      } catch (err: any) {
        unavailable.push(section);
        if (!(err instanceof ForbiddenException)) this.log.warn(`analytics overview: section ${section} failed: ${err?.message ?? err}`);
      }
    }));
    return {
      generatedAt: new Date(),
      window: { from: f.from, to: f.to },
      period: f.period ?? null,
      scope: f.deptScoped ? 'department' : 'fellowship',
      available,
      unavailable,
      kpis,
    };
  }
}
