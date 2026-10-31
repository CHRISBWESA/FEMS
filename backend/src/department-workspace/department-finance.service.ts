import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateAmount, validateText } from '../shared/utils/validation.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import { DepartmentActivitiesService } from './department-activities.service';
import { dateRange, parsePaging, toCsv, validateAttachments } from './department.util';

export const FINANCE_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Pending Treasurer approval',
  RESUBMITTED: 'Pending Treasurer approval',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Under review',
  FINAL_APPROVED: 'Fully approved',
  RETURNED: 'Returned for revision',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  DRAFT: 'Draft',
};

const STAGE_LABEL: Record<string, string> = {
  treasurer: 'Treasurer',
  secretary: 'Fellowship Secretary',
  chairperson: 'Fellowship Chairperson',
};

interface BreakdownItem {
  item: string;
  quantity: number;
  unitCost: string;
  amount: string;
}

function cents(v: string | number): number {
  return Math.round(Number(v) * 100);
}

/**
 * A department's requests for money, kept in the Finance module's money_requests table so the Treasurer's
 * existing release step, records and reports apply unchanged. Approval: Treasurer -> Fellowship Secretary ->
 * Fellowship Chairperson; no stage can be skipped. Leaders only ever see their own department's requests.
 */
@Injectable()
export class DepartmentFinanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private engine: ApprovalEngineService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
    private activities: DepartmentActivitiesService,
  ) {}

  private breakdown(value: unknown): { items: BreakdownItem[]; total: number } {
    if (!Array.isArray(value) || value.length === 0)
      throw new BadRequestException('Add at least one line to the expense breakdown.');
    if (value.length > 50)
      throw new BadRequestException('The expense breakdown can have at most 50 lines.');
    const items = value.map((raw, i) => {
      const r = (raw || {}) as Record<string, unknown>;
      const item = validateText(`expenseBreakdown[${i}].item`, r.item, 200, true) as string;
      const quantity = Number(r.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000)
        throw new BadRequestException(`expenseBreakdown[${i}].quantity must be a whole number`);
      const unitCost = validateAmount(`expenseBreakdown[${i}].unitCost`, r.unitCost);
      const amount = ((cents(unitCost) * quantity) / 100).toFixed(2);
      return { item, quantity, unitCost: Number(unitCost).toFixed(2), amount };
    });
    return { items, total: items.reduce((s, x) => s + cents(x.amount), 0) };
  }

  private async fields(body: any, departmentId: string) {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A JSON object is required');
    const { items, total } = this.breakdown(body.expenseBreakdown);
    // The amount requested is the sum of the breakdown, so the two can never disagree.
    if (
      body.amount !== undefined &&
      body.amount !== null &&
      body.amount !== '' &&
      cents(validateAmount('amount', body.amount)) !== total
    ) {
      throw new BadRequestException(
        'The requested amount must equal the total of the expense breakdown.',
      );
    }
    let activityId: string | null = null;
    if (body.activityId) {
      if (!isUuid(body.activityId)) throw new BadRequestException('activityId is invalid');
      const act = await this.prisma.activity.findUnique({
        where: { id: body.activityId },
        select: { department_id: true, status: true },
      });
      if (!act || act.department_id !== departmentId)
        throw new BadRequestException('That activity does not belong to this department.');
      if (['REJECTED', 'CANCELLED'].includes(act.status))
        throw new BadRequestException(
          'Money cannot be requested for a rejected or cancelled activity.',
        );
      activityId = body.activityId;
    }
    return {
      title: validateText('title', body.title, 200, true) as string,
      description: validateText('description', body.description, 3000),
      justification: validateText('justification', body.justification, 3000, true) as string,
      purpose:
        validateText('justification', body.justification, 300, false)?.slice(0, 300) ||
        'Department request',
      amount: (total / 100).toFixed(2),
      expense_breakdown: items as any,
      attachments: validateAttachments('attachments', body.attachments) as any,
      activity_id: activityId,
    };
  }

  async shape(r: any, withHistory = false) {
    const approval = r.approval_workflow_id
      ? await this.prisma.approval.findUnique({
          where: { id: r.approval_workflow_id },
          include: { steps: { orderBy: { stage_order: 'asc' } } },
        })
      : null;
    const current = approval?.steps.find((s) => s.stage_order === approval.current_stage);
    const inReview = ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(
      r.approval_status,
    );
    return {
      id: r.id,
      departmentId: r.department_id,
      title: r.title,
      description: r.description,
      justification: r.justification,
      activityId: r.activity_id,
      amount: r.amount?.toString(),
      expenseBreakdown: r.expense_breakdown ?? [],
      attachments: r.attachments ?? [],
      status: r.approval_status,
      statusLabel:
        inReview && current
          ? `Pending ${STAGE_LABEL[current.approver_role] ?? current.approver_role} approval`
          : (FINANCE_STATUS_LABEL[r.approval_status] ?? r.approval_status),
      currentStage: inReview && current ? current.approver_role : null,
      stages:
        approval?.steps.map((s) => ({
          role: s.approver_role,
          status: s.status,
          comment: s.comment,
          actedAt: s.acted_at,
        })) ?? [],
      submittedAt: r.submitted_at ?? r.created_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      released: r.release
        ? {
            amount: r.release.amount?.toString(),
            releasedAt: r.release.released_at,
            method: r.release.method,
          }
        : null,
      ...(withHistory && approval
        ? { history: await this.activities.historyWithNames(approval.id) }
        : {}),
    };
  }

  private async load(user: any, departmentId: string, id: string) {
    const ctx = await this.access.assertLeader(user, departmentId);
    if (!isUuid(id)) throw new NotFoundException('Request not found');
    const request = await this.prisma.moneyRequest.findUnique({
      where: { id },
      include: { release: true },
    });
    if (!request || request.department_id !== departmentId)
      throw new NotFoundException('Request not found');
    return { ...ctx, request };
  }

  async list(user: any, departmentId: string, q: any) {
    await this.access.assertLeader(user, departmentId);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where: Prisma.MoneyRequestWhereInput = { department_id: departmentId };
    if (q?.status) where.approval_status = { in: String(q.status).split(',') as ApprovalStatus[] };
    const range = dateRange(q?.from, q?.to);
    if (range) where.created_at = range;
    const [rows, total] = await Promise.all([
      this.prisma.moneyRequest.findMany({
        where,
        include: { release: true },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.moneyRequest.count({ where }),
    ]);
    return { data: await Promise.all(rows.map((r) => this.shape(r))), total, page, limit };
  }

  async get(user: any, departmentId: string, id: string) {
    const { request } = await this.load(user, departmentId, id);
    return this.shape(request, true);
  }

  async create(user: any, departmentId: string, body: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const data = await this.fields(body, departmentId);
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.moneyRequest.create({
        data: {
          ...data,
          department_id: departmentId,
          fellowship_id: department.fellowship_id,
          requester_id: user.userId,
          approval_status: 'SUBMITTED',
          submitted_at: new Date(),
        },
      });
      const wf = await this.engine.createWorkflow(
        'money_request',
        created.id,
        'money_request',
        user.userId,
        { departmentId },
        department.fellowship_id,
        tx,
      );
      await this.engine.submit(wf.id, tx, user.userId);
      return tx.moneyRequest.update({
        where: { id: created.id },
        data: { approval_workflow_id: wf.id },
        include: { release: true },
      });
    });
    await this.audit.log({
      userId: user.userId,
      action: 'finance.money_request_create',
      entityType: 'money_request',
      entityId: request.id,
      newValue: { amount: data.amount, title: data.title, departmentId },
      approvalInfo: { workflowId: request.approval_workflow_id },
    });
    await this.notifyStage(request, department, user.userId, 'submitted');
    return this.shape(request, true);
  }

  /** A returned request: edit its details and send it back to the Treasurer. */
  async resubmit(user: any, departmentId: string, id: string, body: any) {
    const { request, department } = await this.load(user, departmentId, id);
    if (request.approval_status !== 'RETURNED' || !request.approval_workflow_id) {
      throw new BadRequestException(
        'Only a request returned for revision can be changed and resubmitted.',
      );
    }
    const data = body && Object.keys(body).length ? await this.fields(body, departmentId) : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (data) await tx.moneyRequest.update({ where: { id }, data });
      await this.engine.resubmit(request.approval_workflow_id!, user.userId, user.roles, {
        anyRequester: true,
        db: tx,
      });
      return tx.moneyRequest.update({
        where: { id },
        data: { submitted_at: new Date() },
        include: { release: true },
      });
    });
    await this.audit.log({
      userId: user.userId,
      action: 'finance.money_request_resubmit',
      entityType: 'money_request',
      entityId: id,
      oldValue: data ? { amount: request.amount.toString(), title: request.title } : undefined,
      newValue: data ? { amount: data.amount, title: data.title } : undefined,
    });
    await this.notifyStage(updated, department, user.userId, 'resubmitted');
    return this.shape(updated, true);
  }

  /** Tells whoever must act next (the Treasurer, Secretary or Chairperson) and the department's leaders. */
  async notifyStage(request: any, department: any, actorUserId: string, what: string) {
    const approval = await this.prisma.approval.findUnique({
      where: { id: request.approval_workflow_id },
      include: { steps: true },
    });
    const step = approval?.steps.find((s) => s.stage_order === approval.current_stage);
    if (step && ['SUBMITTED', 'RESUBMITTED', 'APPROVED'].includes(approval!.status)) {
      const roles =
        step.approver_role === 'secretary'
          ? ['secretary', 'assistant_secretary']
          : step.approver_role === 'chairperson'
            ? ['chairperson', 'assistant_chairperson']
            : [step.approver_role];
      await this.notifier.notify(
        await this.access.usersWithRoles(department.fellowship_id, roles),
        {
          eventType: 'department_finance_pending',
          title: 'Financial request awaiting your approval',
          message: `${department.name} requests ${request.amount.toString()} for "${request.title}".`,
          entityType: 'money_request',
          entityId: request.id,
          fellowshipId: department.fellowship_id,
        },
        actorUserId,
      );
    }
    await this.notifier.notify(
      await this.access.currentLeaderUserIds(department.id),
      {
        eventType: `department_finance_${what}`,
        title: `Financial request ${what}`,
        message: `"${request.title}" was ${what}.`,
        entityType: 'money_request',
        entityId: request.id,
        fellowshipId: department.fellowship_id,
      },
      actorUserId,
    );
  }

  async exportCsv(user: any, departmentId: string, q: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const where: Prisma.MoneyRequestWhereInput = { department_id: departmentId };
    const range = dateRange(q?.from, q?.to);
    if (range) where.created_at = range;
    if (q?.status) where.approval_status = { in: String(q.status).split(',') as ApprovalStatus[] };
    const rows = await this.prisma.moneyRequest.findMany({
      where,
      include: { release: true },
      orderBy: { created_at: 'asc' },
      take: 5000,
    });
    return {
      filename: `${department.name}-financial-requests.csv`,
      csv: toCsv(
        [
          'Title',
          'Amount',
          'Status',
          'Submitted',
          'Justification',
          'Released amount',
          'Released on',
        ],
        rows.map((r) => [
          r.title,
          r.amount.toString(),
          FINANCE_STATUS_LABEL[r.approval_status] ?? r.approval_status,
          (r.submitted_at ?? r.created_at).toISOString().slice(0, 10),
          r.justification,
          r.release?.amount?.toString() ?? '',
          r.release?.released_at?.toISOString().slice(0, 10) ?? '',
        ]),
      ),
    };
  }
}
