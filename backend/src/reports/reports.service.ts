import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { listWindow, pageResult } from '../shared/utils/paging.util';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';

export interface SubmitReportDto {
  departmentId: string;
  title: string;
  content: string;
  attachments?: string[];
  fellowshipId?: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
  ) {}

  async findAll(currentUser: any, fellowshipId?: string, page?: unknown, limit?: unknown): Promise<{ data: any[]; total: number }> {
    const roles: string[] = currentUser.roles || [];
    const where: Prisma.ReportWhereInput = {};

    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      if (!currentUser.departmentId) where.id = { in: [] };
      else where.department_id = currentUser.departmentId;
    } else if (roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary')) {
      // Can see all reports
    } else if (roles.includes('chairperson') || roles.includes('assistant_chairperson')) {
      // Can see all reports for review
    } else {
      where.submitted_by = currentUser.userId;
    }

    const scopedWhere = this.tenantScope.scopeWhere(currentUser, where, fellowshipId) as Prisma.ReportWhereInput;

    const w = listWindow(page, limit);
    const rows = await this.prisma.report.findMany({ where: scopedWhere, orderBy: [{ submitted_at: 'desc' }, { id: 'asc' }], skip: w.skip, take: w.take });
    return pageResult(rows, w, () => this.prisma.report.count({ where: scopedWhere }));
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const roles: string[] = currentUser.roles || [];
    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      if (report.department_id !== currentUser.departmentId) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    this.tenantScope.assertInScope(currentUser, report);

    return report;
  }

  async submit(dto: SubmitReportDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isDeptLeader = roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isDeptLeader) {
      throw new ForbiddenException('Only department leaders can submit reports.');
    }
    if (!dto || typeof dto !== 'object' || Array.isArray(dto) || !isUuid(dto.departmentId)) {
      throw new BadRequestException('A valid departmentId is required.');
    }
    const title = validateText('title', dto.title, 200, true)!;
    const content = validateText('content', dto.content, 20_000, true)!;
    const attachments = dto.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > 20 || attachments.some((id) => !isUuid(id))) {
      throw new BadRequestException('attachments must contain at most 20 valid ids.');
    }
    if (attachments.length) {
      const documents = await this.prisma.documentEntity.findMany({
        where: { id: { in: attachments }, fellowship_id: currentUser.fellowshipId },
        select: { id: true },
      });
      if (documents.length !== new Set(attachments).size) throw new BadRequestException('One or more attachments are unavailable.');
    }

    const department = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
      include: { leaders: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    this.tenantScope.assertInScope(currentUser, department);

    const isLeader = department.leaders.some(
      (l) => l.user_id === currentUser.userId
    );
    if (!isLeader) {
      throw new ForbiddenException('You can only submit reports for your own department.');
    }

    const report = await this.prisma.report.create({
      data: {
        department_id: dto.departmentId,
        title,
        content,
        attachments: Array.from(new Set(attachments)),
        submitted_by: currentUser.userId,
        submitted_at: new Date(),
        status: 'SUBMITTED',
        fellowship_id: department.fellowship_id,
      },
    });

    // Create approval workflow
    const approval = await this.approvalEngine.createWorkflow(
      'report',
      report.id,
      'report',
      currentUser.userId,
      undefined,
      department.fellowship_id,
    );
    await this.prisma.report.update({
      where: { id: report.id },
      data: { approval_workflow_id: approval.id },
    });
    await this.approvalEngine.submit(approval.id);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'report.submit',
      entityType: 'report',
      entityId: report.id,
      newValue: { title, departmentId: dto.departmentId },
      approvalInfo: { workflowId: approval.id },
    });

    // Notify Secretary/Assistant Secretary for review
    const secretaryUser = await this.findUsersWithRole(['secretary', 'assistant_secretary'], department.fellowship_id);
    for (const userId of secretaryUser) {
      await this.notificationEngine.create({
        recipientUserId: userId,
        eventType: 'report_submitted',
        title: 'Report Submitted',
        message: `A report has been submitted for review.`,
        entityType: 'report',
        entityId: report.id,
      });
    }

    return report;
  }

  async review(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any) {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    const isChair = roles.includes('chairperson') || roles.includes('assistant_chairperson');

    if (!isSecretary && !isChair) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    this.tenantScope.assertInScope(currentUser, report);

    if (!report.approval_workflow_id) {
      throw new BadRequestException('No approval workflow for this report.');
    }

    const workflow = await this.approvalEngine.getWorkflowForUser(
      report.approval_workflow_id,
      currentUser.userId,
      currentUser.roles || [],
    );
    const stage = workflow.steps.find((step: any) => step.stage_order === workflow.current_stage);
    if (!stage) throw new BadRequestException('The approval workflow has no active stage.');
    const decided = await this.approvalEngine.decide(report.approval_workflow_id, {
      approverUserId: currentUser.userId,
      approverRole: stage.approver_role,
      decision,
      comment,
    });

    const updatedReport = await this.prisma.report.findUnique({ where: { id } });

    await this.auditService.log({
      userId: currentUser.userId,
      action: stage.approver_role === 'secretary' ? 'report.review_approve' : 'report.final_approve',
      entityType: 'report',
      entityId: id,
      approvalInfo: { decision, comment, stage: report.approval_workflow_id },
    });

    await this.notificationEngine.create({
      recipientUserId: report.submitted_by,
      eventType: decided.status === 'REJECTED' ? 'report_rejected' : 'report_approved',
      title: decided.status === 'REJECTED' ? 'Report Rejected' : decided.status === 'FINAL_APPROVED' ? 'Report Approved' : 'Report Review Complete',
      message: `Your report "${report.title}" is now ${decided.status.toLowerCase().replace(/_/g, ' ')}: ${comment || ''}`,
      entityType: 'report',
      entityId: id,
    });

    return updatedReport;
  }

  async resubmit(id: string, currentUser: any) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    this.tenantScope.assertInScope(currentUser, report);

    if (report.submitted_by !== currentUser.userId) {
      throw new ForbiddenException('Only the original submitter can resubmit.');
    }

    if (report.status !== 'REJECTED') {
      throw new BadRequestException('Report is not in rejected state.');
    }

    if (!report.approval_workflow_id) throw new BadRequestException('No approval workflow for this report.');
    await this.approvalEngine.resubmit(
      report.approval_workflow_id,
      currentUser.userId,
      currentUser.roles || [],
    );
    const updated = await this.prisma.report.findUnique({ where: { id } });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'report.resubmit',
      entityType: 'report',
      entityId: id,
    });

    return updated;
  }

  private async findUsersWithRole(roles: string[], fellowshipId: string | null): Promise<string[]> {
    if (!fellowshipId) return [];
    const users = await this.prisma.user.findMany({
      where: {
        fellowship_id: fellowshipId,
        roles: { hasSome: roles },
        is_active: true,
        deleted_at: null,
      },
      select: { id: true },
      take: 100,
    });
    return users.map((user) => user.id);
  }
}
