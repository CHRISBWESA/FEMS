import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertAccountScope, defaultAccount, nextNumber, postEntry } from './accounting/ledger';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { FinanceAccessService } from './finance-access.service';
import { validateAmount, validateOptionalUuid, validateText } from './finance.validation';

export const RELEASE_METHODS = ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'];

export interface ReleaseMoneyRequestDto {
  amount?: number;
  method: string;
  reference?: string;
  notes?: string;
  receiptDocumentId?: string;
}

// Releasing (paying out) an approved money request. Safety properties:
//  * only the Treasurer role (plus the finance.release_record permission) - not admin, not the approvers;
//  * authorization AND approval state are re-checked INSIDE the transaction, at write time;
//  * money_request_id is UNIQUE, so the database itself guarantees at most one release even when two
//    requests race (the loser gets 409);
//  * the released amount can never exceed the approved amount.
@Injectable()
export class FinanceReleaseService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
  ) {}

  async release(id: string, dto: ReleaseMoneyRequestDto, user: any): Promise<any> {
    if (!this.access.roles(user).includes('treasurer')) {
      throw new ForbiddenException('Only the Treasurer can release funds.');
    }
    this.access.requirePermission(user, PERMISSIONS.FINANCE_RELEASE_RECORD);
    if (!isUuid(id)) throw new NotFoundException('Money request not found');

    const method = validateText('method', dto?.method, 30, true) as string;
    if (!RELEASE_METHODS.includes(method)) {
      throw new BadRequestException(`method must be one of: ${RELEASE_METHODS.join(', ')}`);
    }
    const reference = validateText('reference', dto?.reference, 100);
    const notes = validateText('notes', dto?.notes, 500);
    const receiptId = validateOptionalUuid('receiptDocumentId', dto?.receiptDocumentId);
    const accountId = validateOptionalUuid('accountId', (dto as any)?.accountId);

    const result = await this.prisma.$transaction(async (tx) => {
      const request = await tx.moneyRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Money request not found');
      this.tenantScope.assertInScope(user, request);
      // A person can never release funds for a request they raised themselves.
      if (request.requester_id === user.userId) {
        throw new ForbiddenException('You cannot release funds for a request you submitted.');
      }

      if (receiptId) {
        const doc = await tx.documentEntity.findFirst({
          where: { id: receiptId, fellowship_id: request.fellowship_id, is_website_content: false },
          select: { id: true },
        });
        if (!doc) throw new ConflictException('The selected receipt document is not available.');
      }

      // Conditional write = row lock + state re-check in one atomic step: it only matches while the
      // request is STILL fully approved, and it serialises this release against any concurrent change.
      const locked = await tx.moneyRequest.updateMany({
        where: { id, approval_status: 'FINAL_APPROVED', fellowship_id: request.fellowship_id },
        data: { updated_at: new Date() },
      });
      if (locked.count !== 1) {
        throw new ConflictException('Only fully approved money requests can be released.');
      }

      // Re-verify the approval chain itself: every stage approved, chain FINAL_APPROVED.
      const approval = request.approval_workflow_id
        ? await tx.approval.findFirst({
            where: { id: request.approval_workflow_id, entity_id: id, workflow_type: 'money_request', status: 'FINAL_APPROVED' },
            include: { steps: true },
          })
        : null;
      if (!approval || approval.steps.length === 0 || approval.steps.some((s) => s.status !== 'approved')) {
        throw new ConflictException('The approval chain for this request is not complete.');
      }

      const approved = new Prisma.Decimal(request.amount);
      const amount = new Prisma.Decimal(dto?.amount === undefined ? approved : validateAmount('amount', dto.amount));
      if (amount.greaterThan(approved)) {
        throw new ConflictException('The released amount cannot exceed the approved amount.');
      }

      let release: any;
      try {
        release = await tx.moneyRequestRelease.create({
          data: {
            money_request_id: id,
            fellowship_id: request.fellowship_id,
            amount,
            method,
            reference,
            notes,
            receipt_document_id: receiptId,
            released_by: user.userId,
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictException('This money request has already been released.');
        }
        throw err;
      }

      // Paying out is an expense, recorded once and linked both ways; the money leaves a central account through
      // the ledger (which refuses to overdraw it).
      if (!request.fellowship_id) return release;
      const account = accountId
        ? await assertAccountScope(tx, accountId, request.fellowship_id, null)
        : await defaultAccount(tx, request.fellowship_id, null, user.userId);
      const number = await nextNumber(tx, request.fellowship_id, 'expense', 'EXP');
      const expense = await tx.expense.create({
        data: {
          fellowship_id: request.fellowship_id, department_id: request.department_id, title: request.title, description: request.description,
          purpose: request.purpose, amount: approved, amount_approved: approved, amount_paid: amount, date: new Date(),
          project_id: request.project_id, activity_id: request.activity_id, budget_id: request.budget_id, budget_line_id: request.budget_line_id,
          payment_status: 'paid', payment_method: method, payment_reference: reference, account_id: account.id, paid_at: new Date(), paid_by: user.userId,
          money_request_id: id, expense_number: number, recorded_by: user.userId, approval_status: 'FINAL_APPROVED', approval_workflow_id: request.approval_workflow_id,
        },
      });
      await postEntry(tx, {
        fellowshipId: request.fellowship_id, accountId: account.id, amount: amount.negated(), entryType: 'expense', sourceType: 'expense', sourceId: expense.id,
        date: new Date(), userId: user.userId, departmentId: null, projectId: request.project_id, reference: request.request_number ?? number,
        description: `Money request: ${request.title}`, primary: true,
      });
      return tx.moneyRequestRelease.update({ where: { id: release.id }, data: { account_id: account.id, expense_id: expense.id } });
    });

    await this.auditService.log({
      userId: user.userId,
      action: 'finance.money_request_release',
      entityType: 'money_request',
      entityId: id,
      newValue: { amount: result.amount.toString(), method },
    });

    const request = await this.prisma.moneyRequest.findUnique({ where: { id }, select: { requester_id: true, fellowship_id: true } });
    if (request) {
      await this.notificationEngine.create({
        recipientUserId: request.requester_id,
        eventType: 'finance_approved',
        title: 'Funds released',
        message: 'The funds for your approved money request have been released.',
        entityType: 'money_request',
        entityId: id,
        fellowshipId: request.fellowship_id,
      });
    }

    return result;
  }
}
