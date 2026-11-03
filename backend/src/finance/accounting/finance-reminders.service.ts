import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Reminders: budget submissions near their deadline, and accounts not reconciled for 30 days. Reminders go only to
 * the people responsible.
 */
@Injectable()
export class FinanceRemindersService {
  constructor(private prisma: PrismaService, private scope: FinanceScopeService, private notify: FinanceNotifyService) {}

  async run(user: any) {
    if (!this.scope.has(user, 'treasurer', 'secretary', 'assistant_secretary')) throw new ForbiddenException('Only the Treasurer or Secretary sends finance reminders.');
    const fellowshipId = this.scope.fellowship(user);
    const now = new Date();
    const result = { budgetDeadlines: 0, reconciliations: 0 };

    const calls = await this.prisma.budgetCall.findMany({ where: { fellowship_id: fellowshipId, status: 'open', deadline: { gte: now, lte: new Date(now.getTime() + 7 * DAY) } } });
    for (const c of calls) {
      const depts = c.all_departments
        ? (await this.prisma.department.findMany({ where: { fellowship_id: fellowshipId, is_active: true }, select: { id: true } })).map((d) => d.id)
        : (c.department_ids as string[]);
      const submitted = new Set((await this.prisma.budget.findMany({ where: { budget_call_id: c.id, approval_status: { notIn: ['REJECTED', 'CANCELLED'] } }, select: { department_id: true } })).map((b) => b.department_id));
      for (const d of depts.filter((x) => !submitted.has(x))) {
        await this.notify.send(await this.scope.departmentLeaderIds(d), { eventType: 'budget_deadline', title: 'Budget deadline approaching', message: `"${c.title}" is due on ${c.deadline.toISOString().slice(0, 10)}.`, entityType: 'budget_call', entityId: c.id, fellowshipId });
        result.budgetDeadlines++;
      }
    }

    const stale = await this.prisma.financialAccount.findMany({ where: { fellowship_id: fellowshipId, is_active: true, OR: [{ last_reconciled_at: null }, { last_reconciled_at: { lt: new Date(now.getTime() - 30 * DAY) } }], created_at: { lt: new Date(now.getTime() - 30 * DAY) } } });
    for (const a of stale) {
      const to = a.department_id ? await this.scope.departmentLeaderIds(a.department_id, 'department_chairperson') : await this.scope.usersWithRoles(fellowshipId, ['treasurer']);
      await this.notify.send(to, { eventType: 'reconciliation_due', title: 'Reconcile an account', message: `"${a.name}" has not been reconciled for 30 days.`, entityType: 'financial_account', entityId: a.id, fellowshipId });
      result.reconciliations++;
    }
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action: 'finance.reminders_run', entity_type: 'finance', fellowship_id: fellowshipId, new_value: result as any } });
    return result;
  }
}
