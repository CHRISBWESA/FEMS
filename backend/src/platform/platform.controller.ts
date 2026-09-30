import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformOnboardingService } from './platform-onboarding.service';
import { PlatformSupportService } from './platform-support.service';
import { PlatformStaffService } from './platform-staff.service';
import { AuditQueryService } from '../audit/audit.service';
import { PlatformAccess } from '../shared/decorators/platform.decorators';
import { Roles } from '../shared/decorators/role.decorators';
import { ROLES } from '../shared/authorization/roles';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { requirePermission } from './platform.util';

// Platform administration. Coarse role gate here; every service method checks the specific platform.*
// permission. None of these routes returns a fellowship's operational data.
@PlatformAccess()
@Roles(ROLES.ADMIN, ROLES.PLATFORM_SUPPORT)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly onboarding: PlatformOnboardingService,
    private readonly support: PlatformSupportService,
    private readonly staff: PlatformStaffService,
    private readonly audit: AuditQueryService,
  ) {}

  @Get('dashboard')
  dashboard(@Req() req) { return this.tenants.dashboard(req.user); }

  // ---- tenants ----
  @Get('tenants')
  list(@Req() req, @Query() q: Record<string, string>) { return this.tenants.list(req.user, q); }
  @Get('tenants/:id')
  get(@Param('id') id: string, @Req() req) { return this.tenants.get(req.user, id); }
  @Put('tenants/:id')
  update(@Param('id') id: string, @Body() b: any, @Req() req) { return this.tenants.update(req.user, id, b); }
  @Post('tenants/:id/suspend')
  suspend(@Param('id') id: string, @Body() b: any, @Req() req) { return this.tenants.suspend(req.user, id, b); }
  @Post('tenants/:id/reactivate')
  reactivate(@Param('id') id: string, @Body() b: any, @Req() req) { return this.tenants.reactivate(req.user, id, b); }
  @Put('tenants/:id/modules')
  setModules(@Param('id') id: string, @Body() b: any, @Req() req) { return this.tenants.setModules(req.user, id, b); }
  @Post('tenants/:id/administrators')
  addAdministrator(@Param('id') id: string, @Body() b: any, @Req() req) { return this.onboarding.addAdministrator(req.user, id, b); }

  @Post('onboarding')
  onboard(@Body() b: any, @Req() req) { return this.onboarding.onboard(req.user, b); }

  // ---- platform audit (platform-level entries only) ----
  @Get('audit')
  auditLog(@Req() req, @Query() q: any) {
    requirePermission(req.user, PERMISSIONS.PLATFORM_AUDIT_VIEW);
    return this.audit.findForPlatform(q, req.user);
  }

  // ---- support access (platform side) ----
  @Post('support/requests')
  requestSupport(@Body() b: any, @Req() req) { return this.support.request(req.user, b); }
  @Get('support/grants')
  myGrants(@Req() req, @Query() q: Record<string, string>) { return this.support.listMine(req.user, q); }
  @Post('support/grants/:id/cancel')
  cancelGrant(@Param('id') id: string, @Req() req) { return this.support.cancel(req.user, id); }
  @Get('support/tenants/:id/config')
  supportConfig(@Param('id') id: string, @Req() req) { return this.support.viewConfig(req.user, id); }
  @Get('support/tenants/:id/users')
  supportUsers(@Param('id') id: string, @Req() req, @Query() q: Record<string, string>) { return this.support.viewUsers(req.user, id, q); }

  // ---- platform staff ----
  @Get('staff')
  staffList(@Req() req) { return this.staff.list(req.user); }
  @Post('staff')
  staffCreate(@Body() b: any, @Req() req) { return this.staff.create(req.user, b); }
  @Post('staff/:id/deactivate')
  staffDeactivate(@Param('id') id: string, @Req() req) { return this.staff.setActive(req.user, id, false); }
  @Post('staff/:id/activate')
  staffActivate(@Param('id') id: string, @Req() req) { return this.staff.setActive(req.user, id, true); }
}
