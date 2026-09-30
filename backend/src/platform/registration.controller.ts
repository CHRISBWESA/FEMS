import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PUBLIC_THROTTLE } from '../shared/throttle';
import { Public } from '../shared/decorators/public.decorator';
import { PlatformAccess } from '../shared/decorators/platform.decorators';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { FellowshipRegistrationService } from './platform-registration.service';

// Self-service signup. The submit route is the only unauthenticated write in the platform surface: it stores a
// request and grants nothing. Everything that turns a request into a working fellowship lives on the
// platform routes below, behind @PlatformAccess() and the platform.* permissions.
@Controller('registrations')
export class RegistrationPublicController {
  constructor(private readonly registrations: FellowshipRegistrationService) {}

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Get('plans')
  plans() {
    return this.registrations.publicPlans();
  }

  @Public()
  @Throttle(PUBLIC_THROTTLE)
  @Post()
  submit(@Body() b: any) {
    return this.registrations.submit(b);
  }
}

// The administrator's review queue.
@PlatformAccess()
@Roles(ROLES.ADMIN, ROLES.PLATFORM_SUPPORT)
@Controller('platform/registrations')
export class RegistrationPlatformController {
  constructor(private readonly registrations: FellowshipRegistrationService) {}

  @Get()
  list(@Req() req, @Query() q: Record<string, string>) {
    return this.registrations.list(req.user, q);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req) {
    return this.registrations.get(req.user, id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() b: any, @Req() req) {
    return this.registrations.approve(req.user, id, b);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() b: any, @Req() req) {
    return this.registrations.reject(req.user, id, b);
  }
}
