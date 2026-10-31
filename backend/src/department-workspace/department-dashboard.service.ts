import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentMembersService } from './department-members.service';
import { DepartmentActivitiesService } from './department-activities.service';
import { DepartmentReportsService } from './department-reports.service';
import { DepartmentFinanceService } from './department-finance.service';
import { DepartmentAnnouncementsService } from './department-announcements.service';
import { DepartmentLeadershipService } from './department-leadership.service';

const IN_REVIEW = ['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'UNDER_REVIEW'] as const;

/** Everything on a department leader's dashboard, computed from the database at request time. */
@Injectable()
export class DepartmentDashboardService {
  constructor(
    private prisma: PrismaService,
    private access: DepartmentAccessService,
    private members: DepartmentMembersService,
    private activities: DepartmentActivitiesService,
    private reports: DepartmentReportsService,
    private finance: DepartmentFinanceService,
    private announcements: DepartmentAnnouncementsService,
    private leadershipService: DepartmentLeadershipService,
  ) {}

  async me(user: any) {
    return { departments: await this.access.leaderDepartments(user) };
  }

  async leadershipView(user: any, departmentId: string) {
    const { role } = await this.access.assertLeader(user, departmentId);
    const history = await this.leadershipService.history(departmentId);
    return {
      myRole: role,
      chairperson: history.find((h) => h.current && h.role === 'department_chairperson') ?? null,
      secretary: history.find((h) => h.current && h.role === 'department_secretary') ?? null,
      history,
    };
  }

  async dashboard(user: any, departmentId: string) {
    const { department, role } = await this.access.assertLeader(user, departmentId);
    const now = new Date();
    const [
      stats,
      upcoming,
      recent,
      pendingActivities,
      recentReports,
      pendingFinance,
      pendingFinanceCount,
      announcements,
      leaders,
    ] = await Promise.all([
      this.members.computeStats(departmentId),
      this.prisma.activity.findMany({
        where: { department_id: departmentId, status: 'APPROVED', date: { gte: now } },
        orderBy: { date: 'asc' },
        take: 5,
      }),
      this.prisma.activity.findMany({
        where: {
          department_id: departmentId,
          date: { lt: now },
          status: { in: ['APPROVED', 'COMPLETED'] },
        },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      this.prisma.activity.findMany({
        where: {
          department_id: departmentId,
          status: { in: ['PENDING_SECRETARY', 'PENDING_CHAIRPERSON', 'RETURNED'] },
        },
        orderBy: { submitted_at: 'desc' },
        take: 5,
      }),
      this.prisma.report.findMany({
        where: { department_id: departmentId, status: { not: 'DRAFT' } },
        orderBy: { updated_at: 'desc' },
        take: 5,
      }),
      this.prisma.moneyRequest.findMany({
        where: { department_id: departmentId, approval_status: { in: [...IN_REVIEW, 'RETURNED'] } },
        include: { release: true },
        orderBy: { created_at: 'desc' },
        take: 5,
      }),
      this.prisma.moneyRequest.count({
        where: { department_id: departmentId, approval_status: { in: [...IN_REVIEW] } },
      }),
      this.announcements.recent(departmentId, department.fellowship_id, 5),
      this.leadershipView(user, departmentId),
    ]);
    const pendingActivityCount = await this.prisma.activity.count({
      where: {
        department_id: departmentId,
        status: { in: ['PENDING_SECRETARY', 'PENDING_CHAIRPERSON'] },
      },
    });
    return {
      department: { id: department.id, name: department.name, description: department.description },
      myRole: role,
      stats,
      chairperson: leaders.chairperson,
      secretary: leaders.secretary,
      upcomingActivities: upcoming.map((a) => this.activities.shape(a)),
      recentActivities: recent.map((a) => this.activities.shape(a)),
      pendingActivities: pendingActivities.map((a) => this.activities.shape(a)),
      pendingActivityCount,
      recentReports: recentReports.map((r) => this.reports.shape(r)),
      pendingFinancialRequests: await Promise.all(pendingFinance.map((r) => this.finance.shape(r))),
      pendingFinancialCount: pendingFinanceCount,
      recentAnnouncements: announcements,
    };
  }

  /** Summary figures for the Reports & Analytics page, optionally for a date range. */
  async analytics(user: any, departmentId: string, range?: { gte?: Date; lte?: Date }) {
    await this.access.assertLeader(user, departmentId);
    const actWhere: any = { department_id: departmentId, ...(range ? { date: range } : {}) };
    const repWhere: any = { department_id: departmentId, ...(range ? { created_at: range } : {}) };
    const finWhere: any = { department_id: departmentId, ...(range ? { created_at: range } : {}) };
    const [stats, activityGroups, reportGroups, financeGroups, approvedTotal] = await Promise.all([
      this.members.computeStats(departmentId),
      this.prisma.activity.groupBy({ by: ['status'], where: actWhere, _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['status'], where: repWhere, _count: { _all: true } }),
      this.prisma.moneyRequest.groupBy({
        by: ['approval_status'],
        where: finWhere,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.moneyRequest.aggregate({
        where: { ...finWhere, approval_status: 'FINAL_APPROVED' },
        _sum: { amount: true },
      }),
    ]);
    return {
      members: stats,
      activities: Object.fromEntries(activityGroups.map((g) => [g.status, g._count._all])),
      reports: Object.fromEntries(reportGroups.map((g) => [g.status, g._count._all])),
      financialRequests: Object.fromEntries(
        financeGroups.map((g) => [
          g.approval_status,
          { count: g._count._all, amount: g._sum.amount?.toString() ?? '0' },
        ]),
      ),
      approvedAmount: approvedTotal._sum.amount?.toString() ?? '0',
    };
  }
}
