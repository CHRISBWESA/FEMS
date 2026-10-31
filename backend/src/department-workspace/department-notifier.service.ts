import { Injectable } from '@nestjs/common';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';

/** Sends one notification per person: duplicate recipients and the person who acted are skipped. */
@Injectable()
export class DepartmentNotifier {
  constructor(private engine: NotificationEngineService) {}

  async notify(
    recipients: (string | null | undefined)[],
    payload: {
      eventType: string;
      title: string;
      message: string;
      entityType?: string;
      entityId?: string;
      fellowshipId?: string | null;
    },
    actorUserId?: string,
  ): Promise<void> {
    const unique = Array.from(
      new Set(recipients.filter((r): r is string => !!r && r !== actorUserId)),
    );
    for (const recipientUserId of unique) {
      await this.engine.create({ ...payload, recipientUserId, actorUserId });
    }
  }
}
