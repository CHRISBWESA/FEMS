import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import {
  dateRange,
  parseOptionalDate,
  parsePaging,
  parseRequiredDate,
  toCsv,
  validateAttachments,
} from './department.util';

const EDITABLE: ActivityStatus[] = ['DRAFT', 'RETURNED'];
const STATUSES: ActivityStatus[] = [
  'DRAFT',
  'PENDING_SECRETARY',
  'RETURNED',
  'PENDING_CHAIRPERSON',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
];

export const ACTIVITY_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_SECRETARY: 'Pending Secretary approval',
  RETURNED: 'Returned for revision',
  PENDING_CHAIRPERSON: 'Pending Chairperson approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/**
 * Activities a department plans for itself. A leader drafts and submits; the Fellowship Secretary and then the
 * Fellowship Chairperson approve (or return / reject). Only then is the activity official and visible to the
 * rest of the fellowship.
 */
@Injectable()
export class DepartmentActivitiesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private engine: ApprovalEngineService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
  ) {}

  private fields(body: any, partial: boolean) {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A JSON object is required');
    const out: Record<string, any> = {};
    if (!partial || body.title !== undefined)
      out.title = validateText('title', body.title, 200, true);
    if (body.description !== undefined)
      out.description = validateText('description', body.description, 5000);
    if (body.objectives !== undefined)
      out.objectives = validateText('objectives', body.objectives, 3000);
    if (body.venue !== undefined) out.venue = validateText('venue', body.venue, 300);
    if (body.supportingInfo !== undefined)
      out.supporting_info = validateText('supportingInfo', body.supportingInfo, 5000);
    if (!partial || body.date !== undefined) out.date = parseRequiredDate('date', body.date);
    if (body.endDate !== undefined) out.end_date = parseOptionalDate('endDate', body.endDate);
    if (body.attachments !== undefined)
      out.attachments = validateAttachments('attachments', body.attachments);
    const start = out.date;
    if (start && out.end_date && out.end_date < start)
      throw new BadRequestException('The end time must be after the start time.');
    return out;
  }

  private async load(user: any, departmentId: string, id: string) {
    const ctx = await this.access.assertLeader(user, departmentId);
    if (!isUuid(id)) throw new NotFoundException('Activity not found');
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity || activity.department_id !== departmentId)
      throw new NotFoundException('Activity not found');
    return { ...ctx, activity };
  }

  async list(user: any, departmentId: string, q: any) {
    await this.access.assertLeader(user, departmentId);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where: Prisma.ActivityWhereInput = { department_id: departmentId };
    if (q?.status) {
      const statuses = String(q.status).split(',');
      if (!statuses.every((s) => (STATUSES as string[]).includes(s)))
        throw new BadRequestException('Unknown status');
      where.status = { in: statuses as ActivityStatus[] };
    }
    const range = dateRange(q?.from, q?.to);
    if (range) where.date = range;
    const search = validateText('search', q?.search, 100);
    if (search) where.title = { contains: search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.activity.count({ where }),
    ]);
    return { data: rows.map((a) => this.shape(a)), total, page, limit };
  }

  shape(a: any) {
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      objectives: a.objectives,
      venue: a.venue,
      supportingInfo: a.supporting_info,
      date: a.date,
      endDate: a.end_date,
      attachments: a.attachments ?? [],
      status: a.status,
      statusLabel: ACTIVITY_STATUS_LABEL[a.status] ?? a.status,
      submittedAt: a.submitted_at,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      departmentId: a.department_id,
      approvalId: a.approval_workflow_id,
    };
  }

  async get(user: any, departmentId: string, id: string) {
    const { activity } = await this.load(user, departmentId, id);
    return {
      ...this.shape(activity),
      history: activity.approval_workflow_id
        ? await this.historyWithNames(activity.approval_workflow_id)
        : [],
    };
  }

  async historyWithNames(approvalId: string) {
    const events = await this.engine.history(approvalId);
    const ids = Array.from(new Set(events.map((e) => e.actor_user_id).filter(Boolean))) as string[];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
    return events.map((e) => {
      const u = users.find((x) => x.id === e.actor_user_id);
      return {
        action: e.action,
        stage: e.stage_order,
        role: e.approver_role,
        comment: e.comment,
        at: e.created_at,
        by: u ? `${u.first_name} ${u.last_name}`.trim() : null,
      };
    });
  }

  async create(user: any, departmentId: string, body: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const data = this.fields(body, false);
    const activity = await this.prisma.activity.create({
      data: {
        ...(data as any),
        audience_type: 'department',
        department_id: departmentId,
        fellowship_id: department.fellowship_id,
        created_by: user.userId,
        status: 'DRAFT',
      },
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_activity.create',
      entityType: 'activity',
      entityId: activity.id,
      newValue: { title: activity.title, departmentId },
    });
    if (body?.submit === true) return this.submit(user, departmentId, activity.id);
    return this.shape(activity);
  }

  async update(user: any, departmentId: string, id: string, body: any) {
    const { activity } = await this.load(user, departmentId, id);
    if (!EDITABLE.includes(activity.status))
      throw new BadRequestException(
        'Only drafts and activities returned for revision can be edited.',
      );
    const data = this.fields(body, true);
    if (
      data.end_date === undefined &&
      data.date &&
      activity.end_date &&
      activity.end_date < data.date
    )
      throw new BadRequestException('The end time must be after the start time.');
    const updated = await this.prisma.activity.update({ where: { id }, data: data as any });
    await this.audit.log({
      userId: user.userId,
      action: 'department_activity.edit',
      entityType: 'activity',
      entityId: id,
      oldValue: { title: activity.title, date: activity.date, venue: activity.venue },
      newValue: { title: updated.title, date: updated.date, venue: updated.venue },
    });
    return this.shape(updated);
  }

  /** First submission of a draft, or resubmission of a returned activity. */
  async submit(user: any, departmentId: string, id: string) {
    const { activity, department } = await this.load(user, departmentId, id);
    if (!EDITABLE.includes(activity.status))
      throw new BadRequestException(
        'Only drafts and activities returned for revision can be submitted.',
      );
    if (!activity.title || !activity.date)
      throw new BadRequestException(
        'An activity needs a title and a date before it can be submitted.',
      );

    await this.prisma.$transaction(async (tx) => {
      if (activity.status === 'RETURNED' && activity.approval_workflow_id) {
        // Either leader may resubmit: they act for the department, not for themselves.
        await this.engine.resubmit(activity.approval_workflow_id, user.userId, user.roles, {
          anyRequester: true,
          db: tx,
        });
      } else {
        const wf = await this.engine.createWorkflow(
          'department_activity',
          activity.id,
          'activity',
          user.userId,
          { departmentId },
          department.fellowship_id,
          tx,
        );
        await tx.activity.update({ where: { id }, data: { approval_workflow_id: wf.id } });
        await this.engine.submit(wf.id, tx, user.userId);
      }
      await tx.activity.update({
        where: { id },
        data: { status: 'PENDING_SECRETARY', submitted_at: new Date() },
      });
    });

    await this.audit.log({
      userId: user.userId,
      action:
        activity.status === 'RETURNED'
          ? 'department_activity.resubmit'
          : 'department_activity.submit',
      entityType: 'activity',
      entityId: id,
    });
    await this.notifier.notify(
      await this.access.usersWithRoles(department.fellowship_id, [
        'secretary',
        'assistant_secretary',
      ]),
      {
        eventType: 'department_activity_submitted',
        title: 'Activity awaiting your approval',
        message: `${department.name} submitted "${activity.title}" for approval.`,
        entityType: 'activity',
        entityId: id,
        fellowshipId: department.fellowship_id,
      },
      user.userId,
    );
    await this.notifier.notify(
      await this.access.currentLeaderUserIds(departmentId),
      {
        eventType: 'department_activity_submitted',
        title: 'Activity submitted',
        message: `"${activity.title}" was submitted for approval.`,
        entityType: 'activity',
        entityId: id,
        fellowshipId: department.fellowship_id,
      },
      user.userId,
    );
    return this.get(user, departmentId, id);
  }

  /** Withdraws a draft or a pending activity, or cancels an approved one that has not happened yet. */
  async cancel(user: any, departmentId: string, id: string, body: any) {
    const { activity } = await this.load(user, departmentId, id);
    const reason = validateText('reason', body?.reason, 300);
    if (['CANCELLED', 'REJECTED', 'COMPLETED'].includes(activity.status))
      throw new BadRequestException('This activity can no longer be cancelled.');
    await this.prisma.$transaction(async (tx) => {
      if (
        activity.approval_workflow_id &&
        ['PENDING_SECRETARY', 'PENDING_CHAIRPERSON', 'RETURNED'].includes(activity.status)
      ) {
        await this.engine.cancel(activity.approval_workflow_id, user.userId, tx);
      }
      await tx.activity.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_activity.cancel',
      entityType: 'activity',
      entityId: id,
      comment: reason || undefined,
    });
    return this.get(user, departmentId, id);
  }

  /** An approved activity that has taken place. */
  async complete(user: any, departmentId: string, id: string) {
    const { activity } = await this.load(user, departmentId, id);
    if (activity.status !== 'APPROVED')
      throw new BadRequestException('Only an approved activity can be marked completed.');
    if (activity.date > new Date())
      throw new BadRequestException('An activity cannot be completed before it has started.');
    const updated = await this.prisma.activity.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_activity.complete',
      entityType: 'activity',
      entityId: id,
    });
    return this.shape(updated);
  }

  async exportCsv(user: any, departmentId: string, q: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const where: Prisma.ActivityWhereInput = { department_id: departmentId };
    const range = dateRange(q?.from, q?.to);
    if (range) where.date = range;
    if (q?.status)
      where.status = {
        in: String(q.status)
          .split(',')
          .filter((s) => (STATUSES as string[]).includes(s)) as ActivityStatus[],
      };
    const rows = await this.prisma.activity.findMany({
      where,
      orderBy: { date: 'asc' },
      take: 5000,
    });
    return {
      filename: `${department.name}-activities.csv`,
      csv: toCsv(
        ['Title', 'Date', 'End', 'Venue', 'Status', 'Submitted', 'Objectives', 'Description'],
        rows.map((a) => [
          a.title,
          a.date.toISOString(),
          a.end_date?.toISOString() ?? '',
          a.venue,
          ACTIVITY_STATUS_LABEL[a.status],
          a.submitted_at?.toISOString().slice(0, 10) ?? '',
          a.objectives,
          a.description,
        ]),
      ),
    };
  }
}
