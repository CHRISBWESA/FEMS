import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User } from '../users/schemas/user.schema';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { RoleName, ROLE_DEFINITIONS } from '../shared/authorization/roles';
import { Permission } from '../shared/authorization/permissions';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwtService: JwtService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userModel.findOne({ email: email.trim().toLowerCase() }).exec();
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    return {
      userId: user._id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      roles: user.roles,
      permissions: user.permissions,
      departmentId: user.department_id,
      mustChangePassword: user.must_change_password,
    };
  }

  async login(user: any) {
    const payload = {
      sub: user.userId,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      departmentId: user.departmentId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.userId, tokenType: 'refresh' },
      { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any },
    );

    await this.auditService.log({
      userId: user.userId,
      action: 'auth.login',
      comment: `User logged in`,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.roles,
      },
    };
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roles: RoleName[];
    departments?: string[];
  }) {
    const existingUser = await this.userModel.findOne({ email: data.email }).exec();
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);

    const roleConfigs = ROLE_DEFINITIONS.filter((r) => data.roles.includes(r.name));
    const allPermissions = roleConfigs.flatMap((r) => r.permissions);

    const user = new this.userModel({
      email: data.email,
      password_hash: passwordHash,
      first_name: data.firstName,
      last_name: data.lastName,
      roles: data.roles,
      permissions: allPermissions,
      is_active: true,
      must_change_password: false,
    });

    await user.save();

    await this.auditService.log({
      userId: user._id.toString(),
      action: 'user.create',
      comment: `User created with roles: ${data.roles.join(', ')}`,
    });

    return { id: user._id, email: user.email, roles: user.roles };
  }

  async refreshToken(refreshToken: string) {
    const decoded = this.jwtService.verify(refreshToken, {
      ignoreExpiration: false,
    });
    if (decoded.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.userModel.findById(decoded.sub).exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const payload = {
      sub: user._id,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      departmentId: user.department_id,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any,
    });

    return { accessToken };
  }

  async resetPassword(targetUserId: string, requesterUserId: string) {
    const targetUser = await this.userModel.findById(targetUserId).exec();
    if (!targetUser) {
      throw new UnauthorizedException('Target user not found');
    }

    const resetToken = this.generateSecureToken();
    const tempPassword = this.generateSecurePassword();

    targetUser.password_hash = await bcrypt.hash(tempPassword, 12);
    targetUser.must_change_password = true;
    await targetUser.save();

    await this.notificationEngine.create({
      recipientUserId: targetUserId,
      eventType: 'password_reset',
      title: 'Password Reset',
      message: 'Your password was reset. Please use the reset link sent to your email or contact your administrator to get the temporary password.',
      actorUserId: requesterUserId,
    });

    await this.auditService.log({
      userId: requesterUserId,
      action: 'password.reset',
      entityType: 'user',
      entityId: targetUserId,
      comment: 'Password reset by authorized user',
    });

    return {
      resetToken,
      temporaryPassword: tempPassword,
      message: 'Password reset successful. Share the temporary password with the user.',
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.password_hash = await bcrypt.hash(newPassword, 12);
    user.must_change_password = false;
    await user.save();

    await this.auditService.log({
      userId: userId,
      action: 'password.change',
      comment: 'User changed their own password',
    });

    return { message: 'Password changed successfully' };
  }

  private generateSecureToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  private generateSecurePassword(): string {
    return '123456789';
  }
}
