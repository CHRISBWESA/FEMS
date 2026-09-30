import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { assertContentMatchesDeclaredType, sanitizeFilename } from '../shared/utils/file-validation.util';
import { writeStoredFile, readStoredFile, deleteStoredFile } from '../shared/utils/file-storage.util';
import { EntitlementsService } from '../shared/billing/entitlements.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { audienceVisibilityWhere } from '../shared/tenant/audience-scope';
import { validateOptionalUuid, validateText } from '../shared/utils/validation.util';
import { isUuid } from '../shared/utils/uuid.util';
import { randomBytes } from 'crypto';

/**
 * A boolean that arrived through a multipart form.
 *
 * A file upload's fields are always text, so a checkbox can only ever send "true". Rejecting that would make the
 * website-content flag impossible to set from a browser. Only the two obvious spellings are accepted, so a value
 * that is neither is still an error rather than being silently treated as false.
 */
function parseMultipartBoolean(field: string, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(`${field} must be true or false.`);
}

export interface UploadDocumentDto {
  title: string;
  departmentId?: string;
  isWebsiteContent?: boolean;
  fellowshipId?: string;
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
    private prisma: PrismaService,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
    @Optional() private entitlements?: EntitlementsService,
  ) {}

  // === Documents ===
  async findDocuments(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    const where: Prisma.DocumentEntityWhereInput = this.tenantScope.scopeWhere(currentUser, {}, queryFellowshipId) as Prisma.DocumentEntityWhereInput;

    if (roles.some((r) => ['department_secretary', 'department_chairperson'].includes(r))) {
      if (!currentUser.departmentId) where.id = { in: [] };
      else where.department_id = currentUser.departmentId;
    }

    if (roles.some((r) => ['secretary', 'admin', 'assistant_secretary'].includes(r))) {
      where.approval_status = { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FINAL_APPROVED', 'REJECTED'] };
    } else if (roles.some((r) => ['department_secretary', 'department_chairperson'].includes(r))) {
      where.approval_status = { in: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'FINAL_APPROVED', 'REJECTED'] };
    } else if (roles.some((r) => ['chairperson', 'assistant_chairperson'].includes(r))) {
      where.approval_status = { in: ['SUBMITTED', 'UNDER_REVIEW', 'FINAL_APPROVED', 'REJECTED'] };
    } else {
      where.approval_status = 'FINAL_APPROVED';
    }

    return this.prisma.documentEntity.findMany({ where, orderBy: { uploaded_at: 'desc' }, take: 500 });
  }

  async uploadDocument(dto: UploadDocumentDto, file: Express.Multer.File, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isITMember = roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isITMember && !roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('Document metadata is required.');
    const title = validateText('title', dto.title, 200, true)!;
    // A multipart field is always a string, so "true" arriving here is the client being correct, not an attack.
    // Without this coercion a browser can never mark a document as website content, because a checkbox cannot send
    // a JSON boolean. Anything other than a recognised true/false spelling is still refused.
    const isWebsiteContent = parseMultipartBoolean('isWebsiteContent', dto.isWebsiteContent);
    const departmentId = validateOptionalUuid('departmentId', dto.departmentId);
    if (isITMember && (!currentUser.departmentId || departmentId !== currentUser.departmentId)) {
      throw new ForbiddenException('Department leaders may upload only to their own department.');
    }
    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, fellowship_id: currentUser.fellowshipId },
        select: { id: true },
      });
      if (!department) throw new NotFoundException('Department not found');
    }

    // Plan quota (soft): storage counted from the stored documents' sizes.
    if (!file) throw new BadRequestException('A file is required');
    await this.entitlements?.assertWithinLimit(currentUser.fellowshipId, 'max_storage_mb', file.size);

    // Validate the file: declared type allowed AND the content really is that type (the declared type is attacker-controlled).
    assertContentMatchesDeclaredType(file.mimetype, file.buffer);
    const safeName = sanitizeFilename(file.originalname);

    const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE || '10485760');
    if (file.size > maxSize) {
      throw new BadRequestException('File too large');
    }

    // Generate safe filename
    const storedFilename = `${Date.now()}_${randomBytes(8).toString('hex')}_${safeName}`;

    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, dto.fellowshipId);

    // Write the bytes BEFORE the row. This used to keep only the row and throw the buffer away, so every
    // "upload" was a description of a file that did not exist. Bytes first means a failure here leaves no row
    // pointing at a missing file, which is the state that could not be recovered from.
    await writeStoredFile(storedFilename, file.buffer);

    let doc;
    try {
      doc = await this.prisma.documentEntity.create({
        data: {
          title,
          filename: safeName,
          stored_filename: storedFilename,
          file_size: file.size,
          mime_type: file.mimetype,
          department_id: departmentId,
          uploaded_by: currentUser.userId,
          uploaded_at: new Date(),
          is_website_content: isWebsiteContent,
          approval_status: 'DRAFT',
          fellowship_id: fellowshipId,
        },
      });

      // Create approval workflow for IT content
      const approval = await this.approvalEngine.createWorkflow(
        'it_content',
        doc.id,
        'document',
        currentUser.userId,
        undefined,
        fellowshipId,
      );
      await this.prisma.documentEntity.update({
        where: { id: doc.id },
        data: { approval_workflow_id: approval.id },
      });

      await this.auditService.log({
        userId: currentUser.userId,
        action: 'it_content.document_upload',
        entityType: 'document',
        entityId: doc.id,
        newValue: { title, isWebsite: dto.isWebsiteContent },
        approvalInfo: { workflowId: approval.id },
      });
    } catch (err) {
      // The row could not be written, so the bytes would be orphans on disk with nothing pointing at them.
      await deleteStoredFile(storedFilename);
      throw err;
    }

    return doc;
  }

  /**
   * The bytes of a document, for a signed-in member of the fellowship that owns it.
   *
   * This is the authenticated read. The public read of an approved website document is
   * `PublicSiteService.publicDocument`, which is the only path that skips the tenant check - and it still requires
   * the document to be approved and flagged as website content.
   */
  async readDocument(id: string, currentUser: any): Promise<{ doc: any; bytes: Buffer }> {
    if (!isUuid(id)) throw new NotFoundException('Document not found');
    const doc = await this.prisma.documentEntity.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    // A draft belongs to the uploader's fellowship only, which assertInScope enforces for every non-admin.
    this.tenantScope.assertInScope(currentUser, doc);

    const roles: string[] = currentUser.roles || [];
    const isDepartmentLeader = roles.includes('department_secretary') || roles.includes('department_chairperson');
    // A department leader is confined to their own department's documents, the same rule as the upload path.
    if (isDepartmentLeader && doc.department_id !== currentUser.departmentId) {
      throw new ForbiddenException('You do not have access to this document.');
    }

    const bytes = await readStoredFile(doc.stored_filename);
    return { doc, bytes };
  }

  async submitForApproval(id: string, currentUser: any): Promise<{ message: string }> {
    if (!isUuid(id)) throw new NotFoundException('Document not found');
    const doc = await this.prisma.documentEntity.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    this.tenantScope.assertInScope(currentUser, doc);
    const roles: string[] = currentUser.roles || [];
    const maySubmit = doc.uploaded_by === currentUser.userId || roles.includes('secretary') || roles.includes('assistant_secretary');
    if (!maySubmit) throw new ForbiddenException('Only the uploader or a fellowship secretary may submit this document.');
    if (!doc.approval_workflow_id) throw new BadRequestException('No approval workflow');
    if (doc.approval_status !== 'DRAFT') throw new ConflictException('This document has already been submitted.');

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.documentEntity.updateMany({
        where: { id, approval_workflow_id: doc.approval_workflow_id, approval_status: 'DRAFT' },
        data: { approval_status: 'SUBMITTED' },
      });
      if (changed.count !== 1) throw new ConflictException('This document changed before it could be submitted.');
      await this.approvalEngine.submit(doc.approval_workflow_id!, tx);
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.submit',
      entityType: 'document',
      entityId: id,
    });
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

  async approveDocument(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<any> {
    if (!isUuid(id)) throw new NotFoundException('Document not found');
    if (decision !== 'approved' && decision !== 'rejected') throw new BadRequestException('decision must be approved or rejected.');
    const doc = await this.prisma.documentEntity.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    this.tenantScope.assertInScope(currentUser, doc);
    if (!doc.approval_workflow_id) throw new BadRequestException('No approval workflow');

    const workflow = await this.approvalEngine.getWorkflowForUser(
      doc.approval_workflow_id,
      currentUser.userId,
      currentUser.roles || [],
    );
    const stage = workflow.steps.find((step: any) => step.stage_order === workflow.current_stage);
    if (!stage) throw new ConflictException('The approval workflow has no active stage.');
    if (stage.approver_role === 'department_secretary' && doc.department_id && currentUser.departmentId !== doc.department_id) {
      throw new ForbiddenException('Department approval is limited to the document department.');
    }

    const decided = await this.approvalEngine.decide(doc.approval_workflow_id, {
      approverUserId: currentUser.userId,
      approverRole: stage.approver_role,
      decision,
      comment,
    });
    const updated = await this.prisma.documentEntity.findUnique({ where: { id } });
    if (decided.status === 'FINAL_APPROVED' || decided.status === 'REJECTED') {
      await this.notificationEngine.create({
        recipientUserId: doc.uploaded_by,
        eventType: decided.status === 'FINAL_APPROVED' ? 'document_new' : 'document_rejected',
        title: decided.status === 'FINAL_APPROVED' ? 'Document Published' : 'Document Rejected',
        message: `Your document "${doc.title}" was ${decided.status === 'FINAL_APPROVED' ? 'published' : 'rejected'}.`,
        entityType: 'document',
        entityId: id,
      });
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

  async requestDelete(id: string, currentUser: any): Promise<never> {
    const roles: string[] = currentUser.roles || [];
    const isITMember = roles.includes('department_secretary') || roles.includes('department_chairperson') ||
      roles.includes('secretary') || roles.includes('admin');
    if (!isITMember) throw new ForbiddenException('You do not have permission to perform this action.');
    throw new ConflictException({
      code: 'OPERATION_UNAVAILABLE',
      message: 'Document deletion requests are not available until the recycle-bin restore and document lifecycle are implemented.',
    });
  }

  async findAnnouncements(currentUser: any): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    const canManage = roles.some((role) => ['secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson', 'admin'].includes(role));
    const tenant = this.tenantScope.scopeWhere(currentUser, {}) as Prisma.AnnouncementWhereInput;
    const where: Prisma.AnnouncementWhereInput = canManage
      ? tenant
      : { AND: [tenant, audienceVisibilityWhere(currentUser), { status: 'FINAL_APPROVED' }] };
    return this.prisma.announcement.findMany({ where, orderBy: { created_at: 'desc' }, take: 500 });
  }

  async createAnnouncement(dto: CreateAnnouncementDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('Announcement data is required.');
    const fellowshipId = currentUser.fellowshipId;
    if (!fellowshipId) throw new ForbiddenException('A fellowship account is required.');
    const title = validateText('title', dto.title, 200, true)!;
    const content = validateText('content', dto.content, 10_000, true)!;
    if (!['all_members', 'department', 'leaders'].includes(dto.audienceType)) {
      throw new BadRequestException('audienceType must be all_members, department, or leaders.');
    }
    const departmentId = validateOptionalUuid('departmentId', dto.departmentId);
    if (dto.audienceType === 'department' && !departmentId) {
      throw new BadRequestException('departmentId is required for a department announcement.');
    }
    if (dto.audienceType !== 'department' && departmentId) {
      throw new BadRequestException('departmentId is only valid for a department announcement.');
    }
    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, fellowship_id: fellowshipId },
        select: { id: true },
      });
      if (!department) throw new NotFoundException('Department not found');
    }
    const announcement = await this.prisma.announcement.create({
      data: {
        title,
        content,
        audience_type: dto.audienceType,
        department_id: departmentId,
        fellowship_id: fellowshipId,
        created_by: currentUser.userId,
        status: 'DRAFT',
      },
    });
    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.announcement_create',
      entityType: 'announcement',
      entityId: announcement.id,
      newValue: { title },
    });
    return announcement;
  }

  async approveAnnouncement(id: string, decision: 'approved' | 'rejected', comment: string, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('chairperson') && !roles.includes('assistant_chairperson')) {
      throw new ForbiddenException('Only a chairperson may publish or reject an announcement.');
    }
    if (!isUuid(id)) throw new NotFoundException('Announcement not found');
    if (decision !== 'approved' && decision !== 'rejected') throw new BadRequestException('decision must be approved or rejected.');
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    this.tenantScope.assertInScope(currentUser, announcement);
    if (announcement.created_by === currentUser.userId) throw new ForbiddenException('You cannot approve your own announcement.');
    if (announcement.status !== 'DRAFT' && announcement.status !== 'REJECTED') {
      throw new ConflictException('This announcement has already received a decision.');
    }
    const changed = await this.prisma.announcement.updateMany({
      where: { id, created_by: announcement.created_by, status: announcement.status },
      data: { status: decision === 'approved' ? 'FINAL_APPROVED' : 'REJECTED' },
    });
    if (changed.count !== 1) throw new ConflictException('This announcement changed before the decision was saved.');
    const updated = await this.prisma.announcement.findUnique({ where: { id } });
    await this.auditService.log({
      userId: currentUser.userId,
      action: 'it_content.announcement_approve',
      entityType: 'announcement',
      entityId: id,
      approvalInfo: { decision, comment },
    });
    return updated;
  }

  // === Gallery (stored as documents with is_website_content) ===
  async findGallery(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    const where = this.tenantScope.scopeWhere(
      currentUser,
      { is_website_content: true, mime_type: { startsWith: 'image/' } },
      queryFellowshipId,
    ) as Prisma.DocumentEntityWhereInput;
    return this.prisma.documentEntity.findMany({
      where,
      orderBy: { uploaded_at: 'desc' },
      take: 500,
    });
  }
}
