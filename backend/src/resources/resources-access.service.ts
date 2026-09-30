import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';

const DEPARTMENT_LEADER_ROLES = ['department_secretary', 'department_chairperson'];
const TAG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PAGE = 500;

export interface HistoryInput {
  fellowshipId: string | null;
  assetId: string;
  eventType: any;
  actorId?: string | null;
  memberId?: string | null;
  fromDepartmentId?: string | null;
  toDepartmentId?: string | null;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  note?: string | null;
}

@Injectable()
export class ResourcesAccessService {
  constructor(
    private prisma: PrismaService,
    private tenantScope: TenantScopeService,
    private notificationEngine: NotificationEngineService,
  ) {}

  hasPermission(user: any, permission: string): boolean {
    return ((user?.permissions as string[]) || []).includes(permission);
  }

  requirePermission(user: any, permission: string): void {
    if (!this.hasPermission(user, permission)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
  }

  isDepartmentLeader(user: any): boolean {
    const roles: string[] = user?.roles || [];
    return DEPARTMENT_LEADER_ROLES.some((r) => roles.includes(r));
  }

  canSeeCost(user: any): boolean {
    return this.hasPermission(user, PERMISSIONS.RESOURCES_COST_VIEW);
  }

  // Fellowship-wide viewers see the whole fellowship; department leaders see only assets OWNED BY their
  // own department. Everyone else is refused.
  isFellowshipViewer(user: any): boolean {
    return this.hasPermission(user, PERMISSIONS.RESOURCES_VIEW);
  }

  requireViewer(user: any): 'fellowship' | 'department' {
    if (this.isFellowshipViewer(user)) return 'fellowship';
    if (this.hasPermission(user, PERMISSIONS.RESOURCES_DEPARTMENT_VIEW) && this.isDepartmentLeader(user)) {
      if (!user.departmentId) throw new ForbiddenException('You are not assigned to a department.');
      return 'department';
    }
    throw new ForbiddenException('You do not have permission to perform this action.');
  }

  assetScope(user: any, extra: Record<string, any> = {}, queryFellowshipId?: string): Record<string, any> {
    const mode = this.requireViewer(user);
    const scoped = mode === 'department' ? { ...extra, owning_department_id: user.departmentId } : extra;
    return this.tenantScope.scopeWhere(user, scoped, queryFellowshipId);
  }

  resolveFellowship(user: any, bodyFellowshipId?: unknown): string | null {
    if (bodyFellowshipId !== undefined && bodyFellowshipId !== null && bodyFellowshipId !== '' && !isUuid(bodyFellowshipId)) {
      throw new BadRequestException('fellowshipId must be a valid id');
    }
    return this.tenantScope.resolveFellowshipId(user, bodyFellowshipId as string | undefined);
  }

  parsePaging(limit?: unknown, page?: unknown, defaultLimit = 100): { take: number; skip: number } {
    const l = limit === undefined || limit === '' ? defaultLimit : Number(limit);
    const p = page === undefined || page === '' ? 1 : Number(page);
    if (!Number.isInteger(l) || l < 1 || l > MAX_PAGE) throw new BadRequestException(`limit must be an integer between 1 and ${MAX_PAGE}`);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return { take: l, skip: (p - 1) * l };
  }

  // Loads an asset the caller may see. A malformed id, a missing asset, another fellowship's asset and
  // (for department leaders) another department's asset are all refused; the tenant/department checks
  // return 403 like the rest of the app, malformed/missing return 404.
  async loadAsset(id: string, user: any): Promise<any> {
    const mode = this.requireViewer(user);
    if (!isUuid(id)) throw new NotFoundException('Asset not found');
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    this.tenantScope.assertInScope(user, asset);
    if (mode === 'department' && asset.owning_department_id !== user.departmentId) {
      throw new ForbiddenException('You can only access assets owned by your own department.');
    }
    return asset;
  }

  // ---- reference validation: same fellowship as the asset, else "not found" ----

  async assertMember(memberId: string, fellowshipId: string | null): Promise<any> {
    const m = await this.prisma.member.findFirst({ where: { id: memberId, fellowship_id: fellowshipId }, select: { id: true, full_name: true, user_id: true } });
    if (!m) throw new NotFoundException('Member not found');
    return m;
  }

  async assertDepartment(departmentId: string, fellowshipId: string | null): Promise<any> {
    const d = await this.prisma.department.findFirst({ where: { id: departmentId, fellowship_id: fellowshipId }, select: { id: true, name: true } });
    if (!d) throw new NotFoundException('Department not found');
    return d;
  }

  async assertCategory(id: string, fellowshipId: string | null): Promise<void> {
    const c = await this.prisma.assetCategory.findFirst({ where: { id, fellowship_id: fellowshipId, is_active: true }, select: { id: true } });
    if (!c) throw new BadRequestException('The selected category is not available.');
  }

  async assertLocation(id: string, fellowshipId: string | null): Promise<void> {
    const l = await this.prisma.assetLocation.findFirst({ where: { id, fellowship_id: fellowshipId, is_active: true }, select: { id: true } });
    if (!l) throw new BadRequestException('The selected location is not available.');
  }

  async assertExpense(id: string, fellowshipId: string | null): Promise<void> {
    const e = await this.prisma.expense.findFirst({ where: { id, fellowship_id: fellowshipId }, select: { id: true } });
    if (!e) throw new BadRequestException('The referenced expense is not available.');
  }

  async assertDocument(id: string, fellowshipId: string | null): Promise<any> {
    const d = await this.prisma.documentEntity.findFirst({ where: { id, fellowship_id: fellowshipId, is_website_content: false }, select: { id: true, title: true } });
    if (!d) throw new BadRequestException('The selected document is not available.');
    return d;
  }

  generateTag(): string {
    let t = '';
    for (let i = 0; i < 6; i++) t += TAG_ALPHABET[randomInt(TAG_ALPHABET.length)];
    return `AST-${t}`;
  }

  historyData(i: HistoryInput): Prisma.AssetHistoryUncheckedCreateInput {
    return {
      fellowship_id: i.fellowshipId,
      asset_id: i.assetId,
      event_type: i.eventType,
      actor_id: i.actorId ?? null,
      member_id: i.memberId ?? null,
      from_department_id: i.fromDepartmentId ?? null,
      to_department_id: i.toDepartmentId ?? null,
      from_location_id: i.fromLocationId ?? null,
      to_location_id: i.toLocationId ?? null,
      from_value: i.fromValue ?? null,
      to_value: i.toValue ?? null,
      note: i.note ?? null,
    };
  }

  // Neutral, single-purpose notification to a member's own account (if they have one).
  async notifyMember(member: { user_id?: string | null }, title: string, message: string, assetId: string, fellowshipId: string | null) {
    if (!member?.user_id) return;
    await this.notificationEngine.create({
      recipientUserId: member.user_id,
      eventType: 'resource_update',
      title,
      message,
      entityType: 'asset',
      entityId: assetId,
      fellowshipId,
    });
  }
}
