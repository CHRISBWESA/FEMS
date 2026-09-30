import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AllowWhenPasswordChangeRequired } from '../shared/authorization/must-change-password.guard';
import { PlatformAccess } from '../shared/decorators/platform.decorators';
import { ImpersonationService } from './impersonation.service';

// Starting, listing and ending an impersonation session is platform work.
@PlatformAccess()
@Controller('platform/impersonations')
export class ImpersonationPlatformController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Get('targets')
  targets(@Req() req, @Query() q: Record<string, string>) {
    return this.impersonation.targets(req.user, q);
  }

  @Get()
  list(@Req() req, @Query() q: Record<string, string>) {
    return this.impersonation.list(req.user, q);
  }

  @Post()
  start(@Body() b: any, @Req() req) {
    return this.impersonation.start(req.user, b);
  }

  @Post(':id/end')
  end(@Param('id') id: string, @Body() b: any, @Req() req) {
    return this.impersonation.end(req.user, id, b);
  }
}

// The account holder's side. Deliberately NOT marked @PlatformAccess(): an administrator must not be able to
// reach it, and the person being acted as must be able to. It is also open to a platform account, which simply
// finds nothing.
@UseGuards(JwtAuthGuard)
@Controller('impersonation')
export class ImpersonationClientController {
  constructor(private readonly impersonation: ImpersonationService) {}

  // Both routes carry @AllowWhenPasswordChangeRequired(): someone on a temporary password must still be able to
  // SEE that a platform administrator is acting as them, and to END it. Revocation must never be gated behind a
  // change they are unable to make.
  @Get('active')
  @AllowWhenPasswordChangeRequired()
  active(@Req() req) {
    return this.impersonation.myActiveSession(req.user);
  }

  @Post('active/end')
  @AllowWhenPasswordChangeRequired()
  end(@Body() b: any, @Req() req) {
    return this.impersonation.end(req.user, b?.sessionId ?? '', b, { asClient: true });
  }
}
