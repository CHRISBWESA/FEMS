import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DeletedRecord, AuditLog } from '../shared/schemas/system.schema';
import { AuditService } from '../shared/audit/audit.service';

@Injectable()
export class RecycleBinService {
  constructor(
    @InjectModel(DeletedRecord.name) private deletedRecordModel: Model<DeletedRecord>,
    private auditService: AuditService,
  ) {}

  async findAll(currentUser: any): Promise<DeletedRecord[]> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Admin/Secretary see all deleted records (30-day window)
    // Assistant Secretary also sees all (can restore)
    return this.deletedRecordModel
      .find({ deleted_at: { $gte: thirtyDaysAgo } })
      .sort({ deleted_at: -1 })
      .exec();
  }

  async restore(id: string, currentUser: any): Promise<{ message: string }> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const record = await this.deletedRecordModel.findById(id).exec();
    if (!record) {
      throw new NotFoundException('Deleted record not found');
    }

    // Check if still within 30-day retention
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    if (record.deleted_at < thirtyDaysAgo) {
      throw new BadRequestException('Record has expired from the recycle bin and can no longer be restored.');
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'recycle.restore',
      entityType: record.original_collection,
      entityId: record.original_record_id.toString(),
      oldValue: { deleted: true, inRecycleBin: true },
      newValue: { restored: true },
      comment: `Restored from recycle bin by ${currentUser.firstName} ${currentUser.lastName}`,
    });

    await record.deleteOne();

    // Notify
    const AuditLogModel = this.deletedRecordModel.db.model('AuditLog');
    const deleteLogs = await AuditLogModel.find({
      entity_id: record.original_record_id,
      entity_type: record.original_collection,
    }).sort({ timestamp: -1 }).limit(1).exec();
    if (deleteLogs.length > 0) {
      const deleteLog = deleteLogs[0];
      if (deleteLog.new_value && typeof deleteLog.new_value === 'object' && 'deleted_by' in deleteLog.new_value) {
        await this.createNotification(record.original_record_id.toString(), record.original_collection, currentUser.userId);
      }
    }

    return { message: 'Record restored successfully' };
  }

  private async createNotification(entityId: string, entityType: string, userId: string): Promise<void> {
    const { NotificationEngineService } = await import('../shared/notifications/notification-engine.service');
  }

  async permanentDelete(id: string, currentUser: any): Promise<{ message: string }> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const record = await this.deletedRecordModel.findById(id).exec();
    if (!record) {
      throw new NotFoundException('Deleted record not found');
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'recycle.permanent_delete',
      entityType: 'recycle_bin',
      entityId: id,
      comment: `Permanently deleted record from ${record.original_collection}.${record.original_record_id}`,
    });

    await record.deleteOne();

    return { message: 'Record permanently deleted' };
  }

  async softDelete(
    entityType: string,
    entityId: string,
    deletedBy: string,
    originalData: Record<string, unknown>,
    reason?: string,
  ): Promise<void> {
    const restoreToken = require('crypto').randomBytes(24).toString('hex');

    await this.deletedRecordModel.create({
      original_collection: entityType,
      original_record_id: new Types.ObjectId(entityId),
      original_data: originalData,
      deleted_by: new Types.ObjectId(deletedBy),
      deleted_at: new Date(),
      restore_token: restoreToken,
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
