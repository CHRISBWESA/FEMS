import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText } from '../shared/utils/validation.util';
import { DepartmentAccessService } from './department-access.service';
import { DepartmentNotifier } from './department-notifier.service';
import { parsePaging, validateAttachments } from './department.util';

/**
 * Official announcements from the Fellowship Secretary to department leaders: to every department, or to the ones
 * chosen. Department leaders only read them (they pass them on to their members through their usual channels);
 * they cannot create official announcements.
 */
@Injectable()
export class DepartmentAnnouncementsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private access: DepartmentAccessService,
    private notifier: DepartmentNotifier,
  ) {}

  private shape(a: any) {
    return {
      id: a.id,
      title: a.title,
      content: a.content,
      status: a.status,
      targetAll: a.target_all,
      departments: (a.targets || []).map((t: any) => ({
        id: t.department.id,
        name: t.department.name,
      })),
      attachments: a.attachments ?? [],
      publishedAt: a.published_at,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    };
  }

  private include = {
    targets: { include: { department: { select: { id: true, name: true } } } },
  } as const;

  private async fields(user: any, body: any) {
    if (!body || typeof body !== 'object')
      throw new BadRequestException('A JSON object is required');
    const targetAll = body.targetAll === true;
    let departmentIds: string[] = [];
    if (!targetAll) {
      if (
        !Array.isArray(body.departmentIds) ||
        body.departmentIds.length === 0 ||
        !body.departmentIds.every(isUuid)
      ) {
        throw new BadRequestException(
          'Choose at least one department, or send the announcement to all departments.',
        );
      }
      departmentIds = Array.from(new Set(body.departmentIds as string[]));
      const found = await this.prisma.department.count({
        where: { id: { in: departmentIds }, fellowship_id: user.fellowshipId },
      });
      if (found !== departmentIds.length)
        throw new BadRequestException('One or more departments were not found.');
    }
    return {
      title: validateText('title', body.title, 200, true) as string,
      content: validateText('content', body.content, 20000, true) as string,
      attachments: validateAttachments('attachments', body.attachments) as any,
      targetAll,
      departmentIds,
    };
  }

  // ---------------------------------------------------------------- Fellowship Secretary

  async listAll(user: any, q: any) {
    const fellowshipId = this.access.requireSecretary(user);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where: Prisma.DepartmentAnnouncementWhereInput = { fellowship_id: fellowshipId };
    if (q?.status) where.status = String(q.status);
    const [rows, total] = await Promise.all([
      this.prisma.departmentAnnouncement.findMany({
        where,
        include: this.include,
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.departmentAnnouncement.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total, page, limit };
  }

  async create(user: any, body: any) {
    const fellowshipId = this.access.requireSecretary(user);
    const f = await this.fields(user, body);
    const created = await this.prisma.departmentAnnouncement.create({
      data: {
        fellowship_id: fellowshipId,
        title: f.title,
        content: f.content,
        attachments: f.attachments,
        target_all: f.targetAll,
        created_by: user.userId,
        targets: { create: f.departmentIds.map((department_id) => ({ department_id })) },
      },
      include: this.include,
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_announcement.create',
      entityType: 'department_announcement',
      entityId: created.id,
      newValue: { title: f.title, targetAll: f.targetAll, departmentIds: f.departmentIds },
    });
    if (body?.publish === true) return this.publish(user, created.id);
    return this.shape(created);
  }

  private async loadOwn(user: any, id: string) {
    const fellowshipId = this.access.requireSecretary(user);
    if (!isUuid(id)) throw new NotFoundException('Announcement not found');
    const a = await this.prisma.departmentAnnouncement.findUnique({
      where: { id },
      include: this.include,
    });
    if (!a || a.fellowship_id !== fellowshipId)
      throw new NotFoundException('Announcement not found');
    return a;
  }

  async update(user: any, id: string, body: any) {
    const a = await this.loadOwn(user, id);
    if (a.status === 'archived')
      throw new BadRequestException('An archived announcement cannot be edited.');
    const f = await this.fields(user, body);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.departmentAnnouncementTarget.deleteMany({ where: { announcement_id: id } });
      return tx.departmentAnnouncement.update({
        where: { id },
        data: {
          title: f.title,
          content: f.content,
          attachments: f.attachments,
          target_all: f.targetAll,
          targets: { create: f.departmentIds.map((department_id) => ({ department_id })) },
        },
        include: this.include,
      });
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_announcement.edit',
      entityType: 'department_announcement',
      entityId: id,
      oldValue: { title: a.title },
      newValue: { title: f.title, targetAll: f.targetAll, departmentIds: f.departmentIds },
    });
    return this.shape(updated);
  }

  async publish(user: any, id: string) {
    const a = await this.loadOwn(user, id);
    if (a.status === 'published') return this.shape(a);
    if (a.status === 'archived')
      throw new BadRequestException('An archived announcement cannot be published.');
    const updated = await this.prisma.departmentAnnouncement.update({
      where: { id },
      data: { status: 'published', published_at: new Date() },
      include: this.include,
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_announcement.publish',
      entityType: 'department_announcement',
      entityId: id,
    });
    // Leaders of the targeted (active) departments.
    const leaders = await this.prisma.departmentLeader.findMany({
      where: {
        active_role: { not: null },
        department: {
          fellowship_id: a.fellowship_id,
          is_active: true,
          ...(a.target_all ? {} : { id: { in: a.targets.map((t) => t.department_id) } }),
        },
      },
      select: { user_id: true },
    });
    await this.notifier.notify(
      leaders.map((l) => l.user_id),
      {
        eventType: 'department_announcement_published',
        title: 'New announcement',
        message: a.title,
        entityType: 'department_announcement',
        entityId: id,
        fellowshipId: a.fellowship_id,
      },
      user.userId,
    );
    return this.shape(updated);
  }

  async archive(user: any, id: string) {
    await this.loadOwn(user, id);
    const updated = await this.prisma.departmentAnnouncement.update({
      where: { id },
      data: { status: 'archived' },
      include: this.include,
    });
    await this.audit.log({
      userId: user.userId,
      action: 'department_announcement.archive',
      entityType: 'department_announcement',
      entityId: id,
    });
    return this.shape(updated);
  }

  // ---------------------------------------------------------------- department leaders (read only)

  private relevantWhere(
    departmentId: string,
    fellowshipId: string,
  ): Prisma.DepartmentAnnouncementWhereInput {
    return {
      fellowship_id: fellowshipId,
      status: 'published',
      OR: [{ target_all: true }, { targets: { some: { department_id: departmentId } } }],
    };
  }

  async forDepartment(user: any, departmentId: string, q: any) {
    const { department } = await this.access.assertLeader(user, departmentId);
    const { skip, take, page, limit } = parsePaging(q?.page, q?.limit);
    const where = this.relevantWhere(departmentId, department.fellowship_id);
    const [rows, total] = await Promise.all([
      this.prisma.departmentAnnouncement.findMany({
        where,
        include: this.include,
        orderBy: { published_at: 'desc' },
        skip,
        take,
      }),
      this.prisma.departmentAnnouncement.count({ where }),
    ]);
    return { data: rows.map((r) => this.shape(r)), total, page, limit };
  }

  async recent(departmentId: string, fellowshipId: string, take = 5) {
    const rows = await this.prisma.departmentAnnouncement.findMany({
      where: this.relevantWhere(departmentId, fellowshipId),
      include: this.include,
      orderBy: { published_at: 'desc' },
      take,
    });
    return rows.map((r) => this.shape(r));
  }
}
