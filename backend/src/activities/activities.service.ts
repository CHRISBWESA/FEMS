import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { listWindow, pageResult } from '../shared/utils/paging.util';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateOptionalUuid, validateText } from '../shared/utils/validation.util';
import { audienceVisibilityWhere, isAudienceVisible } from '../shared/tenant/audience-scope';

export const isActivityVisible = isAudienceVisible;

export interface CreateActivityDto {
  title: string;
  description?: string;
  date: Date;
  endDate?: Date;
  audienceType: 'all_members' | 'department' | 'leaders' | 'specific_group';
  departmentId?: string;
  specificGroup?: string;
}

const ACTIVITY_AUDIENCES = new Set(['all_members', 'department', 'leaders', 'specific_group']);

function parseActivityDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' && !(value instanceof Date)) throw new BadRequestException(`${field} must be a date`);
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
  return date;
}

function parseOptionalActivityDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return parseActivityDate(value, field);
}

@Injectable()
export class ActivitiesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
  ) {}

  async findAll(currentUser: any, fellowshipId?: string, page?: unknown, limit?: unknown): Promise<{ data: any[]; total: number }> {
    let where: Prisma.ActivityWhereInput = audienceVisibilityWhere(currentUser) as Prisma.ActivityWhereInput;
    where = this.tenantScope.scopeWhere(currentUser, where, fellowshipId) as Prisma.ActivityWhereInput;

    const w = listWindow(page, limit);
    const rows = await this.prisma.activity.findMany({ where, orderBy: [{ date: 'desc' }, { id: 'asc' }], skip: w.skip, take: w.take });
    return pageResult(rows, w, () => this.prisma.activity.count({ where }));
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    this.tenantScope.assertInScope(currentUser, activity);
    if (!isActivityVisible(activity, currentUser)) throw new ForbiddenException('You do not have permission to view this activity.');
    return activity;
  }

  async create(data: CreateActivityDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    if (!isSecretary) throw new ForbiddenException('You do not have permission to perform this action.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('An activity object is required.');

    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser);
    if (!fellowshipId) throw new ForbiddenException('A fellowship account is required.');
    const title = validateText('title', data.title, 200, true)!;
    const description = validateText('description', data.description, 5000);
    const audienceType = data.audienceType;
    if (typeof audienceType !== 'string' || !ACTIVITY_AUDIENCES.has(audienceType)) {
      throw new BadRequestException('audienceType is invalid.');
    }
    const date = parseActivityDate(data.date, 'date');
    const endDate = parseOptionalActivityDate(data.endDate, 'endDate');
    if (endDate && endDate < date) throw new BadRequestException('endDate must not be before date.');
    let departmentId = validateOptionalUuid('departmentId', data.departmentId);
    let specificGroup = validateText('specificGroup', data.specificGroup, 200);
    if (audienceType === 'department') {
      if (!departmentId) throw new BadRequestException('departmentId is required for a department activity.');
    } else {
      departmentId = null;
    }
    if (audienceType === 'specific_group') {
      if (!specificGroup) throw new BadRequestException('specificGroup is required for a specific-group activity.');
    } else {
      specificGroup = null;
    }
    if (departmentId) {
      const department = await this.prisma.department.findFirst({ where: { id: departmentId, fellowship_id: fellowshipId }, select: { id: true } });
      if (!department) throw new NotFoundException('Department not found');
    }

    const activity = await this.prisma.activity.create({
      data: {
        title,
        description,
        date,
        end_date: endDate,
        audience_type: audienceType as any,
        department_id: departmentId,
        specific_group: specificGroup,
        created_by: currentUser.userId,
        fellowship_id: fellowshipId,
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.create',
      entityType: 'activity',
      entityId: activity.id,
      newValue: { title, audienceType },
    });

    if (audienceType === 'all_members') {
      await this.notificationEngine.create({
        recipientUserId: currentUser.userId,
        eventType: 'activity_new',
        title: 'New Activity',
        message: `${title} has been scheduled.`,
      });
    }
    return activity;
  }

  async update(id: string, data: Partial<CreateActivityDto>, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    if (!isSecretary) throw new ForbiddenException('You do not have permission to perform this action.');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('An activity object is required.');
    if (!isUuid(id)) throw new NotFoundException('Activity not found');

    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    this.tenantScope.assertInScope(currentUser, activity);

    const title = data.title !== undefined ? validateText('title', data.title, 200, true)! : activity.title;
    const description = data.description !== undefined ? validateText('description', data.description, 5000) : activity.description;
    const audienceType = data.audienceType ?? activity.audience_type;
    if (typeof audienceType !== 'string' || !ACTIVITY_AUDIENCES.has(audienceType)) throw new BadRequestException('audienceType is invalid.');
    const date = data.date !== undefined ? parseActivityDate(data.date, 'date') : activity.date;
    const endDate = data.endDate !== undefined ? parseOptionalActivityDate(data.endDate, 'endDate') : activity.end_date;
    if (endDate && endDate < date) throw new BadRequestException('endDate must not be before date.');
    let departmentId = data.departmentId !== undefined ? validateOptionalUuid('departmentId', data.departmentId) : activity.department_id;
    let specificGroup = data.specificGroup !== undefined ? validateText('specificGroup', data.specificGroup, 200) : activity.specific_group;
    if (audienceType === 'department' && !departmentId) throw new BadRequestException('departmentId is required for a department activity.');
    if (audienceType !== 'department') departmentId = null;
    if (audienceType === 'specific_group' && !specificGroup) throw new BadRequestException('specificGroup is required for a specific-group activity.');
    if (audienceType !== 'specific_group') specificGroup = null;
    if (departmentId) {
      const department = await this.prisma.department.findFirst({ where: { id: departmentId, fellowship_id: activity.fellowship_id }, select: { id: true } });
      if (!department) throw new NotFoundException('Department not found');
    }

    const changes: Record<string, unknown> = {};
    if (data.title !== undefined) changes.title = title;
    if (data.description !== undefined) changes.description = description;
    if (data.date !== undefined) changes.date = date;
    if (data.endDate !== undefined) changes.end_date = endDate;
    if (data.audienceType !== undefined || departmentId !== activity.department_id) changes.audience_type = audienceType;
    if (data.departmentId !== undefined || departmentId !== activity.department_id) changes.department_id = departmentId;
    if (data.specificGroup !== undefined || specificGroup !== activity.specific_group) changes.specific_group = specificGroup;
    if (Object.keys(changes).length === 0) throw new BadRequestException('No fields to update.');

    const updated = await this.prisma.activity.update({ where: { id }, data: changes });
    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.edit',
      entityType: 'activity',
      entityId: id,
      oldValue: activity,
      newValue: updated,
    });
    return updated;
  }

  async cancel(id: string, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') || roles.includes('assistant_secretary');
    if (!isSecretary) throw new ForbiddenException('You do not have permission to perform this action.');
    if (!isUuid(id)) throw new NotFoundException('Activity not found');

    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    this.tenantScope.assertInScope(currentUser, activity);
    if (activity.title.startsWith('[CANCELLED]')) return activity;

    const updated = await this.prisma.activity.update({ where: { id }, data: { title: `[CANCELLED] ${activity.title}` } });
    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.cancel',
      entityType: 'activity',
      entityId: id,
    });
    return updated;
  }

  async generateAttendanceLink(activityId: string, currentUser: any): Promise<{ link: string }> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    this.tenantScope.assertInScope(currentUser, activity);
    if (activity.title.startsWith('[CANCELLED]') || activity.audience_type !== 'all_members') {
      throw new BadRequestException('Attendance links are available only for active all-members activities.');
    }

    return { link: `${process.env.FRONTEND_URL || ''}/attendance/${activityId}` };
  }

  // Backs the PUBLIC (unauthenticated) attendance link, so it records by name only. It must never
  // accept a member id: that would let anyone forge attendance against any member and would poison
  // the member-engagement figures. Member-linked attendance goes through recordMemberAttendance().
  async recordAttendance(activityId: string, data: {
    memberName?: string;
  }): Promise<any> {
    if (!isUuid(activityId)) {
      throw new NotFoundException('Activity not found');
    }
    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    // This route is public, so the JWT-level suspension check does not run: a suspended fellowship's
    // attendance links stop working here.
    if (activity.title.startsWith('[CANCELLED]') || activity.audience_type !== 'all_members') {
      throw new NotFoundException('Activity not found');
    }
    if (activity.fellowship_id) {
      const f = await this.prisma.fellowship.findUnique({ where: { id: activity.fellowship_id }, select: { status: true } });
      if (!f || f.status !== 'active') throw new NotFoundException('Activity not found');
    }

    // Anyone with the link can call this, so it is kept narrow: a real name, only around the time of the event,
    // and the same person checking in twice does not create a second record.
    const name = typeof data.memberName === 'string' ? data.memberName.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 100) throw new BadRequestException('Please enter your full name (2-100 characters).');
    const publicCheckinKey = name.toLocaleLowerCase('en-US');
    const now = Date.now();
    const opens = activity.date.getTime() - 24 * 60 * 60 * 1000;
    const closes = (activity.end_date ?? activity.date).getTime() + 72 * 60 * 60 * 1000;
    if (now < opens || now > closes) throw new BadRequestException('Check-in is not open for this activity.');
    const existing = await this.prisma.attendance.findFirst({
      where: { activity_id: activityId, member_id: null, youth_profile_id: null, recorded_by_name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) return existing;

    try {
      return await this.prisma.attendance.create({
        data: {
          activity_id: activityId,
          recorded_by_name: name,
          public_checkin_key: publicCheckinKey,
          is_confirmed: true,
          fellowship_id: activity.fellowship_id,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.attendance.findFirst({
          where: {
            activity_id: activityId,
            member_id: null,
            youth_profile_id: null,
            OR: [
              { public_checkin_key: publicCheckinKey },
              { recorded_by_name: { equals: name, mode: 'insensitive' } },
            ],
          },
        });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  // Authenticated, permission-gated attendance for specific members (activity.attendance). Duplicate
  // (activity, member) rows are skipped. Members from another fellowship - or ids that don't exist -
  // are reported back as `rejected` without saying which, so ids can't be probed across fellowships.
  async recordMemberAttendance(
    activityId: string,
    memberIds: unknown,
    currentUser: any,
  ): Promise<{ recorded: number; alreadyRecorded: number; rejected: string[] }> {
    if (!((currentUser.permissions as string[]) || []).includes(PERMISSIONS.ACTIVITY_ATTENDANCE)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    if (!isUuid(activityId)) {
      throw new NotFoundException('Activity not found');
    }
    if (!Array.isArray(memberIds) || memberIds.length === 0 || memberIds.length > 200) {
      throw new BadRequestException('memberIds must be an array of 1-200 ids');
    }
    if (!memberIds.every(isUuid)) {
      throw new BadRequestException('memberIds must contain valid ids');
    }
    const requested = Array.from(new Set(memberIds as string[]));

    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) {
      throw new NotFoundException('Activity not found');
    }
    this.tenantScope.assertInScope(currentUser, activity);

    const found = await this.prisma.member.findMany({
      where: this.tenantScope.scopeWhere(currentUser, { id: { in: requested } }),
      select: { id: true, full_name: true, fellowship_id: true },
    });
    const valid = found.filter((m) => m.fellowship_id === activity.fellowship_id);
    const rejected = requested.filter((id) => !valid.some((m) => m.id === id));

    const existing = valid.length
      ? await this.prisma.attendance.findMany({
          where: { activity_id: activityId, member_id: { in: valid.map((m) => m.id) } },
          select: { member_id: true },
        })
      : [];
    const already = new Set(existing.map((e) => e.member_id));
    const toRecord = valid.filter((m) => !already.has(m.id));

    if (toRecord.length > 0) {
      await this.prisma.attendance.createMany({
        data: toRecord.map((m) => ({
          activity_id: activityId,
          member_id: m.id,
          recorded_by_name: m.full_name,
          is_confirmed: true,
          fellowship_id: activity.fellowship_id,
        })),
      });
    }

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'activity.attendance_record_members',
      entityType: 'activity',
      entityId: activityId,
      newValue: { recorded: toRecord.length, alreadyRecorded: already.size, rejected: rejected.length },
    });

    return { recorded: toRecord.length, alreadyRecorded: already.size, rejected };
  }

  async getAttendance(activityId: string, currentUser: any): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    const isSecretary = roles.includes('secretary') || roles.includes('admin') ||
      roles.includes('assistant_secretary');

    if (!isSecretary && !roles.includes('department_secretary') && !roles.includes('department_chairperson')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    if (!isUuid(activityId)) throw new NotFoundException('Activity not found');
    const activity = await this.prisma.activity.findUnique({ where: { id: activityId } });
    if (!activity) throw new NotFoundException('Activity not found');
    this.tenantScope.assertInScope(currentUser, activity);
    // Department leaders read the attendance of their own department's activities only (they could read any
    // activity of the fellowship, and a malformed id caused a 500).
    if (!isSecretary && (!currentUser.departmentId || activity.department_id !== currentUser.departmentId)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const where = this.tenantScope.scopeWhere(
      currentUser,
      { activity_id: activityId },
    ) as Prisma.AttendanceWhereInput;

    return this.prisma.attendance.findMany({ where, take: 5000, orderBy: { recorded_at: 'asc' } });
  }
}
