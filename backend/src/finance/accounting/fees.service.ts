import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateAmount, validateDate, validateRequiredUuid, validateText } from '../finance.validation';
import { ContributionsCoreService, feeDueDates } from './contributions-core.service';
import { D, money, ZERO } from './ledger';
import { FinanceScopeService } from './finance-scope.service';

const FREQUENCIES = ['monthly', 'semester', 'annual', 'one_time', 'custom'];

/**
 * A department's membership fees and recurring contributions. Ordinary members need no login: the department's
 * leaders record payments against registered members, and each payment is a contribution with its own receipt.
 */
@Injectable()
export class FeesService {
  constructor(private prisma: PrismaService, private scope: FinanceScopeService, private contributions: ContributionsCoreService) {}

  private parse(body: any, partial = false) {
    const data: any = {};
    if (!partial || body?.name !== undefined) data.name = validateText('name', body?.name, 150, true);
    if (!partial || body?.amount !== undefined) data.amount = validateAmount('amount', body?.amount);
    if (!partial || body?.frequency !== undefined) {
      if (!FREQUENCIES.includes(body?.frequency)) throw new BadRequestException(`frequency must be one of: ${FREQUENCIES.join(', ')}`);
      data.frequency = body.frequency;
    }
    if (!partial || body?.startDate !== undefined) data.start_date = validateDate('startDate', body?.startDate, { maxFutureDays: 3650 });
    if (body?.endDate !== undefined) data.end_date = validateDate('endDate', body.endDate, { required: false, maxFutureDays: 3650 }) ?? null;
    if (body?.dueDates !== undefined) {
      if (!Array.isArray(body.dueDates) || body.dueDates.length > 60) throw new BadRequestException('dueDates must be a list of at most 60 dates');
      data.due_dates = body.dueDates.map((d: unknown) => (validateDate('dueDates', d, { maxFutureDays: 3650 }) as Date).toISOString());
    }
    if (body?.eligibleMemberIds !== undefined) {
      if (body.eligibleMemberIds === null) data.eligible_member_ids = Prisma.DbNull;
      else {
        if (!Array.isArray(body.eligibleMemberIds) || !body.eligibleMemberIds.every(isUuid)) throw new BadRequestException('eligibleMemberIds must be a list of member ids');
        data.eligible_member_ids = Array.from(new Set(body.eligibleMemberIds));
      }
    }
    if (body?.allowPartial !== undefined) data.allow_partial = body.allowPartial === true;
    if (body?.isActive !== undefined) data.is_active = body.isActive === true;
    return data;
  }

  async list(user: any, departmentId: string) {
    await this.scope.requireView(user, departmentId);
    const fees = await this.prisma.membershipFee.findMany({ where: { department_id: departmentId }, orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }] });
    return Promise.all(fees.map(async (f) => ({ ...f, amount: money(f.amount), summary: (await this.status(user, departmentId, f.id, true)).totals })));
  }

  async create(user: any, departmentId: string, body: any) {
    await this.scope.requireManage(user, departmentId);
    const fellowshipId = this.scope.fellowship(user);
    const data = this.parse(body);
    if (data.frequency === 'custom' && !(data.due_dates?.length)) throw new BadRequestException('A custom schedule needs its due dates.');
    if (data.end_date && data.end_date < data.start_date) throw new BadRequestException('endDate cannot be before startDate');
    await this.checkMembers(departmentId, data.eligible_member_ids);
    const fee = await this.prisma.membershipFee.create({ data: { ...data, fellowship_id: fellowshipId, department_id: departmentId, created_by: user.userId } });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.fee_create', entity_type: 'membership_fee', entity_id: fee.id, fellowship_id: fellowshipId, new_value: { name: fee.name, amount: money(fee.amount), frequency: fee.frequency } as any } });
    return { ...fee, amount: money(fee.amount) };
  }

  async update(user: any, departmentId: string, id: string, body: any) {
    await this.scope.requireManage(user, departmentId);
    const fee = await this.load(departmentId, id);
    const data = this.parse(body, true);
    const paid = await this.prisma.contribution.count({ where: { membership_fee_id: id, status: 'active' } });
    if (paid && (data.amount !== undefined || data.frequency !== undefined || data.start_date !== undefined)) {
      throw new ConflictException('Payments have been recorded against this fee: its amount and schedule can no longer change. Deactivate it and create a new one.');
    }
    await this.checkMembers(departmentId, data.eligible_member_ids);
    const saved = await this.prisma.membershipFee.update({ where: { id: fee.id }, data });
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.fee_update', entity_type: 'membership_fee', entity_id: id, fellowship_id: fee.fellowship_id, new_value: { fields: Object.keys(data) } as any } });
    return { ...saved, amount: money(saved.amount) };
  }

  private async checkMembers(departmentId: string, ids: any) {
    if (!Array.isArray(ids) || !ids.length) return;
    const n = await this.prisma.departmentMember.count({ where: { department_id: departmentId, member_id: { in: ids }, removed: false } });
    if (n !== ids.length) throw new BadRequestException('Every eligible member must be a current member of this department.');
  }

  private async load(departmentId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Fee not found');
    const fee = await this.prisma.membershipFee.findFirst({ where: { id, department_id: departmentId } });
    if (!fee) throw new NotFoundException('Fee not found');
    return fee;
  }

  /** Per member: expected so far, paid, outstanding, and fully paid / partially paid / overdue. */
  async status(user: any, departmentId: string, id: string, summaryOnly = false) {
    if (!summaryOnly) await this.scope.requireView(user, departmentId);
    const fee = await this.load(departmentId, id);
    const asOf = new Date();
    const dues = feeDueDates(fee, asOf);
    const perPeriod = D(fee.amount);
    const eligible = fee.eligible_member_ids as string[] | null;
    const members = await this.prisma.departmentMember.findMany({
      where: { department_id: departmentId, removed: false, ...(eligible ? { member_id: { in: eligible } } : {}) },
      include: { member: { select: { id: true, full_name: true, member_code: true } } },
    });
    const payments = await this.prisma.contribution.groupBy({ by: ['member_id'], where: { membership_fee_id: id, status: 'active' }, _sum: { amount: true } });
    const paidBy = new Map(payments.map((p) => [p.member_id, D(p._sum.amount)]));
    let expectedT = ZERO, paidT = ZERO, outstandingT = ZERO;
    const counts = { fullyPaid: 0, partiallyPaid: 0, unpaid: 0, overdue: 0 };
    const rows = members.map((m) => {
      const expected = perPeriod.times(dues.length);
      const paid = paidBy.get(m.member_id) ?? ZERO;
      const outstanding = Prisma.Decimal.max(expected.minus(paid), ZERO);
      const status = expected.isZero() ? 'not_due' : outstanding.isZero() ? 'paid' : paid.greaterThan(0) ? 'partially_paid' : 'unpaid';
      // Overdue: something is still owed for a due date that has passed (the latest due date is today or earlier).
      const overdue = outstanding.greaterThan(0) && dues.length > 0;
      expectedT = expectedT.plus(expected); paidT = paidT.plus(paid); outstandingT = outstandingT.plus(outstanding);
      if (status === 'paid') counts.fullyPaid++; else if (status === 'partially_paid') counts.partiallyPaid++; else if (status === 'unpaid') counts.unpaid++;
      if (overdue) counts.overdue++;
      return { memberId: m.member_id, name: m.member.full_name, memberCode: m.member.member_code, expected: expected.toFixed(2), paid: paid.toFixed(2), outstanding: outstanding.toFixed(2), status, overdue };
    });
    const totals = { members: rows.length, periodsDue: dues.length, expected: expectedT.toFixed(2), paid: paidT.toFixed(2), outstanding: outstandingT.toFixed(2), ...counts };
    if (summaryOnly) return { totals, rows: [] as any[] };
    return { fee: { ...fee, amount: money(fee.amount) }, dueDates: dues, totals, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async recordPayment(user: any, departmentId: string, id: string, body: any) {
    await this.scope.requireManage(user, departmentId);
    const fellowshipId = this.scope.fellowship(user);
    await this.load(departmentId, id);
    return this.contributions.record(user, {
      contributorType: 'member', memberId: validateRequiredUuid('memberId', body?.memberId), amount: body?.amount, date: body?.date,
      accountId: body?.accountId, paymentMethod: body?.paymentMethod, paymentReference: body?.paymentReference, notes: body?.notes, membershipFeeId: id,
    }, { fellowshipId, departmentId });
  }
}
