import { Injectable, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isUuid } from '../shared/utils/uuid.util';

export const FINANCE_VIEW_ROLES = [
  'admin', 'treasurer', 'secretary', 'assistant_secretary', 'chairperson', 'assistant_chairperson',
];
const DEPARTMENT_LEADER_ROLES = ['department_secretary', 'department_chairperson'];
const PENDING_APPROVAL_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'RESUBMITTED'];

export const MAX_PAGE_SIZE = 1000;

@Injectable()
export class FinanceAccessService {
  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
    private notificationEngine: NotificationEngineService,
  ) {}

  roles(user: any): string[] {
    return user?.roles || [];
  }

  hasAnyRole(user: any, roles: string[]): boolean {
    const mine = this.roles(user);
    return roles.some((r) => mine.includes(r));
  }

  hasPermission(user: any, permission: string): boolean {
    return ((user?.permissions as string[]) || []).includes(permission);
  }

  requirePermission(user: any, permission: string): void {
    if (!this.hasPermission(user, permission)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  isFinanceViewer(user: any): boolean {
    return this.hasAnyRole(user, FINANCE_VIEW_ROLES);
  }

  isDepartmentLeader(user: any): boolean {
    return this.hasAnyRole(user, DEPARTMENT_LEADER_ROLES);
  }

  // Which fellowship a NEW record belongs to: the caller's own, unless a global admin names one.
  // (TenantScopeService ignores the body value for non-admins, so it can't be used to cross tenants.)
  resolveFellowship(user: any, bodyFellowshipId?: unknown): string | null {
    if (bodyFellowshipId !== undefined && bodyFellowshipId !== null && bodyFellowshipId !== '' && !isUuid(bodyFellowshipId)) {
      throw new BadRequestException('fellowshipId must be a valid id');
    }
    return this.tenantScope.resolveFellowshipId(user, bodyFellowshipId as string | undefined);
  }

  parsePaging(limit?: unknown, page?: unknown, defaultLimit = 500): { take: number; skip: number } {
    const l = limit === undefined || limit === '' ? defaultLimit : Number(limit);
    const p = page === undefined || page === '' ? 1 : Number(page);
    if (!Number.isInteger(l) || l < 1 || l > MAX_PAGE_SIZE) {
      throw new BadRequestException(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
    }
    if (!Number.isInteger(p) || p < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    return { take: l, skip: (p - 1) * l };
  }

  // ---- reference validation: every referenced record must exist IN THE SAME FELLOWSHIP as the new
  // record. A missing record and a foreign-fellowship record are indistinguishable to the caller. ----

  async assertMember(memberId: string, fellowshipId: string | null): Promise<any> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, fellowship_id: fellowshipId },
      select: { id: true, full_name: true, fellowship_id: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async assertDepartment(departmentId: string, fellowshipId: string | null): Promise<any> {
    const dept = await this.prisma.department.findFirst({
      where: { id: departmentId, fellowship_id: fellowshipId },
      select: { id: true, name: true },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async assertCategory(categoryId: string, kind: 'contribution' | 'income' | 'expense', fellowshipId: string | null): Promise<void> {
    const cat = await this.prisma.financeCategory.findFirst({
      where: { id: categoryId, fellowship_id: fellowshipId, kind, is_active: true },
      select: { id: true },
    });
    if (!cat) throw new BadRequestException('The selected category is not available.');
  }

  async assertCampaign(campaignId: string, fellowshipId: string | null, requireActive = true): Promise<void> {
    const c = await this.prisma.contributionCampaign.findFirst({
      where: { id: campaignId, fellowship_id: fellowshipId, ...(requireActive ? { status: 'active' as const } : {}) },
      select: { id: true },
    });
    if (!c) throw new BadRequestException('The selected campaign is not available.');
  }

  // Receipts reuse the existing documents table. A receipt must belong to the same fellowship and must
  // never be a document that is published as public website content.
  async assertReceipt(documentId: string, fellowshipId: string | null): Promise<void> {
    const doc = await this.prisma.documentEntity.findFirst({
      where: { id: documentId, fellowship_id: fellowshipId, is_website_content: false },
      select: { id: true },
    });
    if (!doc) throw new BadRequestException('The selected receipt document is not available.');
  }

  async assertNoPendingRequest(entityId: string, workflowTypes: string[]): Promise<void> {
    const pending = await this.prisma.approval.findFirst({
      where: { entity_id: entityId, workflow_type: { in: workflowTypes }, status: { in: PENDING_APPROVAL_STATUSES as any } },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException('There is already a pending request for this record.');
    }
  }

  // ---- approver notifications (this was a stub returning [] before, so approvers were never told) ----

  async findUsersWithRole(roles: string[], fellowshipId: string | null): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { roles: { hasSome: roles }, fellowship_id: fellowshipId, is_active: true, deleted_at: null },
      select: { id: true },
      take: 50,
    });
    return users.map((u) => u.id);
  }

  // Tells whoever must act at the approval's CURRENT stage. Deliberately neutral text: no titles,
  // amounts or names in the notification.
  async notifyCurrentStage(approval: any, label: string, entityType: string, entityId: string, excludeUserId?: string): Promise<void> {
    const step = approval?.steps?.find((s: any) => s.stage_order === approval.current_stage);
    if (!step || step.status !== 'pending') return;
    const roles = step.approver_role === 'chairperson' ? ['chairperson', 'assistant_chairperson']
      : step.approver_role === 'secretary' ? ['secretary', 'assistant_secretary']
      : [step.approver_role];
    const ids = (await this.findUsersWithRole(roles, approval.fellowship_id ?? null)).filter((id) => id !== excludeUserId);
    for (const userId of ids) {
      await this.notificationEngine.create({
        recipientUserId: userId,
        eventType: 'approval_request',
        title: 'Approval needed',
        message: `A ${label} is waiting for your approval.`,
        entityType,
        entityId,
        fellowshipId: approval.fellowship_id ?? null,
      });
    }
  }
}
