import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../shared/utils/uuid.util';
import { CENTRAL_VIEWERS, FinanceScopeService, LeaderRole } from '../finance/accounting/finance-scope.service';

/**
 * Who may see and manage which resources.
 *
 *  - Fellowship resources (fellowship-owned, and donations to / borrowings by the fellowship): managed by the
 *    Treasurer, the fellowship's Resource Manager. The Secretary and Chairperson see everything and approve.
 *  - A department's resources (owning_department_id = X: its own purchases, donations to it, things it borrowed):
 *    managed by X's current leaders. The Treasurer sees them (oversight) but does not manage them and can never
 *    change their ownership without the department's authorization.
 *  - A fellowship asset ASSIGNED to a department stays fellowship-owned: that department sees it and keeps custody.
 */
@Injectable()
export class InventoryScopeService {
  constructor(private prisma: PrismaService, private fin: FinanceScopeService) {}

  fellowship(user: any) { return this.fin.fellowship(user); }
  isTreasurer(user: any) { return this.fin.isTreasurer(user); }
  isCentralViewer(user: any) { return this.fin.isCentralViewer(user); }
  leaderships(user: any) { return this.fin.leaderships(user); }
  department(user: any, id: string) { return this.fin.department(user, id); }
  departmentLeaderIds(id: string, office?: LeaderRole) { return this.fin.departmentLeaderIds(id, office); }
  usersWithRoles(f: string, roles: string[]) { return this.fin.usersWithRoles(f, roles); }

  /** Null for fellowship resources, the owning department otherwise. */
  ownerDept(asset: { owning_department_id: string | null; ownership_type: string }): string | null {
    return asset.owning_department_id ?? null;
  }

  async load(user: any, id: string) {
    const fellowshipId = this.fellowship(user);
    if (!isUuid(id)) throw new NotFoundException('Resource not found');
    const asset = await this.prisma.asset.findFirst({ where: { id, fellowship_id: fellowshipId } });
    if (!asset) throw new NotFoundException('Resource not found');
    return asset;
  }

  /** May see it: central officers; the owning department; the department it is assigned to. */
  async canView(user: any, asset: any): Promise<boolean> {
    if (this.isCentralViewer(user)) return true;
    const led = await this.leaderships(user);
    return (!!asset.owning_department_id && led.has(asset.owning_department_id)) || (!!asset.assigned_department_id && led.has(asset.assigned_department_id));
  }

  async loadVisible(user: any, id: string) {
    const asset = await this.load(user, id);
    if (!(await this.canView(user, asset))) throw new ForbiddenException('You do not have access to this resource.');
    return asset;
  }

  /** May manage it: the Treasurer for fellowship resources; the owning department's leaders for department ones. */
  async canManage(user: any, asset: any, office?: LeaderRole): Promise<boolean> {
    const dept = this.ownerDept(asset);
    if (!dept) return this.isTreasurer(user);
    const role = (await this.leaderships(user)).get(dept);
    return !!role && (!office || role === office);
  }

  async loadManaged(user: any, id: string, office?: LeaderRole) {
    const asset = await this.load(user, id);
    if (!(await this.canManage(user, asset, office))) {
      throw new ForbiddenException(this.ownerDept(asset) ? 'Only the leaders of the department that owns this resource can do this.' : 'Only the Treasurer manages the fellowship\'s resources.');
    }
    return asset;
  }

  /** May manage resources of this scope (null = fellowship). */
  async requireManageScope(user: any, departmentId: string | null, office?: LeaderRole) {
    this.fellowship(user);
    if (!departmentId) {
      if (this.isTreasurer(user)) return;
      throw new ForbiddenException('Only the Treasurer manages the fellowship\'s resources.');
    }
    await this.department(user, departmentId);
    const role = (await this.leaderships(user)).get(departmentId);
    if (!role || (office && role !== office)) throw new ForbiddenException(office === 'department_chairperson' ? 'Only the Department Chairperson can do this.' : 'Only the current leaders of this department can manage its resources.');
  }

  /**
   * The asset filter for lists. Central officers see everything (optionally narrowed to ?departmentId=, which means
   * owned by OR assigned to that department, or =central for fellowship resources). Department leaders see only
   * resources their departments own or hold.
   */
  async listWhere(user: any, departmentId?: string): Promise<Record<string, any>> {
    const fellowshipId = this.fellowship(user);
    if (departmentId && departmentId !== 'central' && !isUuid(departmentId)) throw new BadRequestException('departmentId must be a valid id');
    const base: Record<string, any> = { fellowship_id: fellowshipId };
    const forDept = (ids: string[]) => ({ OR: [{ owning_department_id: { in: ids } }, { assigned_department_id: { in: ids } }] });
    if (this.isCentralViewer(user)) {
      if (departmentId === 'central') return { ...base, owning_department_id: null };
      if (departmentId) return { ...base, ...forDept([departmentId]) };
      return base;
    }
    const led = Array.from((await this.leaderships(user)).keys());
    if (!led.length) throw new ForbiddenException('You do not have permission to perform this action.');
    if (departmentId === 'central') throw new ForbiddenException('You can only see your own department\'s resources.');
    if (departmentId && !led.includes(departmentId)) throw new ForbiddenException('You can only see your own department\'s resources.');
    return { ...base, ...forDept(departmentId ? [departmentId] : led) };
  }

  /** Recipients responsible for a resource: the Treasurer for fellowship ones, the owning department's leaders otherwise. */
  async managers(asset: any): Promise<string[]> {
    const dept = this.ownerDept(asset);
    return dept ? this.departmentLeaderIds(dept) : this.usersWithRoles(asset.fellowship_id, ['treasurer']);
  }

  static readonly VIEWER_ROLES = [...CENTRAL_VIEWERS, 'department_chairperson', 'department_secretary'];
}
