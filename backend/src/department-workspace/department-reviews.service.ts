import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import { DepartmentActivitiesService } from './department-activities.service';
import { DepartmentReportsService } from './department-reports.service';
import { DepartmentFinanceService } from './department-finance.service';
import { parsePaging } from './department.util';

export type ReviewKind = 'activity' | 'report' | 'financial';
const WORKFLOW: Record<ReviewKind, string> = {
  activity: 'department_activity',
  report: 'report',
  financial: 'money_request',
};
const KIND_OF: Record<string, ReviewKind> = {
  department_activity: 'activity',
  report: 'report',
  money_request: 'financial',
};
const PENDING = ['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'UNDER_REVIEW'];
const STAGE_NAME: Record<string, string> = {
  secretary: 'Fellowship Secretary',
  chairperson: 'Fellowship Chairperson',
  treasurer: 'Treasurer',
};

/**
 * Review inboxes for the Fellowship Secretary, Fellowship Chairperson and Treasurer. They see the department
 * items waiting at their own stage (plus the record of items they review), never a general view of departments.
 *
 *   Activities:          Secretary -> Chairperson
 *   Reports:             Secretary -> Chairperson
 *   Financial requests:  Treasurer -> Secretary -> Chairperson
 */
@Injectable()
export class DepartmentReviewsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private engine: ApprovalEngineService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
    private activities: DepartmentActivitiesService,
    private reports: DepartmentReportsService,
    private finance: DepartmentFinanceService,
  ) {}

  /** The approval stages this user may decide. */
  private stagesFor(user: any): string[] {
    const s: string[] = [];
    if (this.access.isFellowshipSecretary(user)) s.push('secretary');
    if (this.access.isFellowshipChair(user)) s.push('chairperson');
    if (this.access.isTreasurer(user)) s.push('treasurer');
    return s;
  }

  /** The kinds of item this user reviews at all (the Treasurer only sees financial requests). */
  private kindsFor(user: any): ReviewKind[] {
    const stages = this.stagesFor(user);
    if (stages.includes('secretary') || stages.includes('chairperson'))
      return ['activity', 'report', 'financial'];
    if (stages.includes('treasurer')) return ['financial'];
    return [];
  }

  private requireReviewer(user: any): string {
    const fellowshipId = this.access.requireFellowship(user);
    if (this.stagesFor(user).length === 0)
      throw new ForbiddenException('You do not review department items.');
    return fellowshipId;
  }

  private async entity(kind: ReviewKind, id: string): Promise<any> {
    if (kind === 'activity') return this.prisma.activity.findUnique({ where: { id } });
    if (kind === 'report') return this.prisma.report.findUnique({ where: { id } });
    return this.prisma.moneyRequest.findUnique({ where: { id }, include: { release: true } });
  }

  async summary(user: any) {
    this.requireReviewer(user);
    const pending = await this.pending(user);
    const count = (k: ReviewKind) => pending.filter((p) => p.kind === k).length;
    return {
      stages: this.stagesFor(user),
      kinds: this.kindsFor(user),
      pending: {
        activity: count('activity'),
        report: count('report'),
        financial: count('financial'),
        total: pending.length,
      },
    };
  }

  /** Items waiting at one of this user's stages. */
  async pending(user: any, kind?: ReviewKind) {
    const fellowshipId = this.requireReviewer(user);
    const stages = this.stagesFor(user);
    const kinds = (kind ? [kind] : this.kindsFor(user)).filter((k) =>
      this.kindsFor(user).includes(k),
    );
    const approvals = await this.prisma.approval.findMany({
      where: {
        fellowship_id: fellowshipId,
        workflow_type: { in: kinds.map((k) => WORKFLOW[k]) },
        status: { in: PENDING as any },
      },
      include: { steps: true },
      orderBy: { updated_at: 'asc' },
      take: 500,
    });
    const mine = approvals.filter((a) => {
      const step = a.steps.find((s) => s.stage_order === a.current_stage);
      return (
        step &&
        step.status === 'pending' &&
        stages.includes(step.approver_role) &&
        a.created_by !== user.userId
      );
    });
    return (await Promise.all(mine.map((a) => this.item(KIND_OF[a.workflow_type], a)))).filter(
      Boolean,
    ) as any[];
  }

  /** Everything submitted for review that this user's role covers, newest first (the review record). */
  async all(user: any, kind: ReviewKind, q: any) {
    const fellowshipId = this.requireReviewer(user);
    if (!this.kindsFor(user).includes(kind))
      throw new ForbiddenException('You do not review this kind of item.');
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where: Prisma.ApprovalWhereInput = {
      fellowship_id: fellowshipId,
      workflow_type: WORKFLOW[kind],
      status: { not: 'DRAFT' },
    };
    if (q?.status) where.status = { in: String(q.status).split(',') as any };
    const [rows, total] = await Promise.all([
      this.prisma.approval.findMany({
        where,
        include: { steps: true },
        orderBy: { updated_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.approval.count({ where }),
    ]);
    const data = (await Promise.all(rows.map((a) => this.item(kind, a)))).filter(Boolean);
    return { data, total, page, limit };
  }

  /** A row for an inbox or list; department requests only (requests the Secretary made herself are left out). */
  private async item(kind: ReviewKind, approval: any) {
    const e = await this.entity(kind, approval.entity_id);
    if (!e || !e.department_id || e.approval_workflow_id !== approval.id) return null;
    const dept = await this.prisma.department.findUnique({
      where: { id: e.department_id },
      select: { name: true },
    });
    const step = approval.steps.find((s: any) => s.stage_order === approval.current_stage);
    const inReview = PENDING.includes(approval.status);
    return {
      kind,
      id: e.id,
      approvalId: approval.id,
      title: kind === 'report' ? (e.activity_title ?? e.title) : e.title,
      department: dept?.name ?? null,
      departmentId: e.department_id,
      amount: kind === 'financial' ? e.amount?.toString() : undefined,
      date: kind === 'activity' ? e.date : kind === 'report' ? e.activity_date : undefined,
      submittedAt: e.submitted_at ?? e.created_at,
      status: approval.status,
      waitingFor: inReview && step ? (STAGE_NAME[step.approver_role] ?? step.approver_role) : null,
      waitingForStage: inReview && step ? step.approver_role : null,
    };
  }

  async detail(user: any, kind: ReviewKind, id: string) {
    const fellowshipId = this.requireReviewer(user);
    if (!(['activity', 'report', 'financial'] as string[]).includes(kind) || !isUuid(id))
      throw new NotFoundException('Not found');
    if (!this.kindsFor(user).includes(kind))
      throw new ForbiddenException('You do not review this kind of item.');
    const e = await this.entity(kind, id);
    if (!e || e.fellowship_id !== fellowshipId || !e.department_id || !e.approval_workflow_id)
      throw new NotFoundException('Not found');
    const approval = await this.prisma.approval.findUnique({
      where: { id: e.approval_workflow_id },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
    });
    if (!approval || approval.status === 'DRAFT') throw new NotFoundException('Not found');
    const dept = await this.prisma.department.findUnique({
      where: { id: e.department_id },
      select: { id: true, name: true },
    });
    const step = approval.steps.find((s) => s.stage_order === approval.current_stage);
    const canDecide =
      PENDING.includes(approval.status) &&
      !!step &&
      step.status === 'pending' &&
      this.stagesFor(user).includes(step.approver_role) &&
      approval.created_by !== user.userId &&
      !approval.steps.some((s) => s.status === 'approved' && s.acted_by === user.userId);
    let body: any;
    if (kind === 'activity')
      body = {
        ...this.activities.shape(e),
        history: await this.activities.historyWithNames(approval.id),
      };
    else if (kind === 'report') body = await this.reports.detail(e);
    else body = await this.finance.shape(e, true);
    return {
      kind,
      department: dept,
      ...body,
      stages: approval.steps.map((s) => ({
        role: s.approver_role,
        name: STAGE_NAME[s.approver_role] ?? s.approver_role,
        status: s.status,
        comment: s.comment,
        actedAt: s.acted_at,
      })),
      waitingFor:
        PENDING.includes(approval.status) && step
          ? (STAGE_NAME[step.approver_role] ?? step.approver_role)
          : null,
      canDecide,
    };
  }

  async decide(user: any, kind: ReviewKind, id: string, body: any) {
    const fellowshipId = this.requireReviewer(user);
    const decision = body?.decision;
    if (!['approved', 'returned', 'rejected'].includes(decision))
      throw new BadRequestException("decision must be 'approved', 'returned' or 'rejected'");
    const comment = validateText('comment', body?.comment, 2000, decision !== 'approved') ?? '';
    if (!(['activity', 'report', 'financial'] as string[]).includes(kind) || !isUuid(id))
      throw new NotFoundException('Not found');
    if (!this.kindsFor(user).includes(kind))
      throw new ForbiddenException('You do not review this kind of item.');
    const e = await this.entity(kind, id);
    if (!e || e.fellowship_id !== fellowshipId || !e.department_id || !e.approval_workflow_id)
      throw new NotFoundException('Not found');
    const approval = await this.prisma.approval.findUnique({
      where: { id: e.approval_workflow_id },
      include: { steps: true },
    });
    const step = approval?.steps.find((s) => s.stage_order === approval.current_stage);
    if (!approval || !step || !PENDING.includes(approval.status) || step.status !== 'pending')
      throw new BadRequestException('This item is not waiting for a decision.');
    if (!this.stagesFor(user).includes(step.approver_role)) {
      throw new ForbiddenException(
        `This item is waiting for the ${STAGE_NAME[step.approver_role] ?? step.approver_role}.`,
      );
    }

    // The engine enforces the order of stages, separation of duties and race safety.
    const decided = await this.engine.decide(approval.id, {
      approverUserId: user.userId,
      approverRole: step.approver_role,
      decision,
      comment,
    });

    await this.audit.log({
      userId: user.userId,
      action: `department_${kind}.${decision === 'approved' ? (decided.status === 'FINAL_APPROVED' ? 'final_approve' : 'approve') : decision === 'returned' ? 'return' : 'reject'}`,
      entityType: kind === 'financial' ? 'money_request' : kind,
      entityId: id,
      approvalInfo: {
        workflowId: approval.id,
        stage: approval.current_stage,
        role: step.approver_role,
        decision,
        resultingStatus: decided.status,
      },
      comment: comment || undefined,
    });

    await this.notifyAfter(kind, e, decided, decision, comment, user.userId);
    return this.detail(user, kind, id).catch(() => ({ status: decided.status }));
  }

  private async notifyAfter(
    kind: ReviewKind,
    e: any,
    decided: any,
    decision: string,
    comment: string,
    actorId: string,
  ) {
    const dept = await this.prisma.department.findUnique({ where: { id: e.department_id } });
    if (!dept) return;
    const leaders = await this.access.currentLeaderUserIds(dept.id);
    const label =
      kind === 'activity' ? 'Activity' : kind === 'report' ? 'Report' : 'Financial request';
    const title = kind === 'report' ? (e.activity_title ?? e.title) : e.title;
    const base = {
      entityType: kind === 'financial' ? 'money_request' : kind,
      entityId: e.id,
      fellowshipId: dept.fellowship_id,
    };

    if (decided.status === 'FINAL_APPROVED') {
      await this.notifier.notify(
        leaders,
        {
          ...base,
          eventType: `department_${kind}_approved`,
          title: `${label} approved`,
          message: `"${title}" has been ${kind === 'financial' ? 'fully approved' : 'officially approved'}.`,
        },
        actorId,
      );
      if (kind === 'financial') {
        await this.notifier.notify(
          await this.access.usersWithRoles(dept.fellowship_id, ['treasurer']),
          {
            ...base,
            eventType: 'department_finance_release',
            title: 'Approved request ready for release',
            message: `${dept.name}: "${title}" (${e.amount.toString()}) is fully approved and can be released.`,
          },
          actorId,
        );
      }
      return;
    }
    if (decision === 'returned' || decision === 'rejected') {
      const verb = decision === 'returned' ? 'returned for revision' : 'rejected';
      await this.notifier.notify(
        leaders,
        {
          ...base,
          eventType: `department_${kind}_${decision}`,
          title: `${label} ${verb}`,
          message: `"${title}" was ${verb}${comment ? `: ${comment}` : '.'}`,
        },
        actorId,
      );
      return;
    }
    // Moved on to the next stage.
    const next = decided.steps.find((s: any) => s.stage_order === decided.current_stage);
    if (!next) return;
    const roles =
      next.approver_role === 'secretary'
        ? ['secretary', 'assistant_secretary']
        : next.approver_role === 'chairperson'
          ? ['chairperson', 'assistant_chairperson']
          : [next.approver_role];
    await this.notifier.notify(
      await this.access.usersWithRoles(dept.fellowship_id, roles),
      {
        ...base,
        eventType: `department_${kind}_pending`,
        title: `${label} awaiting your approval`,
        message: `${dept.name}: "${title}" is waiting for your review.`,
      },
      actorId,
    );
    await this.notifier.notify(
      leaders,
      {
        ...base,
        eventType: `department_${kind}_stage`,
        title: `${label} moved forward`,
        message: `"${title}" was approved by the ${STAGE_NAME[decided.steps.find((s: any) => s.stage_order === decided.current_stage - 1)?.approver_role] ?? 'reviewer'} and is now with the ${STAGE_NAME[next.approver_role] ?? next.approver_role}.`,
      },
      actorId,
    );
  }
}
