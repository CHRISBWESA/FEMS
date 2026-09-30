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
  GoneException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { NotificationEngineService } from '../shared/notifications/notification-engine.service';
import { Roles } from '../shared/decorators/role.decorators';
import { Public } from '../shared/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { AllowWhenPasswordChangeRequired } from '../shared/authorization/must-change-password.guard';
import { AUTH_THROTTLE } from '../shared/throttle';
import { ROLES } from '../shared/authorization/roles';
import { PlatformAccess } from '../shared/decorators/platform.decorators';

@PlatformAccess()
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationEngine: NotificationEngineService,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(@Req() req) {
    return this.authService.login(req.user);
  }

  @AllowWhenPasswordChangeRequired()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req, @Res({ passthrough: true }) res) {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    return { message: 'Logged out' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  async refresh(@Req() req) {
    const refreshToken = req.body?.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new BadRequestException('Refresh token required');
    }
    return this.authService.refreshToken(refreshToken);
  }

  @Throttle(AUTH_THROTTLE)
  @AllowWhenPasswordChangeRequired()
  @Post('change-password')
  async changePassword(@Req() req, @Body() body) {
    return this.authService.changePassword(
      req.user.userId,
      body.oldPassword,
      body.newPassword,
    );
  }

  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @Roles(ROLES.ADMIN, ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY)
  async resetPassword(@Body() body: { targetUserId: string }, @Req() req) {
    return this.authService.resetPassword(body.targetUserId, {
      userId: req.user.userId,
      roles: req.user.roles,
      // The service decides on the `user.password_reset` permission rather than on a job title, so it has to be
      // passed through here - it lives in the token, not in the role list.
      permissions: req.user.permissions,
      fellowshipId: req.user.fellowshipId,
    });
  }

  // Impersonation used to live here and returned 410 on every route. It now lives in
  // /platform/impersonations, where it is time-boxed, audited against both parties, notified to the account
  // holder and revocable by them. These stubs are kept so the old URLs answer clearly instead of 404, and so
  // any client still calling them is pointed at the replacement.
  @Post('request-impersonation')
  @Roles(ROLES.ADMIN)
  requestImpersonation() {
    throw new GoneException('This endpoint has moved. Use POST /api/v1/platform/impersonations instead.');
  }

  @Public()
  @Post('approve-impersonation/:token')
  approveImpersonation() {
    throw new GoneException('This endpoint has moved. Use POST /api/v1/platform/impersonations instead.');
  }

  @Post('cancel-impersonation')
  @Roles(ROLES.ADMIN)
  cancelImpersonation() {
    throw new GoneException('This endpoint has moved. Use POST /api/v1/platform/impersonations/:id/end instead.');
  }
}
