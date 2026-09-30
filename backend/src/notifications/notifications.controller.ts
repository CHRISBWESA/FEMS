import { Controller, Get, Patch, Param, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PlatformAccess } from '../shared/decorators/platform.decorators';

@PlatformAccess()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.GENDER_LEADER,
    ROLES.ORDINARY_MEMBER,
  )
  async findAll(@Req() req) {
    return this.notificationsService.list(
      req.user.userId,
      {
        unreadOnly: req.query.unreadOnly === 'true',
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      },
    );
  }

  @Get('unread-count')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.GENDER_LEADER,
    ROLES.ORDINARY_MEMBER,
  )
  async unreadCount(@Req() req) {
    return this.notificationsService.unreadCount(req.user.userId);
  }

  @Patch(':id/read')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.GENDER_LEADER,
    ROLES.ORDINARY_MEMBER,
  )
  async markRead(@Param('id') id: string, @Req() req) {
    await this.notificationsService.markRead(req.user.userId, id);
    return { message: 'Marked as read' };
  }

  @Patch('mark-all-read')
  @Roles(
    ROLES.ADMIN,
    ROLES.SECRETARY,
    ROLES.ASSISTANT_SECRETARY,
    ROLES.CHAIRPERSON,
    ROLES.ASSISTANT_CHAIRPERSON,
    ROLES.TREASURER,
    ROLES.DEPARTMENT_SECRETARY,
    ROLES.DEPARTMENT_CHAIRPERSON,
    ROLES.GENDER_LEADER,
    ROLES.ORDINARY_MEMBER,
  )
  async markAllRead(@Req() req) {
    await this.notificationsService.markAllRead(req.user.userId);
    return { message: 'All marked as read' };
  }
}
