import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DocumentEntity, Comment } from '../shared/schemas/it-content.schema';
import { Announcement } from '../shared/schemas/activities-reports.schema';
import { Department } from '../shared/schemas/members-departments.schema';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';

export interface UploadDocumentDto {
  title: string;
  departmentId?: string;
  isWebsiteContent?: boolean;
}

export interface CreateAnnouncementDto {
  title: string;
  content: string;
  audienceType: 'all_members' | 'department' | 'leaders' | 'specific_group';
  departmentId?: string;
}

@Injectable()
export class ItContentService {
  private readonly logger = new Logger(ItContentService.name);

  constructor(
    @InjectModel(DocumentEntity.name) private documentModel: Model<DocumentEntity>,
    @InjectModel(Announcement.name) private announcementModel: Model<Announcement>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  // === Documents ===
  async findDocuments(currentUser: any): Promise<DocumentEntity[]> {
    const roles: string[] = currentUser.roles || [];
    const query: any = {};

    if (roles.some((r) => ['department_secretary', 'department_chairperson'].includes(r))) {
      query.department_id = new Types.ObjectId(currentUser.departmentId);
    }

    if (roles.some((r) => ['secretary', 'admin', 'assistant_secretary', 'chairperson', 'assistant_chairperson'].includes(r)) ||
        roles.includes('treasurer')) {
      // Can see all
    } else if (!roles.includes('admin')) {
      query.approval_status = 'FINAL_APPROVED';
    }

    return this.documentModel.find(query).sort({ uploaded_at: -1 }).exec();
  }

  async uploadDocument(dto: UploadDocumentDto, file: Express.Multer.File, currentUser: any): Promise<DocumentEntity> {
    const roles: string[] = currentUser.roles || [];
    const isITMember = roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isITMember && !roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    // Validate file (type and size)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'application/msword', 'text/plain'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('File type not allowed');
    }

    const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE || '10485760');
    if (file.size > maxSize) {
      throw new BadRequestException('File too large');
    }

    // Generate safe filename
    const storedFilename = `${Date.now()}_${require('crypto').randomBytes(8).toString('hex')}_${file.originalname}`;

    const doc = await this.documentModel.create({
      title: dto.title,
      filename: file.originalname,
      stored_filename: storedFilename,
      file_size: file.size,
      mime_type: file.mimetype,
      department_id: dto.departmentId ? new Types.ObjectId(dto.departmentId) : undefined,
      uploaded_by: new Types.ObjectId(currentUser.userId),
      uploaded_at: new Date(),
      is_website_content: dto.isWebsiteContent || false,
      approval_status: 'DRAFT',
    });

    // Create approval workflow for IT content
    const approval = await this.approvalEngine.createWorkflow(
      'it_content',
      doc._id.toString(),
      'document',
      currentUser.userId,
    );
    doc.approval_workflow_id = approval._id;
    await doc.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.document_upload',
      entityType: 'document',
      entityId: doc._id.toString(),
      newValue: { title: dto.title, isWebsite: dto.isWebsiteContent },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return doc;
  }

  async submitForApproval(id: string, currentUser: any): Promise<{ message: string }> {
    const doc = await this.documentModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Document not found');

    doc.approval_status = 'SUBMITTED';
    await doc.save();

    if (doc.approval_workflow_id) {
      await this.approvalEngine.submit(doc.approval_workflow_id.toString());
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.submit',
      entityType: 'document',
      entityId: id,
    });

    // Notify IT Department Secretary
    await this.notificationEngine.create({
      recipientUserId: currentUser.userId,
      eventType: 'approval_request',
      title: 'Document Approval Requested',
      message: `Document "${doc.title}" has been submitted for approval.`,
       entityType: 'document',
       entityId: id,
    });

    return { message: 'Document submitted for approval' };
  }

  async approveDocument(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<DocumentEntity> {
    const roles: string[] = currentUser.roles || [];
    const isITSecretary = roles.includes('department_secretary') && roles.includes('admin');
    const isChair = roles.includes('chairperson') || roles.includes('assistant_chairperson');

    const doc = await this.documentModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Document not found');
    if (!doc.approval_workflow_id) throw new BadRequestException('No approval workflow');

    await this.approvalEngine.decide(doc.approval_workflow_id.toString(), {
      approverUserId: currentUser.userId,
      approverRole: isChair ? 'chairperson' : 'department_secretary',
      decision,
      comment,
    });

    const updated = await this.documentModel.findById(id).exec();

    if (decision === 'approved' && updated.approval_status === 'FINAL_APPROVED') {
      updated.approval_status = 'FINAL_APPROVED';
      await updated.save();

      await this.notificationEngine.create({
        recipientUserId: doc.uploaded_by.toString(),
        eventType: 'document_new',
        title: 'Document Published',
        message: `Your document "${doc.title}" has been published.`,
        entityType: 'document',
        entityId: id,
      });
    } else if (decision === 'rejected') {
      updated.approval_status = 'REJECTED';
      await updated.save();
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.document_publish_approve',
      entityType: 'document',
      entityId: id,
      approvalInfo: { decision, comment },
    });

    return updated;
  }

  async requestDelete(id: string, currentUser: any): Promise<{ message: string }> {
    const roles: string[] = currentUser.roles || [];
    const isITMember = roles.includes('department_secretary') || roles.includes('department_chairperson') ||
      roles.includes('secretary') || roles.includes('admin');

    if (!isITMember) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const doc = await this.documentModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Document not found');

    const approval = await this.approvalEngine.createWorkflow(
      'it_content_delete',
      doc._id.toString(),
      'document_delete',
      currentUser.userId,
    );
    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.document_delete_request',
      entityType: 'document',
      entityId: id,
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return { message: 'Delete request submitted for approval' };
  }

  // === Announcements ===
  async findAnnouncements(currentUser: any): Promise<Announcement[]> {
    const roles: string[] = currentUser.roles || [];
    const query: any = {};

    if (roles.some((r) => ['secretary', 'admin', 'assistant_secretary'].includes(r))) {
      // Can see all
    } else {
      query.status = 'FINAL_APPROVED';
    }

    return this.announcementModel.find(query).sort({ created_at: -1 }).exec();
  }

  async createAnnouncement(dto: CreateAnnouncementDto, currentUser: any): Promise<Announcement> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const announcement = await this.announcementModel.create({
      ...dto,
      created_by: new Types.ObjectId(currentUser.userId),
      status: 'DRAFT',
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.announcement_create',
      entityType: 'announcement',
      entityId: announcement._id.toString(),
      newValue: { title: dto.title },
    });

    return announcement;
  }

  async approveAnnouncement(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<Announcement> {
    const roles: string[] = currentUser.roles || [];
    const isChair = roles.includes('chairperson') || roles.includes('assistant_chairperson');
    const isSecretary = roles.includes('secretary') || roles.includes('admin');

    if (!isChair && !isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const announcement = await this.announcementModel.findById(id).exec();
    if (!announcement) throw new NotFoundException('Announcement not found');

    if (decision === 'approved') {
      announcement.status = 'FINAL_APPROVED';
    } else {
      announcement.status = 'REJECTED';
    }
    await announcement.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.announcement_approve',
      entityType: 'announcement',
      entityId: id,
      approvalInfo: { decision, comment },
    });

    return announcement;
  }

  // === Gallery (stored as documents with is_website_content) ===
  async findGallery(currentUser: any): Promise<DocumentEntity[]> {
    return this.documentModel
      .find({ is_website_content: true, mime_type: { $regex: '^image/' } })
      .sort({ uploaded_at: -1 })
      .exec();
  }
}
