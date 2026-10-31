import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../../shared/approval-engine/approval-engine.service';
import { isUuid } from '../../shared/utils/uuid.util';
import { assertPeriodOpen, validateAmount, validateDate, validateOptionalUuid, validateRequiredUuid, validateText } from '../finance.validation';
import { postTransferEntries } from './accounting-effects';
import { D, getSettings, money, nextNumber, postEntry } from './ledger';
import { generalFundPosition } from './project-finance';
import { FinanceScopeService } from './finance-scope.service';
import { FinanceNotifyService } from './finance-notify.service';

const ACCOUNT_TYPES = ['cash', 'bank', 'mobile_money', 'other'];

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

  // ===================== accounts =====================

  private shape(a: any) {
    return { ...a, opening_balance: money(a.opening_balance), balance: money(a.balance), scope: a.department_id ? 'department' : 'central' };
  }

  async list(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const where: any = { fellowship_id: fellowshipId, ...(await this.scope.listScope(user, q?.departmentId)) };
    if (q?.includeInactive !== 'true') where.is_active = true;
    const rows = await this.prisma.financialAccount.findMany({ where, orderBy: [{ department_id: 'asc' }, { name: 'asc' }], include: { department: { select: { id: true, name: true } } } });
    return rows.map((a) => this.shape(a));
  }

  async load(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Account not found');
    const a = await this.prisma.financialAccount.findFirst({ where: { id, fellowship_id: fellowshipId }, include: { department: { select: { id: true, name: true } } } });
    if (!a) throw new NotFoundException('Account not found');
    await this.scope.requireView(user, a.department_id);
    return a;
  }

  async get(user: any, id: string) {
    const a = await this.load(user, id);
    const last = await this.prisma.accountReconciliation.findFirst({ where: { account_id: id }, orderBy: { statement_date: 'desc' } });
    return { ...this.shape(a), lastReconciliation: last ? { ...last, statement_balance: money(last.statement_balance), system_balance: money(last.system_balance), difference: money(last.difference) } : null };
  }

  async create(user: any, body: any) {
    const departmentId = validateOptionalUuid('departmentId', body?.departmentId);
    await this.scope.requireManage(user, departmentId, departmentId ? { office: 'department_chairperson' } : {});
    const fellowshipId = this.scope.fellowship(user);
    const name = validateText('name', body?.name, 100, true) as string;
    const type = validateText('accountType', body?.accountType, 20, true) as string;
    if (!ACCOUNT_TYPES.includes(type)) throw new BadRequestException(`accountType must be one of: ${ACCOUNT_TYPES.join(', ')}`);
    const reference = validateText('reference', body?.reference, 100);
    const description = validateText('description', body?.description, 300);
    const opening = body?.openingBalance === undefined || body.openingBalance === '' || Number(body.openingBalance) === 0 ? null : validateAmount('openingBalance', body.openingBalance);
    const openingDate = (validateDate('openingDate', body?.openingDate, { required: false }) ?? new Date()) as Date;
    const settings = await getSettings(this.prisma as any, fellowshipId);
    const dup = await this.prisma.financialAccount.findFirst({ where: { fellowship_id: fellowshipId, department_id: departmentId, name: { equals: name, mode: 'insensitive' } } });
    if (dup) throw new ConflictException('An account with this name already exists.');
    if (opening) await assertPeriodOpen(this.prisma, fellowshipId, openingDate);
    const account = await this.prisma.$transaction(async (tx) => {
      const a = await tx.financialAccount.create({
        data: {
          fellowship_id: fellowshipId, department_id: departmentId, name, account_type: type as any, reference, description,
          currency: settings.currency, opening_balance: opening ?? '0', created_by: user.userId,
        },
      });
      if (opening) {
        await postEntry(tx, {
          fellowshipId, accountId: a.id, amount: opening, entryType: 'opening_balance', sourceType: 'account', sourceId: a.id,
          date: openingDate, userId: user.userId, departmentId, description: 'Opening balance', primary: true,
        });
      }
      return a;
    });
    await this.audit(user, 'finance.account_create', 'financial_account', account.id, { name, type, departmentId, openingBalance: opening });
    return this.get(user, account.id);
  }

  /** Name, reference, description and active status only: balances are never edited directly. */
  async update(user: any, id: string, body: any) {
    const a = await this.load(user, id);
    await this.scope.requireManage(user, a.department_id, a.department_id ? { office: 'department_chairperson' } : {});
    if (body?.balance !== undefined || body?.openingBalance !== undefined) {
      throw new BadRequestException('Balances cannot be edited. Record a transaction, or reconcile the account and post an adjustment.');
    }
    const data: any = {};
    if (body?.name !== undefined) data.name = validateText('name', body.name, 100, true);
    if (body?.reference !== undefined) data.reference = validateText('reference', body.reference, 100);
    if (body?.description !== undefined) data.description = validateText('description', body.description, 300);
    if (body?.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') throw new BadRequestException('isActive must be true or false');
      if (!body.isActive && !D(a.balance).isZero()) throw new ConflictException('Move the balance to another account before deactivating this one.');
      data.is_active = body.isActive;
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    await this.prisma.financialAccount.update({ where: { id }, data });
    await this.audit(user, 'finance.account_update', 'financial_account', id, { fields: Object.keys(data) });
    return this.get(user, id);
  }

  async entries(user: any, id: string, q: any) {
    await this.load(user, id);
    const { take, skip, page, limit } = parsePage(q);
    const where: any = { account_id: id };
    const r = range(q);
    if (r) where.entry_date = r;
    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }], take, skip }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return { data: rows.map((e) => ({ ...e, amount: money(e.amount), balance_after: money(e.balance_after) })), total, page, limit };
  }

  /** The ledger across the accounts this user may see. */
  async ledger(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const { take, skip, page, limit } = parsePage(q);
    const where: any = { fellowship_id: fellowshipId, ...(await this.scope.listScope(user, q?.departmentId)) };
    if (q?.accountId) where.account_id = validateRequiredUuid('accountId', q.accountId);
    if (q?.projectId) where.project_id = validateRequiredUuid('projectId', q.projectId);
    if (q?.type) where.entry_type = validateText('type', q.type, 30);
    const r = range(q);
    if (r) where.entry_date = r;
    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }], take, skip, include: { account: { select: { id: true, name: true } } } }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return { data: rows.map((e) => ({ ...e, amount: money(e.amount), balance_after: money(e.balance_after) })), total, page, limit };
  }

  /**
   * Compares the account with a bank/cash statement. A difference can be corrected with an adjustment entry, which
   * needs a reason and is audited; the original entries are never changed.
   */
  async reconcile(user: any, id: string, body: any) {
    const a = await this.load(user, id);
    await this.scope.requireManage(user, a.department_id, a.department_id ? { office: 'department_chairperson' } : {});
    const statementDate = validateDate('statementDate', body?.statementDate) as Date;
    const statementBalance = D(validateAmount('statementBalance', body?.statementBalance, { allowZero: true }));
    const notes = validateText('notes', body?.notes, 500);
    const post = body?.postAdjustment === true;
    const result = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.financialAccount.findUniqueOrThrow({ where: { id } });
      const difference = statementBalance.minus(fresh.balance);
      let adjustmentId: string | null = null;
      if (post && !difference.isZero()) {
        const reason = validateText('reason', body?.reason, 300, true) as string;
        await assertPeriodOpen(tx as any, a.fellowship_id, statementDate);
        const rec = await tx.accountReconciliation.create({ data: { fellowship_id: a.fellowship_id, account_id: id, statement_date: statementDate, statement_balance: statementBalance.toFixed(2), system_balance: fresh.balance, difference: difference.toFixed(2), notes, reconciled_by: user.userId } });
        const entry = await postEntry(tx, {
          fellowshipId: a.fellowship_id, accountId: id, amount: difference, entryType: 'adjustment', sourceType: 'reconciliation', sourceId: rec.id,
          date: statementDate, userId: user.userId, departmentId: a.department_id, description: `Reconciliation adjustment: ${reason}`, primary: true, allowOverdraw: true,
        });
        adjustmentId = entry.id;
        await tx.accountReconciliation.update({ where: { id: rec.id }, data: { adjustment_entry_id: entry.id } });
        await tx.financialAccount.update({ where: { id }, data: { last_reconciled_at: new Date() } });
        return { ...rec, adjustment_entry_id: adjustmentId };
      }
      const rec = await tx.accountReconciliation.create({ data: { fellowship_id: a.fellowship_id, account_id: id, statement_date: statementDate, statement_balance: statementBalance.toFixed(2), system_balance: fresh.balance, difference: difference.toFixed(2), notes, reconciled_by: user.userId } });
      if (difference.isZero()) await tx.financialAccount.update({ where: { id }, data: { last_reconciled_at: new Date() } });
      return rec;
    });
    await this.audit(user, 'finance.account_reconcile', 'financial_account', id, { statementBalance: statementBalance.toFixed(2), difference: money(result.difference), adjusted: !!result.adjustment_entry_id });
    return { ...result, statement_balance: money(result.statement_balance), system_balance: money(result.system_balance), difference: money(result.difference) };
  }

  async reconciliations(user: any, id: string) {
    await this.load(user, id);
    const rows = await this.prisma.accountReconciliation.findMany({ where: { account_id: id }, orderBy: { statement_date: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...r, statement_balance: money(r.statement_balance), system_balance: money(r.system_balance), difference: money(r.difference) }));
  }

  // ===================== transfers =====================

  /**
   * Within one scope (two central accounts, or two accounts of the same department) a transfer is immediate.
   * Between central and department funds it is an allocation that needs the Fellowship Secretary and Chairperson;
   * only the Treasurer may start it. Department-to-department transfers are refused.
   */
  async createTransfer(user: any, body: any) {
    const fellowshipId = this.scope.fellowship(user);
    const fromId = validateRequiredUuid('fromAccountId', body?.fromAccountId);
    const toId = validateRequiredUuid('toAccountId', body?.toAccountId);
    if (fromId === toId) throw new BadRequestException('Choose two different accounts.');
    const amount = D(validateAmount('amount', body?.amount));
    const date = validateDate('date', body?.date) as Date;
    const reference = validateText('reference', body?.reference, 100);
    const description = validateText('description', body?.description, 300);
    const [from, to] = await Promise.all([
      this.prisma.financialAccount.findFirst({ where: { id: fromId, fellowship_id: fellowshipId, is_active: true } }),
      this.prisma.financialAccount.findFirst({ where: { id: toId, fellowship_id: fellowshipId, is_active: true } }),
    ]);
    if (!from || !to) throw new BadRequestException('Both accounts must be active accounts of this fellowship.');
    const sameScope = (from.department_id ?? null) === (to.department_id ?? null);
    if (!sameScope && from.department_id && to.department_id) {
      throw new ForbiddenException('Money cannot be moved directly between two departments.');
    }
    if (sameScope) await this.scope.requireManage(user, from.department_id);
    else await this.scope.requireManage(user, null); // central <-> department: the Treasurer starts it
    await assertPeriodOpen(this.prisma, fellowshipId, date);
    if (D(from.balance).lessThan(amount)) throw new ConflictException(`Insufficient funds: "${from.name}" holds ${money(from.balance)}.`);

    const { transfer, approval } = await this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, fellowshipId, 'transfer', 'TRF', date);
      const t = await tx.financialTransfer.create({
        data: {
          fellowship_id: fellowshipId, transfer_number: number, from_account_id: fromId, to_account_id: toId, amount: amount.toFixed(2),
          transfer_date: date, reference, description, recorded_by: user.userId, requires_approval: !sameScope,
          status: sameScope ? 'COMPLETED' : 'PENDING', completed_at: sameScope ? new Date() : null,
        },
      });
      if (sameScope) {
        await postTransferEntries(tx, { ...t, fromAccount: from, toAccount: to }, user.userId);
        return { transfer: t, approval: null };
      }
      const wf = await this.engine.createWorkflow('fund_transfer', t.id, 'transfer', user.userId, { departmentId: null, amount: amount.toFixed(2) }, fellowshipId, tx);
      await tx.financialTransfer.update({ where: { id: t.id }, data: { approval_workflow_id: wf.id } });
      const submitted = await this.engine.submit(wf.id, tx, user.userId);
      return { transfer: t, approval: submitted };
    });
    await this.audit(user, 'finance.transfer_create', 'transfer', transfer.id, { amount: amount.toFixed(2), from: fromId, to: toId, requiresApproval: !sameScope });
    if (approval) await this.notify.stage(approval, 'fund transfer', 'transfer', transfer.id, user.userId);
    return this.getTransfer(user, transfer.id);
  }

  async listTransfers(user: any, q: any) {
    const fellowshipId = this.scope.fellowship(user);
    const { take, skip, page, limit } = parsePage(q);
    const where: any = { fellowship_id: fellowshipId };
    if (!this.scope.isCentralViewer(user)) {
      const led = Array.from((await this.scope.leaderships(user)).keys());
      if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
      where.OR = [{ fromAccount: { department_id: { in: led } } }, { toAccount: { department_id: { in: led } } }];
    } else if (q?.departmentId && isUuid(q.departmentId)) {
      where.OR = [{ fromAccount: { department_id: q.departmentId } }, { toAccount: { department_id: q.departmentId } }];
    }
    if (q?.status) where.status = validateText('status', q.status, 20);
    const r = range(q);
    if (r) where.transfer_date = r;
    const [rows, total] = await Promise.all([
      this.prisma.financialTransfer.findMany({ where, orderBy: { transfer_date: 'desc' }, take, skip, include: { fromAccount: { select: { id: true, name: true, department_id: true } }, toAccount: { select: { id: true, name: true, department_id: true } } } }),
      this.prisma.financialTransfer.count({ where }),
    ]);
    return { data: rows.map((t) => ({ ...t, amount: money(t.amount) })), total, page, limit };
  }

  async getTransfer(user: any, id: string) {
    const fellowshipId = this.scope.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Transfer not found');
    const t = await this.prisma.financialTransfer.findFirst({ where: { id, fellowship_id: fellowshipId }, include: { fromAccount: { select: { id: true, name: true, department_id: true } }, toAccount: { select: { id: true, name: true, department_id: true } } } });
    if (!t) throw new NotFoundException('Transfer not found');
    if (!this.scope.isCentralViewer(user)) {
      const led = await this.scope.leaderships(user);
      if (!led.has(t.fromAccount.department_id ?? '') && !led.has(t.toAccount.department_id ?? '')) throw new ForbiddenException('You do not have access to this transfer.');
    }
    const history = t.approval_workflow_id ? await this.engine.history(t.approval_workflow_id) : [];
    return { ...t, amount: money(t.amount), history };
  }

  async cancelTransfer(user: any, id: string) {
    const t = await this.getTransfer(user, id);
    if (t.status !== 'PENDING' && t.status !== 'RETURNED') throw new ConflictException('Only a pending transfer can be cancelled.');
    if (t.recorded_by !== user.userId) throw new ForbiddenException('Only the person who started the transfer can cancel it.');
    if (t.approval_workflow_id) await this.engine.cancel(t.approval_workflow_id, user.userId);
    await this.prisma.financialTransfer.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit(user, 'finance.transfer_cancel', 'transfer', id);
    return this.getTransfer(user, id);
  }

  // ===================== General Fund =====================

  async generalFund(user: any, q: any) {
    await this.scope.requireView(user, null);
    const fellowshipId = this.scope.fellowship(user);
    const r = range(q) ?? { gte: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)) };
    const central = { fellowship_id: fellowshipId, department_id: null, entry_date: r };
    const [position, byType, accounts, allocations] = await Promise.all([
      generalFundPosition(this.prisma, fellowshipId),
      this.prisma.ledgerEntry.groupBy({ by: ['entry_type'], where: central, _sum: { amount: true } }),
      this.prisma.financialAccount.findMany({ where: { fellowship_id: fellowshipId, department_id: null }, select: { id: true, name: true, account_type: true, balance: true, opening_balance: true, is_active: true } }),
      this.prisma.projectAllocation.aggregate({ where: { fellowship_id: fellowshipId, status: 'APPROVED', kind: 'general_fund_allocation', approved_at: r }, _sum: { amount: true } }),
    ]);
    const sum = (t: string) => money(byType.find((b) => b.entry_type === t)?._sum.amount);
    return {
      ...position,
      period: r,
      openingBalances: sum('opening_balance'),
      contributionsReceived: sum('contribution'),
      otherIncome: sum('income'),
      expensesPaid: money(D(sum('expense')).abs()),
      transfersIn: sum('transfer_in'),
      transfersOut: money(D(sum('transfer_out')).abs()),
      reversals: sum('reversal'),
      adjustments: sum('adjustment'),
      allocatedToProjects: money(allocations._sum.amount),
      accounts: accounts.map((a) => ({ ...a, balance: money(a.balance), opening_balance: money(a.opening_balance) })),
    };
  }

  private async audit(user: any, action: string, entityType: string, entityId: string, newValue?: any) {
    await this.prisma.auditLog.create({ data: { user_id: user.userId, action, entity_type: entityType, entity_id: entityId, fellowship_id: user.fellowshipId ?? null, new_value: newValue } });
  }
}
