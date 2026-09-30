import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../shared/audit/audit.service';
import { TenantScopeService, RequesterLike } from '../shared/tenant/tenant-scope.service';
import * as bcrypt from 'bcryptjs';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { GOVERNANCE_ROLES, ROLE_DEFINITIONS, ROLES, RoleName, permissionsForRoles } from '../shared/authorization/roles';
import { validateOptionalUuid } from '../shared/utils/validation.util';
import { isUuid } from '../shared/utils/uuid.util';
import { fellowshipHost } from '../shared/tenancy/subdomain.util';
import { email, text } from '../platform/platform.util';
import { assertPasswordPolicy } from '../shared/utils/password-policy.util';
import { randomBytes, createHash } from 'crypto';

/** How long an invitation stays usable. A month is long enough to reach a real person, short enough to matter. */
const INVITE_TTL_DAYS = 30;

/** A user-facing label for a role, without a hard-coded list that could drift from the role table. */
function roleLabel(role: string): string {
  return ROLE_DEFINITIONS.find((r) => r.name === role)?.description ?? role;
}

/**
 * Invitations: appointing the people who actually hold the fellowship's offices.
 *
 * This replaces the old onboarding, which created six accounts named after the offices and expected an
 * administrator to edit their e-mail addresses once the real office holders were known. An invitation has no
 * account behind it and cannot be signed in to, so a partially-configured fellowship holds no usable credentials.
 *
 * The security rule the whole module exists to enforce: **an invitation for a governance role requires
 * USER_ROLE_ASSIGN_GOV, and so does accepting it.** Both are checked, because authority granted at invite time can
 * be withdrawn by the time the link is clicked - and an invitation that quietly outlives its authority is how a
 * fellowship ends up with a Treasurer nobody appointed.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  private resolveTarget(user: RequesterLike | undefined, queryFellowshipId?: string): string {
    const id = this.tenantScope.resolveFellowshipId(user, queryFellowshipId);
    if (!id) throw new NotFoundException('No fellowship is associated with this account.');
    return id;
  }

  /** The permission set of the requester, derived from their roles - the single source of truth. */
  private held(user: RequesterLike | undefined): string[] {
    return permissionsForRoles(user?.roles || []);
  }

  /**
   * Refuses a role list the requester has no authority to appoint.
   *
   * Mirrors `UsersService.assertCanAssignRoles` deliberately: an invitation is a promise of a role, so the promise
   * must be checked with the same rule as the grant. Two implementations of one rule would drift, and the safer one
   * is not the one somebody remembers to update.
   *
   * Authority is derived from the requester's ROLES rather than read from a permission claim on the token, for the
   * same reason `UsersService` does it: a stale `permissions` array in the database must never be able to widen
   * what somebody may appoint, and `permissionsForRoles` is the single source of truth.
   *
   * Refused as 403 rather than 400: this is an authorization failure, not a malformed request, and the two should
   * not be reported as the same thing.
   */
  private assertCanInviteRoles(user: RequesterLike | undefined, roles: string[]): void {
    const held = this.held(user);
    const governance = roles.filter((r) => GOVERNANCE_ROLES.has(r as RoleName));
    if (governance.length > 0 && !held.includes(PERMISSIONS.USER_ROLE_ASSIGN_GOV)) {
      const names = governance.map((r) => roleLabel(r)).join(', ');
      throw new ForbiddenException(
        `Only the fellowship administrator may invite an office holder (${names}).`,
      );
    }
    if (!held.includes(PERMISSIONS.USER_ROLE_ASSIGN)) {
      throw new ForbiddenException('You do not have permission to invite people to this fellowship.');
    }
  }

  private parseInvitation(body: any, user: RequesterLike | undefined) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required');
    }
    const address = email('email', body.email).toLowerCase();
    const firstName = text('firstName', body.firstName, { max: 80, required: true }) as string;
    const lastName = text('lastName', body.lastName, { max: 80, required: true }) as string;
    const phone = text('phone', body.phone, { max: 40 });

    const requested: string[] = Array.isArray(body.roles) ? body.roles : [];
    if (requested.length === 0 || requested.length > 8) {
      throw new BadRequestException('roles must be a list of 1 to 8 role names.');
    }
    if (requested.some((r) => typeof r !== 'string')) {
      throw new BadRequestException('roles must be a list of role names.');
    }
    const known = new Set(ROLE_DEFINITIONS.map((r) => r.name));
    const invalid = requested.filter((r) => !known.has(r as RoleName) || r === ROLES.ADMIN || r === ROLES.PLATFORM_SUPPORT);
    if (invalid.length) {
      throw new BadRequestException(`Unknown or reserved role(s): ${invalid.join(', ').slice(0, 100)}`);
    }
    const roles = Array.from(new Set(requested)) as RoleName[];

    // Department-leader roles are meaningless without a department, and the department must be this fellowship's.
    if (roles.some((r) => r === ROLES.DEPARTMENT_SECRETARY || r === ROLES.DEPARTMENT_CHAIRPERSON)) {
      if (!body.departmentId) {
        throw new BadRequestException('Department leader roles require a department.');
      }
    }
    const departmentId = validateOptionalUuid('departmentId', body.departmentId);

    // The authority check happens BEFORE anything is written, so a refused invitation leaves no trace at all.
    this.assertCanInviteRoles(user, roles);

    return { address, firstName, lastName, phone, roles, departmentId };
  }

  /**
   * Invites somebody, returning the token ONCE.
   *
   * The token is returned to the caller and never stored: only its SHA-256 goes in the database, so a dump of the
   * invitations table yields nothing that can be used. The caller is responsible for delivering it, and this
   * application sends no e-mail - it has no mail transport - so the acceptance link is surfaced for the inviter to
   * pass on. Saying so plainly beats a screen implying an invitation was delivered.
   */
  async invite(user: RequesterLike | undefined, body: any, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    const parsed = this.parseInvitation(body, user);

    const fellowship = await this.prisma.fellowship.findUnique({
      where: { id: fellowshipId },
      select: { id: true, subdomain: true, status: true, name: true },
    });
    if (!fellowship) throw new NotFoundException('Fellowship not found');
    if (fellowship.status !== 'active') {
      throw new BadRequestException('This fellowship is suspended and cannot invite anybody.');
    }

    // A pending invitation for the same address is a duplicate. Refusing it keeps the fellowship from filling up
    // with invitations nobody meant, and tells the administrator to revoke the first one deliberately.
    const existing = await this.prisma.invitation.findFirst({
      where: { fellowship_id: fellowshipId, email: parsed.address, status: 'pending' },
      select: { id: true, expires_at: true },
    });
    if (existing) {
      const stillValid = existing.expires_at.getTime() > Date.now();
      throw new BadRequestException(
        stillValid
          ? 'There is already a pending invitation for that address. Revoke it first if you meant to re-invite them.'
          : 'There is an expired invitation for that address. Revoke it first.',
      );
    }

    if (parsed.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: parsed.departmentId, fellowship_id: fellowshipId },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department not found');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
    const host = fellowship.subdomain ? fellowshipHost(fellowship.subdomain) : null;

    const invitation = await this.prisma.invitation.create({
      data: {
        fellowship_id: fellowshipId,
        email: parsed.address,
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        phone: parsed.phone,
        roles: parsed.roles,
        department_id: parsed.departmentId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        invited_by: (user?.userId as string) ?? '',
        site_host: host,
      },
    });

    await this.auditService.log({
      userId: user?.userId,
      action: 'invitation.create',
      entityType: 'invitation',
      entityId: invitation.id,
      fellowshipId,
      newValue: { email: parsed.address, roles: parsed.roles },
      comment: `Invited ${parsed.address} as ${parsed.roles.map((r) => roleLabel(r)).join(', ')}`,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      roles: invitation.roles,
      expiresAt: invitation.expires_at,
      // Shown once. There is no mail transport in this deployment, so the inviter passes this on by hand.
      token,
      acceptUrl: `/invite/${token}`,
      note: 'This link is shown once and no e-mail was sent. Share it with the person you are inviting over a channel you trust.',
    };
  }

  /** The fellowship's invitations, newest first, with whether each has been used. */
  async list(user: RequesterLike | undefined, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    const rows = await this.prisma.invitation.findMany({
      where: { fellowship_id: fellowshipId },
      orderBy: { created_at: 'desc' },
      take: 200,
      select: {
        id: true, email: true, first_name: true, last_name: true, roles: true, status: true,
        created_at: true, expires_at: true, accepted_at: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: `${r.first_name} ${r.last_name}`.trim(),
      roles: r.roles,
      // A pending invitation past its date is shown as expired rather than as still actionable, because that is
      // what it is - a stale link that would fail on use.
      status: r.status === 'pending' && r.expires_at.getTime() <= Date.now() ? 'expired' : r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      acceptedAt: r.accepted_at,
    }));
  }

  /**
   * Looks up an invitation by its token, for the acceptance screen.
   *
   * Returns only what the page needs to explain itself - the fellowship's name, the roles on offer and the
   * inviter's name. Not the whole row, and never the token: this is an unauthenticated call.
   */
  async peek(token: string) {
    if (!token || typeof token !== 'string' || token.length < 20) {
      throw new NotFoundException('This invitation is not valid.');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = await this.prisma.invitation.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true, email: true, first_name: true, last_name: true, roles: true, status: true,
        expires_at: true, accepted_at: true, site_host: true,
        fellowship: { select: { name: true, status: true } },
        invitedBy: { select: { first_name: true, last_name: true } },
      },
    });
    if (!row) throw new NotFoundException('This invitation is not valid.');

    const expired = row.expires_at.getTime() <= Date.now();
    const usable = row.status === 'pending' && !expired && row.fellowship.status === 'active';
    return {
      // Enough to render the page, and nothing that could be used without the token itself.
      fellowshipName: row.fellowship.name,
      invitedName: `${row.first_name} ${row.last_name}`.trim(),
      // The address is partly masked: the holder of the link is being told which mailbox it was sent to, not handed
      // a list of them.
      emailHint: maskEmail(row.email),
      roles: row.roles,
      invitedBy: `${row.invitedBy.first_name} ${row.invitedBy.last_name}`.trim(),
      expiresAt: row.expires_at,
      usable,
      reason: !usable ? unusableReason(row.status, expired, row.fellowship.status) : null,
    };
  }

  /**
   * Accepts an invitation, creating the account.
   *
   * The authority to appoint the roles is re-checked HERE, not only at invite time. An invitation is a promise
   * that can go stale: the fellowship administrator who issued it may have been removed, or the fellowship
   * suspended, in the month the link sat in an inbox. Re-checking at the moment of the grant is what makes the
   * promise real.
   */
  async accept(token: string, body: any) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required');
    }
    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) throw new BadRequestException('A password is required');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.prisma.invitation.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true, email: true, first_name: true, last_name: true, phone: true, roles: true,
        department_id: true, fellowship_id: true, status: true, expires_at: true, invited_by: true,
        fellowship: { select: { id: true, name: true, status: true, public_site_enabled: true } },
      },
    });
    if (!invitation) throw new NotFoundException('This invitation is not valid.');
    if (invitation.status !== 'pending') {
      throw new BadRequestException('This invitation has already been used or withdrawn.');
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      throw new BadRequestException('This invitation has expired. Ask for a new one.');
    }
    if (invitation.fellowship.status !== 'active') {
      throw new BadRequestException('This fellowship is suspended, so invitations cannot be accepted.');
    }

    // A user who already exists cannot accept: the account is established, and silently adopting it would let a
    // forwarded link take over somebody's existing login. They sign in and an administrator adds the role.
    const clash = await this.prisma.user.findUnique({
      where: { email: invitation.email.toLowerCase() },
      select: { id: true, fellowship_id: true },
    });
    if (clash) {
      throw new BadRequestException(
        'An account already exists for this address. Sign in as it and ask your fellowship administrator to add the role.',
      );
    }

    // The inviter's authority, re-checked at the moment the role is actually granted.
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitation.invited_by },
      select: { roles: true, is_active: true, deleted_at: true, fellowship_id: true },
    });
    const inviterLive =
      inviter && inviter.is_active && !inviter.deleted_at && inviter.fellowship_id === invitation.fellowship_id;
    if (inviterLive) {
      // The same rule as issuing, but the refusal is reported differently: the person on this screen did nothing
      // wrong. It is the INVITATION that has gone stale, so the answer is "this cannot be used" (400) rather than
      // "you are not allowed" (403), which would wrongly suggest the invitee tried something forbidden.
      try {
        this.assertCanInviteRoles({ roles: inviter.roles }, invitation.roles as string[]);
      } catch {
        throw new BadRequestException(
          'The person who issued this invitation is no longer authorised to appoint that office. Ask for a new invitation.',
        );
      }
    } else {
      // The inviter is gone. The invitation's roles are no longer covered by anyone's authority, so the fellowship
      // administrator has to re-issue it rather than the grant proceeding unchecked.
      throw new BadRequestException(
        'The person who issued this invitation is no longer an administrator of this fellowship. Ask for a new invitation.',
      );
    }

    // The same password policy every other account in the system goes through, including the rule that a password
    // may not be built from the account's own name - a new user picking "grace123" for the Grace Fellowship must
    // be refused exactly as it would be for somebody who signed up through the ordinary route.
    assertPasswordPolicy(password, {
      email: invitation.email,
      firstName: invitation.first_name,
      lastName: invitation.last_name,
    });
    const passwordHash = await bcrypt.hash(password, 12);

    // The account, its member record and the invitation's own state move together: a half-accepted invitation
    // would either grant a role twice or leave an account nobody can reach.
    const user = await this.prisma.$transaction(async (tx: any) => {
      const now = new Date();
      const member = await tx.member.create({
        data: {
          member_code: `INV${randomBytes(5).toString('hex').toUpperCase()}`,
          full_name: `${invitation.first_name} ${invitation.last_name}`.trim(),
          email: invitation.email.toLowerCase(),
          phone: invitation.phone,
          membership_status: 'active',
          expected_graduation_year: now.getFullYear() + 10,
          expected_graduation_month: 6,
          created_by: invitation.invited_by,
          fellowship_id: invitation.fellowship_id,
        },
      });
      const created = await tx.user.create({
        data: {
          email: invitation.email.toLowerCase(),
          password_hash: passwordHash,
          first_name: invitation.first_name,
          last_name: invitation.last_name,
          phone: invitation.phone,
          roles: invitation.roles,
          permissions: permissionsForRoles(invitation.roles as string[]),
          department_id: invitation.department_id,
          fellowship_id: invitation.fellowship_id,
          is_active: true,
          // The person chose this password themselves, so it is not a temporary one to be changed.
          must_change_password: false,
        },
      });
      await tx.member.update({ where: { id: member.id }, data: { user_id: created.id } });
      // Single use: the token cannot be replayed to create a second account.
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', accepted_at: new Date(), accepted_user_id: created.id },
      });
      return created;
    });

    await this.auditService.log({
      userId: invitation.invited_by,
      action: 'invitation.accept',
      entityType: 'invitation',
      entityId: invitation.id,
      fellowshipId: invitation.fellowship_id,
      newValue: { userId: user.id, email: user.email, roles: user.roles },
      comment: `${invitation.first_name} ${invitation.last_name} accepted an invitation`,
    });

    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
      fellowshipName: invitation.fellowship.name,
      message: 'Your account is ready. Sign in with the password you just chose.',
    };
  }

  /** Withdraws a pending invitation. Only a pending one: an accepted account is not undone by revoking. */
  async revoke(user: RequesterLike | undefined, id: string, queryFellowshipId?: string) {
    const fellowshipId = this.resolveTarget(user, queryFellowshipId);
    if (!isUuid(id)) throw new NotFoundException('Invitation not found');

    const existing = await this.prisma.invitation.findUnique({
      where: { id },
      select: { fellowship_id: true, status: true, email: true },
    });
    if (!existing) throw new NotFoundException('Invitation not found');
    this.tenantScope.assertInScope(user, existing, queryFellowshipId);

    if (existing.status !== 'pending') {
      throw new BadRequestException(`This invitation is already ${existing.status} and cannot be withdrawn.`);
    }

    const revoked = await this.prisma.invitation.update({
      where: { id },
      data: { status: 'revoked', revoked_at: new Date(), revoked_by: (user?.userId as string) ?? null },
      select: { id: true, status: true },
    });

    await this.auditService.log({
      userId: user?.userId,
      action: 'invitation.revoke',
      entityType: 'invitation',
      entityId: id,
      fellowshipId,
      oldValue: { status: 'pending', email: existing.email },
      newValue: { status: 'revoked' },
      comment: 'Invitation withdrawn',
    });

    return revoked;
  }

  /**
   * Re-issues an invitation, replacing a stale or withdrawn one.
   *
   * The common case is an expired link sitting in somebody's inbox from a month ago. Creating a fresh one is clearer
   * than reviving the old row, whose token has been seen.
   */
  async reissue(user: RequesterLike | undefined, id: string, body: any, queryFellowshipId?: string) {
    // Resolved and then used only to prove the caller has a fellowship: `assertInScope` below is the check that
    // actually binds the invitation to it.
    this.resolveTarget(user, queryFellowshipId);
    if (!isUuid(id)) throw new NotFoundException('Invitation not found');
    const existing = await this.prisma.invitation.findUnique({
      where: { id },
      select: { fellowship_id: true, status: true, email: true, first_name: true, last_name: true, phone: true, roles: true, department_id: true },
    });
    if (!existing) throw new NotFoundException('Invitation not found');
    this.tenantScope.assertInScope(user, existing, queryFellowshipId);
    if (existing.status === 'accepted') {
      throw new BadRequestException('That invitation was already accepted. Edit the account instead.');
    }

    await this.prisma.invitation.update({ where: { id }, data: { status: 'revoked', revoked_at: new Date() } });

    // The same authority check as a fresh invitation: re-issuing is appointing, and cannot be a loophole past the
    // rule that the original issue had to satisfy.
    this.assertCanInviteRoles(user, existing.roles as string[]);
    return this.invite(user, { ...body, ...existing }, queryFellowshipId);
  }
}

function unusableReason(status: string, expired: boolean, fellowshipStatus: string): string {
  if (status === 'accepted') return 'This invitation has already been accepted.';
  if (status === 'revoked') return 'This invitation was withdrawn.';
  if (fellowshipStatus !== 'active') return 'This fellowship is currently suspended.';
  if (expired) return 'This invitation has expired. Ask your fellowship administrator for a new one.';
  return 'This invitation cannot be used.';
}

/** `grace@x.org` → `gr***e@x.org`. Enough to recognise, not enough to harvest. */
function maskEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return address;
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}
