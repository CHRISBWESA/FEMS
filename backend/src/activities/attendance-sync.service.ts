import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';

const MAX_OPS = 200;
const MAX_ROSTER = 5000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type SyncStatus = 'applied' | 'duplicate' | 'already_recorded' | 'rejected';
export interface SyncResult { opId: string; status: SyncStatus; reason?: string; previous?: string }

/**
 * Server side of offline attendance. The device only remembers WHAT it saw; the server decides everything again
 * when the check-ins arrive: the caller is re-authenticated and re-authorised at that moment (a permission
 * revoked while offline stops the sync), the activity and every member must belong to the caller's fellowship,
 * and each operation carries a client-generated id that is stored under UNIQUE (user, op) so replaying a sync
 * can never record anything twice.
 */
@Injectable()
export class AttendanceSyncService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private tenantScope: TenantScopeService,
  ) {}

  private requirePermission(user: any): void {
    if (!((user?.permissions as string[]) || []).includes(PERMISSIONS.ACTIVITY_ATTENDANCE)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  private async loadActivity(id: string, user: any) {
    if (!isUuid(id)) throw new NotFoundException('Activity not found');
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    this.tenantScope.assertInScope(user, activity);
    return activity;
  }

  /**
   * What a device needs to record attendance for one activity while offline: the fellowship's members as
   * id + name + code ONLY (no phone, e-mail, gender, department or status) and who is already recorded.
   */
  async roster(activityId: string, user: any) {
    this.requirePermission(user);
    const activity = await this.loadActivity(activityId, user);
    const [members, recorded] = await Promise.all([
      this.prisma.member.findMany({ where: { fellowship_id: activity.fellowship_id }, select: { id: true, full_name: true, member_code: true }, orderBy: { full_name: 'asc' }, take: MAX_ROSTER + 1 }),
      this.prisma.attendance.findMany({ where: { activity_id: activity.id, member_id: { not: null } }, select: { member_id: true } }),
    ]);
    const truncated = members.length > MAX_ROSTER;
    const list = members.slice(0, MAX_ROSTER);
    await this.auditService.log({ userId: user.userId, action: 'activity.attendance_roster_download', entityType: 'activity', entityId: activity.id, newValue: { members: list.length, truncated } });
    return {
      activity: { id: activity.id, title: activity.title, date: activity.date },
      members: list.map((m) => ({ id: m.id, fullName: m.full_name, memberCode: m.member_code })),
      recorded: Array.from(new Set(recorded.map((r) => r.member_id as string))),
      truncated,
      generatedAt: new Date(),
    };
  }

  async sync(activityId: string, dto: any, user: any): Promise<{ results: SyncResult[]; summary: Record<SyncStatus, number> }> {
    this.requirePermission(user);
    const activity = await this.loadActivity(activityId, user);
    const raw = dto?.ops;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPS) throw new BadRequestException(`ops must be a list of 1-${MAX_OPS} operations`);
    const ops = raw.map((o: any, i: number) => {
      if (!o || typeof o !== 'object') throw new BadRequestException(`ops[${i}] must be an object`);
      if (!isUuid(o.opId)) throw new BadRequestException(`ops[${i}].opId must be a UUID`);
      if (!isUuid(o.memberId)) throw new BadRequestException(`ops[${i}].memberId must be a UUID`);
      let at: Date | null = null;
      if (o.at !== undefined && o.at !== null) {
        const d = new Date(o.at);
        if (Number.isNaN(d.getTime())) throw new BadRequestException(`ops[${i}].at must be a valid date`);
        at = d;
      }
      return { opId: o.opId as string, memberId: o.memberId as string, at };
    });

    const now = Date.now();
    const results = await this.prisma.$transaction(async (tx) => {
      // One sync per activity at a time: keeps the "already recorded?" check and the insert atomic.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${activity.id}, 0))`);
      const [seen, members, attended] = await Promise.all([
        tx.attendanceSyncOp.findMany({ where: { user_id: user.userId, op_id: { in: ops.map((o) => o.opId) } } }),
        tx.member.findMany({ where: { id: { in: ops.map((o) => o.memberId) }, fellowship_id: activity.fellowship_id }, select: { id: true, full_name: true } }),
        tx.attendance.findMany({ where: { activity_id: activity.id, member_id: { in: ops.map((o) => o.memberId) } }, select: { member_id: true } }),
      ]);
      const previous = new Map(seen.map((s) => [s.op_id, s.result]));
      const memberById = new Map(members.map((m) => [m.id, m.full_name]));
      const attendedSet = new Set(attended.map((a) => a.member_id as string));
      const handled = new Set<string>();
      const out: SyncResult[] = [];

      for (const op of ops) {
        if (handled.has(op.opId) || previous.has(op.opId)) {
          out.push({ opId: op.opId, status: 'duplicate', previous: previous.get(op.opId) });
          handled.add(op.opId);
          continue;
        }
        handled.add(op.opId);
        let result: string;
        const name = memberById.get(op.memberId);
        if (!name) {
          result = 'rejected';
          out.push({ opId: op.opId, status: 'rejected', reason: 'member_not_found' }); // unknown or another fellowship's: indistinguishable
        } else if (attendedSet.has(op.memberId)) {
          result = 'already_recorded';
          out.push({ opId: op.opId, status: 'already_recorded' });
        } else {
          const usable = op.at && op.at.getTime() <= now + CLOCK_SKEW_MS && op.at.getTime() >= now - MAX_AGE_MS;
          await tx.attendance.create({ data: { activity_id: activity.id, member_id: op.memberId, recorded_by_name: name, is_confirmed: true, fellowship_id: activity.fellowship_id, ...(usable ? { recorded_at: op.at! } : {}) } });
          attendedSet.add(op.memberId);
          result = 'applied';
          out.push({ opId: op.opId, status: 'applied' });
        }
        await tx.attendanceSyncOp.create({ data: { user_id: user.userId, op_id: op.opId, activity_id: activity.id, member_id: op.memberId, result } });
      }
      return out;
    });

    const summary = { applied: 0, duplicate: 0, already_recorded: 0, rejected: 0 } as Record<SyncStatus, number>;
    for (const r of results) summary[r.status]++;
    await this.auditService.log({ userId: user.userId, action: 'activity.attendance_sync', entityType: 'activity', entityId: activity.id, newValue: summary as unknown as Record<string, unknown> });
    return { results, summary };
  }
}
