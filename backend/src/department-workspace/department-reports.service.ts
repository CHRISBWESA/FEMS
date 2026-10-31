import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import { DepartmentActivitiesService } from './department-activities.service';
import {
  dateRange,
  parseOptionalDate,
  parsePaging,
  toCsv,
  validateAttachments,
} from './department.util';

const EDITABLE: ApprovalStatus[] = ['DRAFT', 'RETURNED'];

export const REPORT_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending Secretary review',
  RESUBMITTED: 'Pending Secretary review',
  UNDER_REVIEW: 'Pending Chairperson review',
  APPROVED: 'Pending Chairperson review',
  FINAL_APPROVED: 'Approved',
  RETURNED: 'Returned for revision',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * Reports a department writes after an activity. They are reviewed by the Fellowship Secretary and then the
 * Fellowship Chairperson (the existing "report" approval workflow). Every submission is kept as a numbered
 * version, so a revision never overwrites what was reviewed before.
 */
@Injectable()
export class DepartmentReportsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private engine: ApprovalEngineService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
    private activities: DepartmentActivitiesService,
  ) {}

  private async fields(body: any, departmentId: string, partial: boolean) {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A JSON object is required');
    const out: Record<string, any> = {};
    const text = (key: string, col: string, max: number, required = false) => {
      if (!partial || body[key] !== undefined)
        out[col] = validateText(key, body[key], max, required && !partial);
    };
    if (body.activityId !== undefined && body.activityId !== null && body.activityId !== '') {
      if (!isUuid(body.activityId)) throw new BadRequestException('activityId is invalid');
      const act = await this.prisma.activity.findUnique({ where: { id: body.activityId } });
      if (!act || act.department_id !== departmentId)
        throw new BadRequestException('That activity does not belong to this department.');
      if (!['APPROVED', 'COMPLETED'].includes(act.status))
        throw new BadRequestException('Reports can only be written for approved activities.');
      out.activity_id = act.id;
      if (body.activityTitle === undefined) out.activity_title = act.title;
      if (body.activityDate === undefined) out.activity_date = act.date;
    } else if (body.activityId === null || body.activityId === '') {
      out.activity_id = null;
    }
    // Taken from the linked activity unless the leader typed one.
    if (body.activityTitle !== undefined || out.activity_title === undefined)
      text('activityTitle', 'activity_title', 200, true);
    if (!partial || body.activityDate !== undefined) {
      const d = parseOptionalDate('activityDate', body.activityDate ?? out.activity_date);
      if (!d && !partial) throw new BadRequestException('activityDate is required');
      out.activity_date = d;
    }
    text('description', 'content', 20000, true);
    text('objectives', 'objectives', 5000);
    text('achievements', 'achievements', 5000);
    text('outcomes', 'outcomes', 5000);
    text('challenges', 'challenges', 5000);
    text('recommendations', 'recommendations', 5000);
    if (body.participants !== undefined) {
      if (body.participants === null || body.participants === '') out.participants = null;
      else {
        const n = Number(body.participants);
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000)
          throw new BadRequestException('participants must be a whole number');
        out.participants = n;
      }
    }
    if (body.photos !== undefined) out.photos = validateAttachments('photos', body.photos);
    if (body.documents !== undefined)
      out.documents = validateAttachments('documents', body.documents);
    if (out.activity_title !== undefined) out.title = out.activity_title;
    return out;
  }

  shape(r: any) {
    return {
      id: r.id,
      departmentId: r.department_id,
      activityId: r.activity_id,
      activityTitle: r.activity_title ?? r.title,
      activityDate: r.activity_date,
      description: r.content,
      objectives: r.objectives,
      participants: r.participants,
      achievements: r.achievements,
      outcomes: r.outcomes,
      challenges: r.challenges,
      recommendations: r.recommendations,
      photos: r.photos ?? [],
      documents: r.documents ?? [],
      status: r.status,
      statusLabel: REPORT_STATUS_LABEL[r.status] ?? r.status,
      version: r.version,
      submittedAt: r.submitted_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      approvalId: r.approval_workflow_id,
    };
  }

  private async load(user: any, departmentId: string, id: string) {
    const ctx = await this.access.assertLeader(user, departmentId);
    if (!isUuid(id)) throw new NotFoundException('Report not found');
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report || report.department_id !== departmentId)
      throw new NotFoundException('Report not found');
    return { ...ctx, report };
  }

  async list(user: any, departmentId: string, q: any) {
    await this.access.assertLeader(user, departmentId);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where: Prisma.ReportWhereInput = { department_id: departmentId };
    if (q?.status) where.status = { in: String(q.status).split(',') as ApprovalStatus[] };
    const range = dateRange(q?.from, q?.to);
    if (range) where.created_at = range;
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({ where, orderBy: { created_at: 'desc' }, skip, take }),
      this.prisma.report.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total, page, limit };
  }

  async get(user: any, departmentId: string, id: string) {
    const { report } = await this.load(user, departmentId, id);
    return this.detail(report);
  }

  async detail(report: any) {
    const submissions = await this.prisma.reportSubmission.findMany({
      where: { report_id: report.id },
      orderBy: { version: 'desc' },
    });
    return {
      ...this.shape(report),
      submissions: submissions.map((s) => ({
        version: s.version,
        submittedAt: s.submitted_at,
        data: s.data,
      })),
      history: report.approval_workflow_id
        ? await this.activities.historyWithNames(report.approval_workflow_id)
        : [],
    };
  }

  async create(user: any, departmentId: string, body: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const data = await this.fields(body, departmentId, false);
    const report = await this.prisma.report.create({
      data: {
        ...(data as any),
        department_id: departmentId,
        fellowship_id: department.fellowship_id,
        submitted_by: user.userId,
        status: 'DRAFT',
      },
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_report.create',
      entityType: 'report',
      entityId: report.id,
      newValue: { title: report.title, departmentId },
    });
    if (body?.submit === true) return this.submit(user, departmentId, report.id);
    return this.shape(report);
  }

  async update(user: any, departmentId: string, id: string, body: any) {
    const { report } = await this.load(user, departmentId, id);
    if (!EDITABLE.includes(report.status))
      throw new BadRequestException('Only drafts and reports returned for revision can be edited.');
    const data = await this.fields(body, departmentId, true);
    const updated = await this.prisma.report.update({ where: { id }, data: data as any });
    await this.audit.log({
      userId: user.userId,
      action: 'department_report.edit',
      entityType: 'report',
      entityId: id,
    });
    return this.shape(updated);
  }

  async submit(user: any, departmentId: string, id: string) {
    const { report, department } = await this.load(user, departmentId, id);
    if (!EDITABLE.includes(report.status))
      throw new BadRequestException(
        'Only drafts and reports returned for revision can be submitted.',
      );
    if (!report.activity_title || !report.content || !report.activity_date) {
      throw new BadRequestException(
        'Add the activity title, date and description before submitting.',
      );
    }
    const resubmitting = report.status === 'RETURNED' && !!report.approval_workflow_id;
    const version = resubmitting ? report.version + 1 : 1;
    await this.prisma.$transaction(async (tx) => {
      if (resubmitting) {
        await this.engine.resubmit(report.approval_workflow_id!, user.userId, user.roles, {
          anyRequester: true,
          db: tx,
        });
      } else {
        const wf = await this.engine.createWorkflow(
          'report',
          report.id,
          'report',
          user.userId,
          { departmentId },
          department.fellowship_id,
          tx,
        );
        await tx.report.update({ where: { id }, data: { approval_workflow_id: wf.id } });
        await this.engine.submit(wf.id, tx, user.userId);
      }
      const now = new Date();
      await tx.report.update({
        where: { id },
        data: { status: resubmitting ? 'RESUBMITTED' : 'SUBMITTED', submitted_at: now, version },
      });
      await tx.reportSubmission.create({
        data: {
          report_id: id,
          fellowship_id: department.fellowship_id,
          version,
          submitted_by: user.userId,
          submitted_at: now,
          data: this.shape({ ...report, version, submitted_at: now }) as any,
        },
      });
    });
    await this.audit.log({
      userId: user.userId,
      action: resubmitting ? 'department_report.resubmit' : 'department_report.submit',
      entityType: 'report',
      entityId: id,
      newValue: { version },
    });
    await this.notifier.notify(
      await this.access.usersWithRoles(department.fellowship_id, [
        'secretary',
        'assistant_secretary',
      ]),
      {
        eventType: 'department_report_submitted',
        title: 'Report awaiting your review',
        message: `${department.name} submitted a report on "${report.activity_title}".`,
        entityType: 'report',
        entityId: id,
        fellowshipId: department.fellowship_id,
      },
      user.userId,
    );
    await this.notifier.notify(
      await this.access.currentLeaderUserIds(departmentId),
      {
        eventType: 'department_report_submitted',
        title: 'Report submitted',
        message: `The report on "${report.activity_title}" was submitted for review.`,
        entityType: 'report',
        entityId: id,
        fellowshipId: department.fellowship_id,
      },
      user.userId,
    );
    return this.get(user, departmentId, id);
  }

  async exportCsv(user: any, departmentId: string, q: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const where: Prisma.ReportWhereInput = { department_id: departmentId };
    if (q?.status) where.status = { in: String(q.status).split(',') as ApprovalStatus[] };
    const range = dateRange(q?.from, q?.to);
    if (range) where.created_at = range;
    const rows = await this.prisma.report.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: 5000,
    });
    return {
      filename: `${department.name}-reports.csv`,
      csv: toCsv(
        [
          'Activity',
          'Activity date',
          'Status',
          'Version',
          'Submitted',
          'Participants',
          'Description',
          'Objectives',
          'Achievements',
          'Outcomes',
          'Challenges',
          'Recommendations',
        ],
        rows.map((r) => [
          r.activity_title ?? r.title,
          r.activity_date?.toISOString().slice(0, 10) ?? '',
          REPORT_STATUS_LABEL[r.status],
          r.version,
          r.submitted_at?.toISOString().slice(0, 10) ?? '',
          r.participants,
          r.content,
          r.objectives,
          r.achievements,
          r.outcomes,
          r.challenges,
          r.recommendations,
        ]),
      ),
    };
  }
}
