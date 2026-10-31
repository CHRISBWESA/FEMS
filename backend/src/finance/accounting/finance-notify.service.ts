import { Injectable, Logger } from '@nestjs/common';
import { NotificationEngineService } from '../../shared/notifications/notification-engine.service';
import { FinanceScopeService } from './finance-scope.service';

const STAGE_ROLES: Record<string, string[]> = {
  treasurer: ['treasurer'],
  secretary: ['secretary', 'assistant_secretary'],
  chairperson: ['chairperson', 'assistant_chairperson'],
};

/**
 * Finance notifications: one per person, never to the person who acted, and only to the people responsible
 * (department stages go to that department's leaders, not to every department leader).
 */
@Injectable()
export class FinanceNotifyService {
  private readonly logger = new Logger(FinanceNotifyService.name);

  constructor(private notifications: NotificationEngineService, private scope: FinanceScopeService) {}

  async send(userIds: string[], p: { eventType: string; title: string; message: string; entityType?: string; entityId?: string; fellowshipId: string | null }, exclude?: string) {
    const ids = Array.from(new Set(userIds.filter((id) => id && id !== exclude)));
    for (const id of ids) {
      try {
        await this.notifications.create({ recipientUserId: id, ...p, actorUserId: exclude });
      } catch (e) {
        // A notification must never undo a recorded financial decision.
        this.logger.warn(`notification failed: ${(e as Error).message}`);
      }
    }
  }

  async toRoles(fellowshipId: string, roles: string[], p: Parameters<FinanceNotifyService['send']>[1], exclude?: string) {
    await this.send(await this.scope.usersWithRoles(fellowshipId, roles), p, exclude);
  }

  /** Tells whoever must decide the approval's current stage. */
  async stage(approval: any, label: string, entityType: string, entityId: string, exclude?: string) {
    const step = approval?.steps?.find((s: any) => s.stage_order === approval.current_stage);
    if (!step || step.status !== 'pending' || !approval.fellowship_id) return;
    const departmentId = (approval.metadata as any)?.departmentId;
    const recipients = step.approver_role.startsWith('department_') && departmentId
      ? await this.scope.departmentLeaderIds(departmentId, step.approver_role)
      : await this.scope.usersWithRoles(approval.fellowship_id, STAGE_ROLES[step.approver_role] ?? [step.approver_role]);
    await this.send(recipients, {
      eventType: 'approval_request',
      title: 'Approval needed',
      message: `A ${label} is waiting for your review.`,
      entityType,
      entityId,
      fellowshipId: approval.fellowship_id,
    }, exclude);
  }
}
