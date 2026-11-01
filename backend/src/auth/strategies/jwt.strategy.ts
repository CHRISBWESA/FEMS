import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy as JwtStrategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLE_DEFINITIONS } from '../../shared/authorization/roles';
import { resolveJwtSecret } from '../../config/security-config';
import { isPlatformPrincipal } from '../../shared/authorization/platform-boundary.guard';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  departmentId?: string;
  mustChangePassword?: boolean;
  tokenType?: string;
  tv?: number;
  /** Set only on an impersonation token: the ImpersonationSession id, and the administrator behind it. */
  imp?: string;
  impBy?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AccountRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  roles: string[] | null;
  department_id: string | null;
  fellowship_id: string | null;
  is_active: boolean;
  must_change_password: boolean;
  token_version: number;
  deleted_at: Date | null;
  fellowship_status: string | null;
}

export interface ImpersonationContext {
  sessionId: string;
  adminUserId: string;
  targetUserId: string;
  expiresAt: Date | null;
}

@Injectable()
export class JwtStrategyService extends PassportStrategy(JwtStrategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      // Bearer header only. The application never sets an authentication cookie, so accepting one would only add a
      // cookie-based (CSRF / cookie-tossing) way in that nothing needs.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret({ JWT_SECRET: configService.get<string>('JWT_SECRET'), NODE_ENV: configService.get<string>('NODE_ENV') }),
    });
  }

  // Users of a suspended fellowship are locked out on every request (platform accounts belong to no fellowship).
  private assertTenantActive(fellowshipId: string | null, fellowshipStatus: string | null, roles: string[]): void {
    if (isPlatformPrincipal(roles)) return;
    if (!fellowshipId) return;
    if (fellowshipStatus !== 'active') {
      throw new ForbiddenException('Your fellowship is currently suspended. Please contact the platform administrator.');
    }
  }

  /**
   * The account and its fellowship's status in ONE query. This runs on every authenticated request, and the
   * database is a network hop away, so two sequential lookups here added a full round trip to every call.
   */
  private async loadAccount(userId: string): Promise<AccountRow | null> {
    if (!UUID.test(userId)) return null;
    const rows = await this.prisma.$queryRaw<AccountRow[]>`
      SELECT u.id, u.email, u.first_name, u.last_name, u.gender, u.roles, u.department_id, u.fellowship_id,
             u.is_active, u.must_change_password, u.token_version, u.deleted_at, f.status::text AS fellowship_status
      FROM users u LEFT JOIN fellowships f ON f.id = u.fellowship_id
      WHERE u.id = ${userId}::uuid`;
    return rows[0] ?? null;
  }

  /**
   * An impersonation token is only honoured while its session is genuinely live. This runs on every request, so
   * ending the session, the account holder revoking it, or the expiry passing all take effect on the very next
   * call - the token cannot be replayed afterwards even though it has not itself expired.
   */
  private async assertImpersonationLive(payload: JwtPayload): Promise<ImpersonationContext | null> {
    if (!payload.imp) return null;
    const session = await this.prisma.impersonationSession.findUnique({
      where: { id: payload.imp },
      select: { id: true, admin_user_id: true, target_user_id: true, status: true, expires_at: true },
    });
    if (!session) throw new UnauthorizedException('This impersonation session no longer exists.');
    if (session.status !== 'active') throw new UnauthorizedException('This impersonation session has ended.');
    if (!session.expires_at || session.expires_at <= new Date()) {
      throw new UnauthorizedException('This impersonation session has expired.');
    }
    if (session.target_user_id !== payload.sub) {
      throw new UnauthorizedException('This impersonation token does not match the session.');
    }
    return { sessionId: session.id, adminUserId: session.admin_user_id, targetUserId: session.target_user_id, expiresAt: session.expires_at };
  }

  async validate(payload: JwtPayload) {
    // A refresh token only works at /auth/refresh. It used to authenticate here too, as a bare user id that skipped the
    // deactivation, session-version and suspended-fellowship checks below - so a revoked session could still read data.
    if (payload.tokenType === 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Checked before the account is even loaded, so an ended session cannot be used at all.
    const impersonation = await this.assertImpersonationLive(payload);

    const user = await this.loadAccount(payload.sub);
    // A deactivated or deleted account loses access at once, not whenever its token happens to expire.
    if (!user || user.deleted_at || !user.is_active) {
      throw new UnauthorizedException('User not found');
    }

    // Tokens issued before the last password change/reset are dead. (Tokens minted before this field existed carry no
    // version and count as version 0, which is every account's starting value.)
    if ((payload.tv ?? 0) !== user.token_version) {
      throw new UnauthorizedException('Session expired');
    }

    const roles = user.roles || [];
    this.assertTenantActive(user.fellowship_id, user.fellowship_status, roles);
    const permissions = ROLE_DEFINITIONS.filter((r) => roles.includes(r.name)).flatMap(
      (r) => r.permissions,
    );

    return {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      roles,
      permissions,
      departmentId: user.department_id,
      fellowshipId: user.fellowship_id,
      gender: user.gender, // used to scope gender leaders (it used to be missing, which un-scoped them)
      mustChangePassword: user.must_change_password,
      ipAddress: null,
      // Carried through so services and the audit trail can tell an impersonated request from a real one.
      impersonation,
    };
  }
}

export interface ValidatedUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  departmentId?: string;
  mustChangePassword: boolean;
  ipAddress: string | null;
}
