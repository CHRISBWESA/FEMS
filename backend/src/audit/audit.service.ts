import { Injectable, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog } from '../shared/schemas/system.schema';
import { PERMISSIONS } from '../shared/authorization/permissions';

export interface AuditFilters {
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditQueryService {
  private readonly logger = new Logger(AuditQueryService.name);

  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLog>,
  ) {}

  async findAll(filters: AuditFilters, currentUser: any): Promise<{ data: AuditLog[]; total: number }> {
    const roles: string[] = currentUser.roles || [];
    const canViewAudit = roles.includes('admin') || roles.includes('secretary') || roles.includes('chairperson');

    if (!canViewAudit) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));
    const skip = (page - 1) * limit;

    const query: Record<string, any> = {};
    if (filters.userId) query.user_id = new Types.ObjectId(filters.userId);
    if (filters.action) query.action = { $regex: filters.action, $options: 'i' };
    if (filters.entityType) query.entity_type = filters.entityType;
    if (filters.entityId) query.entity_id = new Types.ObjectId(filters.entityId);

    if (filters.from || filters.to) {
      query.timestamp = {};
      if (filters.from) query.timestamp.$gte = new Date(filters.from);
      if (filters.to) query.timestamp.$lte = new Date(filters.to);
    }

    const [data, total] = await Promise.all([
      this.auditLogModel.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit).exec(),
      this.auditLogModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async getImpersonationLogs(sessionId: string, currentUser: any): Promise<AuditLog[]> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('chairperson')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return this.auditLogModel
      .find({ impersonation_session_id: new Types.ObjectId(sessionId) })
      .sort({ timestamp: -1 })
      .exec();
  }

  async getStats(currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('admin') && !roles.includes('secretary') && !roles.includes('chairperson')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const [totalEntries, recentActions] = await Promise.all([
      this.auditLogModel.countDocuments().exec(),
      this.auditLogModel.find().sort({ timestamp: -1 }).limit(20).exec(),
    ]);

    return { totalEntries, recentActions };
  }
}
