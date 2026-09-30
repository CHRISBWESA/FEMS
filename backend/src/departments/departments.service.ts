import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { validateRequiredUuid, validateText } from '../shared/utils/validation.util';
import { isUuid } from '../shared/utils/uuid.util';

export interface CreateDepartmentDto {
  name: string;
  description?: string;
  customFieldsSchema?: Record<string, unknown>;
  is_active?: boolean;
  fellowshipId?: string;
}

export interface AssignLeaderDto {
  userId: string;
  roleInDepartment: 'department_secretary' | 'department_chairperson';
  startDate?: string;
}

export interface RequestTransferDto {
  memberId: string;
  fromDepartmentId: string;
  toDepartmentId: string;
  reason: string;
}

export interface RequestRemovalDto {
  reason: string;
}

@Injectable()
export class DepartmentsService {
  constructor(
    private prisma: PrismaService,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
    private tenantScope: TenantScopeService,
  ) {}

  async findAll(currentUser: any, queryFellowshipId?: string): Promise<any[]> {
    const where = this.tenantScope.scopeWhere(currentUser, {}, queryFellowshipId);
    return this.prisma.department.findMany({
      where,
      orderBy: { created_at: 'asc' },
      include: { leaders: true },
    });
  }

  async findOne(id: string, currentUser: any): Promise<any> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { leaders: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    this.tenantScope.assertInScope(currentUser, department);
    return department;
  }

  async create(data: CreateDepartmentDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('A JSON object is required');
    const name = validateText('name', data.name, 120, true)!;
    const description = validateText('description', data.description, 1000);
    if (data.customFieldsSchema !== undefined && (!data.customFieldsSchema || typeof data.customFieldsSchema !== 'object' || Array.isArray(data.customFieldsSchema))) {
      throw new BadRequestException('customFieldsSchema must be an object');
    }
    if (roles.includes('admin')) validateRequiredUuid('fellowshipId', data.fellowshipId);
    const fellowshipId = this.tenantScope.resolveFellowshipId(currentUser, data.fellowshipId);
    if (!fellowshipId) throw new BadRequestException('A fellowship is required');

    // Scoped to the fellowship: another congregation having a "Choir" is neither a conflict nor this
    // Secretary's business. The database enforces the same rule via departments_fellowship_id_name_key.
    const existing = await this.prisma.department.findFirst({ where: { fellowship_id: fellowshipId, name } });
    if (existing) throw new BadRequestException('This fellowship already has a department with that name');

    const department = await this.prisma.department.create({
      data: {
        name,
        description,
        is_active: false,
        custom_fields_schema: (data.customFieldsSchema || {}) as any,
        created_by: currentUser.userId,
        fellowship_id: fellowshipId,
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.create',
      entityType: 'department',
      entityId: department.id,
      newValue: { name, description },
    });

    return department;
  }

  async update(id: string, data: Partial<CreateDepartmentDto>, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('A JSON object is required');
    if (!isUuid(id)) throw new NotFoundException('Department not found');

    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');
    this.tenantScope.assertInScope(currentUser, department);

    const changes: Record<string, any> = {};
    if (data.name !== undefined) changes.name = validateText('name', data.name, 120, true);
    if (data.description !== undefined) changes.description = validateText('description', data.description, 1000);
    if (data.customFieldsSchema !== undefined) {
      if (!data.customFieldsSchema || typeof data.customFieldsSchema !== 'object' || Array.isArray(data.customFieldsSchema)) throw new BadRequestException('customFieldsSchema must be an object');
      changes.custom_fields_schema = data.customFieldsSchema;
    }
    if (data.is_active !== undefined) {
      if (typeof data.is_active !== 'boolean') throw new BadRequestException('is_active must be a boolean');
      changes.is_active = data.is_active;
    }
    if (Object.keys(changes).length === 0) throw new BadRequestException('No fields to update');
    if (changes.name && changes.name !== department.name) {
      const clash = await this.prisma.department.findFirst({
        where: { fellowship_id: department.fellowship_id, name: changes.name },
      });
      if (clash && clash.id !== id) throw new BadRequestException('This fellowship already has a department with that name');
    }

    const updated = await this.prisma.department.update({ where: { id }, data: changes });
    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.edit',
      entityType: 'department',
      entityId: id,
      oldValue: department,
      newValue: updated,
    });
    return updated;
  }

  async assignLeader(id: string, dto: AssignLeaderDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    this.tenantScope.assertInScope(currentUser, department);

    // The new leader must be an account of THIS department's fellowship. Before, any user id was accepted, so a
    // secretary could make an account of another fellowship a "leader" here (and have that fellowship's member see a
    // leadership role in a department that is not theirs).
    if (dto === null || typeof dto !== 'object') throw new BadRequestException('A JSON object is required');
    const userId = validateRequiredUuid('userId', dto.userId);
    if (dto.roleInDepartment !== 'department_secretary' && dto.roleInDepartment !== 'department_chairperson') {
      throw new BadRequestException('roleInDepartment must be department_secretary or department_chairperson');
    }
    const startDate = dto.startDate ? new Date(dto.startDate as string) : new Date();
    if (Number.isNaN(startDate.getTime())) throw new BadRequestException('startDate must be a valid date');
    const leader = await this.prisma.user.findUnique({ where: { id: userId }, select: { fellowship_id: true, deleted_at: true } });
    if (!leader || leader.deleted_at || !department.fellowship_id || leader.fellowship_id !== department.fellowship_id) {
      throw new BadRequestException('User not found in this fellowship');
    }

    await this.prisma.departmentLeader.create({
      data: {
        department_id: id,
        user_id: userId,
        role_in_department: dto.roleInDepartment,
        start_date: startDate,
        fellowship_id: this.tenantScope.resolveFellowshipId(currentUser, department.fellowship_id),
      },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.leader_assign',
      entityType: 'department',
      entityId: id,
      newValue: { userId, roleInDepartment: dto.roleInDepartment },
    });

    return this.findOne(id, currentUser);
  }

  async removeLeader(id: string, userId: string, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    this.tenantScope.assertInScope(currentUser, department);

    await this.prisma.departmentLeader.deleteMany({
      where: { department_id: id, user_id: userId },
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.leader_remove',
      entityType: 'department',
      entityId: id,
      newValue: { userId, removed: true },
    });

    return this.findOne(id, currentUser);
  }

  async getMembers(id: string, currentUser: any): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    const isDepartmentLeader =
      roles.includes('department_secretary') || roles.includes('department_chairperson');

    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    this.tenantScope.assertInScope(currentUser, department);

    if (isDepartmentLeader) {
      const userDeptId = currentUser.departmentId;
      if (department.id !== userDeptId) {
        throw new ForbiddenException('You can only access your own department.');
      }
    }

    const members = await this.prisma.member.findMany({
      where: { departmentMemberships: { some: { department_id: id, removed: false } } },
    });

    return members;
  }

  async transferRequest(dto: RequestTransferDto, currentUser: any): Promise<any> {
    validateRequiredUuid('memberId', dto?.memberId);
    validateRequiredUuid('fromDepartmentId', dto?.fromDepartmentId);
    validateRequiredUuid('toDepartmentId', dto?.toDepartmentId);
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('A JSON object is required');
    const reason = validateText('reason', dto.reason, 1000, true)!;
    const member = await this.prisma.member.findUnique({ where: { id: dto.memberId } });
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const fromDept = await this.prisma.department.findUnique({ where: { id: dto.fromDepartmentId } });
    if (!fromDept) {
      throw new NotFoundException('Source department not found');
    }
    this.tenantScope.assertInScope(currentUser, member);
    this.tenantScope.assertInScope(currentUser, fromDept);

    const toDept = await this.prisma.department.findUnique({ where: { id: dto.toDepartmentId } });
    if (!toDept) {
      throw new NotFoundException('Destination department not found');
    }
    this.tenantScope.assertInScope(currentUser, toDept);
    if (!member.fellowship_id || member.fellowship_id !== fromDept.fellowship_id || toDept.fellowship_id !== fromDept.fellowship_id) {
      throw new NotFoundException('Member or department not found');
    }

    if (dto.fromDepartmentId === dto.toDepartmentId) {
      throw new BadRequestException('Source and destination department must differ');
    }

    const activeMembership = await this.prisma.departmentMember.findFirst({
      where: { member_id: dto.memberId, department_id: dto.fromDepartmentId, removed: false },
    });
    if (!activeMembership) {
      throw new BadRequestException('Member is not an active member of the source department');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'department_transfer',
      dto.memberId,
      'member',
      currentUser.userId,
      { fromDepartmentId: dto.fromDepartmentId, toDepartmentId: dto.toDepartmentId, reason },
      fromDept.fellowship_id,
    );

    // Update steps with specific approver roles
    const steps = approval.steps as any[];
    await this.prisma.approvalStep.update({
      where: { id: steps[0].id },
      data: { approver_role: 'department_chairperson' },
    });
    await this.prisma.approvalStep.update({
      where: { id: steps[1].id },
      data: { approver_role: 'department_chairperson' },
    });
    await this.prisma.approvalStep.update({
      where: { id: steps[2].id },
      data: { approver_role: 'secretary' },
    });

    await this.approvalEngine.submit(approval.id);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department_transfer.request',
      entityType: 'member',
      entityId: dto.memberId,
      newValue: { fromDept: dto.fromDepartmentId, toDept: dto.toDepartmentId, reason },
      approvalInfo: { workflowId: approval.id },
    });

    return { approvalId: approval.id, status: 'submitted' };
  }

  async requestRemoval(departmentId: string, memberId: string, dto: RequestRemovalDto, currentUser: any): Promise<any> {
    validateRequiredUuid('departmentId', departmentId);
    validateRequiredUuid('memberId', memberId);
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('A JSON object is required');
    const reason = validateText('reason', dto.reason, 1000, true)!;
    const roles: string[] = currentUser.roles || [];
    const isDeptLeader =
      roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isDeptLeader) {
      throw new ForbiddenException('Only department leaders can request removal.');
    }

    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    this.tenantScope.assertInScope(currentUser, department);
    const member = await this.prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member not found');
    this.tenantScope.assertInScope(currentUser, member);
    if (!member.fellowship_id || member.fellowship_id !== department.fellowship_id) {
      throw new NotFoundException('Member or department not found');
    }

    const membership = await this.prisma.departmentMember.findFirst({
      where: { member_id: memberId, department_id: departmentId, removed: false },
    });
    if (!membership) {
      throw new BadRequestException('Member is not an active member of this department');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'department_removal',
      memberId,
      'member',
      currentUser.userId,
      { departmentId, reason },
      department.fellowship_id,
    );

    await this.approvalEngine.submit(approval.id);

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.member_remove_requested',
      entityType: 'member',
      entityId: memberId,
      newValue: { departmentId, reason },
      approvalInfo: { workflowId: approval.id },
    });

    return { approvalId: approval.id, status: 'submitted' };
  }
}
