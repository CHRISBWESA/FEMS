import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { FinanceAccessService } from './finance-access.service';
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
  ) {}

  async list(user: any, q: Record<string, string | undefined> = {}): Promise<{ data: any[]; total: number }> {
    if (!this.access.isFinanceViewer(user)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    const { take, skip } = this.access.parsePaging(q.limit, q.page);
    const extra: Record<string, any> = {};
    if (q.categoryId) extra.category_id = validateRequiredUuid('categoryId', q.categoryId);
    if (q.campaignId) extra.campaign_id = validateRequiredUuid('campaignId', q.campaignId);
    if (q.departmentId) extra.department_id = validateRequiredUuid('departmentId', q.departmentId);
    const from = validateDate('from', q.from, { required: false, maxFutureDays: 3650 });
    const to = validateDate('to', q.to, { required: false, maxFutureDays: 3650 });
    if (from || to) extra.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const where = this.tenantScope.scopeWhere(user, extra, q.fellowshipId) as Prisma.IncomeRecordWhereInput;
    const [data, total] = await Promise.all([
      this.prisma.incomeRecord.findMany({
        where, orderBy: [{ date: 'desc' }, { created_at: 'desc' }], take, skip,
        include: { category: { select: { id: true, name: true } }, campaign: { select: { id: true, name: true } } },
      }),
      this.prisma.incomeRecord.count({ where }),
    ]);
    return { data, total };
  }

  async create(dto: CreateIncomeDto, user: any): Promise<any> {
    this.access.requirePermission(user, PERMISSIONS.FINANCE_INCOME_RECORD);
    const fellowshipId = this.access.resolveFellowship(user, dto?.fellowshipId);

    const title = validateText('title', dto?.title, 200, true) as string;
    const description = validateText('description', dto?.description, 1000);
    const amount = validateAmount('amount', dto?.amount);
    const date = validateDate('date', dto?.date) as Date;
    const source = validateText('source', dto?.source, 200);
    const categoryId = validateOptionalUuid('categoryId', dto?.categoryId);
    const campaignId = validateOptionalUuid('campaignId', dto?.campaignId);
    const departmentId = validateOptionalUuid('departmentId', dto?.departmentId);
    const receiptId = validateOptionalUuid('receiptDocumentId', dto?.receiptDocumentId);

    if (categoryId) await this.access.assertCategory(categoryId, 'income', fellowshipId);
    if (campaignId) await this.access.assertCampaign(campaignId, fellowshipId);
    if (departmentId) await this.access.assertDepartment(departmentId, fellowshipId);
    if (receiptId) await this.access.assertReceipt(receiptId, fellowshipId);
    await assertPeriodOpen(this.prisma, fellowshipId, date);

    const record = await this.prisma.incomeRecord.create({
      data: {
        title, description, amount, date, source,
        category_id: categoryId, campaign_id: campaignId, department_id: departmentId,
        receipt_document_id: receiptId, recorded_by: user.userId, fellowship_id: fellowshipId,
      },
    });
    await this.auditService.log({
      userId: user.userId,
      action: 'finance.income_create',
      entityType: 'income',
      entityId: record.id,
      newValue: { amount, title, date: date.toISOString() },
    });
    return record;
  }
}
