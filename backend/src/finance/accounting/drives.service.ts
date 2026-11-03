import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance.validation';
import { FinanceService } from '../finance.service';
import { FinanceScopeService } from './finance-scope.service';
import { D, money, nextNumber, ZERO } from './ledger';

export const DRIVE_KINDS = ['event', 'project', 'activity', 'outreach', 'membership', 'other'] as const;
const STATUSES = ['active', 'closed'];

/** How one contributor stands in a drive. A pledge is a promise, never money: owed = pledged - paid, never below 0. */
export interface ContributorLine {
  key: string;
  memberId: string | null;
  name: string;
  memberCode: string | null;
  pledged: string;
  paid: string;
  owed: string;
  pledges: number;
  payments: number;
}

/** The grouping key for a contributor: their member id, else the typed name (trimmed, case-insensitive). */
export function contributorKey(memberId: string | null | undefined, name: string | null | undefined): string | null {
  if (memberId) return `m:${memberId}`;
  const n = (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return n ? `n:${n}` : null;
}

/** Combines pledges and cash into one line per contributor (pure: unit tested). */
export function contributorLines(
  pledges: { member_id: string | null; contributor_name: string | null; amount: Prisma.Decimal.Value; member?: { full_name: string; member_code: string | null } | null }[],
  payments: { member_id: string | null; contributor_name: string | null; contributor_type?: string; amount: Prisma.Decimal.Value; member?: { full_name: string; member_code: string | null } | null }[],
): ContributorLine[] {
  const lines = new Map<string, { memberId: string | null; name: string; memberCode: string | null; pledged: Prisma.Decimal; paid: Prisma.Decimal; pledges: number; payments: number }>();
  const touch = (r: any) => {
    const key = contributorKey(r.member_id, r.contributor_type === 'anonymous' ? 'Anonymous' : r.contributor_name) ?? 'n:anonymous';
    let line = lines.get(key);
    if (!line) {
      line = { memberId: r.member_id ?? null, name: r.member?.full_name ?? (r.contributor_name?.trim() || 'Anonymous'), memberCode: r.member?.member_code ?? null, pledged: ZERO, paid: ZERO, pledges: 0, payments: 0 };
      lines.set(key, line);
    }
    return { key, line };
  };
  for (const p of pledges) { const { line } = touch(p); line.pledged = line.pledged.plus(p.amount); line.pledges += 1; }
  for (const c of payments) { const { line } = touch(c); line.paid = line.paid.plus(c.amount); line.payments += 1; }
  return Array.from(lines, ([key, l]) => ({
    key, memberId: l.memberId, name: l.name, memberCode: l.memberCode,
    pledged: l.pledged.toFixed(2), paid: l.paid.toFixed(2), owed: Prisma.Decimal.max(l.pledged.minus(l.paid), ZERO).toFixed(2),
    pledges: l.pledges, payments: l.payments,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Contribution Drives: something the fellowship (or one department) collects money for - an event, project, activity,
 * outreach or membership drive. Inside a drive: pledges and cash per contributor (a member, or a typed name), the
 * target, and the drive's own expenses. Drives are stored in contribution_campaigns; cash is an ordinary contribution
 * (same receipt, ledger entry and audit) tagged with the drive.
 */
@Injectable()
export class DrivesService {
  constructor(private prisma: PrismaService, private scope: FinanceScopeService, private finance: FinanceService) {}

  private async load(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Contribution drive not found');
    const d = await this.prisma.contributionCampaign.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!d) throw new NotFoundException('Contribution drive not found');
    return d;
  }

  /** Central drives: the Treasurer or Secretary. A department's drive: that department's current leaders. */
  private manage(user: any, departmentId: string | null) {
    return this.scope.requireManage(user, departmentId, { central: ['treasurer', 'secretary'] });
  }

  private shape(d: any) {
    return { id: d.id, name: d.name, kind: d.kind, description: d.description, target: d.target_amount ? money(d.target_amount) : null, startDate: d.start_date, endDate: d.end_date, status: d.status === 'active' ? 'active' : 'closed', departmentId: d.department_id, projectId: d.project_id, createdAt: d.created_at };
  }

  /** Money in, promised and spent for a set of drives, in four grouped queries. */
  private async totals(ids: string[]) {
    if (!ids.length) return new Map<string, any>();
    const [cash, pledged, paidExp, committedExp] = await Promise.all([
      this.prisma.contribution.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids }, status: 'active' }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.contributionPledge.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids }, status: { not: 'cancelled' } }, _sum: { amount: true } }),
      this.prisma.expense.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids }, payment_status: 'paid', reversed_at: null }, _sum: { amount_paid: true } }),
      this.prisma.expense.groupBy({ by: ['campaign_id'], where: { campaign_id: { in: ids }, payment_status: 'unpaid', approval_status: { notIn: ['REJECTED', 'CANCELLED'] }, reversed_at: null }, _sum: { amount: true } }),
    ]);
    const out = new Map<string, any>();
    for (const id of ids) {
      const c = D(cash.find((x) => x.campaign_id === id)?._sum.amount);
      const spent = D(paidExp.find((x) => x.campaign_id === id)?._sum.amount_paid);
      out.set(id, {
        collected: c.toFixed(2),
        payments: cash.find((x) => x.campaign_id === id)?._count._all ?? 0,
        pledged: D(pledged.find((x) => x.campaign_id === id)?._sum.amount).toFixed(2),
        expensesPaid: spent.toFixed(2),
        expensesPending: D(committedExp.find((x) => x.campaign_id === id)?._sum.amount).toFixed(2),
        balance: c.minus(spent).toFixed(2),
      });
    }
    return out;
  }

  private withProgress(d: any, t: any) {
    const target = d.target_amount ? D(d.target_amount) : null;
    return { ...t, remaining: target ? Prisma.Decimal.max(target.minus(t.collected), ZERO).toFixed(2) : null, progressPercent: target && !target.isZero() ? Math.min(999, Math.round(D(t.collected).div(target).times(100).toNumber())) : null };
  }

  async list(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const where: Prisma.ContributionCampaignWhereInput = { fellowship_id: fellowshipId, ...(await this.scope.listScope(user, q?.departmentId)) };
    if (q?.status === 'active') where.status = 'active';
    if (q?.status === 'closed') where.status = { not: 'active' };
    const rows = await this.prisma.contributionCampaign.findMany({ where, orderBy: [{ status: 'asc' }, { start_date: 'desc' }], take: 300 });
    const t = await this.totals(rows.map((r) => r.id));
    return rows.map((d) => ({ ...this.shape(d), totals: this.withProgress(d, t.get(d.id)) }));
  }

  private fields(b: any, partial: boolean) {
    const data: Record<string, any> = {};
    if (!partial || b?.name !== undefined) data.name = validateText('name', b?.name, 150, true);
    if (!partial || b?.kind !== undefined) {
      const kind = b?.kind ?? 'event';
      if (!(DRIVE_KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`kind must be one of: ${DRIVE_KINDS.join(', ')}`);
      data.kind = kind;
    }
    if (b?.description !== undefined) data.description = validateText('description', b.description, 1000);
    if (b?.target !== undefined) data.target_amount = b.target === null || b.target === '' ? null : D(validateAmount('target', b.target)).toFixed(2);
    if (!partial || b?.startDate !== undefined) data.start_date = validateDate('startDate', b?.startDate ?? new Date().toISOString(), { maxFutureDays: 3650 });
    if (b?.endDate !== undefined) data.end_date = b.endDate ? validateDate('endDate', b.endDate, { maxFutureDays: 3650 }) : null;
    if (data.start_date && data.end_date && data.end_date < data.start_date) throw new BadRequestException('endDate cannot be before startDate');
    return data;
  }

  async create(user: any, b: any) {
    const fellowshipId = this.scope.fellowship(user);
    const departmentId = validateOptionalUuid('departmentId', b?.departmentId);
    await this.manage(user, departmentId);
    const data = this.fields(b, false);
    const projectId = validateOptionalUuid('projectId', b?.projectId);
    if (projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: projectId, fellowship_id: fellowshipId }, select: { scope: true, department_id: true } });
      if (!p || (p.scope === 'department' ? p.department_id : null) !== (departmentId ?? null)) throw new BadRequestException('The selected project is not available for this fund.');
    }
    const clash = await this.prisma.contributionCampaign.findFirst({ where: { fellowship_id: fellowshipId, name: data.name }, select: { id: true } });
    if (clash) throw new ConflictException('A contribution drive with this name already exists.');
    const d = await this.prisma.contributionCampaign.create({ data: { ...(data as any), fellowship_id: fellowshipId, department_id: departmentId, project_id: projectId, status: 'active', created_by: user.userId } });
    await this.audit(user, 'finance.drive_create', d.id, { name: d.name, kind: d.kind, target: data.target_amount ?? null });
    return this.detail(user, d.id);
  }

  async update(user: any, id: string, b: any) {
    const d = await this.load(user, id);
    await this.manage(user, d.department_id);
    const data = this.fields(b, true);
    if (b?.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw new BadRequestException('status must be active or closed');
      data.status = b.status;
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    if (data.name && data.name !== d.name) {
      const clash = await this.prisma.contributionCampaign.findFirst({ where: { fellowship_id: d.fellowship_id, name: data.name, id: { not: id } }, select: { id: true } });
      if (clash) throw new ConflictException('A contribution drive with this name already exists.');
    }
    await this.prisma.contributionCampaign.update({ where: { id }, data });
    await this.audit(user, 'finance.drive_update', id, { fields: Object.keys(data) });
    return this.detail(user, id);
  }

  private memberSel = { select: { full_name: true, member_code: true } };

  async detail(user: any, id: string) {
    const d = await this.load(user, id);
    await this.scope.requireView(user, d.department_id);
    const [pledges, payments, expenses, totals, department] = await Promise.all([
      this.prisma.contributionPledge.findMany({ where: { campaign_id: id, status: { not: 'cancelled' } }, select: { member_id: true, contributor_name: true, amount: true, member: this.memberSel } }),
      this.prisma.contribution.findMany({ where: { campaign_id: id, status: 'active' }, select: { member_id: true, contributor_name: true, contributor_type: true, amount: true, member: this.memberSel } }),
      this.prisma.expense.findMany({ where: { campaign_id: id }, orderBy: { date: 'desc' }, take: 200, select: { id: true, expense_number: true, title: true, amount: true, amount_paid: true, date: true, approval_status: true, payment_status: true, reversed_at: true } }),
      this.totals([id]),
      d.department_id ? this.prisma.department.findUnique({ where: { id: d.department_id }, select: { id: true, name: true } }) : null,
    ]);
    return {
      ...this.shape(d), department,
      totals: this.withProgress(d, totals.get(id)),
      contributors: contributorLines(pledges, payments),
      expenses: expenses.map((e) => ({ ...e, amount: money(e.amount), amount_paid: e.amount_paid ? money(e.amount_paid) : null })),
    };
  }

  private keyWhere(key: string): Prisma.ContributionWhereInput & Prisma.ContributionPledgeWhereInput {
    if (key.startsWith('m:') && isUuid(key.slice(2))) return { member_id: key.slice(2) };
    if (key.startsWith('n:') && key.length > 2 && key.length <= 160) return { member_id: null, contributor_name: { equals: key.slice(2), mode: 'insensitive' } } as any;
    throw new NotFoundException('Contributor not found');
  }

  /** One contributor's pledges and payments in this drive. */
  async contributor(user: any, id: string, key: string) {
    const d = await this.load(user, id);
    await this.scope.requireView(user, d.department_id);
    const who = this.keyWhere(key);
    const [pledges, payments] = await Promise.all([
      this.prisma.contributionPledge.findMany({ where: { campaign_id: id, ...(who as any) }, orderBy: { created_at: 'asc' }, select: { id: true, pledge_number: true, amount: true, due_date: true, status: true, notes: true, created_at: true, member_id: true, contributor_name: true, member: this.memberSel } }),
      this.prisma.contribution.findMany({ where: { campaign_id: id, ...(who as any) }, orderBy: { date: 'asc' }, select: { id: true, receipt_number: true, amount: true, date: true, payment_method: true, payment_reference: true, status: true, member_id: true, contributor_name: true, contributor_type: true, member: this.memberSel } }),
    ]);
    const [line] = contributorLines(pledges.filter((p) => p.status !== 'cancelled'), payments.filter((p) => p.status === 'active'));
    if (!line && !pledges.length && !payments.length) throw new NotFoundException('Contributor not found');
    return {
      drive: { id: d.id, name: d.name, status: d.status === 'active' ? 'active' : 'closed' },
      contributor: line ?? null,
      pledges: pledges.map((p) => ({ ...p, amount: money(p.amount) })),
      payments: payments.map((p) => ({ ...p, amount: money(p.amount) })),
    };
  }

  private async active(user: any, id: string) {
    const d = await this.load(user, id);
    await this.manage(user, d.department_id);
    if (d.status !== 'active') throw new ConflictException('This contribution drive is closed; it accepts no new pledges or money.');
    return d;
  }

  /** Who is giving: a registered member of the fellowship, or a typed name for someone who is not a member. */
  private async giver(fellowshipId: string, b: any) {
    const memberId = validateOptionalUuid('memberId', b?.memberId);
    if (memberId) {
      const m = await this.prisma.member.findFirst({ where: { id: memberId, fellowship_id: fellowshipId }, select: { id: true } });
      if (!m) throw new NotFoundException('Member not found');
      return { memberId, name: null as string | null, phone: null as string | null };
    }
    const name = validateText('contributorName', b?.contributorName, 150);
    if (!name) throw new BadRequestException('Choose a member, or type the contributor\'s name.');
    return { memberId: null, name: name.trim().replace(/\s+/g, ' '), phone: validateText('contributorPhone', b?.contributorPhone, 30) };
  }

  async addPledge(user: any, id: string, b: any) {
    const d = await this.active(user, id);
    const fellowshipId = d.fellowship_id!;
    const g = await this.giver(fellowshipId, b);
    const amount = D(validateAmount('amount', b?.amount));
    const dueDate = b?.dueDate ? validateDate('dueDate', b.dueDate, { maxFutureDays: 3650 }) : null;
    const notes = validateText('notes', b?.notes, 500);
    const pledge = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, fellowshipId, 'pledge', 'PLG');
      const p = await tx.contributionPledge.create({
        data: {
          fellowship_id: fellowshipId, campaign_id: id, department_id: d.department_id, member_id: g.memberId,
          contributor_type: g.memberId ? 'member' : 'external', contributor_name: g.name, contributor_phone: g.phone,
          amount: amount.toFixed(2), frequency: 'one_time', start_date: new Date(), pledged_at: new Date(), due_date: dueDate,
          notes, pledge_number: number, created_by: user.userId,
        },
      });
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.drive_pledge', entity_type: 'contribution_drive', entity_id: id, fellowship_id: fellowshipId, new_value: { pledgeId: p.id, amount: amount.toFixed(2) } as any } });
      return p;
    });
    return { ...pledge, amount: money(pledge.amount), key: contributorKey(g.memberId, g.name) };
  }

  /** Cash received for the drive: an ordinary contribution (receipt, ledger, audit) tagged with the drive. */
  async addCash(user: any, id: string, b: any) {
    const d = await this.active(user, id);
    const g = await this.giver(d.fellowship_id!, b);
    const c = await this.finance.recordContribution({
      departmentId: d.department_id ?? undefined, campaignId: id,
      contributorType: g.memberId ? 'member' : 'external', memberId: g.memberId ?? undefined, contributorName: g.name ?? undefined, contributorPhone: g.phone ?? undefined,
      amount: b?.amount, date: b?.date ?? new Date().toISOString(), paymentMethod: b?.paymentMethod, paymentReference: b?.paymentReference,
      contributionType: d.name, notes: b?.notes,
    } as any, user);
    return { ...c, key: contributorKey(g.memberId, g.name) };
  }

  /**
   * Members to choose as a contributor: name and member number only, at most 20, own fellowship only. The members
   * list itself is the Secretary's; the Treasurer still has to be able to say who gave.
   */
  async memberSearch(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    if (!this.scope.isCentralViewer(user)) throw new NotFoundException();
    const term = validateText('search', q?.search, 100) ?? '';
    const rows = await this.prisma.member.findMany({
      where: { fellowship_id: fellowshipId, ...(term ? { OR: [{ full_name: { contains: term, mode: 'insensitive' } }, { member_code: { contains: term, mode: 'insensitive' } }] } : {}) },
      orderBy: { full_name: 'asc' }, take: 20, select: { id: true, full_name: true, member_code: true },
    });
    return rows.map((m) => ({ id: m.id, fullName: m.full_name, memberCode: m.member_code }));
  }

  private async audit(user: any, action: string, id: string, newValue: any) {
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action, entity_type: 'contribution_drive', entity_id: id, fellowship_id: user.fellowshipId ?? null, new_value: newValue } });
  }
}
