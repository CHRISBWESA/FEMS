import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Activity, Attendance } from '../shared/schemas/activities-reports.schema';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { PERMISSIONS } from '../shared/authorization/permissions';

export interface CreateActivityDto {
  title: string;
  description?: string;
  date: Date;
  endDate?: Date;
  audienceType: 'all_members' | 'department' | 'leaders' | 'specific_group';
  departmentId?: string;
  specificGroup?: string;
}

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Activity.name) private activityModel: Model<Activity>,
    @InjectModel(Attendance.name) private attendanceModel: Model<Attendance>,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  async findAll(currentUser: any): Promise<Activity[]> {
    const roles: string[] = currentUser.roles || [];
    const query: any = {};

    if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
      query.audience_type = { $in: ['all_members', 'leaders', 'department'] };
    }

    if (roles.includes('ordinary_member')) {
      query.audience_type = { $in: ['all_members', 'department'] };
    }

    const activities = await this.activityModel.find(query).sort({ date: -1 }).exec();

    // Apply department scoping for ordinary members and dept leaders
    if (roles.includes('ordinary_member') ||
        roles.includes('department_secretary') ||
        roles.includes('department_chairperson')) {
      return activities.filter((a) => {
        if (a.audience_type === 'department') {
          if (!a.department_id) return false;
          if (roles.includes('department_secretary') || roles.includes('department_chairperson')) {
            return a.department_id.toString() === currentUser.departmentId;
          }
          return false;
        }
        if (a.audience_type === 'specific_group') {
          return false;
        }
        return true;
      });
    }

    return activities;
  }

  async findOne(id: string, currentUser: any): Promise<Activity> {
    const activity = await this.activityModel.findById(id).exec();
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    return activity;
  }

  async create(data: CreateActivityDto, currentUser: any): Promise<Activity> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const activity = await this.activityModel.create({
      ...data,
      created_by: new Types.ObjectId(currentUser.userId),
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.create',
      entityType: 'activity',
      entityId: activity._id.toString(),
      newValue: { title: data.title, audienceType: data.audienceType },
    });

    // Generate notifications for targeted audience
    if (data.audienceType === 'all_members') {
      // Notify all members (in practice, would batch query userIds)
      await this.notificationEngine.create({
        recipientUserId: currentUser.userId,
        eventType: 'activity_new',
        title: 'New Activity',
        message: `${data.title} has been scheduled.`,
      });
    }

    return activity;
  }

  async update(id: string, data: Partial<CreateActivityDto>, currentUser: any): Promise<Activity> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const activity = await this.activityModel.findById(id).exec();
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    const oldValues = (activity as any).toObject();
    Object.assign(activity, data);
    await activity.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.edit',
      entityType: 'activity',
      entityId: id,
      oldValue: oldValues,
      newValue: (activity as any).toObject(),
    });

    return activity;
  }

  async cancel(id: string, currentUser: any): Promise<Activity> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const activity = await this.activityModel.findById(id).exec();
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    activity.title = `[CANCELLED] ${activity.title}`;
    await activity.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.cancel',
      entityType: 'activity',
      entityId: id,
    });

    return activity;
  }

  async generateAttendanceLink(activityId: string, currentUser: any): Promise<{ link: string }> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return { link: `${process.env.FRONTEND_URL || ''}/attendance/${activityId}` };
  }

  async recordAttendance(activityId: string, data: {
    memberId?: string;
    memberName?: string;
  }): Promise<Attendance> {
    const activity = await this.activityModel.findById(activityId).exec();
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    const attendance = await this.attendanceModel.create({
      activity_id: new Types.ObjectId(activityId),
      member_id: data.memberId ? new Types.ObjectId(data.memberId) : undefined,
      recorded_by_name: data.memberName || undefined,
      is_confirmed: true,
    });

    return attendance;
  }

  async getAttendance(activityId: string, currentUser: any): Promise<Attendance[]> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary && !roles.includes('department_secretary') && !roles.includes('department_chairperson')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return this.attendanceModel.find({ activity_id: new Types.ObjectId(activityId) }).exec();
  }
}
