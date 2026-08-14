import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  SetMetadata,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { ImpersonationSession } from '../shared/schemas/system.schema';
import { User } from '../users/schemas/user.schema';
import { Model, Types } from 'mongoose';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { Roles } from '../shared/decorators/role.decorators';
import { Public } from '../shared/decorators/public.decorator';
import { ROLES } from '../shared/authorization/roles';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
    @InjectModel(ImpersonationSession.name)
    private impersonationModel: Model<ImpersonationSession>,
    @InjectModel(User.name) private userModel: Model<User>,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Public()
  @Post('login')
  async login(@Req() req) {
    return this.authService.login(req.user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req, @Res({ passthrough: true }) res) {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return { message: 'Logged out' };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req) {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token required');
    }
    return this.authService.refreshToken(refreshToken);
  }

  @Post('change-password')
  async changePassword(@Req() req, @Body() body) {
    return this.authService.changePassword(
      req.user.userId,
      body.oldPassword,
      body.newPassword,
    );
  }

  @Post('reset-password')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async resetPassword(@Body() body: { targetUserId: string }, @Req() req) {
    const userRoles: string[] = req.user.roles || [];
    if (!userRoles.includes('admin') &&
        !userRoles.includes('secretary') &&
        !userRoles.includes('assistant_secretary')) {
      const isITDept = req.user.departmentId &&
        (userRoles.includes('department_secretary') || userRoles.includes('department_chairperson'));
      if (!isITDept) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }
    return this.authService.resetPassword(body.targetUserId, req.user.userId);
  }

  @Post('request-impersonation')
  @Roles(ROLES.ADMIN)
  async requestImpersonation(
    @Body() body: { targetUserId: string; reason: string },
    @Req() req,
  ) {
    if (body.targetUserId === req.user.userId) {
      throw new BadRequestException('Cannot impersonate yourself');
    }

    const targetUser = await this.userModel.findById(body.targetUserId).exec();
    if (!targetUser) {
      throw new BadRequestException('Target user not found');
    }

    const targetRoles: string[] = targetUser.roles || [];
    if (targetRoles.includes('admin')) {
      throw new ForbiddenException('Cannot impersonate another Admin');
    }

    const approvalToken = require('crypto').randomBytes(32).toString('hex');

    const session = await this.impersonationModel.create({
      admin_user_id: new Types.ObjectId(req.user.userId),
      target_user_id: new Types.ObjectId(body.targetUserId),
      approval_token: approvalToken,
      status: 'requested',
      requested_at: new Date(),
    });

    await this.notificationEngine.create({
      recipientUserId: body.targetUserId,
      eventType: 'impersonation_requested',
      title: 'Impersonation Request',
      message: `Admin ${req.user.firstName} ${req.user.lastName} has requested to impersonate your account. Reason: ${body.reason}`,
      entityType: 'impersonation_session',
      entityId: session._id.toString(),
      actorUserId: req.user.userId,
    });

    await this.auditService.log({
      userId: req.user.userId,
      action: 'impersonation.request',
      entityType: 'impersonation_session',
      entityId: session._id.toString(),
      comment: body.reason,
    });

    return {
      message: 'Impersonation request sent. Waiting for approval.',
      sessionId: session._id,
    };
  }

  @Public()
  @Post('approve-impersonation/:token')
  async approveImpersonation(@Req() req) {
    const token = req.params?.token || req.body?.token;
    if (!token) {
      throw new BadRequestException('Approval token required');
    }

    const session = await this.impersonationModel
      .findOne({ approval_token: token })
      .exec();
    if (!session) {
      throw new BadRequestException('Invalid or expired approval token');
    }

    if (session.status !== 'requested') {
      throw new BadRequestException('This impersonation request is no longer valid.');
    }

    session.status = 'active';
    session.approved_at = new Date();
    session.started_at = new Date();
    session.expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await session.save();

    await this.notificationEngine.create({
      recipientUserId: session.admin_user_id.toString(),
      eventType: 'impersonation_approved',
      title: 'Impersonation Started',
      message: 'Impersonation session started. It will auto-expire in 10 minutes.',
      entityType: 'impersonation_session',
      entityId: session._id.toString(),
    });

    await this.auditService.log({
      userId: session.target_user_id.toString(),
      action: 'impersonation.approve',
      entityType: 'impersonation_session',
      entityId: session._id.toString(),
      comment: 'Impersonation approved by account owner',
    });

    const targetUser = await this.userModel.findById(session.target_user_id).exec();
    const payload = {
      sub: targetUser._id,
      email: targetUser.email,
      roles: targetUser.roles,
      permissions: targetUser.permissions,
      departmentId: targetUser.department_id,
      impersonating: true,
      impersonationSessionId: session._id.toString(),
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: '10m' as any });

    return { accessToken, message: 'Impersonation started for 10 minutes' };
  }

  @Post('cancel-impersonation')
  @Roles(ROLES.ADMIN)
  async cancelImpersonation(@Req() req) {
    const impersonationSessionId = req.user.impersonationSessionId;
    if (!impersonationSessionId) {
      throw new BadRequestException('No active impersonation session');
    }

    const session = await this.impersonationModel.findById(impersonationSessionId).exec();
    if (!session) {
      throw new BadRequestException('Impersonation session not found');
    }

    session.status = 'cancelled';
    session.ended_at = new Date();
    await session.save();

    await this.auditService.log({
      userId: session.admin_user_id.toString(),
      action: 'impersonation.cancel',
      entityType: 'impersonation_session',
      entityId: session._id.toString(),
    });

    return { message: 'Impersonation cancelled' };
  }
}
