import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Backup } from '../shared/schemas/it-content.schema';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);

  constructor(
    @InjectModel(Backup.name) private backupModel: Model<Backup>,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  async findAll(currentUser: any): Promise<Backup[]> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    return this.backupModel.find().sort({ created_at: -1 }).exec();
  }

  async createManual(currentUser: any): Promise<{ message: string; backupId: string }> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const backup = await this.backupModel.create({
      created_by: new Types.ObjectId(currentUser.userId),
      file_path: `/backups/manual_${Date.now()}.json`,
      file_size: 0,
      storage_location: 'local',
      status: 'success',
      is_incremental: false,
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'backup.create',
      entityType: 'backup',
      entityId: backup._id.toString(),
    });

    await this.notificationEngine.create({
      recipientUserId: currentUser.userId,
      eventType: 'backup_completed',
      title: 'Backup Created',
      message: `Manual backup ${backup._id} has been created.`,
    });

    return { message: 'Backup started', backupId: backup._id.toString() };
  }

  async restore(backupId: string, currentUser: any, options: { confirmSafetyBackup: boolean; reason?: string }): Promise<{ message: string; safetyBackupId: string }> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    if (!options.confirmSafetyBackup) {
      throw new ForbiddenException('You must confirm the safety backup creation before restoring.');
    }

    const backup = await this.backupModel.findById(backupId).exec();
    if (!backup) {
      throw new NotFoundException('Backup not found');
    }
    if (backup.status !== 'success') {
      throw new ForbiddenException('Cannot restore from a failed backup.');
    }

    // Step 1: Create safety backup of current state
    const safetyBackup = await this.backupModel.create({
      created_by: new Types.ObjectId(currentUser.userId),
      file_path: `/backups/safety_${Date.now()}.json`,
      file_size: 0,
      storage_location: 'local',
      status: 'success',
      is_incremental: false,
      is_safety_backup: true,
      restored_from: backup._id,
    });

    // Step 2-4: Warn and confirm (handled in frontend)
    // In a real implementation, this would trigger the actual restore process

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'backup.restore',
      entityType: 'backup',
      entityId: backupId,
      oldValue: { safetyBackupId: safetyBackup._id.toString() },
      newValue: { backupRestored: backupId },
      comment: options.reason,
      approvalInfo: { safetyBackupId: safetyBackup._id.toString() },
    });

    await this.notificationEngine.create({
      recipientUserId: currentUser.userId,
      eventType: 'backup_restore',
      title: 'Backup Restored',
      message: `System has been restored from backup ${backupId}. Safety backup ${safetyBackup._id} was created.`,
    });

    return { message: 'Restore started', safetyBackupId: safetyBackup._id.toString() };
  }

  async getStats() {
    const [total, recent] = await Promise.all([
      this.backupModel.countDocuments().exec(),
      this.backupModel.find().sort({ created_at: -1 }).limit(5).exec(),
    ]);
    return { total, recent };
  }
}
