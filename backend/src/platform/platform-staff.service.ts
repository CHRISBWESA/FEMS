import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ROLES, permissionsForRoles } from '../shared/authorization/roles';
import { email, requirePermission, requireUuid, temporaryPassword, text } from './platform.util';

// Platform staff = accounts that belong to no fellowship. Only support accounts can be created or switched off
// here; platform administrator accounts are provisioned out-of-band (they hold the most powerful role).
@Injectable()
export class PlatformStaffService {
  constructor(private prisma: PrismaService, private auditService: AuditService) {}

  async list(user: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_STAFF_MANAGE);
    const rows = await this.prisma.user.findMany({
      where: { deleted_at: null, fellowship_id: null, OR: [{ roles: { has: ROLES.ADMIN } }, { roles: { has: ROLES.PLATFORM_SUPPORT } }] },
      orderBy: { created_at: 'asc' }, take: 200,
      select: { id: true, email: true, first_name: true, last_name: true, roles: true, is_active: true, created_at: true },
    });
    return rows.map((r) => ({ id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name, roles: r.roles, isActive: r.is_active, createdAt: r.created_at }));
  }

  async create(user: any, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_STAFF_MANAGE);
    const addr = email('email', dto?.email);
    const firstName = text('firstName', dto?.firstName, { max: 80, required: true }) as string;
    const lastName = text('lastName', dto?.lastName, { max: 80, required: true }) as string;
    if (await this.prisma.user.findUnique({ where: { email: addr }, select: { id: true } })) throw new ConflictException('A user with this e-mail address already exists.');
    const password = temporaryPassword();
    const roles = [ROLES.PLATFORM_SUPPORT];
    const created = await this.prisma.user.create({
      data: { email: addr, password_hash: await bcrypt.hash(password, 12), first_name: firstName, last_name: lastName, roles, permissions: permissionsForRoles(roles), fellowship_id: null, is_active: true, must_change_password: true },
    });
    await this.auditService.log({ userId: user.userId, action: 'platform.staff_create', entityType: 'user', entityId: created.id, fellowshipId: null, newValue: { roles } });
    return { id: created.id, email: created.email, roles, temporaryPassword: password, note: 'Shown only once. The account must change the password at first login.' };
  }

  async setActive(user: any, id: string, isActive: boolean) {
    requirePermission(user, PERMISSIONS.PLATFORM_STAFF_MANAGE);
    requireUuid('id', id);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.deleted_at || target.fellowship_id) throw new NotFoundException('Staff account not found');
    if (!target.roles.includes(ROLES.PLATFORM_SUPPORT) || target.roles.includes(ROLES.ADMIN)) {
      throw new ForbiddenException('Only support accounts can be switched on or off here.');
    }
    if (target.is_active === isActive) throw new BadRequestException(`The account is already ${isActive ? 'active' : 'inactive'}.`);
    await this.prisma.user.update({ where: { id }, data: { is_active: isActive } });
    // A switched-off support account also loses any support grants it requested.
    if (!isActive) await this.prisma.supportAccessGrant.updateMany({ where: { requested_by: id, status: { in: ['requested', 'approved'] } }, data: { status: 'revoked', revoked_at: new Date() } });
    await this.auditService.log({ userId: user.userId, action: isActive ? 'platform.staff_activate' : 'platform.staff_deactivate', entityType: 'user', entityId: id, fellowshipId: null });
    return { id, isActive };
  }
}
