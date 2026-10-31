import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { FinanceScopeService } from './accounting/finance-scope.service';
import { ContributionsCoreService, assertProjectForScope } from './accounting/contributions-core.service';
import { D, money, nextNumber, ZERO } from './accounting/ledger';
import {
  expectedInstallments,
  validateAmount,
  validateDate,
  validateOptionalUuid,
  validateRequiredUuid,
  validateText,
} from './finance.validation';

const FREQUENCIES = ['one_time', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
type Frequency = (typeof FREQUENCIES)[number];

export interface PledgeDto {
  memberId?: string;
  campaignId?: string | null;
  amount?: number;
  frequency?: string;
  startDate?: string;
  endDate?: string | null;
  isActive?: boolean;
  notes?: string;
  fellowshipId?: string;
}

// A pledge is a member's commitment to give. It NEVER creates contributions on its own (no money is
// recorded without a person recording it); it is compared with the contributions that actually exist.
@Injectable()
export class FinancePledgesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
    private scope: FinanceScopeService,
    private contributions: ContributionsCoreService,
  ) {}

  /** Outstanding and overdue, computed. A pledge is a promise: none of this is money received. */
  shapePledge(p: any) {
    const outstanding = Prisma.Decimal.max(D(p.amount).minus(p.amount_fulfilled ?? 0), ZERO);
    const open = p.status === 'pending' || p.status === 'partially_fulfilled';
    const overdue = open && !!p.due_date && new Date(p.due_date) < new Date() && outstanding.greaterThan(0);
    return {
      ...p, amount: money(p.amount), amount_fulfilled: money(p.amount_fulfilled ?? 0), outstanding: outstanding.toFixed(2),
      displayStatus: overdue ? 'overdue' : p.status,
      contributor: p.contributor_type === 'anonymous' ? 'Anonymous' : p.member?.full_name ?? p.contributor_name ?? null,
    };
  }

  /**
   * A pledge towards a project or campaign (or general): who pledged, how much in total, by when. Members,
   * external contributors and anonymous pledgers are all supported; department pledges belong to the department.
   */
  async createPledge(dto: any, user: any) {
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    if (departmentId) await this.scope.requireManage(user, departmentId);
    else this.access.requirePermission(user, PERMISSIONS.FINANCE_PLEDGE_MANAGE);
    const type = dto?.contributorType ?? 'member';
    if (!['member', 'external', 'anonymous'].includes(type)) throw new BadRequestException('contributorType must be member, external or anonymous');
    const memberId = type === 'member' ? validateRequiredUuid('memberId', dto?.memberId) : null;
    if (memberId) await this.access.assertMember(memberId, fellowshipId);
    const name = type === 'external' ? validateText('contributorName', dto?.contributorName, 150, true) : null;
    const phone = type === 'external' ? validateText('contributorPhone', dto?.contributorPhone, 30) : null;
    const campaignId = validateOptionalUuid('campaignId', dto?.campaignId);
    if (campaignId) {
      const c = await this.prisma.contributionCampaign.findFirst({ where: { id: campaignId, fellowship_id: fellowshipId } });
      if (!c || (c.department_id ?? null) !== (departmentId ?? null)) throw new BadRequestException('The selected campaign is not available.');
    }
    const projectId = validateOptionalUuid('projectId', dto?.projectId);
    if (projectId) await assertProjectForScope(this.prisma, projectId, fellowshipId, departmentId);
    const amount = validateAmount('amount', dto?.amount);
    const pledgedAt = (validateDate('pledgedAt', dto?.pledgedAt, { required: false }) ?? new Date()) as Date;
    const due = validateDate('dueDate', dto?.dueDate, { required: false, maxFutureDays: 3650 }) ?? null;
    if (due && due < pledgedAt) throw new BadRequestException('dueDate cannot be before the pledge date');
    const notes = validateText('notes', dto?.notes, 500);
    const pledge = await this.prisma.$transaction(async (tx) => tx.contributionPledge.create({
      data: {
        fellowship_id: fellowshipId, department_id: departmentId, contributor_type: type as any, member_id: memberId,
        contributor_name: name, contributor_phone: phone, campaign_id: campaignId, project_id: projectId, amount,
        frequency: 'one_time', start_date: pledgedAt, pledged_at: pledgedAt, end_date: due, due_date: due, notes,
        pledge_number: await nextNumber(tx, fellowshipId, 'pledge', 'PLG', pledgedAt), created_by: user.userId,
      },
    }));
    await this.auditService.log({ userId: user.userId, action: 'finance.pledge_create', entityType: 'pledge', entityId: pledge.id, newValue: { amount, projectId, campaignId, departmentId } });
    return this.shapePledge(pledge);
  }

  async getPledge(id: string, user: any) {
    if (!isUuid(id)) throw new NotFoundException('Pledge not found');
    const fellowshipId = this.scope.fellowship(user);
    const p = await this.prisma.contributionPledge.findFirst({
      where: { id, fellowship_id: fellowshipId },
      include: { member: { select: { id: true, full_name: true, member_code: true } }, campaign: { select: { id: true, name: true } } },
    });
    if (!p) throw new NotFoundException('Pledge not found');
    await this.scope.requireView(user, p.department_id);
    const payments = await this.prisma.contribution.findMany({
      where: { pledge_id: id }, orderBy: { date: 'asc' },
      select: { id: true, receipt_number: true, amount: true, pledge_applied: true, date: true, status: true },
    });
    const project = p.project_id ? await this.prisma.project.findUnique({ where: { id: p.project_id }, select: { id: true, name: true, project_number: true } }) : null;
    return { ...this.shapePledge(p), project, payments: payments.map((x) => ({ ...x, amount: money(x.amount), pledge_applied: money(x.pledge_applied), additional: money(D(x.amount).minus(x.pledge_applied ?? 0)) })) };
  }

  /** A payment towards the pledge: one contribution and one receipt; any excess is an additional contribution. */
  async payPledge(id: string, body: any, user: any) {
    const p = await this.getPledge(id, user);
    if (p.department_id) await this.scope.requireManage(user, p.department_id);
    else this.access.requirePermission(user, PERMISSIONS.FINANCE_CONTRIBUTION_RECORD);
    return this.contributions.record(user, {
      contributorType: p.contributor_type, memberId: p.member_id ?? undefined, contributorName: p.contributor_name ?? undefined,
      amount: body?.amount, date: body?.date, accountId: body?.accountId, paymentMethod: body?.paymentMethod,
      paymentReference: body?.paymentReference, notes: body?.notes, pledgeId: id, categoryId: body?.categoryId,
    }, { fellowshipId: p.fellowship_id!, departmentId: p.department_id });
  }

  async cancelPledge(id: string, body: any, user: any) {
    const p = await this.getPledge(id, user);
    if (p.department_id) await this.scope.requireManage(user, p.department_id, { office: 'department_chairperson' });
    else this.access.requirePermission(user, PERMISSIONS.FINANCE_PLEDGE_MANAGE);
    const reason = validateText('reason', body?.reason, 300, true) as string;
    const done = await this.prisma.contributionPledge.updateMany({ where: { id, status: { in: ['pending', 'partially_fulfilled'] } }, data: { status: 'cancelled', is_active: false } });
    if (done.count !== 1) throw new BadRequestException('Only an open pledge can be cancelled.');
    await this.auditService.log({ userId: user.userId, action: 'finance.pledge_cancel', entityType: 'pledge', entityId: id, comment: reason });
    return this.getPledge(id, user);
  }

  private requireViewer(user: any) {
    if (!this.access.isFinanceViewer(user)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  // Received = the member's contributions inside the pledge window (limited to the pledge's campaign
  // when it has one; otherwise all of the member's contributions count - documented behaviour).
  async fulfillmentFor(pledge: any, asOf: Date = new Date()) {
    const stop = pledge.end_date && pledge.end_date < asOf ? pledge.end_date : asOf;
    const expectedCount = expectedInstallments(pledge.frequency, pledge.start_date, asOf, pledge.end_date);
    const expected = new Prisma.Decimal(pledge.amount).mul(expectedCount);
    const agg = await this.prisma.contribution.aggregate({
      where: {
        member_id: pledge.member_id,
        fellowship_id: pledge.fellowship_id,
        ...(pledge.campaign_id ? { campaign_id: pledge.campaign_id } : {}),
        date: { gte: pledge.start_date, lte: stop },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const received = new Prisma.Decimal(agg._sum.amount ?? 0);
    return {
      asOf,
      expectedInstallments: expectedCount,
      expectedAmount: expected.toString(),
      receivedAmount: received.toString(),
      balance: expected.minus(received).toString(),
      contributionCount: agg._count._all,
    };
  }

  async list(user: any, q: Record<string, string | undefined> = {}) {
    const { take, skip } = this.access.parsePaging(q.limit, q.page, 200);
    const extra: Record<string, any> = !this.access.isFinanceViewer(user) || q.departmentId ? await this.scope.listScope(user, q.departmentId) : {};
    if (q.projectId) extra.project_id = validateRequiredUuid('projectId', q.projectId);
    if (q.status && ['pending', 'partially_fulfilled', 'fulfilled', 'cancelled'].includes(q.status)) extra.status = q.status;
    if (q.memberId) extra.member_id = validateRequiredUuid('memberId', q.memberId);
    if (q.campaignId) extra.campaign_id = validateRequiredUuid('campaignId', q.campaignId);
    if (q.active === 'true') extra.is_active = true;
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.ContributionPledgeWhereInput;
    const rows = await this.prisma.contributionPledge.findMany({
      where, orderBy: { created_at: 'desc' }, take, skip,
      include: { member: { select: { id: true, full_name: true, member_code: true } }, campaign: { select: { id: true, name: true } } },
    });
    const shaped = rows.map((r) => this.shapePledge(r));
    return q.status === 'overdue' ? shaped.filter((r) => r.displayStatus === 'overdue') : shaped;
  }

  async fulfillment(id: string, user: any, asOfRaw?: string) {
    this.requireViewer(user);
    if (!isUuid(id)) throw new NotFoundException('Pledge not found');
    const pledge = await this.prisma.contributionPledge.findUnique({ where: { id } });
    if (!pledge) throw new NotFoundException('Pledge not found');
    this.tenantScope.assertInScope(user, pledge);
    const asOf = validateDate('asOf', asOfRaw, { required: false, maxFutureDays: 3650 }) ?? new Date();
    return { pledgeId: id, ...(await this.fulfillmentFor(pledge, asOf)) };
  }

  async create(dto: PledgeDto, user: any) {
    // Without a frequency this is a pledge of a total amount (towards a project, campaign or general).
    if (dto?.frequency === undefined) return this.createPledge(dto, user);
    this.access.requirePermission(user, PERMISSIONS.FINANCE_PLEDGE_MANAGE);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    const memberId = validateRequiredUuid('memberId', dto?.memberId);
    await this.access.assertMember(memberId, fellowshipId);
    const campaignId = validateOptionalUuid('campaignId', dto?.campaignId);
    if (campaignId) await this.access.assertCampaign(campaignId, fellowshipId);
    const amount = validateAmount('amount', dto?.amount);
    if (!FREQUENCIES.includes(dto?.frequency as Frequency)) {
      throw new BadRequestException(`frequency must be one of: ${FREQUENCIES.join(', ')}`);
    }
    const start = validateDate('startDate', dto?.startDate, { maxFutureDays: 3650 }) as Date;
    const end = validateDate('endDate', dto?.endDate, { required: false, maxFutureDays: 3650 }) ?? null;
    if (end && end < start) throw new BadRequestException('endDate cannot be before startDate');
    const notes = validateText('notes', dto?.notes, 500);

    const pledge = await this.prisma.contributionPledge.create({
      data: {
        fellowship_id: fellowshipId, member_id: memberId, campaign_id: campaignId, amount,
        frequency: dto.frequency as Frequency, start_date: start, end_date: end, notes, created_by: user.userId,
      },
    });
    await this.auditService.log({ userId: user.userId, action: 'finance.pledge_create', entityType: 'pledge', entityId: pledge.id, newValue: { amount, frequency: dto.frequency } });
    return pledge;
  }

  async update(id: string, dto: PledgeDto, user: any) {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_PLEDGE_MANAGE);
    if (!isUuid(id)) throw new NotFoundException('Pledge not found');
    const pledge = await this.prisma.contributionPledge.findUnique({ where: { id } });
    if (!pledge) throw new NotFoundException('Pledge not found');
    this.tenantScope.assertInScope(user, pledge);

    const data: Record<string, any> = {};
    if (dto.amount !== undefined) data.amount = validateAmount('amount', dto.amount);
    if (dto.endDate !== undefined) {
      data.end_date = validateDate('endDate', dto.endDate, { required: false, maxFutureDays: 3650 }) ?? null;
      if (data.end_date && data.end_date < pledge.start_date) throw new BadRequestException('endDate cannot be before startDate');
    }
    if (dto.isActive !== undefined) data.is_active = !!dto.isActive;
    if (dto.notes !== undefined) data.notes = validateText('notes', dto.notes, 500);
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const updated = await this.prisma.contributionPledge.update({ where: { id }, data });
    await this.auditService.log({ userId: user.userId, action: 'finance.pledge_edit', entityType: 'pledge', entityId: id, newValue: { fields: Object.keys(data) } });
    return updated;
  }
}
