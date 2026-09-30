import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Notification } from '@prisma/client';

export interface NotificationPayload {
  recipientUserId: string;
  eventType: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  fellowshipId?: string | null;
}

@Injectable()
export class NotificationEngineService {
  private readonly logger = new Logger(NotificationEngineService.name);

  constructor(private prisma: PrismaService) {}

  async create(payload: NotificationPayload): Promise<Notification> {
    if (!payload.recipientUserId) {
      return null;
    }
    try {
      let fellowshipId = payload.fellowshipId;
      if (!fellowshipId) {
        const ref = await this.prisma.user.findUnique({
          where: { id: payload.actorUserId || payload.recipientUserId },
          select: { fellowship_id: true },
        });
        fellowshipId = ref?.fellowship_id ?? null;
      }
      return await this.prisma.notification.create({
        data: {
          recipient_user_id: payload.recipientUserId,
          event_type: payload.eventType,
          title: payload.title,
          message: payload.message,
          entity_type: payload.entityType,
          entity_id: payload.entityId,
          is_read: false,
          actor_user_id: payload.actorUserId,
          fellowship_id: fellowshipId,
          created_at: new Date(),
        },
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
      this.logger.error(`Failed to create notification event=${payload.eventType} code=${code}`);
      return null;
    }
  }

  async createForUsers(
    userIds: string[],
    payload: Omit<NotificationPayload, 'recipientUserId'>,
  ): Promise<void> {
    for (const userId of userIds) {
      await this.create({ ...payload, recipientUserId: userId });
    }
  }

  async list(userId: string, filters: { unreadOnly?: boolean; page?: number; limit?: number }) {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      recipient_user_id: userId,
    };
    if (filters.unreadOnly) {
      where.is_read = false;
    }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: { actor: { select: { first_name: true, last_name: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipient_user_id: userId, is_read: false },
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, recipient_user_id: userId },
      data: { is_read: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { recipient_user_id: userId, is_read: false },
      data: { is_read: true },
    });
  }
}
