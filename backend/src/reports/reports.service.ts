import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Report } from '../shared/schemas/activities-reports.schema';
import { Approval, ApprovalStep } from '../shared/schemas/system.schema';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { Department } from '../shared/schemas/members-departments.schema';

export interface SubmitReportDto {
  departmentId: string;
  title: string;
  content: string;
  attachments?: string[];
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private reportModel: Model<Report>,
    @InjectModel(Approval.name) private approvalModel: Model<Approval>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  async findAll(currentUser: any): Promise<Report[]> {
    const roles: string[] = currentUser.roles || [];
    const query: any = {};

    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      query.department_id = new Types.ObjectId(currentUser.departmentId);
    } else if (roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary')) {
      // Can see all reports
    } else if (roles.includes('chairperson') || roles.includes('assistant_chairperson')) {
      // Can see all reports for review
    } else {
      query.submitted_by = new Types.ObjectId(currentUser.userId);
    }

    return this.reportModel.find(query).sort({ submitted_at: -1 }).exec();
  }

  async findOne(id: string, currentUser: any): Promise<Report> {
    const report = await this.reportModel.findById(id).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    const roles: string[] = currentUser.roles || [];
    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      if (report.department_id.toString() !== currentUser.departmentId) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    return report;
  }

  async submit(dto: SubmitReportDto, currentUser: any): Promise<Report> {
    const roles: string[] = currentUser.roles || [];
    const isDeptLeader = roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isDeptLeader) {
      throw new ForbiddenException('Only department leaders can submit reports.');
    }

    const department = await this.departmentModel.findById(dto.departmentId).exec();
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    const isLeader = department.leaders.some(
      (l) => l.user_id.toString() === currentUser.userId
    );
    if (!isLeader) {
      throw new ForbiddenException('You can only submit reports for your own department.');
    }

    const report = await this.reportModel.create({
      department_id: new Types.ObjectId(dto.departmentId),
      title: dto.title,
      content: dto.content,
      attachments: dto.attachments || [],
      submitted_by: new Types.ObjectId(currentUser.userId),
      submitted_at: new Date(),
      status: 'SUBMITTED',
    });

    // Create approval workflow
    const approval = await this.approvalEngine.createWorkflow(
      'report',
      report._id.toString(),
      'report',
      currentUser.userId,
    );
    report.approval_workflow_id = approval._id;
    await report.save();
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'report.submit',
      entityType: 'report',
      entityId: report._id.toString(),
      newValue: { title: dto.title, departmentId: dto.departmentId },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    // Notify Secretary/Assistant Secretary for review
    const secretaryUser = await this.findUsersWithRole(['secretary', 'assistant_secretary']);
    for (const userId of secretaryUser) {
      await this.notificationEngine.create({
        recipientUserId: userId,
        eventType: 'report_submitted',
        title: 'Report Submitted',
        message: `A report has been submitted for review.`,
        entityType: 'report',
        entityId: report._id.toString(),
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

    const report = await this.reportModel.findById(id).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (!report.approval_workflow_id) {
      throw new BadRequestException('No approval workflow for this report.');
    }

    await this.approvalEngine.decide(report.approval_workflow_id.toString(), {
      approverUserId: currentUser.userId,
      approverRole: isSecretary ? 'secretary' : 'chairperson',
      decision,
      comment,
    });

    const updatedReport = await this.reportModel.findById(id).exec();

    await this.auditService.log({
      userId: currentUser.userId,
      action: isSecretary ? 'report.review_approve' : 'report.final_approve',
      entityType: 'report',
      entityId: id,
      approvalInfo: { decision, comment, stage: report.approval_workflow_id.toString() },
    });

    await this.notificationEngine.create({
      recipientUserId: report.submitted_by.toString(),
      eventType: 'report_approved',
      title: `Report ${decision === 'approved' ? 'Approved' : 'Rejected'}`,
      message: `Your report "${report.title}" was ${decision === 'approved' ? 'approved' : 'rejected'}: ${comment || ''}`,
      entityType: 'report',
      entityId: id,
    });

    return updatedReport;
  }

  async resubmit(id: string, currentUser: any) {
    const report = await this.reportModel.findById(id).exec();
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (report.submitted_by.toString() !== currentUser.userId) {
      throw new ForbiddenException('Only the original submitter can resubmit.');
    }

    if (report.status !== 'REJECTED') {
      throw new BadRequestException('Report is not in rejected state.');
    }

    report.status = 'RESUBMITTED';
    await report.save();

    if (report.approval_workflow_id) {
      await this.approvalEngine.resubmit(
        report.approval_workflow_id.toString(),
        currentUser.userId,
        currentUser.roles || [],
      );
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'report.resubmit',
      entityType: 'report',
      entityId: id,
    });

    return report;
  }

  private async findUsersWithRole(roles: string[]): Promise<string[]> {
    // Simplified: find users with at least one of the given roles
    // In practice, could query the User collection
    return [];
  }
}
