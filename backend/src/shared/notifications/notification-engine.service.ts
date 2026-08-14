import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Notification } from '../../shared/schemas/system.schema';
import { Model, Types } from 'mongoose';

export interface NotificationPayload {
  recipientUserId: string;
  eventType: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
}

@Injectable()
export class NotificationEngineService {
  private readonly logger = new Logger(NotificationEngineService.name);

  constructor(
    @InjectModel(Notification.name) private notificationModel: Model<Notification>,
  ) {}

  async create(payload: NotificationPayload): Promise<Notification> {
    try {
      return await this.notificationModel.create({
        recipient_user_id: new Types.ObjectId(payload.recipientUserId),
        event_type: payload.eventType,
        title: payload.title,
        message: payload.message,
        entity_type: payload.entityType,
        entity_id: payload.entityId ? new Types.ObjectId(payload.entityId) : undefined,
        is_read: false,
        actor_user_id: payload.actorUserId
          ? new Types.ObjectId(payload.actorUserId)
          : undefined,
        created_at: new Date(),
      });
    } catch (e) {
      this.logger.error('Failed to create notification', e);
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

    const query: Record<string, unknown> = {
      recipient_user_id: new Types.ObjectId(userId),
    };
    if (filters.unreadOnly) {
      query.is_read = false;
    }

    const [data, total] = await Promise.all([
      this.notificationModel
        .find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actor_user_id', 'first_name last_name')
        .exec(),
      this.notificationModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({
        recipient_user_id: new Types.ObjectId(userId),
        is_read: false,
      })
      .exec();
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.notificationModel
      .updateOne(
        { _id: new Types.ObjectId(notificationId), recipient_user_id: new Types.ObjectId(userId) },
        { is_read: true },
      )
      .exec();
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        { recipient_user_id: new Types.ObjectId(userId), is_read: false },
        { is_read: true },
      )
      .exec();
  }
}
