import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { isUuid } from '../shared/utils/uuid.util';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';

@Injectable()
export class RecycleBinService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // Only members of the fellowship a record belonged to can see or act on it. Records with no fellowship (created
  // before the column existed and not attributable) are not reachable through the API at all.
  private assertStaff(currentUser: any, allowed: string[]): void {
    const roles: string[] = currentUser.roles || [];
    if (!allowed.some((r) => roles.includes(r))) throw new ForbiddenException('You do not have permission to perform this action.');
    if (!currentUser.fellowshipId) throw new ForbiddenException('You do not have permission to perform this action.');
  }

  private async load(id: string, currentUser: any) {
    if (!isUuid(id)) throw new NotFoundException('Deleted record not found');
    const record = await this.prisma.deletedRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Deleted record not found');
    if (!record.fellowship_id || record.fellowship_id !== currentUser.fellowshipId) {
      throw new ForbiddenException('You do not have access to this record');
    }
    return record;
  }

  async findAll(currentUser: any): Promise<any[]> {
    this.assertStaff(currentUser, ['secretary', 'assistant_secretary']);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return this.prisma.deletedRecord.findMany({
      where: { fellowship_id: currentUser.fellowshipId, deleted_at: { gte: thirtyDaysAgo } },
      orderBy: { deleted_at: 'desc' },
      take: 500,
      omit: { original_data: true, restore_token: true },
    });
  }

  // Restoring is NOT implemented: the previous code only logged "restored" and deleted the recycle-bin copy, i.e.
  // it destroyed the only backup of the record while telling the user it had been recovered. Until records can
  // really be re-created (per-collection field mapping, period-lock and approval re-checks) this refuses and the
  // copy stays in the bin.
  async restore(id: string, currentUser: any): Promise<{ message: string }> {
    this.assertStaff(currentUser, ['secretary', 'assistant_secretary']);
    await this.load(id, currentUser);
    throw new ConflictException({
      code: 'OPERATION_UNAVAILABLE',
      message: 'Restoring deleted records is not available yet. The record has been kept in the recycle bin.',
    });
  }

  async permanentDelete(id: string, currentUser: any): Promise<{ message: string }> {
    this.assertStaff(currentUser, ['secretary']);
    const record = await this.load(id, currentUser);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'recycle.permanent_delete',
      entityType: 'recycle_bin',
      entityId: id,
      comment: `Permanently deleted record from ${record.original_collection}`,
    });

    await this.prisma.deletedRecord.delete({ where: { id } });

    return { message: 'Record permanently deleted' };
  }

  async softDelete(
    entityType: string,
    entityId: string,
    deletedBy: string,
    originalData: Record<string, unknown>,
    reason?: string,
    fellowshipId?: string | null,
  ): Promise<void> {
    const restoreToken = require('crypto').randomBytes(24).toString('hex');

    await this.prisma.deletedRecord.create({
      data: {
        original_collection: entityType,
        original_record_id: entityId,
        original_data: originalData as any,
        fellowship_id: fellowshipId ?? ((originalData as any)?.fellowship_id ?? null),
        deleted_by: deletedBy,
        deleted_at: new Date(),
        restore_token: restoreToken,
      },
    });

    await this.auditService.log({
      userId: deletedBy,
      action: 'recycle.soft_delete',
      entityType,
      entityId,
      comment: reason,
    });
  }
}
