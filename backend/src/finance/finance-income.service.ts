import { Injectable, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { FinanceAccessService } from './finance-access.service';
import { FinanceScopeService } from './accounting/finance-scope.service';
import { assertProjectForScope } from './accounting/contributions-core.service';
import { assertAccountScope, defaultAccount, getSettings, nextNumber, postEntry } from './accounting/ledger';
import {
  assertPeriodOpen,
  validateAmount,
  validateDate,
  validateOptionalUuid,
  validateRequiredUuid,
  validateText,
} from './finance.validation';

export interface CreateIncomeDto {
  title: string;
  description?: string;
  amount: number;
  date: string;
  source?: string;
  categoryId?: string;
  campaignId?: string;
  departmentId?: string;
  receiptDocumentId?: string;
  fellowshipId?: string;
}

// Income that is NOT a member contribution (grants, fundraising proceeds, donations from outside the
// membership). Member giving stays in the existing contributions table.
@Injectable()
export class FinanceIncomeService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
    private access: FinanceAccessService,
    private scope: FinanceScopeService,
  ) {}

  async list(user: any, q: Record<string, string | undefined> = {}): Promise<{ data: any[]; total: number }> {
    if (!this.access.isFinanceViewer(user) && !(await this.scope.leaderships(user)).size) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = !this.access.isFinanceViewer(user) || q.departmentId ? await this.scope.listScope(user, q.departmentId) : {};
    if (q.projectId) extra.project_id = validateRequiredUuid('projectId', q.projectId);
    if (q.status === 'reversed' || q.status === 'active') extra.status = q.status;
    if (q.categoryId) extra.category_id = validateRequiredUuid('categoryId', q.categoryId);
    if (q.campaignId) extra.campaign_id = validateRequiredUuid('campaignId', q.campaignId);
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 3650 });
    if (from || to) extra.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.IncomeRecordWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.incomeRecord.findMany({
        where, orderBy: [{ date: 'desc' }, { created_at: 'desc' }], take, skip,
        include: { category: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } }, account: { select: { id: true, name: true } } },
      }),
      this.prisma.incomeRecord.count({ where }),
    ]);
    return { data, total };
  }

  /**
   * Income that is not a contribution: grants, sponsorships, organisational donations. One receipt is one record
   * with one classification, so the same money is never both a contribution and income. Transfers are never income.
   * `scope: 'department'` records a department's own income (by its leaders); otherwise it is central.
   */
  async create(dto: CreateIncomeDto & Record<string, any>, user: any): Promise<any> {
    const ownFunds = dto?.scope === 'department';
    const departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    if (ownFunds) {
      if (!departmentId) throw new BadRequestException('Choose the department that received this income.');
      await this.scope.requireManage(user, departmentId);
    } else {
      this.access.requirePermission(user, PERMISSIONS.FINANCE_INCOME_RECORD);
    }
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);
    if (!fellowshipId) throw new ForbiddenException('Income is recorded inside a fellowship.');
    const fund = ownFunds ? departmentId : null;

    const title = validateText('title', dto?.title, 200, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const amount = validateAmount('amount', dto?.amount);
    const date = validateDate('date', dto?.date) as Date;
    const source = validateText('source', dto?.source, 200);
    const fundingSource = validateText('fundingSource', dto?.fundingSource, 100);
    const categoryId = validateOptionalUuid('categoryId', dto?.categoryId);
    const campaignId = validateOptionalUuid('campaignId', dto?.campaignId);
    const projectId = validateOptionalUuid('projectId', dto?.projectId);
    const accountId = validateOptionalUuid('accountId', dto?.accountId);
    const receiptId = validateOptionalUuid('receiptDocumentId', dto?.receiptDocumentId);
    const reference = validateText('paymentReference', dto?.paymentReference, 100);
    const settings = await getSettings(this.prisma as any, fellowshipId);
    const method = (validateText('paymentMethod', dto?.paymentMethod, 30) ?? 'bank_transfer') as string;
    if (!settings.payment_methods.includes(method)) throw new BadRequestException(`paymentMethod must be one of: ${settings.payment_methods.join(', ')}`);

    if (categoryId) await this.access.assertCategory(categoryId, 'income', fellowshipId);
    if (campaignId) await this.access.assertCampaign(campaignId, fellowshipId);
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);
    if (projectId) await assertProjectForScope(this.prisma, projectId, fellowshipId, fund);
    if (receiptId) await this.access.assertReceipt(receiptId, fellowshipId);
    if (reference) {
      const dup = await this.prisma.incomeRecord.findFirst({ where: { fellowship_id: fellowshipId, payment_method: method, payment_reference: { equals: reference, mode: 'insensitive' }, status: 'active' }, select: { id: true } });
      if (dup) throw new ConflictException('Income with this payment reference has already been recorded.');
    }
    await assertPeriodOpen(this.prisma, fellowshipId, date);

    const record = await this.prisma.$transaction(async (tx) => {
      const account = accountId ? await assertAccountScope(tx, accountId, fellowshipId, fund) : await defaultAccount(tx, fellowshipId, fund, user.userId);
      const receipt = await nextNumber(tx, fellowshipId, 'income', 'INC', date);
      const r = await tx.incomeRecord.create({
        data: {
          title, description, amount, date, source, funding_source: fundingSource,
          category_id: categoryId, campaign_id: campaignId, department_id: departmentId, project_id: projectId,
          account_id: account.id, payment_method: method, payment_reference: reference, receipt_number: receipt,
          receipt_document_id: receiptId, recorded_by: user.userId, fellowship_id: fellowshipId,
        },
      });
      await postEntry(tx, {
        fellowshipId, accountId: account.id, amount, entryType: 'income', sourceType: 'income', sourceId: r.id, date,
        userId: user.userId, departmentId: fund, projectId, reference: receipt, description: title, primary: true,
      });
      return r;
    });
    await this.auditService.log({
      userId: user.userId,
      action: 'finance.income_create',
      entityType: 'income',
      entityId: record.id,
      newValue: { amount, title, date: date.toISOString(), departmentId: fund, projectId },
    });
    return record;
  }
}
