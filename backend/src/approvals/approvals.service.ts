import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { AuditService } from '../shared/audit/audit.service';
import { ROLE_DEFINITIONS } from '../shared/authorization/roles';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { buildHistoryData } from '../members/membership-history.util';
import { applyFinanceEffect } from '../finance/finance-effects';
import { isUuid } from '../shared/utils/uuid.util';

@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
  ) {}

  async findPendingForUser(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    const userId = currentUser.userId;

    const where = this.tenantScope.scopeWhere(
      currentUser,
      { status: { in: ['SUBMITTED', 'RESUBMITTED', 'APPROVED'] } },
      queryFellowshipId,
    ) as Prisma.ApprovalWhereInput;

    const approvals = await this.prisma.approval.findMany({
      where,
      include: { steps: { orderBy: { stage_order: 'asc' } } },
      orderBy: { updated_at: 'desc' },
    });

    return approvals.filter((a) => {
      const current = a.steps.find((s) => s.stage_order === a.current_stage);
      if (!current || current.status !== 'pending') return false;
      if (current.approver_user_id === userId) return true;
      if (roles.includes(current.approver_role)) return true;
      const roleIsChair =
        current.approver_role === 'chairperson' || current.approver_role === 'assistant_chairperson';
      if (
        roleIsChair &&
        (roles.includes('chairperson') || roles.includes('assistant_chairperson'))
      ) {
        return true;
      }
      return false;
    });
  }

  async decide(id: string, decision: 'approved' | 'rejected' | undefined, comment: string, currentUser: any): Promise<any> {
    if (!isUuid(id)) {
      throw new NotFoundException('Approval not found');
    }
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new BadRequestException("decision must be 'approved' or 'rejected'");
    }
    const approval = await this.prisma.approval.findUnique({
      where: { id },
      include: { steps: { orderBy: { stage_order: 'asc' } } },
    });
    if (!approval) {
      throw new NotFoundException('Approval not found');
    }
    this.tenantScope.assertInScope(currentUser, approval);

    const roles: string[] = currentUser.roles || [];
    await this.approvalEngine.getWorkflowForUser(id, currentUser.userId, roles);
    const current = approval.steps.find((s) => s.stage_order === approval.current_stage);
    if (!current) throw new BadRequestException('Invalid workflow state');
    const approverRole = current.approver_role;

    // The final-approval side effect runs INSIDE the decision's transaction (see the engine), so an
    // approval can never be committed without its effect - and a decided step can never be applied twice.
    const updated = await this.approvalEngine.decide(
      id,
      { approverUserId: currentUser.userId, approverRole, decision, comment },
      (tx, finalApproval) => this.applyFinalEffect(finalApproval, currentUser.userId, tx),
    );

    await this.auditService.log({
      userId: currentUser.userId,
      action: `approval.${decision}`,
      entityType: approval.entity_type,
      entityId: approval.entity_id,
      newValue: { workflowId: id, stage: approval.current_stage, decision },
      comment,
      approvalInfo: { workflowId: id },
    });

    return updated;
  }

  private async applyFinalEffect(approval: any, actorUserId: string | undefined, db: Prisma.TransactionClient): Promise<void> {
    const metadata: any = approval.metadata || {};
    const entityId = approval.entity_id;

    // Finance edit/delete requests (contribution / expense / budget / income).
    if (await applyFinanceEffect(db, approval, actorUserId)) return;

    switch (approval.workflow_type) {
      case 'department_transfer': {
        const { fromDepartmentId, toDepartmentId } = metadata;
        if (!fromDepartmentId || !toDepartmentId) break;
        const [member, fromDepartment, toDepartment] = await Promise.all([
          db.member.findUnique({ where: { id: entityId }, select: { fellowship_id: true } }),
          db.department.findUnique({ where: { id: fromDepartmentId }, select: { fellowship_id: true } }),
          db.department.findUnique({ where: { id: toDepartmentId }, select: { fellowship_id: true } }),
        ]);
        if (!member || !fromDepartment || !toDepartment || member.fellowship_id !== fromDepartment.fellowship_id || toDepartment.fellowship_id !== fromDepartment.fellowship_id) {
          throw new ConflictException('The transfer no longer references one fellowship; the approval was not applied.');
        }
        const membership = await db.departmentMember.findFirst({
          where: { member_id: entityId, department_id: fromDepartmentId, removed: false },
        });
        if (!membership) break;
        await db.departmentMember.update({
          where: { id: membership.id },
          data: { removed: true, removed_at: new Date() },
        });
        const existingTarget = await db.departmentMember.findFirst({
          where: { member_id: entityId, department_id: toDepartmentId },
        });
        if (existingTarget) {
          await db.departmentMember.update({
            where: { id: existingTarget.id },
            data: { removed: false, removed_at: null },
          });
        } else {
          await db.departmentMember.create({ data: { member_id: entityId, department_id: toDepartmentId } });
        }
        await db.membershipHistory.create({
          data: buildHistoryData({
            memberId: entityId,
            fellowshipId: approval.fellowship_id,
            eventType: 'department_transferred',
            departmentId: fromDepartmentId,
            relatedDepartmentId: toDepartmentId,
            reason: metadata.reason,
            recordedBy: actorUserId,
          }),
        });
        break;
      }
      case 'department_removal': {
        const { departmentId } = metadata;
        if (!departmentId) break;
        const [member, department] = await Promise.all([
          db.member.findUnique({ where: { id: entityId }, select: { fellowship_id: true } }),
          db.department.findUnique({ where: { id: departmentId }, select: { fellowship_id: true } }),
        ]);
        if (!member || !department || member.fellowship_id !== department.fellowship_id) {
          throw new ConflictException('The removal no longer references one fellowship; the approval was not applied.');
        }
        const membership = await db.departmentMember.findFirst({
          where: { member_id: entityId, department_id: departmentId, removed: false },
        });
        if (!membership) break;
        await db.departmentMember.update({
          where: { id: membership.id },
          data: { removed: true, removed_at: new Date(), removal_approval_id: approval.id },
        });
        await db.membershipHistory.create({
          data: buildHistoryData({
            memberId: entityId,
            fellowshipId: approval.fellowship_id,
            eventType: 'department_removed',
            departmentId,
            reason: metadata.reason,
            recordedBy: actorUserId,
          }),
        });
        break;
      }
      case 'role_unassign': {
        const { userId, role } = metadata;
        if (!userId || !role) break;
        const target = await db.user.findUnique({ where: { id: userId } });
        if (!target) break;
        if (!(target.roles || []).includes(role)) {
          throw new ConflictException('The role was already removed; the approval was not applied again.');
        }
        let newRoles: string[] = (target.roles || []).filter((r) => r !== role);
        // A user must always hold at least one role.
        if (newRoles.length === 0) newRoles = ['ordinary_member'];
        const allPermissions = ROLE_DEFINITIONS
          .filter((d) => newRoles.includes(d.name))
          .flatMap((d) => d.permissions);
        await db.user.update({
          where: { id: userId },
          data: { roles: newRoles, permissions: allPermissions, token_version: { increment: 1 } },
        });
        break;
      }
      default:
        // other workflows (money_request, expense, budget, report, it_content, ...) have no generic side effect
        break;
    }
  }
}
