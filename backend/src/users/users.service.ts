
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { assertPasswordPolicy } from '../shared/utils/password-policy.util';
import { EntitlementsService } from '../shared/billing/entitlements.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { TenantScopeService, RequesterLike } from '../shared/tenant/tenant-scope.service';
import {
  GOVERNANCE_ROLES,
  PLATFORM_ROLES,
  ROLE_DEFINITIONS,
  ROLES,
  RoleName,
  permissionsForRoles,
  roleLabel,
} from '../shared/authorization/roles';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isUuid } from '../shared/utils/uuid.util';
import { validateText, validateOptionalUuid, validateRequiredUuid } from '../shared/utils/validation.util';

export interface CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  gender?: string;
  roles?: RoleName[];
  departmentId?: string;
  memberId?: string;
  fellowshipId?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private approvalEngine: ApprovalEngineService,
    private tenantScope: TenantScopeService,
    @Optional() private entitlements?: EntitlementsService,
  ) {}

  private async resolveRequester(requester: string | RequesterLike): Promise<RequesterLike> {
    if (typeof requester === 'string') {
      const u = await this.prisma.user.findUnique({ where: { id: requester } });
      return { userId: requester, roles: u?.roles || [], fellowshipId: u?.fellowship_id || null };
    }
    return {
      userId: requester?.userId,
      roles: requester?.roles || [],
      fellowshipId: requester?.fellowshipId || null,
    };
  }

  private async getRequesterRoles(requester: string | RequesterLike): Promise<string[]> {
    const r = await this.resolveRequester(requester);
    return r.roles || [];
  }

  // The role list comes straight from the request body: it must be a small array of known role names.
  private normalizeRoles(input: unknown): RoleName[] {
    if (!Array.isArray(input) || input.length === 0 || input.length > 10 || input.some((r) => typeof r !== 'string')) {
      throw new BadRequestException('roles must be a non-empty list of role names.');
    }
    const invalid = (input as string[]).filter((r) => !ROLE_DEFINITIONS.some((cfg) => cfg.name === r));
    if (invalid.length > 0) throw new BadRequestException(`Invalid role(s): ${invalid.slice(0, 5).join(', ').slice(0, 100)}`);
    return Array.from(new Set(input as string[])) as RoleName[];
  }

  /**
   * Who may hand out which role.
   *
   * Decided by PERMISSION, never by which role the requester happens to hold. That distinction is the whole point:
   * if holding a role implied the power to appoint it, a Treasurer could appoint a Treasurer and a Secretary could
   * appoint a Chairperson, and the fellowship's governance would be worth nothing. A Treasurer approves expenses -
   * a completely different power from appointing officers.
   *
   * Two tenant grants, deliberately separate:
   *   USER_ROLE_ASSIGN      - the fellowship's ordinary roles (member, department leader, content manager...)
   *   USER_ROLE_ASSIGN_GOV  - the governance roles in GOVERNANCE_ROLES (chairperson, secretary, treasurer...)
   *
   * A platform administrator has neither, but holds `PLATFORM_TENANTS_MANAGE`, which is the explicit permission
   * that lets the platform manage a tenant's accounts. That is a third route, not an implicit one.
   */
  private assertCanAssignRoles(requester: RequesterLike, roles: string[]) {
    const requesterRoles = requester.roles || [];

    // Platform roles are never assignable here at all, by anyone. They are administered under Users > System accounts.
    const platformRole = roles.find((role) => PLATFORM_ROLES.has(role as RoleName));
    if (platformRole) {
      throw new ForbiddenException(
        'Platform roles cannot be assigned through fellowship account management. Use Users › System accounts.',
      );
    }

    const held = permissionsForRoles(requesterRoles);
    const governance = roles.filter((role) => GOVERNANCE_ROLES.has(role as RoleName));

    // A platform administrator is a separate case, and it is an explicit permission rather than an implied one:
    // `PLATFORM_TENANTS_MANAGE` exists precisely so the platform can manage a tenant's accounts. Rule 5 is about a
    // TENANT role not implying the power to appoint it - a Treasurer approving expenses is not thereby authorised to
    // appoint a Treasurer. It is not a reason to lock the platform out of tenants it administers.
    //
    // Note this still cannot create a platform role: that is refused above, for everyone, on this route.
    if (held.includes(PERMISSIONS.PLATFORM_TENANTS_MANAGE)) return;

    if (governance.length > 0) {
      if (!held.includes(PERMISSIONS.USER_ROLE_ASSIGN_GOV)) {
        const names = governance.map((r) => roleLabel(r)).join(', ');
        throw new ForbiddenException(
          `Only the fellowship administrator may appoint an office holder (${names}). ` +
          'A Secretary, Treasurer or Chairperson may appoint ordinary members and department leaders, but not the fellowship\'s officers.',
        );
      }
      return;
    }

    if (!held.includes(PERMISSIONS.USER_ROLE_ASSIGN)) {
      throw new ForbiddenException('You do not have permission to assign roles.');
    }
  }

  private async assertCanManageTarget(requester: string | RequesterLike, target: { id: string; roles: string[] }) {
    const r = await this.resolveRequester(requester);
    if (r.userId === target.id) throw new ForbiddenException('You cannot change your own account through user management.');
    if ((target.roles.includes(ROLES.ADMIN) || target.roles.includes(ROLES.PLATFORM_SUPPORT)) && !r.roles?.includes(ROLES.ADMIN)) {
      throw new ForbiddenException('Only an admin can manage platform accounts');
    }
    // A fellowship administrator manages every role in their own fellowship, so there is deliberately no
    // "protected role" check here any more. The one thing still refused is the step that would leave the
    // fellowship unadministrable, which is handled by `assertNotLastSecretary` at the point a role is removed.
  }

  /**
   * Refuses a change that would leave a fellowship with no Secretary.
   *
   * The Secretary owns member records and departments, and is what the platform's "fellowship without an
   * administrator" health check looks for. A fellowship administrator can freely add, deactivate or re-role any
   * account, including other Secretaries - but not if the result is that the last one goes, because that would
   * lock the fellowship out of its own data with no way back in short of a platform administrator.
   */
  private async assertNotLastSecretary(fellowshipId: string, removingRole: RoleName, targetUserId: string) {
    if (removingRole !== ROLES.SECRETARY) return;
    const others = await this.prisma.user.count({
      where: {
        fellowship_id: fellowshipId,
        is_active: true,
        deleted_at: null,
        roles: { has: ROLES.SECRETARY },
        NOT: { id: targetUserId },
      },
    });
    if (others === 0) {
      throw new ForbiddenException(
        'This is the fellowship\'s only active Secretary account. Appoint or create another Secretary first.',
      );
    }
  }

  async create(dto: CreateUserDto, requesterIn: string | RequesterLike) {
    const requester = await this.resolveRequester(requesterIn);
    // Every field arrives untyped from the request body; anything that is not the expected type is a 400, not a crash.
    if (typeof dto.password !== 'string' || !dto.password) {
      throw new BadRequestException('email, password, firstName and lastName are required');
    }
    const email = validateText('email', dto.email, 254, true)!.toLowerCase();
    const firstName = validateText('firstName', dto.firstName, 100, true)!;
    const lastName = validateText('lastName', dto.lastName, 100, true)!;
    if (!dto.memberId) {
      throw new BadRequestException('A linked member is required - every user account must belong to a member');
    }
    validateRequiredUuid('memberId', dto.memberId);
    const departmentId = validateOptionalUuid('departmentId', dto.departmentId);
    const phone = validateText('phone', dto.phone, 40);
    if (dto.gender !== undefined && dto.gender !== null && (dto.gender as unknown) !== '' && !['male', 'female'].includes(dto.gender as string)) {
      throw new BadRequestException('gender must be male or female');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    const memberToLink = await this.prisma.member
      .findUnique({ where: { id: dto.memberId } })
      .catch(() => null);
    if (!memberToLink) {
      throw new BadRequestException('Linked member not found');
    }
    if (memberToLink.user_id) {
      throw new BadRequestException('This member already has a user account');
    }

    const isAdmin = requester.roles?.includes(ROLES.ADMIN);

    // Fellowship resolution: admin must supply one; secretary inherits their own.
    let fellowshipId: string | null;
    if (isAdmin) {
      if (!dto.fellowshipId) {
        throw new BadRequestException('A fellowship must be selected when an admin creates an account');
      }
      fellowshipId = validateRequiredUuid('fellowshipId', dto.fellowshipId);
    } else {
      fellowshipId = requester.fellowshipId ?? null;
    }

    // The member and the department must belong to the fellowship the account is created in. Without this a secretary
    // could link (and thereby move into their own fellowship) a member of ANOTHER fellowship, or point the new account
    // at another fellowship's department.
    if (memberToLink.fellowship_id !== fellowshipId) {
      throw new BadRequestException('Linked member not found');
    }
    if (departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: departmentId }, select: { fellowship_id: true } });
      if (!dept || dept.fellowship_id !== fellowshipId) throw new BadRequestException('Department not found');
    }

    await this.entitlements?.assertWithinLimit(fellowshipId, 'max_users', 1);

    let roles: RoleName[];
    if (dto.roles !== undefined && dto.roles !== null && !(Array.isArray(dto.roles) && dto.roles.length === 0)) {
      roles = this.normalizeRoles(dto.roles);
    } else if (isAdmin) {
      roles = [ROLES.SECRETARY];
    } else {
      roles = [ROLE_DEFINITIONS[ROLE_DEFINITIONS.length - 1].name];
    }

    if (roles.some((role) => role === ROLES.DEPARTMENT_SECRETARY || role === ROLES.DEPARTMENT_CHAIRPERSON) && !departmentId) {
      throw new BadRequestException('Department leader roles require a department.');
    }
    this.assertCanAssignRoles(requester, roles);

    const roleConfigs = ROLE_DEFINITIONS.filter((r) => roles.includes(r.name));
    const allPermissions = roleConfigs.flatMap((r) => r.permissions);

    assertPasswordPolicy(dto.password, { email, firstName, lastName });
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        phone: phone ?? undefined,
        gender: (dto.gender || undefined) as any,
        roles,
        permissions: allPermissions,
        department_id: departmentId || undefined,
        fellowship_id: fellowshipId,
        is_active: true,
        // The initial password was chosen by someone else (the secretary), so the account owner sets their own.
        must_change_password: true,
      },
    });

    await this.prisma.member.update({
      where: { id: memberToLink.id },
      data: { user_id: user.id, fellowship_id: fellowshipId },
    });

    await this.auditService.log({
      userId: requester.userId!,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      newValue: { email, roles, departmentId: departmentId || null, fellowshipId },
      comment: `Created user with roles: ${roles.join(', ')}`,
    });

    await this.notificationEngine.create({
      recipientUserId: user.id,
      eventType: 'account_created',
      title: 'Account Created',
      message: `Your fellowship account has been created. Please log in and change your password.`,
      entityType: 'user',
      entityId: user.id,
      actorUserId: requester.userId,
    });

    return { id: user.id, email: user.email, roles: user.roles };
  }

  async findAll(
    filters?: {
      role?: string;
      isActive?: boolean;
      fellowshipId?: string;
      page?: number;
      limit?: number;
    },
    requesterIn?: string | RequesterLike,
  ): Promise<{ data: any[]; total: number }> {
    const requester = await this.resolveRequester(requesterIn || '');
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.max(1, Math.min(100, filters?.limit || 50));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    // A removed account is a soft delete (DELETE /users/:id sets deleted_at), so it must be excluded here or the
    // list keeps showing accounts the operator has already deleted. The row is retained, not destroyed.
    where.deleted_at = null;
    if (filters?.role) {
      where.roles = { has: filters.role };
    }
    if (filters?.isActive !== undefined && typeof filters.isActive !== 'boolean') {
      throw new BadRequestException('isActive must be true or false.');
    }
    if (filters?.isActive !== undefined) {
      where.is_active = filters.isActive;
    }

    // A platform administrator sees every fellowship account, because it can create any of them: it used to be
    // narrowed to `secretary`, which meant an account it had just created in any other role was invisible and
    // looked as though the creation had failed. Platform accounts are excluded - those are system accounts and
    // are listed under Users > System accounts. A Secretary still sees only its own non-admin accounts.
    if (requester.roles?.includes(ROLES.ADMIN)) {
      where.fellowship_id = { not: null };
      where.NOT = { roles: { hasSome: [ROLES.ADMIN, ROLES.PLATFORM_SUPPORT] } };
    } else if (requester.roles?.includes(ROLES.SECRETARY)) {
      where.NOT = { roles: { has: ROLES.ADMIN } };
    } else {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    // Fellowship scoping (admin may filter by query, otherwise global; secretary is locked to own).
    const scoped = this.tenantScope.scopeWhere(requester, where, filters?.fellowshipId);

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: scoped,
        omit: { password_hash: true },
        include: { member: { select: { id: true, full_name: true, member_code: true } } },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: scoped }),
    ]);

    return { data, total };
  }

  async findOne(id: string, requesterIn?: string | RequesterLike): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      omit: { password_hash: true },
      include: { member: { select: { id: true, full_name: true, member_code: true } } },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const requester = await this.resolveRequester(requesterIn || '');
    this.tenantScope.assertInScope(requester, user);
    return user;
  }

  async update(id: string, dto: Partial<CreateUserDto>, requesterIn: string | RequesterLike): Promise<any> {
    if (!isUuid(id)) throw new NotFoundException('User not found');
    if (dto === null || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('A JSON object is required');
    const requester = await this.resolveRequester(requesterIn);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.tenantScope.assertInScope(requester, user);

    await this.assertCanManageTarget(requester, user);

    const changes: Record<string, any> = {};

    if (dto.email !== undefined && (typeof dto.email !== 'string' || dto.email.trim() !== user.email)) {
      const email = validateText('email', dto.email, 254, true)!.toLowerCase();
      const existing = await this.prisma.user.findFirst({
        where: { email, NOT: { id: user.id } },
      });
      if (existing) {
        throw new BadRequestException('A user with this email already exists');
      }
      changes.email = email;
    }

    if (dto.firstName !== undefined) changes.first_name = validateText('firstName', dto.firstName, 100, true);
    if (dto.lastName !== undefined) changes.last_name = validateText('lastName', dto.lastName, 100, true);
    if (dto.phone !== undefined) changes.phone = validateText('phone', dto.phone, 40);
    if (dto.gender !== undefined) {
      if (dto.gender !== null && !['male', 'female'].includes(dto.gender as string)) throw new BadRequestException('gender must be male or female');
      changes.gender = dto.gender;
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const oldValue: Record<string, any> = {};
    for (const key of Object.keys(changes)) {
      oldValue[key] = (user as any)[key];
    }

    const updated = await this.prisma.user.update({ where: { id }, data: changes });

    await this.auditService.log({
      userId: requester.userId!,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      oldValue,
      newValue: changes,
      comment: 'User account updated',
    });

    await this.notificationEngine.create({
      recipientUserId: id,
      eventType: 'account_updated',
      title: 'Account Updated',
      message: 'Your account details were updated by an administrator.',
      entityType: 'user',
      entityId: id,
      actorUserId: requester.userId,
    });

    return { id: updated.id, email: updated.email, firstName: updated.first_name, lastName: updated.last_name };
  }

  async assignRoles(userId: string, rolesIn: RoleName[], requesterIn: string | RequesterLike) {
    if (!isUuid(userId)) throw new NotFoundException('User not found');
    const roles = this.normalizeRoles(rolesIn);
    const requester = await this.resolveRequester(requesterIn);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.tenantScope.assertInScope(requester, user);
    if (requester.roles?.includes(ROLES.ADMIN) && !user.fellowship_id) {
      throw new ForbiddenException('Platform roles cannot be assigned through tenant account management.');
    }
    if (roles.some((role) => role === ROLES.DEPARTMENT_SECRETARY || role === ROLES.DEPARTMENT_CHAIRPERSON) && !user.department_id) {
      throw new BadRequestException('Department leader roles require an assigned department.');
    }

    const roleConfigs = ROLE_DEFINITIONS.filter((r) => roles.includes(r.name));
    const allPermissions = roleConfigs.flatMap((r) => r.permissions);

    this.assertCanAssignRoles(requester, roles);
    await this.assertCanManageTarget(requester, user);

    // Refused before the write: dropping the last Secretary would leave the fellowship with nobody who can manage
    // its members or departments. A platform administrator is exempt, because they can restore one.
    if (user.fellowship_id && !requester.roles?.includes(ROLES.ADMIN) && user.roles.includes(ROLES.SECRETARY) && !roles.includes(ROLES.SECRETARY)) {
      await this.assertNotLastSecretary(user.fellowship_id, ROLES.SECRETARY, userId);
    }

    const oldRoles = [...user.roles];
    const oldPermissions = [...user.permissions];

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { roles, permissions: allPermissions, token_version: { increment: 1 } },
    });

    await this.auditService.log({
      userId: requester.userId!,
      action: 'user.roles_change',
      entityType: 'user',
      entityId: userId,
      oldValue: { roles: oldRoles, permissions: oldPermissions },
      newValue: { roles, permissions: allPermissions },
    });

    return { id: updated.id, email: updated.email, roles: updated.roles };
  }

  async requestRoleRemoval(userId: string, role: string, reason: string, requesterIn: string | RequesterLike) {
    const requester = await this.resolveRequester(requesterIn);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.tenantScope.assertInScope(requester, user);
    if (!user.roles?.includes(role)) {
      throw new BadRequestException(`User does not hold the role "${role}"`);
    }
    if (role === ROLES.ADMIN) {
      throw new ForbiddenException('Admin roles cannot be removed via workflow');
    }
    if (!reason?.trim()) {
      throw new BadRequestException('A reason is required');
    }
    if (!requester.roles?.includes(ROLES.ADMIN) && !requester.roles?.includes(ROLES.SECRETARY)) {
      throw new ForbiddenException('Only an admin or secretary can request role removal');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'role_unassign',
      userId,
      'user',
      requester.userId!,
      { userId, role, reason: reason.trim() },
      user.fellowship_id,
    );
    await this.approvalEngine.submit(approval.id);

    await this.auditService.log({
      userId: requester.userId!,
      action: 'user.role_removal_requested',
      entityType: 'user',
      entityId: userId,
      newValue: { role },
      comment: reason.trim(),
      approvalInfo: { workflowId: approval.id },
    });

    return { approvalId: approval.id, status: 'submitted' };
  }

  async setActive(userId: string, isActive: boolean, requesterIn: string | RequesterLike) {
    const requester = await this.resolveRequester(requesterIn);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.tenantScope.assertInScope(requester, user);

    await this.assertCanManageTarget(requester, user);

    const oldStatus = user.is_active;
    await this.prisma.user.update({ where: { id: userId }, data: { is_active: isActive } });

    await this.auditService.log({
      userId: requester.userId!,
      action: 'user.status_change',
      entityType: 'user',
      entityId: userId,
      oldValue: { is_active: oldStatus },
      newValue: { is_active: isActive },
    });

    return { message: 'User status updated' };
  }

  async delete(userId: string, requesterIn: string | RequesterLike) {
    const requester = await this.resolveRequester(requesterIn);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.tenantScope.assertInScope(requester, user);

    await this.assertCanManageTarget(requester, user);

    await this.prisma.user.update({
      where: { id: userId },
      data: { is_active: false, deleted_at: new Date() },
    });

    await this.auditService.log({
      userId: requester.userId!,
      action: 'user.delete',
      entityType: 'user',
      entityId: userId,
      comment: 'User account deactivated',
    });

    return { message: 'User deactivated' };
  }

  async getPermissions(): Promise<any[]> {
    return this.prisma.role.findMany();
  }

  async getRoles(): Promise<any[]> {
    return this.prisma.role.findMany({
      select: { name: true, description: true, permissions: true },
    });
  }
}
