import { Injectable, UnauthorizedException, ForbiddenException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { assertPasswordPolicy } from '../shared/utils/password-policy.util';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { PLATFORM_ROLES, ROLES, permissionsForRoles, RoleName } from '../shared/authorization/roles';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { isPlatformPrincipal } from '../shared/authorization/platform-boundary.guard';
import { isUuid } from '../shared/utils/uuid.util';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  // Precomputed so that "no such account" costs the same as "wrong password" (no user enumeration by timing).
  private static readonly DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
  private static readonly MAX_FAILED_LOGINS = 8;
  private static readonly LOCK_MINUTES = 15;

  async validateUser(email: string, password: string): Promise<any> {
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 254 || password.length > 1024) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user || user.deleted_at) {
      await bcrypt.compare(password, AuthService.DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }
    // A locked account answers exactly like a wrong password: an attacker learns nothing, the owner waits it out.
    if (user.locked_until && user.locked_until > new Date()) {
      await bcrypt.compare(password, AuthService.DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      await this.recordFailedLogin(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active || user.deleted_at) {
      throw new UnauthorizedException('Account is deactivated');
    }
    await this.assertTenantActive(user.fellowship_id, user.roles);
    if (user.failed_login_count > 0 || user.locked_until) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failed_login_count: 0, last_failed_login_at: null, locked_until: null } });
    }

    return {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      roles: user.roles,
      permissions: permissionsForRoles(user.roles),
      departmentId: user.department_id,
      mustChangePassword: user.must_change_password,
      tokenVersion: user.token_version,
    };
  }

  // Counts failures inside a 15-minute window and locks the account for 15 minutes after 8 of them. One atomic
  // statement, so parallel guesses cannot slip past the counter.
  private async recordFailedLogin(user: { id: string; fellowship_id: string | null }): Promise<void> {
    // timezone('UTC', now()) is "now" as the UTC wall-clock value Prisma stores in these timestamp columns, whatever the
    // database session time zone is (a bare now() would be stored as local time and skew the window and the lock).
    const rows = await this.prisma.$queryRaw<{ failed_login_count: number }[]>`
      UPDATE users SET
        failed_login_count = CASE WHEN last_failed_login_at IS NOT NULL AND last_failed_login_at > timezone('UTC', now()) - interval '15 minutes' THEN failed_login_count + 1 ELSE 1 END,
        last_failed_login_at = timezone('UTC', now()),
        locked_until = CASE WHEN (CASE WHEN last_failed_login_at IS NOT NULL AND last_failed_login_at > timezone('UTC', now()) - interval '15 minutes' THEN failed_login_count + 1 ELSE 1 END) >= ${AuthService.MAX_FAILED_LOGINS}
                            THEN timezone('UTC', now()) + (${AuthService.LOCK_MINUTES} * interval '1 minute') ELSE locked_until END
      WHERE id = ${user.id}::uuid
      RETURNING failed_login_count`;
    if (rows[0]?.failed_login_count === AuthService.MAX_FAILED_LOGINS) {
      await this.auditService.log({ userId: user.id, action: 'auth.account_locked', entityType: 'user', entityId: user.id, fellowshipId: user.fellowship_id, comment: `Locked for ${AuthService.LOCK_MINUTES} minutes after repeated failed sign-ins` });
    }
  }

  async login(user: any) {
    const payload = {
      sub: user.userId,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      departmentId: user.departmentId,
      mustChangePassword: !!user.mustChangePassword,
      tv: user.tokenVersion ?? 0,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.userId, tokenType: 'refresh', tv: user.tokenVersion ?? 0 },
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
        permissions: user.permissions,
        mustChangePassword: !!user.mustChangePassword,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    let decoded: any;
    try {
      decoded = this.jwtService.verify(refreshToken, { ignoreExpiration: false });
    } catch {
      throw new UnauthorizedException('Invalid token'); // was an uncaught error (500) for a malformed or expired token
    }
    if (decoded.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || user.deleted_at || !user.is_active) {
      throw new UnauthorizedException('User not found');
    }
    // A password change/reset ends every session issued before it.
    if ((decoded.tv ?? 0) !== user.token_version) throw new UnauthorizedException('Session expired');
    await this.assertTenantActive(user.fellowship_id, user.roles);

    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      permissions: permissionsForRoles(user.roles),
      departmentId: user.department_id,
      mustChangePassword: user.must_change_password,
      tv: user.token_version,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as any,
    });

    return { accessToken };
  }

  // Reset a user's password and hand back a one-time temporary password. Who may reset whom:
  //  - nobody resets a platform administrator (they change their own password);
  //  - a fellowship administrator resets ANY role in their OWN fellowship - that is the whole point of the role,
  //    so an account is not protected by the job title it happens to hold;
  //  - nobody reaches an account outside their own fellowship, and no platform account at all.
  async resetPassword(targetUserId: string, requester: { userId: string; roles?: string[]; permissions?: string[]; fellowshipId?: string | null }) {
    if (!isUuid(targetUserId)) throw new NotFoundException('Target user not found');
    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser || targetUser.deleted_at) {
      throw new NotFoundException('Target user not found');
    }
    const requesterRoles = requester.roles || [];
    const targetRoles = targetUser.roles || [];
    if (requester.userId === targetUserId) {
      throw new ForbiddenException('Use the change-password endpoint for your own account.');
    }
    if (targetRoles.includes(ROLES.ADMIN)) {
      throw new ForbiddenException('Platform administrator accounts cannot be reset by another user.');
    }
    if (!requesterRoles.includes(ROLES.ADMIN)) {
      if (!(requester.permissions || []).includes(PERMISSIONS.USER_PASSWORD_RESET)) {
        throw new ForbiddenException('You do not have permission to reset passwords.');
      }
      if (targetRoles.some((role) => PLATFORM_ROLES.has(role as RoleName))) {
        throw new ForbiddenException('You do not have access to this record');
      }
      if (!requester.fellowshipId || targetUser.fellowship_id !== requester.fellowshipId) {
        throw new ForbiddenException('You do not have access to this record');
      }
    }
    const requesterUserId = requester.userId;

    const resetToken = this.generateSecureToken();
    const tempPassword = this.generateSecurePassword();

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        password_hash: await bcrypt.hash(tempPassword, 12),
        must_change_password: true,
        token_version: { increment: 1 }, // signs the account out everywhere
        password_changed_at: new Date(),
        failed_login_count: 0,
        last_failed_login_at: null,
        locked_until: null,
      },
    });

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
      fellowshipId: targetUser.fellowship_id,
    });

    return {
      resetToken,
      temporaryPassword: tempPassword,
      message: 'Password reset successful. Share the temporary password with the user; they must change it at their next login.',
    };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') throw new BadRequestException('oldPassword and newPassword are required.');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deleted_at || !user.is_active) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    assertPasswordPolicy(newPassword, { email: user.email, firstName: user.first_name, lastName: user.last_name });
    if (newPassword === oldPassword) throw new BadRequestException('The new password must be different from the current one.');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password_hash: await bcrypt.hash(newPassword, 12),
        must_change_password: false,
        token_version: { increment: 1 }, // every token issued before this moment stops working (other devices, stolen tokens)
        password_changed_at: new Date(),
        failed_login_count: 0,
        last_failed_login_at: null,
        locked_until: null,
      },
    });

    await this.auditService.log({
      userId: userId,
      action: 'password.change',
      comment: 'User changed their own password',
    });

    // The caller keeps working: they get a fresh session bound to the new token version.
    const session = await this.login({
      userId: updated.id, email: updated.email, firstName: updated.first_name, lastName: updated.last_name, roles: updated.roles,
      permissions: permissionsForRoles(updated.roles), departmentId: updated.department_id, mustChangePassword: false, tokenVersion: updated.token_version,
    });
    return { message: 'Password changed successfully', accessToken: session.accessToken, refreshToken: session.refreshToken };
  }

  private generateSecureToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  // Was the constant '123456789' for every reset - anyone could take over an account right after a reset.
  private generateSecurePassword(): string {
    return randomBytes(12).toString('base64url');
  }

  private async assertTenantActive(fellowshipId: string | null, roles: string[]): Promise<void> {
    if (isPlatformPrincipal(roles) || !fellowshipId) return;
    const f = await this.prisma.fellowship.findUnique({ where: { id: fellowshipId }, select: { status: true } });
    if (!f || f.status !== 'active') {
      throw new ForbiddenException('Your fellowship is currently suspended. Please contact the platform administrator.');
    }
  }
}
