import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
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
  ) {}

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
    this.requireViewer(user);
    const { take, skip } = this.access.parsePaging(q.limit, q.page, 200);
    const extra: Record<string, any> = {};
    if (q.memberId) extra.member_id = validateRequiredUuid('memberId', q.memberId);
    if (q.campaignId) extra.campaign_id = validateRequiredUuid('campaignId', q.campaignId);
    if (q.active === 'true') extra.is_active = true;
    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.ContributionPledgeWhereInput;
    return this.prisma.contributionPledge.findMany({
      where, orderBy: { created_at: 'desc' }, take, skip,
      include: { member: { select: { id: true, full_name: true, member_code: true } }, campaign: { select: { id: true, name: true } } },
    });
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
