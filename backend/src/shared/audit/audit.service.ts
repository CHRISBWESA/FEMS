import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AuditLog } from '../schemas/system.schema';
import { Model, Types } from 'mongoose';

export interface AuditLogEntry {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  deviceInfo?: string;
  approvalInfo?: Record<string, unknown>;
  comment?: string;
  impersonationSessionId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLog>,
  ) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.auditLogModel.create({
        user_id: entry.userId ? new Types.ObjectId(entry.userId) : undefined,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId ? new Types.ObjectId(entry.entityId) : undefined,
        timestamp: new Date(),
        old_value: entry.oldValue,
        new_value: entry.newValue,
        ip_address: entry.ipAddress,
        device_info: entry.deviceInfo,
        approval_info: entry.approvalInfo,
        comment: entry.comment,
        impersonation_session_id: entry.impersonationSessionId
          ? new Types.ObjectId(entry.impersonationSessionId)
          : undefined,
      });
    } catch (e) {
      this.logger.error(`Failed to write audit log for action: ${entry.action}`, e);
    }
  }

  async find(
    filters: Partial<AuditLogEntry> & {
      from?: Date;
      to?: Date;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: AuditLog[]; total: number }> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};

    if (filters.userId) query.user_id = new Types.ObjectId(filters.userId);
    if (filters.action) query.action = filters.action;
    if (filters.entityType) query.entity_type = filters.entityType;
    if (filters.entityId) query.entity_id = new Types.ObjectId(filters.entityId);
    if (filters.impersonationSessionId)
      query.impersonation_session_id = new Types.ObjectId(filters.impersonationSessionId);

    if (filters.from || filters.to) {
      query.timestamp = {};
      if (filters.from) (query.timestamp as Record<string, unknown>).$gte = filters.from;
      if (filters.to) (query.timestamp as Record<string, unknown>).$lte = filters.to;
    }

    const [data, total] = await Promise.all([
      this.auditLogModel
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.auditLogModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async getImpersonationLogs(sessionId: string): Promise<AuditLog[]> {
    return this.auditLogModel
      .find({ impersonation_session_id: new Types.ObjectId(sessionId) })
      .sort({ timestamp: -1 })
      .exec();
  }
}
