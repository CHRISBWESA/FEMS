import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { PLATFORM_ROLES, ROLES, ROLE_DEFINITIONS, RoleName, permissionsForRoles } from '../shared/authorization/roles';
import { isModuleKey } from '../shared/modules/modules';
import { defaultRoleEmail, suggestSubdomain } from '../shared/tenancy/subdomain.util';
import { email, requirePermission, requireUuid, temporaryPassword, text } from './platform.util';

export interface AdministratorDto { email?: string; firstName?: string; lastName?: string; phone?: string; roles?: string[] }

export interface CreatedAccount {
  id: string;
  email: string;
  roles: RoleName[];
  temporaryPassword: string;
  /** True for the role seats minted automatically, whose e-mail the platform administrator is expected to edit. */
  isPlaceholder: boolean;
}

/**
 * The organizational offices a fellowship is invited to fill, offered as a starting checklist.
 *
 * These are ROLES, not accounts. Onboarding creates no user for any of them - the fellowship's leadership structure
 * is not FEMS's to assume, and a congregation may have no Assistant Chairperson or a combined Secretary/Treasurer.
 * What this list is for is the "Configure fellowship leadership" step: the administrator sees the offices this system
 * understands and appoints the people who actually hold them, and may ignore any of them.
 *
 * Deliberately a data list rather than a `switch` in code, so a fellowship is not told it has exactly six offices.
 */
export const FELLOWSHIP_LEADERSHIP_ROLES: ReadonlyArray<{ role: RoleName; label: string; required: boolean; blurb: string }> = [
  { role: ROLES.SECRETARY, label: 'Secretary', required: true, blurb: 'Keeps the member register, departments and activities.' },
  { role: ROLES.TREASURER, label: 'Treasurer', required: true, blurb: 'Holds the money: contributions, expenses and budgets.' },
  { role: ROLES.CHAIRPERSON, label: 'Chairperson', required: false, blurb: 'Gives final approval and provides oversight.' },
  { role: ROLES.ASSISTANT_CHAIRPERSON, label: 'Assistant Chairperson', required: false, blurb: 'Shares the Chairperson’s approvals.' },
  { role: ROLES.ASSISTANT_SECRETARY, label: 'Assistant Secretary', required: false, blurb: 'Supports the Secretary.' },
  { role: ROLES.IT_ADMIN, label: 'IT / Content Manager', required: false, blurb: 'Runs the fellowship’s public website. No access to members or money.' },
];


// Onboarding: creates a fellowship, switches off any modules that should not be available, and creates the
// fellowship's first administrator (a Secretary account with its own member record) - all in ONE transaction, so
// a failure leaves nothing half-created. The temporary password is returned once and never stored or logged.
@Injectable()
export class PlatformOnboardingService {
  constructor(private prisma: PrismaService, private auditService: AuditService) {}

  private parseAdministrator(dto: AdministratorDto | undefined) {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('administrator is required');
    // The person who requests a fellowship becomes its FELLOWSHIP ADMINISTRATOR: the system administrator who
    // configures the FEMS account, invites people and appoints office holders. This is not a fellowship office -
    // Chairperson, Secretary and Treasurer are separate roles this account administers but does not hold by default.
    //
    // "Owner" is never used as a role: it describes a relationship to the software, not a job in a congregation,
    // and it invited exactly the confusion this replaces.
    const requestedRoles = dto.roles ?? [ROLES.FELLOWSHIP_ADMIN];
    if (!Array.isArray(requestedRoles) || requestedRoles.length === 0 || requestedRoles.length > 10 || requestedRoles.some((role) => typeof role !== 'string')) {
      throw new BadRequestException('administrator.roles must be a non-empty list of role names.');
    }
    const known = new Set(ROLE_DEFINITIONS.map((role) => role.name));
    const invalid = requestedRoles.filter((role) => !known.has(role as RoleName) || PLATFORM_ROLES.has(role as RoleName));
    if (invalid.length) throw new BadRequestException('Administrator roles must be tenant roles.');

    // A fellowship must always have someone who can appoint its officers, so the system administrator role is
    // added rather than trusted to be requested. Without it the fellowship would be created with no way to appoint
    // a Treasurer and the only remedy would be a platform administrator.
    const roles = Array.from(new Set([...requestedRoles, ROLES.FELLOWSHIP_ADMIN])) as RoleName[];
    return {
      email: email('administrator.email', dto.email),
      firstName: text('administrator.firstName', dto.firstName, { max: 80, required: true }) as string,
      lastName: text('administrator.lastName', dto.lastName, { max: 80, required: true }) as string,
      phone: text('administrator.phone', dto.phone, { max: 40 }),
      roles,
    };
  }

  // Creates the Member + User pair for one account inside an existing transaction.
  //
  // Every account gets a Member record, not just the people: the Users screen and the attendance register join
  // through it, so an account without one cannot be named on a register or shown in a roster. For an unappointed
  // role seat the member is named after the role, which is honest - nobody holds it yet.
  private async createAccount(
    tx: any,
    fellowshipId: string,
    account: { email: string; firstName: string; lastName: string; phone: string | null; roles: RoleName[]; isPlaceholder: boolean },
    actorId: string,
  ): Promise<CreatedAccount> {
    const clash = await tx.user.findUnique({ where: { email: account.email }, select: { id: true } });
    if (clash) throw new ConflictException('A user with this e-mail address already exists.');
    const password = temporaryPassword();
    const now = new Date();
    const member = await tx.member.create({
      data: {
        member_code: `ADM${randomBytes(5).toString('hex').toUpperCase()}`,
        full_name: `${account.firstName} ${account.lastName}`.trim(),
        email: account.email,
        phone: account.phone,
        membership_status: 'active',
        // Required by the schema; an administrator is not a student, so this is a placeholder far in the future.
        expected_graduation_year: now.getFullYear() + 10,
        expected_graduation_month: 6,
        created_by: actorId,
        fellowship_id: fellowshipId,
      },
    });
    const user = await tx.user.create({
      data: {
        email: account.email,
        password_hash: await bcrypt.hash(password, 12),
        first_name: account.firstName,
        last_name: account.lastName,
        phone: account.phone,
        roles: account.roles,
        permissions: permissionsForRoles(account.roles),
        fellowship_id: fellowshipId,
        is_active: true,
        must_change_password: true,
      },
    });
    await tx.member.update({ where: { id: member.id }, data: { user_id: user.id } });
    return { id: user.id as string, email: account.email, roles: account.roles, temporaryPassword: password, isPlaceholder: account.isPlaceholder };
  }

  private async createAdministrator(tx: any, fellowshipId: string, admin: ReturnType<PlatformOnboardingService['parseAdministrator']>, actorId: string) {
    return this.createAccount(
      tx,
      fellowshipId,
      { email: admin.email, firstName: admin.firstName, lastName: admin.lastName, phone: admin.phone, roles: admin.roles, isPlaceholder: false },
      actorId,
    );
  }

  async onboard(user: any, dto: any) {
    requirePermission(user, PERMISSIONS.PLATFORM_ONBOARD);
    const name = text('name', dto?.name, { min: 2, max: 120, required: true }) as string;
    const location = text('location', dto?.location, { max: 200 });
    const description = text('description', dto?.description, { max: 1000 });
    const admin = this.parseAdministrator(dto?.administrator);
    const modules: Record<string, boolean> = {};
    if (dto?.modules !== undefined) {
      if (typeof dto.modules !== 'object' || dto.modules === null || Array.isArray(dto.modules)) throw new BadRequestException('modules must be an object');
      for (const [k, v] of Object.entries(dto.modules)) {
        if (!isModuleKey(k)) throw new BadRequestException(`Unknown module: ${k}`);
        if (typeof v !== 'boolean') throw new BadRequestException(`modules.${k} must be true or false`);
        modules[k] = v;
      }
    }
    const nameClash = await this.prisma.fellowship.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (nameClash) throw new ConflictException('A fellowship with this name already exists.');

    // Reserve a subdomain before the transaction opens, so the uniqueness check cannot race two onboardings that
    // picked the same label: the unique index added with the public-site migration is the real guard, but failing
    // here produces a far better message than a Prisma constraint violation.
    const subdomain = await suggestSubdomain(name, async (candidate) => {
      const found = await this.prisma.fellowship.findUnique({ where: { subdomain: candidate }, select: { id: true } });
      return Boolean(found);
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const fellowship = await tx.fellowship.create({
        data: { name, location, description, subdomain, status: 'active', is_active: true, created_by: user.userId },
      });
      const off = Object.entries(modules).filter(([, enabled]) => !enabled);
      if (off.length) {
        await tx.fellowshipModuleSetting.createMany({ data: off.map(([module_key]) => ({ fellowship_id: fellowship.id, module_key, enabled: false, updated_by: user.userId })) });
      }

      // Exactly ONE account is created: the fellowship's system administrator. No seats, no placeholder
      // addresses, no invented office holders. This used to mint six accounts named after the offices, which meant
      // a new fellowship opened with a "Treasurer" who did not exist and whose e-mail was a guess; it also filled a
      // tenant's user quota before the fellowship had appointed anybody.
      const administrator = await this.createAdministrator(tx, fellowship.id, admin, user.userId);
      return { fellowship, administrator };
    });

    // The next step the fellowship administrator has to take: appoint real people to the offices. The list is the
    // canonical set of offices, not a claim that all of them are filled, and `required` marks the two a working
    // fellowship cannot do without.
    const officesToFill = FELLOWSHIP_LEADERSHIP_ROLES.map((o) => ({ role: o.role, label: o.label, required: o.required, blurb: o.blurb }));

    await this.auditService.log({
      userId: user.userId, action: 'platform.tenant_onboard', entityType: 'fellowship', entityId: result.fellowship.id, fellowshipId: result.fellowship.id,
      newValue: {
        name, subdomain,
        modulesDisabled: Object.entries(modules).filter(([, v]) => !v).map(([k]) => k),
        administratorUserId: result.administrator.id, roles: admin.roles,
      },
    });
    return {
      fellowship: { id: result.fellowship.id, name: result.fellowship.name, status: result.fellowship.status, subdomain },
      administrator: result.administrator,
      // The offices to fill, so the caller can send the administrator straight to the invite step rather than
      // making them work out what to do next.
      officesToFill,
      note: 'Give this temporary password to the fellowship administrator through a secure channel; it is shown only once and must be changed at first sign-in. No other accounts have been created: sign in as the fellowship administrator and invite the people who will hold each office.',
    };
  }

  // Adds another administrator to an existing fellowship (e.g. the first one lost access). The platform account
  // needs no access to the fellowship's member list to do this.
  async addAdministrator(user: any, fellowshipId: string, dto: AdministratorDto) {
    requirePermission(user, PERMISSIONS.PLATFORM_TENANTS_MANAGE);
    requireUuid('id', fellowshipId);
    const t = await this.prisma.fellowship.findUnique({ where: { id: fellowshipId }, select: { id: true } });
    if (!t) throw new NotFoundException('Fellowship not found');
    const admin = this.parseAdministrator(dto);
    const administrator = await this.prisma.$transaction((tx) => this.createAdministrator(tx, fellowshipId, admin, user.userId));
    await this.auditService.log({ userId: user.userId, action: 'platform.tenant_add_administrator', entityType: 'fellowship', entityId: fellowshipId, fellowshipId, newValue: { administratorUserId: administrator.id, roles: admin.roles } });
    return { administrator, note: 'Shown only once. The administrator must change the password at first login.' };
  }
}
