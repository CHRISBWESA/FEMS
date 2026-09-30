import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLog, Prisma } from '@prisma/client';
import { redactAuditPayload } from './redact';
import { currentRequestContext } from '../middleware/request-context.store';

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
  /** The tenant the entry belongs to. Derived from the acting user when omitted; pass null for platform-level entries. */
  fellowshipId?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      let fellowshipId = entry.fellowshipId;
      if (fellowshipId === undefined && entry.userId) {
        const actor = await this.prisma.user.findUnique({ where: { id: entry.userId }, select: { fellowship_id: true } });
        fellowshipId = actor?.fellowship_id ?? null;
      }
      // Sign-in, password and account-locking entries are the ones an incident review needs to attribute, and they
      // are written from services that never see the request. Fall back to the ambient request context.
      const request = currentRequestContext();
      const ipAddress = entry.ipAddress ?? request?.ip;
      const deviceInfo = entry.deviceInfo ?? request?.userAgent;
      await this.prisma.auditLog.create({
        data: {
          fellowship_id: fellowshipId ?? null,
          user_id: entry.userId,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          timestamp: new Date(),
          old_value: redactAuditPayload(entry.oldValue) as Prisma.InputJsonValue,
          new_value: redactAuditPayload(entry.newValue) as Prisma.InputJsonValue,
          ip_address: ipAddress,
          device_info: deviceInfo,
          approval_info: redactAuditPayload(entry.approvalInfo) as Prisma.InputJsonValue,
          comment: entry.comment,
          impersonation_session_id: entry.impersonationSessionId,
        },
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
      this.logger.error(`Failed to write audit log for action=${entry.action} code=${code}`);
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

    const where: Prisma.AuditLogWhereInput = {};

    if (filters.userId) where.user_id = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entity_type = filters.entityType;
    if (filters.entityId) where.entity_id = filters.entityId;
    if (filters.impersonationSessionId)
      where.impersonation_session_id = filters.impersonationSessionId;

    if (filters.from || filters.to) {
      where.timestamp = {};
      if (filters.from) where.timestamp.gte = filters.from;
      if (filters.to) where.timestamp.lte = filters.to;
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total };
  }

  async getImpersonationLogs(sessionId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { impersonation_session_id: sessionId },
      orderBy: { timestamp: 'desc' },
    });
  }
}
