import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Department } from '../shared/schemas/members-departments.schema';
import { Member } from '../shared/schemas/members-departments.schema';
import { ApprovalEngineService } from '../shared/approval-engine/approval-engine.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';

export interface CreateDepartmentDto {
  name: string;
  description?: string;
  customFieldsSchema?: Record<string, unknown>;
  is_active?: boolean;
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
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    @InjectModel(Member.name) private memberModel: Model<Member>,
    private approvalEngine: ApprovalEngineService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  async findAll(currentUser: any): Promise<Department[]> {
    return this.departmentModel.find({ is_active: true }).exec();
  }

  async findOne(id: string, currentUser: any): Promise<Department> {
    const department = await this.departmentModel.findById(id).exec();
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }

  async create(data: CreateDepartmentDto, currentUser: any): Promise<Department> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const existing = await this.departmentModel.findOne({ name: data.name }).exec();
    if (existing) {
      throw new BadRequestException('Department already exists');
    }

    const department = await this.departmentModel.create({
      name: data.name,
      description: data.description,
      is_active: true,
      leaders: [],
      custom_fields_schema: data.customFieldsSchema || {},
      created_by: new Types.ObjectId(currentUser.userId),
    });

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.create',
      entityType: 'department',
      entityId: department._id.toString(),
      newValue: { name: data.name, description: data.description },
    });

    return department;
  }

  async update(id: string, data: Partial<CreateDepartmentDto>, currentUser: any): Promise<Department> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin') && !roles.includes('assistant_secretary')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const department = await this.departmentModel.findById(id).exec();
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    if (data.name) department.name = data.name;
    if (data.description) department.description = data.description;
    if (data.customFieldsSchema) department.custom_fields_schema = data.customFieldsSchema;
    if (data.is_active !== undefined) department.is_active = data.is_active;

    await department.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.edit',
      entityType: 'department',
      entityId: id,
      newValue: (department as any).toObject(),
    });

    return department;
  }

  async assignLeader(id: string, dto: AssignLeaderDto, currentUser: any): Promise<Department> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const department = await this.departmentModel.findById(id).exec();
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    department.leaders.push({
      user_id: new Types.ObjectId(dto.userId),
      role_in_department: dto.roleInDepartment,
      start_date: dto.startDate ? new Date(dto.startDate) : new Date(),
    });

    await department.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.leader_assign',
      entityType: 'department',
      entityId: id,
      newValue: { userId: dto.userId, roleInDepartment: dto.roleInDepartment },
    });

    return department;
  }

  async removeLeader(id: string, userId: string, currentUser: any): Promise<Department> {
    const roles: string[] = currentUser.roles || [];
    if (!roles.includes('secretary') && !roles.includes('admin')) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const department = await this.departmentModel.findById(id).exec();
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    department.leaders = department.leaders.filter((l) => l.user_id.toString() !== userId);
    await department.save();

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.leader_remove',
      entityType: 'department',
      entityId: id,
      newValue: { userId, removed: true },
    });

    return department;
  }

  async getMembers(id: string, currentUser: any): Promise<any[]> {
    const roles: string[] = currentUser.roles || [];
    const isDepartmentLeader =
      roles.includes('department_secretary') || roles.includes('department_chairperson');

    const department = await this.departmentModel.findById(id).exec();
    if (!department) {
      throw new NotFoundException('Department not found');
    }

    if (isDepartmentLeader) {
      const userDeptId = currentUser.departmentId;
      if (!department._id.equals(userDeptId)) {
        throw new ForbiddenException('You can only access your own department.');
      }
    }

    const members = await this.memberModel
      .find({ 'departments.department_id': new Types.ObjectId(id), 'departments.removed': false })
      .exec();

    return members;
  }

  async transferRequest(dto: RequestTransferDto, currentUser: any): Promise<any> {
    const member = await this.memberModel.findById(dto.memberId).exec();
    if (!member) {
      throw new NotFoundException('Member not found');
    }

    const fromDept = await this.departmentModel.findById(dto.fromDepartmentId).exec();
    if (!fromDept) {
      throw new NotFoundException('Source department not found');
    }

    const toDept = await this.departmentModel.findById(dto.toDepartmentId).exec();
    if (!toDept) {
      throw new NotFoundException('Destination department not found');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'department_transfer',
      dto.memberId,
      'member',
      currentUser.userId,
    );

    // Update steps with specific approvers
    (approval as any).steps[0].approver_role = 'department_chairperson';
    (approval as any).steps[0].approver_user_id = new Types.ObjectId(dto.fromDepartmentId);
    (approval as any).steps[1].approver_role = 'department_chairperson';
    (approval as any).steps[2].approver_role = 'secretary';
    await (approval as any).save();

    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department_transfer.request',
      entityType: 'member',
      entityId: dto.memberId,
      newValue: { fromDept: dto.fromDepartmentId, toDept: dto.toDepartmentId, reason: dto.reason },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return { approvalId: approval._id, status: 'submitted' };
  }

  async requestRemoval(departmentId: string, memberId: string, dto: RequestRemovalDto, currentUser: any): Promise<any> {
    const roles: string[] = currentUser.roles || [];
    const isDeptLeader =
      roles.includes('department_secretary') || roles.includes('department_chairperson');

    if (!isDeptLeader) {
      throw new ForbiddenException('Only department leaders can request removal.');
    }

    const approval = await this.approvalEngine.createWorkflow(
      'department_removal',
      memberId,
      'member',
      currentUser.userId,
    );

    await this.approvalEngine.submit(approval._id.toString());

    await this.auditService.log({
      userId: currentUser.userId,
      action: 'department.member_remove_requested',
      entityType: 'member',
      entityId: memberId,
      newValue: { departmentId, reason: dto.reason },
      approvalInfo: { workflowId: approval._id.toString() },
    });

    return { approvalId: approval._id, status: 'submitted' };
  }
}
