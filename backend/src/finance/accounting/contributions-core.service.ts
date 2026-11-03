import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { validateAttachments } from '../../department-workspace/department.util';
import { assertPeriodOpen, validateAmount, validateDate, validateOptionalUuid, validateText } from '../finance.validation';
import { assertAccountScope, D, defaultAccount, getSettings, money, nextNumber, postEntry, reverseSource, Tx, ZERO } from './ledger';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';

export interface AllocationInput { projectId: string; amount: number | string }

export interface ContributionInput {
  contributorType?: 'member' | 'external' | 'anonymous';
  memberId?: string;
  contributorName?: string;
  contributorPhone?: string;
  contributorEmail?: string;
  amount: number | string;
  date: string | Date;
  contributionType?: string;
  categoryId?: string;
  /** The Contribution Drive this money is for. */
  campaignId?: string;
  accountId?: string;
  paymentMethod?: string;
  paymentReference?: string;
  notes?: string;
  attachments?: unknown;
  allocations?: AllocationInput[];
  membershipFeeId?: string;
  receiptDocumentId?: string;
}

const OPEN_PROJECT = ['APPROVED', 'ACTIVE'] as const;

/** A project that can receive money from this scope: same fellowship, approved or active, and of the same scope. */
export async function assertProjectForScope(tx: Tx | any, projectId: string, fellowshipId: string, departmentId: string | null) {
  if (!isUuid(projectId)) throw new BadRequestException('projectId must be a valid id');
  const project = await tx.project.findFirst({ where: { id: projectId, fellowship_id: fellowshipId } });
  if (!project) throw new BadRequestException('The selected project is not available.');
  if (!(OPEN_PROJECT as readonly string[]).includes(project.status)) {
    throw new BadRequestException(`"${project.name}" is not open for funding (it is ${project.status.toLowerCase().replace(/_/g, ' ')}).`);
  }
  const projectDept = project.scope === 'department' ? project.department_id : null;
  if ((projectDept ?? null) !== (departmentId ?? null)) {
    throw new BadRequestException(departmentId
      ? 'A department\'s money can only fund that department\'s own projects.'
      : 'Central fellowship money can only fund fellowship-wide projects.');
  }
  return project;
}

/** Validates an allocation list against a contribution amount. Returns normalised rows. */
export async function validateAllocations(tx: Tx | any, list: unknown, total: Prisma.Decimal, fellowshipId: string, departmentId: string | null) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new BadRequestException('allocations must be a list');
  if (list.length > 20) throw new BadRequestException('A contribution can be split across at most 20 projects.');
  const rows: { projectId: string; amount: Prisma.Decimal }[] = [];
  const seen = new Set<string>();
  for (const a of list as AllocationInput[]) {
    const amount = D(validateAmount('allocation amount', a?.amount));
    await assertProjectForScope(tx, a?.projectId, fellowshipId, departmentId);
    if (seen.has(a.projectId)) throw new BadRequestException('Each project can appear only once in the allocations.');
    seen.add(a.projectId);
    rows.push({ projectId: a.projectId, amount });
  }
  const sum = rows.reduce((s, r) => s.plus(r.amount), ZERO);
  if (sum.greaterThan(total)) {
    throw new BadRequestException(`The allocations (${money(sum)}) are more than the contribution (${money(total)}).`);
  }
  return rows;
}

/** Due dates of a membership fee up to (and including) `asOf`. */
export function feeDueDates(fee: { frequency: string; start_date: Date; end_date: Date | null; due_dates: any }, asOf: Date): Date[] {
  const end = fee.end_date && fee.end_date < asOf ? fee.end_date : asOf;
  if (fee.frequency === 'custom') {
    return ((fee.due_dates as string[]) || []).map((d) => new Date(d)).filter((d) => !Number.isNaN(d.getTime()) && d <= end).sort((a, b) => +a - +b);
  }
  if (fee.frequency === 'one_time') return fee.start_date <= end ? [fee.start_date] : [];
  const step = fee.frequency === 'monthly' ? 1 : fee.frequency === 'semester' ? 6 : 12;
  const out: Date[] = [];
  for (let k = 0; k < 600; k++) {
    const d = new Date(fee.start_date);
    d.setUTCMonth(d.getUTCMonth() + k * step);
    if (d > end) break;
    out.push(d);
  }
  return out;
}

/**
 * Recording money received. One payment is one contribution row and one ledger entry - so a payment is counted
 * once, whether it is general, split across projects or a membership fee.
 */
@Injectable()
export class ContributionsCoreService {
  constructor(private prisma: PrismaService, private scope: FinanceScopeService, private notify: FinanceNotifyService) {}

  async record(user: any, dto: ContributionInput, ctx: { fellowshipId: string; departmentId: string | null }) {
    const { fellowshipId, departmentId } = ctx;
    const amount = D(validateAmount('amount', dto?.amount));
    const date = validateDate('date', dto?.date) as Date;
    const contributorType = (dto?.contributorType ?? 'member') as string;
    if (!['member', 'external', 'anonymous'].includes(contributorType)) throw new BadRequestException('contributorType must be member, external or anonymous');
    let memberId = validateOptionalUuid('memberId', dto?.memberId);
    let contributorName = validateText('contributorName', dto?.contributorName, 150);
    let contributorPhone = validateText('contributorPhone', dto?.contributorPhone, 30);
    const contributorEmail = validateText('contributorEmail', dto?.contributorEmail, 150);
    const categoryId = validateOptionalUuid('categoryId', dto?.categoryId);
    const campaignId = validateOptionalUuid('campaignId', dto?.campaignId);
    const accountId = validateOptionalUuid('accountId', dto?.accountId);
    const feeId = validateOptionalUuid('membershipFeeId', dto?.membershipFeeId);
    const receiptDocumentId = validateOptionalUuid('receiptDocumentId', dto?.receiptDocumentId);
    const notes = validateText('notes', dto?.notes, 500);
    const reference = validateText('paymentReference', dto?.paymentReference, 100);
    const attachments = validateAttachments('attachments', dto?.attachments ?? []);
    const settings = await getSettings(this.prisma as any, fellowshipId);
    const method = (validateText('paymentMethod', dto?.paymentMethod, 30) ?? 'cash') as string;
    if (!settings.payment_methods.includes(method)) {
      throw new BadRequestException(`paymentMethod must be one of: ${settings.payment_methods.join(', ')}`);
    }

    if (contributorType === 'member' && !memberId) throw new BadRequestException('Choose the member who contributed.');
    if (contributorType === 'external' && !contributorName) throw new BadRequestException('Enter the contributor\'s name.');
    if (contributorType !== 'member') memberId = null;
    if (contributorType === 'anonymous') { contributorName = null; contributorPhone = null; }
    if (memberId) {
      const m = await this.prisma.member.findFirst({ where: { id: memberId, fellowship_id: fellowshipId }, select: { id: true } });
      if (!m) throw new NotFoundException('Member not found');
    }

    let contributionType = validateText('contributionType', dto?.contributionType, 50);
    if (categoryId) {
      const cat = await this.prisma.financeCategory.findFirst({ where: { id: categoryId, fellowship_id: fellowshipId, kind: 'contribution', is_active: true } });
      if (!cat) throw new BadRequestException('The selected category is not available.');
      contributionType = contributionType ?? cat.name;
    }
    if (campaignId) {
      const drive = await this.prisma.contributionCampaign.findFirst({ where: { id: campaignId, fellowship_id: fellowshipId } });
      if (!drive) throw new BadRequestException('The selected contribution drive is not available.');
      if ((drive.department_id ?? null) !== (departmentId ?? null)) throw new BadRequestException('That contribution drive belongs to a different fund.');
      if (drive.status !== 'active') throw new ConflictException('This contribution drive is closed; it accepts no new money.');
    }
    if (receiptDocumentId) {
      const doc = await this.prisma.documentEntity.findFirst({ where: { id: receiptDocumentId, fellowship_id: fellowshipId, is_website_content: false }, select: { id: true } });
      if (!doc) throw new BadRequestException('The selected receipt document is not available.');
    }
    await assertPeriodOpen(this.prisma, fellowshipId, date);

    const result = await this.prisma.$transaction(async (tx) => {
      const account = accountId
        ? await assertAccountScope(tx, accountId, fellowshipId, departmentId)
        : await defaultAccount(tx, fellowshipId, departmentId, user.userId);

      // ---- membership fee payment: a department's own fee, paid by an eligible member ----
      let fee: any = null;
      if (feeId) {
        fee = await tx.membershipFee.findFirst({ where: { id: feeId, fellowship_id: fellowshipId } });
        if (!fee || fee.department_id !== departmentId) throw new BadRequestException('The selected membership fee is not available.');
        if (!fee.is_active) throw new BadRequestException('This membership fee is no longer active.');
        if (!memberId) throw new BadRequestException('A membership fee is paid by a registered member.');
        const eligible = fee.eligible_member_ids as string[] | null;
        const inDept = await tx.departmentMember.findFirst({ where: { department_id: departmentId!, member_id: memberId, removed: false }, select: { id: true } });
        if (eligible ? !eligible.includes(memberId) : !inDept) throw new BadRequestException('This member is not required to pay this fee.');
        if (!fee.allow_partial && !amount.mod(fee.amount).isZero()) {
          throw new BadRequestException(`This fee does not accept partial payments: pay a multiple of ${money(fee.amount)}.`);
        }
        contributionType = contributionType ?? fee.name;
      }

      const receipt = await nextNumber(tx, fellowshipId, 'receipt', settings.receipt_prefix, date);
      let contribution: any;
      try {
        contribution = await tx.contribution.create({
          data: {
            fellowship_id: fellowshipId,
            department_id: departmentId,
            member_id: memberId,
            contributor_type: contributorType as any,
            contributor_name: contributorName,
            contributor_phone: contributorPhone,
            contributor_email: contributorType === 'anonymous' ? null : contributorEmail,
            amount: amount.toFixed(2),
            contribution_type: contributionType ?? 'general',
            date,
            category_id: categoryId,
            campaign_id: campaignId,
            account_id: account.id,
            payment_method: method,
            payment_reference: reference,
            payment_dedupe_key: reference ? `${method}:${reference.toLowerCase()}` : null,
            membership_fee_id: fee?.id ?? null,
            receipt_document_id: receiptDocumentId,
            notes,
            attachments: attachments as any,
            receipt_number: receipt,
            recorded_by: user.userId,
            approval_status: 'FINAL_APPROVED',
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') throw new ConflictException('A payment with this reference has already been recorded.');
        throw err;
      }

      // ---- project allocations ----
      const allocations = await validateAllocations(tx, dto?.allocations, amount, fellowshipId, departmentId);
      for (const a of allocations) {
        await tx.contributionAllocation.create({ data: { fellowship_id: fellowshipId, contribution_id: contribution.id, project_id: a.projectId, amount: a.amount.toFixed(2), created_by: user.userId } });
      }

      await postEntry(tx, {
        fellowshipId, accountId: account.id, amount, entryType: 'contribution', sourceType: 'contribution', sourceId: contribution.id,
        date, userId: user.userId, departmentId, projectId: allocations.length === 1 ? allocations[0].projectId : null,
        reference: receipt, description: contributionType ?? 'Contribution', primary: true,
      });
      await tx.auditLog.create({
        data: {
          user_id: user.userId, action: 'finance.contribution_create', entity_type: 'contribution', entity_id: contribution.id, fellowship_id: fellowshipId,
          new_value: { amount: amount.toFixed(2), receipt, departmentId, accountId: account.id, allocations: allocations.map((a) => ({ projectId: a.projectId, amount: a.amount.toFixed(2) })), feeId } as any,
        },
      });
      return { contribution };
    });

    return this.prisma.contribution.findUnique({
      where: { id: result.contribution.id },
      include: { allocations: { where: { is_active: true }, include: { project: { select: { id: true, name: true, project_number: true } } } }, account: { select: { id: true, name: true } } },
    });
  }

  /** Replaces a contribution's project allocations. The old rows are ended, not deleted, so history is kept. */
  async setAllocations(user: any, id: string, body: { allocations?: AllocationInput[]; reason?: string }) {
    const c = await this.load(user, id);
    await this.scope.requireManage(user, c.department_id, { central: ['treasurer'] });
    if (c.status !== 'active') throw new ConflictException('A reversed contribution cannot be allocated.');
    const reason = validateText('reason', body?.reason, 300) ?? 'Allocation changed';
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "contributions" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const rows = await validateAllocations(tx, body?.allocations ?? [], D(c.amount), c.fellowship_id!, c.department_id);
      await tx.contributionAllocation.updateMany({ where: { contribution_id: id, is_active: true }, data: { is_active: false, ended_at: new Date(), ended_by: user.userId, end_reason: reason } });
      for (const r of rows) {
        await tx.contributionAllocation.create({ data: { fellowship_id: c.fellowship_id!, contribution_id: id, project_id: r.projectId, amount: r.amount.toFixed(2), created_by: user.userId } });
      }
      await tx.auditLog.create({ data: { user_id: user.userId, action: 'finance.contribution_allocation', entity_type: 'contribution', entity_id: id, fellowship_id: c.fellowship_id, comment: reason, new_value: { allocations: rows.map((r) => ({ projectId: r.projectId, amount: r.amount.toFixed(2) })) } as any } });
    });
    return this.detail(user, id);
  }

  async load(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Contribution not found');
    const c = await this.prisma.contribution.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!c) throw new NotFoundException('Contribution not found');
    return c;
  }

  async detail(user: any, id: string) {
    const c = await this.load(user, id);
    await this.scope.requireView(user, c.department_id);
    const full = await this.prisma.contribution.findUnique({
      where: { id },
      include: {
        member: { select: { id: true, full_name: true, member_code: true } },
        category: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, account_type: true } },
        allocations: { orderBy: { created_at: 'asc' }, include: { project: { select: { id: true, name: true, project_number: true } } } },
      },
    });
    const allocated = full!.allocations.filter((a) => a.is_active).reduce((s, a) => s.plus(a.amount), ZERO);
    return { ...full, allocatedAmount: money(allocated), unallocatedAmount: money(D(full!.amount).minus(allocated)) };
  }

  /** Data for a printable receipt. Department leaders get receipts for their own department only. */
  async receipt(user: any, id: string) {
    const c = await this.detail(user, id);
    const [fellowship, recorder, fee, settings] = await Promise.all([
      this.prisma.fellowship.findUnique({ where: { id: c.fellowship_id! }, select: { name: true, location: true } }),
      this.prisma.user.findUnique({ where: { id: c.recorded_by }, select: { first_name: true, last_name: true } }),
      c.membership_fee_id ? this.prisma.membershipFee.findUnique({ where: { id: c.membership_fee_id }, select: { name: true } }) : null,
      getSettings(this.prisma as any, c.fellowship_id!),
    ]);
    const department = c.department_id ? await this.prisma.department.findUnique({ where: { id: c.department_id }, select: { name: true } }) : null;
    const contributor = c.contributor_type === 'anonymous' ? 'Anonymous' : c.member?.full_name ?? c.contributor_name ?? '—';
    return {
      fellowship: fellowship?.name ?? '',
      fellowshipLocation: fellowship?.location ?? null,
      department: department?.name ?? null,
      currency: settings.currency,
      receiptNumber: c.receipt_number,
      date: c.date,
      contributor,
      memberCode: c.contributor_type === 'member' ? c.member?.member_code ?? null : null,
      amount: money(c.amount),
      purpose: c.contribution_type,
      category: c.category?.name ?? null,
      paymentMethod: c.payment_method,
      paymentReference: c.payment_reference,
      account: c.account?.name ?? null,
      allocations: c.allocations.filter((a) => a.is_active).map((a) => ({ project: a.project.name, number: a.project.project_number, amount: money(a.amount) })),
      membershipFee: fee?.name ?? null,
      recordedBy: recorder ? `${recorder.first_name} ${recorder.last_name}` : null,
      status: c.status,
      reversalReason: c.reversal_reason,
    };
  }

  /** A department's contribution is reversed by its Department Chairperson (never by the person who recorded it). */
  async reverseDepartment(user: any, id: string, body: { reason?: string }) {
    const c = await this.load(user, id);
    if (!c.department_id) throw new ForbiddenException('Central contributions are reversed through a reversal request approved by the Secretary and Chairperson.');
    await this.scope.requireManage(user, c.department_id, { office: 'department_chairperson' });
    if (c.recorded_by === user.userId) throw new ForbiddenException('You cannot reverse a contribution that you recorded.');
    const reason = validateText('reason', body?.reason, 300, true) as string;
    await assertPeriodOpen(this.prisma, c.fellowship_id, c.date);
    await this.prisma.$transaction((tx) => reverseContributionTx(tx, c.id, user.userId, reason));
    return this.detail(user, id);
  }
}

/** Reverses a contribution: ledger reversal and allocations ended. The row is kept. */
export async function reverseContributionTx(tx: Tx, id: string, actor: string, reason: string) {
  const done = await tx.contribution.updateMany({
    where: { id, status: 'active' },
    data: { status: 'reversed', reversed_at: new Date(), reversed_by: actor, reversal_reason: reason },
  });
  if (done.count !== 1) throw new ConflictException('This contribution has already been reversed.');
  const c = await tx.contribution.findUniqueOrThrow({ where: { id } });
  if (c.fellowship_id) await reverseSource(tx, c.fellowship_id, 'contribution', id, actor, reason);
  await tx.contributionAllocation.updateMany({ where: { contribution_id: id, is_active: true }, data: { is_active: false, ended_at: new Date(), ended_by: actor, end_reason: 'Contribution reversed' } });
  await tx.auditLog.create({ data: { user_id: actor, action: 'finance.contribution_reversed', entity_type: 'contribution', entity_id: id, fellowship_id: c.fellowship_id, comment: reason, old_value: { amount: D(c.amount).toFixed(2) } as any } });
}
