import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../../shared/approval-engine/approval-engine.service';
import { validateAmount, validateDate, validateText } from '../finance.validation';
import { getSettings, money } from './ledger';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';


export function parsePage(q: any, max = 200) {
  const limit = q?.limit === undefined || q.limit === '' ? 50 : Number(q.limit);
  const page = q?.page === undefined || q.page === '' ? 1 : Number(q.page);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new BadRequestException(`limit must be between 1 and ${max}`);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
  return { take: limit, skip: (page - 1) * limit, page, limit };
}

export function range(q: any): { gte?: Date; lte?: Date } | undefined {
  const from = validateDate('from', q?.from, { required: false, maxFutureDays: 3650 });
  const to = validateDate('to', q?.to, { required: false, maxFutureDays: 3650 });
  if (from && to && from > to) throw new BadRequestException('from cannot be after to');
  if (!from && !to) return undefined;
  const end = to ? new Date(to) : undefined;
  if (end && typeof q.to === 'string' && q.to.length <= 10) end.setUTCHours(23, 59, 59, 999);
  return { ...(from ? { gte: from } : {}), ...(end ? { lte: end } : {}) };
}

@Injectable()
export class AccountsService {
  constructor(
    private prisma: PrismaService,
    private scope: FinanceScopeService,
    private engine: ApprovalEngineService,
    private notify: FinanceNotifyService,
  ) {}

  // ===================== settings =====================

  async getSettings(user: any) {
    const fellowshipId = this.scope.fellowship(user);
    const leads = (await this.scope.leaderships(user)).size > 0;
    if (!this.scope.isCentralViewer(user) && !leads) throw new ForbiddenException('You do not have permission to perform this action.');
    const s = await getSettings(this.prisma as any, fellowshipId);
    return { ...s, major_expense_threshold: s.major_expense_threshold ? money(s.major_expense_threshold) : null };
  }

  async updateSettings(user: any, body: any) {
    await this.scope.requireManage(user, null);
    const fellowshipId = this.scope.fellowship(user);
    const data: any = {};
    if (body?.currency !== undefined) {
      const c = validateText('currency', body.currency, 3, true) as string;
      if (!/^[A-Z]{3}$/.test(c)) throw new BadRequestException('currency must be a three-letter code such as TZS');
      data.currency = c;
    }
    if (body?.receiptPrefix !== undefined) {
      const p = validateText('receiptPrefix', body.receiptPrefix, 8, true) as string;
      if (!/^[A-Z0-9]{2,8}$/.test(p)) throw new BadRequestException('receiptPrefix must be 2-8 capital letters or digits');
      data.receipt_prefix = p;
    }
    if (body?.majorExpenseThreshold !== undefined) {
      data.major_expense_threshold = body.majorExpenseThreshold === null || body.majorExpenseThreshold === '' ? null : validateAmount('majorExpenseThreshold', body.majorExpenseThreshold);
    }
    if (body?.budgetWarningPercent !== undefined) {
      const n = Number(body.budgetWarningPercent);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new BadRequestException('budgetWarningPercent must be between 1 and 100');
      data.budget_warning_percent = n;
    }
    if (body?.financialYearStartMonth !== undefined) {
      const n = Number(body.financialYearStartMonth);
      if (!Number.isInteger(n) || n < 1 || n > 12) throw new BadRequestException('financialYearStartMonth must be 1-12');
      data.financial_year_start_month = n;
    }
    if (body?.paymentMethods !== undefined) {
      if (!Array.isArray(body.paymentMethods) || !body.paymentMethods.length || body.paymentMethods.length > 15) throw new BadRequestException('paymentMethods must list 1-15 methods');
      const list = body.paymentMethods.map((m: unknown) => validateText('paymentMethods', m, 30, true) as string);
      if (list.some((m: string) => !/^[a-z0-9_]+$/.test(m))) throw new BadRequestException('Payment methods use lower-case letters, digits and underscores, e.g. mobile_money');
      data.payment_methods = Array.from(new Set(list));
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    const saved = await this.prisma.financeSettings.upsert({
      where: { fellowship_id: fellowshipId },
      update: { ...data, updated_by: user.userId },
      create: { fellowship_id: fellowshipId, ...data, updated_by: user.userId },
    });
    await this.audit(user, 'finance.settings_update', 'finance_settings', saved.id, { fields: Object.keys(data) });
    return this.getSettings(user);
  }

  private async audit(user: any, action: string, entityType: string, entityId: string, newValue?: any) {
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action, entity_type: entityType, entity_id: entityId, fellowship_id: user.fellowshipId ?? null, new_value: newValue } });
  }
}
