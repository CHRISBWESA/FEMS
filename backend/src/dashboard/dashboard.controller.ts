import { Controller, Get, Put, Req, UseGuards, Body } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AllowWhenPasswordChangeRequired } from '../shared/authorization/must-change-password.guard';
import { PlatformAccess } from '../shared/decorators/platform.decorators';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { isPlatformPrincipal } from '../shared/authorization/platform-boundary.guard';
import { ModuleAvailabilityService } from '../shared/modules/module-availability.service';
import { AuditService } from '../shared/audit/audit.service';
import { validateText } from '../shared/utils/validation.util';
import { BadRequestException, NotFoundException } from '@nestjs/common';

@PlatformAccess()
@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService, private tenantScope: TenantScopeService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getDashboard(@Req() req) {
    // Counts are limited to the caller's own fellowship (a global admin sees the platform totals). They used
    // to be unscoped, which showed every signed-in user the totals of all fellowships.
    if (isPlatformPrincipal(req.user.roles)) {
      // Platform accounts see platform figures only, never a fellowship's operational totals.
      const [totalFellowships, activeFellowships] = await Promise.all([
        this.prisma.fellowship.count(),
        this.prisma.fellowship.count({ where: { status: 'active' } }),
      ]);
      // Platform-level entries only (platform.* / support.* and a platform account's own actions), so this can
      // never surface a tenant's operational trail. Same scope rule as GET /platform/audit.
      const recentActions = await this.recentPlatformActions();
      return { platform: true, totalFellowships, activeFellowships, recentActions };
    }
    const where = this.tenantScope.scopeWhere(req.user, {}) as any;
    const [memberCount, activityCount, deptCount] = await Promise.all([
      this.prisma.member.count({ where }),
      this.prisma.activity.count({ where }),
      this.prisma.department.count({ where }),
    ]);

    return {
      totalMembers: memberCount,
      totalActivities: activityCount,
      totalDepartments: deptCount,
      recentActions: await this.recentTenantActions(req.user, where),
    };
  }

  private async recentPlatformActions() {
    const platformUsers = await this.prisma.user.findMany({
      where: { OR: [{ roles: { has: 'admin' } }, { roles: { has: 'platform_support' } }] },
      select: { id: true },
      take: 1000,
    });
    const rows = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { action: { startsWith: 'platform.' } },
          { action: { startsWith: 'support.' } },
          { user_id: { in: platformUsers.map((u) => u.id) } },
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: 8,
      select: { id: true, action: true, comment: true, timestamp: true },
    });
    return rows.map((r) => ({ id: r.id, action: r.action, detail: r.comment ?? '', at: r.timestamp }));
  }

  // A tenant sees its own audit trail only, matching GET /audit for their role.
  private async recentTenantActions(user: any, where: any) {
    if (!user.fellowshipId) return [];
    const rows = await this.prisma.auditLog.findMany({
      where: { fellowship_id: user.fellowshipId },
      orderBy: { timestamp: 'desc' },
      take: 8,
      select: { id: true, action: true, comment: true, timestamp: true },
    });
    return rows.map((r) => ({ id: r.id, action: r.action, detail: r.comment ?? '', at: r.timestamp }));
  }
}

@PlatformAccess()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private modules: ModuleAvailabilityService,
    private prisma: PrismaService,
    private auditService: AuditService,
  ) {}

  // Previously had no @Get() at all, so GET /profile answered 404 and the client silently fell back.
  @Get()
  @AllowWhenPasswordChangeRequired()
  async getProfile(@Req() req) {
    return {
      id: req.user.userId,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      roles: req.user.roles,
      permissions: req.user.permissions,
      isActive: true,
      mustChangePassword: req.user.mustChangePassword,
      disabledModules: Array.from(await this.modules.disabledModules(req.user.fellowshipId)),
    };
  }

  @Put()
  @AllowWhenPasswordChangeRequired()
  async updateProfile(@Req() req, @Body() body: { firstName?: string; lastName?: string; email?: string }) {
    const userId = req.user.userId;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const changes: Record<string, any> = {};
    const oldValue: Record<string, any> = {};

    if (body.firstName !== undefined) {
      const firstName = validateText('firstName', body.firstName, 100, true);
      if (firstName !== user.first_name) {
        changes.first_name = firstName;
        oldValue.firstName = user.first_name;
      }
    }

    if (body.lastName !== undefined) {
      const lastName = validateText('lastName', body.lastName, 100, true);
      if (lastName !== user.last_name) {
        changes.last_name = lastName;
        oldValue.lastName = user.last_name;
      }
    }

    if (body.email !== undefined) {
      const email = validateText('email', body.email, 254, true)!.toLowerCase();
      if (email !== user.email) {
        const existing = await this.prisma.user.findFirst({
          where: { email, NOT: { id: userId } },
        });
        if (existing) {
          throw new BadRequestException('A user with this email already exists');
        }
        changes.email = email;
        oldValue.email = user.email;
      }
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: changes });

    await this.auditService.log({
      userId,
      action: 'profile.update',
      entityType: 'user',
      entityId: userId,
      oldValue,
      newValue: changes,
      comment: 'User updated their own profile',
    });

    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.first_name,
      lastName: updated.last_name,
      roles: updated.roles,
      permissions: updated.permissions,
      isActive: updated.is_active,
      mustChangePassword: updated.must_change_password,
    };
  }
}
