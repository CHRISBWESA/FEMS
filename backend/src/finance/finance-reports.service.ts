import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { FinancePledgesService } from './finance-pledges.service';
import { validateDate, validateOptionalUuid } from './finance.validation';

const PENDING = ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'] as const;
const MAX_RANGE_MS = 5 * 366 * 24 * 60 * 60 * 1000;

const str = (v: any): string => new Prisma.Decimal(v ?? 0).toString();

@Injectable()
export class FinanceReportsService {
  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
    private auditService: AuditService,
    private pledges: FinancePledgesService,
  ) {}

  // Fellowship filter for raw SQL. Non-admins are pinned to their own fellowship; the ?fellowshipId
  // query value is honoured for global admins only (same rule as TenantScopeService).
  private fellowshipSql(user: any, queryFellowshipId?: string): Prisma.Sql {
    if (this.tenantScope.isAdmin(user)) {
      return queryFellowshipId ? Prisma.sql`AND fellowship_id = ${queryFellowshipId}::uuid` : Prisma.empty;
    }
    return user.fellowshipId ? Prisma.sql`AND fellowship_id = ${user.fellowshipId}::uuid` : Prisma.sql`AND FALSE`;
  }

  private async names(model: 'department' | 'financeCategory' | 'contributionCampaign', ids: (string | null)[]) {
    const real = Array.from(new Set(ids.filter((i): i is string => !!i)));
    if (real.length === 0) return new Map<string, string>();
    const rows = await (this.prisma as any)[model].findMany({ where: { id: { in: real } }, select: { id: true, name: true } });
    return new Map<string, string>(rows.map((r: any) => [r.id, r.name]));
  }

  // ===================== summary =====================

  async summary(user: any, q: { from?: string; to?: string; departmentId?: string; fellowshipId?: string }) {
    const departmentOnly = this.access.isDepartmentLeader(user) && !this.access.isFinanceViewer(user);
    this.access.requirePermission(user, departmentOnly ? PERMISSIONS.FINANCE_DEPARTMENT_VIEW : PERMISSIONS.FINANCE_REPORTS_VIEW);
    if (departmentOnly && !user.departmentId) {
      throw new ForbiddenException('You are not assigned to a department.');
    }
    if (q.fellowshipId && !isUuid(q.fellowshipId)) throw new BadRequestException('fellowshipId must be a valid id');

    const to = validateDate('to', q.to, { required: false, maxFutureDays: 1 }) ?? new Date();
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 }) ?? new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    if (from > to) throw new BadRequestException('from cannot be after to');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new BadRequestException('The reporting range cannot exceed five years');
    const departmentId = departmentOnly ? user.departmentId : validateOptionalUuid('departmentId', q.departmentId);

    const dateRange = { gte: from, lte: to };
    const deptWhere = departmentId ? { department_id: departmentId } : {};
    const scoped = <T extends object>(extra: T) => this.tenantScope.scopeWhere(user, extra as any, q.fellowshipId) as any;

    // ---- expenses (only FULLY approved expenses count as spending) ----
    const expenseBase = scoped({ ...deptWhere, date: dateRange });
    const [approvedByDept, approvedByCategory, approvedTotal, pendingCount] = await Promise.all([
      this.prisma.expense.groupBy({ by: ['department_id'], where: { ...expenseBase, approval_status: 'FINAL_APPROVED' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.expense.groupBy({ by: ['category_id'], where: { ...expenseBase, approval_status: 'FINAL_APPROVED' }, _sum: { amount: true } }),
      this.prisma.expense.aggregate({ where: { ...expenseBase, approval_status: 'FINAL_APPROVED' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.expense.count({ where: { ...expenseBase, approval_status: { in: PENDING as any } } }),
    ]);

    // ---- money requests ----
    const mrScope = scoped({ ...deptWhere });
    const [mrByStatus, released, awaitingRelease] = await Promise.all([
      this.prisma.moneyRequest.groupBy({ by: ['approval_status'], where: { ...mrScope, created_at: dateRange }, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.moneyRequestRelease.aggregate({
        where: { released_at: dateRange, money_request: mrScope },
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.prisma.moneyRequest.count({ where: { ...mrScope, approval_status: 'FINAL_APPROVED', release: null } }),
    ]);

    // ---- budget vs actual (approved budgets vs approved expenses; calendar year of the fiscal year start) ----
    const budgets = await this.prisma.budget.findMany({
      where: scoped({ ...deptWhere, approval_status: 'FINAL_APPROVED' }),
      select: { fiscal_year: true, department_id: true, amount: true },
      take: 1000,
    });
    const spentRows = await this.prisma.$queryRaw<{ year: number; department_id: string | null; total: Prisma.Decimal }[]>(Prisma.sql`
      SELECT EXTRACT(YEAR FROM "date")::int AS year, department_id, SUM(amount) AS total
      FROM expenses
      WHERE approval_status = 'FINAL_APPROVED' ${this.fellowshipSql(user, q.fellowshipId)}
        ${departmentId ? Prisma.sql`AND department_id = ${departmentId}::uuid` : Prisma.empty}
      GROUP BY 1, 2`);
    const budgetMap = new Map<string, { fiscalYear: string; departmentId: string | null; budgeted: Prisma.Decimal }>();
    for (const b of budgets) {
      const key = `${b.fiscal_year}|${b.department_id ?? ''}`;
      const cur = budgetMap.get(key);
      budgetMap.set(key, { fiscalYear: b.fiscal_year, departmentId: b.department_id, budgeted: (cur?.budgeted ?? new Prisma.Decimal(0)).plus(b.amount) });
    }

    const deptNames = await this.names('department', [
      ...approvedByDept.map((r) => r.department_id),
      ...Array.from(budgetMap.values()).map((b) => b.departmentId),
    ]);
    const catNames = await this.names('financeCategory', approvedByCategory.map((r) => r.category_id));

    const result: any = {
      scope: departmentOnly ? 'department' : 'fellowship',
      generatedAt: new Date(),
      range: { from, to },
      expenses: {
        approvedTotal: str(approvedTotal._sum.amount),
        approvedCount: approvedTotal._count._all,
        pendingApprovalCount: pendingCount,
        byDepartment: approvedByDept.map((r) => ({ departmentId: r.department_id, name: r.department_id ? deptNames.get(r.department_id) ?? null : null, total: str(r._sum.amount), count: r._count._all })),
        byCategory: approvedByCategory.map((r) => ({ categoryId: r.category_id, name: r.category_id ? catNames.get(r.category_id) ?? null : 'Uncategorised', total: str(r._sum.amount) })),
      },
      moneyRequests: {
        byStatus: mrByStatus.map((r) => ({ status: r.approval_status, count: r._count._all, total: str(r._sum.amount) })),
        releasedTotal: str(released._sum.amount),
        releasedCount: released._count._all,
        awaitingRelease,
      },
      budgetVsActual: Array.from(budgetMap.values()).map((b) => {
        const year = Number(String(b.fiscalYear).slice(0, 4));
        const spent = spentRows
          .filter((s) => s.year === year && (s.department_id ?? null) === (b.departmentId ?? null))
          .reduce((acc, s) => acc.plus(s.total), new Prisma.Decimal(0));
        return {
          fiscalYear: b.fiscalYear,
          departmentId: b.departmentId,
          departmentName: b.departmentId ? deptNames.get(b.departmentId) ?? null : null,
          budgeted: b.budgeted.toString(),
          spent: spent.toString(),
          remaining: b.budgeted.minus(spent).toString(),
        };
      }),
    };

    if (departmentOnly) return result;

    // ---- fellowship-wide only: contributions and other income (never shown to department leaders) ----
    const contribBase = scoped({ date: dateRange });
    const [cTotal, cByType, cByCampaign, cByCategory, iTotal, iByCategory, monthly] = await Promise.all([
      this.prisma.contribution.aggregate({ where: contribBase, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.contribution.groupBy({ by: ['contribution_type'], where: contribBase, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.contribution.groupBy({ by: ['campaign_id'], where: contribBase, _sum: { amount: true } }),
      this.prisma.contribution.groupBy({ by: ['category_id'], where: contribBase, _sum: { amount: true } }),
      this.prisma.incomeRecord.aggregate({ where: scoped({ ...deptWhere, date: dateRange }), _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.incomeRecord.groupBy({ by: ['category_id'], where: scoped({ ...deptWhere, date: dateRange }), _sum: { amount: true } }),
      this.prisma.$queryRaw<{ month: Date; total: Prisma.Decimal; count: bigint }[]>(Prisma.sql`
        SELECT date_trunc('month', "date") AS month, SUM(amount) AS total, COUNT(*) AS count
        FROM contributions
        WHERE "date" >= ${from} AND "date" <= ${to} ${this.fellowshipSql(user, q.fellowshipId)}
        GROUP BY 1 ORDER BY 1`),
    ]);
    const campNames = await this.names('contributionCampaign', cByCampaign.map((r) => r.campaign_id));
    const cCatNames = await this.names('financeCategory', [...cByCategory.map((r) => r.category_id), ...iByCategory.map((r) => r.category_id)]);

    result.contributions = {
      total: str(cTotal._sum.amount),
      count: cTotal._count._all,
      byType: cByType.map((r) => ({ type: r.contribution_type, total: str(r._sum.amount), count: r._count._all })),
      byCampaign: cByCampaign.map((r) => ({ campaignId: r.campaign_id, name: r.campaign_id ? campNames.get(r.campaign_id) ?? null : 'No campaign', total: str(r._sum.amount) })),
      byCategory: cByCategory.map((r) => ({ categoryId: r.category_id, name: r.category_id ? cCatNames.get(r.category_id) ?? null : 'Uncategorised', total: str(r._sum.amount) })),
      monthly: monthly.map((m) => ({ month: m.month.toISOString().slice(0, 7), total: str(m.total), count: Number(m.count) })),
    };
    result.income = {
      total: str(iTotal._sum.amount),
      count: iTotal._count._all,
      byCategory: iByCategory.map((r) => ({ categoryId: r.category_id, name: r.category_id ? cCatNames.get(r.category_id) ?? null : 'Uncategorised', total: str(r._sum.amount) })),
    };
    // Operating position deliberately excludes money-request releases: those are payouts against
    // requests, reported separately above, and adding them here could double count spending.
    result.operatingPosition = {
      contributionsAndIncome: new Prisma.Decimal(cTotal._sum.amount ?? 0).plus(iTotal._sum.amount ?? 0).toString(),
      approvedExpenses: str(approvedTotal._sum.amount),
      net: new Prisma.Decimal(cTotal._sum.amount ?? 0).plus(iTotal._sum.amount ?? 0).minus(approvedTotal._sum.amount ?? 0).toString(),
    };
    return result;
  }

  // ===================== member statements =====================

  private async contributionsFor(memberId: string, fellowshipId: string | null, from?: Date, to?: Date) {
    const where: Prisma.ContributionWhereInput = {
      member_id: memberId,
      fellowship_id: fellowshipId,
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [rows, byType, total] = await Promise.all([
      this.prisma.contribution.findMany({
        where, orderBy: { date: 'desc' }, take: 1000,
        select: { id: true, amount: true, contribution_type: true, date: true, notes: true, campaign: { select: { id: true, name: true } }, category: { select: { id: true, name: true } } },
      }),
      this.prisma.contribution.groupBy({ by: ['contribution_type'], where, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.contribution.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    return {
      total: str(total._sum.amount),
      count: total._count._all,
      byType: byType.map((r) => ({ type: r.contribution_type, total: str(r._sum.amount), count: r._count._all })),
      contributions: rows.map((r) => ({ ...r, amount: str(r.amount) })),
      truncated: total._count._all > rows.length,
    };
  }

  private async pledgesWithFulfillment(memberId: string, fellowshipId: string | null) {
    const pledges = await this.prisma.contributionPledge.findMany({
      where: { member_id: memberId, fellowship_id: fellowshipId },
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return Promise.all(pledges.map(async (p) => ({
      id: p.id, amount: str(p.amount), frequency: p.frequency, startDate: p.start_date, endDate: p.end_date,
      isActive: p.is_active, campaign: p.campaign, fulfillment: await this.pledges.fulfillmentFor(p),
    })));
  }

  // An individual's giving is sensitive: only finance viewers holding the statement permission may read
  // it, and every read is audited.
  async memberStatement(memberId: string, user: any, q: { from?: string; to?: string } = {}) {
    if (!this.access.isFinanceViewer(user)) throw new ForbiddenException('You do not have permission to perform this action.');
    this.access.requirePermission(user, PERMISSIONS.FINANCE_MEMBER_STATEMENT_VIEW);
    if (!isUuid(memberId)) throw new NotFoundException('Member not found');
    const member = await this.prisma.member.findUnique({ where: { id: memberId }, select: { id: true, full_name: true, member_code: true, fellowship_id: true } });
    if (!member) throw new NotFoundException('Member not found');
    this.tenantScope.assertInScope(user, member);

    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 3650 });
    const [giving, pledges] = await Promise.all([
      this.contributionsFor(memberId, member.fellowship_id, from, to),
      this.pledgesWithFulfillment(memberId, member.fellowship_id),
    ]);
    await this.auditService.log({ userId: user.userId, action: 'finance.member_statement_view', entityType: 'member', entityId: memberId });
    return { member: { id: member.id, fullName: member.full_name, memberCode: member.member_code }, ...giving, pledges };
  }

  // Self-service: a signed-in user sees ONLY the member record linked to their own account.
  async myContributions(user: any, q: { from?: string; to?: string } = {}) {
    const member = await this.prisma.member.findFirst({
      where: { user_id: user.userId },
      select: { id: true, full_name: true, member_code: true, fellowship_id: true },
    });
    if (!member) throw new NotFoundException('No member profile is linked to your account.');
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 3650 });
    const [giving, pledges] = await Promise.all([
      this.contributionsFor(member.id, member.fellowship_id, from, to),
      this.pledgesWithFulfillment(member.id, member.fellowship_id),
    ]);
    return { member: { id: member.id, fullName: member.full_name, memberCode: member.member_code }, ...giving, pledges };
  }
}
