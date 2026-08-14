import { Injectable } from '@nestjs/common';
import { NotificationEngineService, NotificationPayload } from '../shared/notifications/notification-engine.service';

@Injectable()
export class NotificationsService {
  constructor(private notificationEngine: NotificationEngineService) {}

  async list(userId: string, filters: { unreadOnly?: boolean; page?: number; limit?: number }) {
    return this.notificationEngine.list(userId, filters);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.notificationEngine.unreadCount(userId) };
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.notificationEngine.markRead(userId, notificationId);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationEngine.markAllRead(userId);
  }
}
