
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { Role } from './schemas/role.schema';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { ROLE_DEFINITIONS, ROLES, RoleName } from '../shared/authorization/roles';

export interface CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  gender?: string;
  roles?: RoleName[];
  departmentId?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Role.name) private roleModel: Model<Role>,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  private async getRequesterRoles(requesterUserId?: string): Promise<string[]> {
    if (!requesterUserId) return [];
    const requester = await this.userModel.findById(requesterUserId).exec();
    return requester?.roles || [];
  }

  private assertCanAssignRoles(requesterRoles: string[], roles: string[]) {
    if (requesterRoles.includes(ROLES.ADMIN)) {
      const invalid = roles.filter((r) => r !== ROLES.SECRETARY);
      if (invalid.length > 0) {
        throw new ForbiddenException('Admin can only create secretary accounts');
      }
      return;
    }
    if (requesterRoles.includes(ROLES.SECRETARY)) {
      if (roles.includes(ROLES.ADMIN)) {
        throw new ForbiddenException('Only an admin can assign the admin role');
      }
      return;
    }
    throw new ForbiddenException('You do not have permission to assign roles');
  }

  private async assertCanManageTarget(requesterUserId: string, targetRoles: string[]) {
    const requesterRoles = await this.getRequesterRoles(requesterUserId);
    if (targetRoles.includes(ROLES.ADMIN) && !requesterRoles.includes(ROLES.ADMIN)) {
      throw new ForbiddenException('Only an admin can manage admin accounts');
    }
  }

  async create(dto: CreateUserDto, requesterUserId: string) {
    const email = dto.email?.trim().toLowerCase();
    if (!email || !dto.password || !dto.firstName || !dto.lastName) {
      throw new BadRequestException('email, password, firstName and lastName are required');
    }

    const existing = await this.userModel.findOne({ email }).exec();
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    const requesterRoles = await this.getRequesterRoles(requesterUserId);

    let roles: RoleName[];
    if (dto.roles && dto.roles.length > 0) {
      roles = dto.roles;
    } else if (requesterRoles.includes(ROLES.ADMIN)) {
      roles = [ROLES.SECRETARY];
    } else {
      roles = [ROLE_DEFINITIONS[ROLE_DEFINITIONS.length - 1].name];
    }

    const invalidRoles = roles.filter((r) => !ROLE_DEFINITIONS.some((cfg) => cfg.name === r));
    if (invalidRoles.length > 0) {
      throw new BadRequestException(`Invalid role(s): ${invalidRoles.join(', ')}`);
    }

    this.assertCanAssignRoles(requesterRoles, roles);

    const roleConfigs = ROLE_DEFINITIONS.filter((r) => roles.includes(r.name));
    const allPermissions = roleConfigs.flatMap((r) => r.permissions);

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = new this.userModel({
      email,
      password_hash: passwordHash,
      first_name: dto.firstName.trim(),
      last_name: dto.lastName.trim(),
      phone: dto.phone,
      gender: dto.gender,
      roles,
      permissions: allPermissions,
      department_id: dto.departmentId ? new Types.ObjectId(dto.departmentId) : undefined,
      is_active: true,
      must_change_password: false,
    });

    await user.save();

    await this.auditService.log({
      userId: requesterUserId,
      action: 'user.create',
      entityType: 'user',
      entityId: user._id.toString(),
      newValue: { email, roles, departmentId: dto.departmentId || null },
      comment: `Created user with roles: ${roles.join(', ')}`,
    });

    await this.notificationEngine.create({
      recipientUserId: user._id.toString(),
      eventType: 'account_created',
      title: 'Account Created',
      message: `Your fellowship account has been created. Please log in and change your password.`,
      entityType: 'user',
      entityId: user._id.toString(),
      actorUserId: requesterUserId,
    });

    return { id: user._id, email: user.email, roles: user.roles };
  }

  async findAll(
    filters?: {
      role?: string;
      isActive?: boolean;
      page?: number;
      limit?: number;
    },
    requesterUserId?: string,
  ): Promise<{ data: any[]; total: number }> {
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.max(1, Math.min(100, filters?.limit || 50));
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {};
    if (filters?.role) {
      query.roles = filters.role;
    }
    if (filters?.isActive !== undefined) {
      query.is_active = filters.isActive;
    }

    // Admin manages secretaries only; Secretary manages all non-admin accounts.
    const requesterRoles = requesterUserId ? await this.getRequesterRoles(requesterUserId) : [];
    if (requesterRoles.includes(ROLES.ADMIN)) {
      query.roles = ROLES.SECRETARY;
    } else if (requesterRoles.includes(ROLES.SECRETARY)) {
      query.roles = { $ne: ROLES.ADMIN };
    } else {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    const [data, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('-password_hash')
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async findOne(id: string): Promise<any> {
    const user = await this.userModel.findById(id).select('-password_hash').exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(
    id: string,
    dto: Partial<CreateUserDto>,
    requesterUserId: string,
  ): Promise<any> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertCanManageTarget(requesterUserId, user.roles);

    const changes: Record<string, any> = {};

    if (dto.email !== undefined && dto.email.trim() !== user.email) {
      const email = dto.email.trim().toLowerCase();
      if (!email) {
        throw new BadRequestException('Email cannot be empty');
      }
      const existing = await this.userModel.findOne({ email, _id: { $ne: user._id } }).exec();
      if (existing) {
        throw new BadRequestException('A user with this email already exists');
      }
      changes.email = email;
    }

    if (dto.firstName !== undefined) {
      const firstName = dto.firstName.trim();
      if (!firstName) throw new BadRequestException('First name cannot be empty');
      changes.first_name = firstName;
    }

    if (dto.lastName !== undefined) {
      const lastName = dto.lastName.trim();
      if (!lastName) throw new BadRequestException('Last name cannot be empty');
      changes.last_name = lastName;
    }

    if (dto.phone !== undefined) changes.phone = dto.phone;
    if (dto.gender !== undefined) changes.gender = dto.gender;

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const oldValue: Record<string, any> = {};
    for (const key of Object.keys(changes)) {
      oldValue[key] = user[key];
    }

    Object.assign(user, changes);
    await user.save();

    await this.auditService.log({
      userId: requesterUserId,
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
      actorUserId: requesterUserId,
    });

    return { id: user._id, email: user.email, firstName: user.first_name, lastName: user.last_name };
  }

  async assignRoles(userId: string, roles: RoleName[], requesterUserId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const roleConfigs = ROLE_DEFINITIONS.filter((r) => roles.includes(r.name));
    const allPermissions = roleConfigs.flatMap((r) => r.permissions);

    const requesterRoles = await this.getRequesterRoles(requesterUserId);
    this.assertCanAssignRoles(requesterRoles, roles);
    await this.assertCanManageTarget(requesterUserId, user.roles);

    const oldRoles = [...user.roles];
    const oldPermissions = [...user.permissions];

    user.roles = roles;
    user.permissions = allPermissions;
    await user.save();

    await this.auditService.log({
      userId: requesterUserId,
      action: 'user.roles_change',
      entityType: 'user',
      entityId: userId,
      oldValue: { roles: oldRoles, permissions: oldPermissions },
      newValue: { roles, permissions: allPermissions },
    });

    return { id: user._id, email: user.email, roles: user.roles };
  }

  async setActive(userId: string, isActive: boolean, requesterUserId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertCanManageTarget(requesterUserId, user.roles);

    const oldStatus = user.is_active;
    user.is_active = isActive;
    await user.save();

    await this.auditService.log({
      userId: requesterUserId,
      action: 'user.status_change',
      entityType: 'user',
      entityId: userId,
      oldValue: { is_active: oldStatus },
      newValue: { is_active: isActive },
    });

    return { message: 'User status updated' };
  }

  async delete(userId: string, requesterUserId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.assertCanManageTarget(requesterUserId, user.roles);

    user.is_active = false;
    user.deleted_at = new Date();
    await user.save();

    await this.auditService.log({
      userId: requesterUserId,
      action: 'user.delete',
      entityType: 'user',
      entityId: userId,
      comment: 'User account deactivated',
    });

    return { message: 'User deactivated' };
  }

  async getPermissions(): Promise<any[]> {
    return this.roleModel.find().exec();
  }

  async getRoles(): Promise<any[]> {
    return this.roleModel.find().select('-_id name description permissions').exec();
  }
}
