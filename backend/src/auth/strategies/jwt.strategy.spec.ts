import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategyService } from './jwt.strategy';

// The impersonation check sits in the authentication strategy, so it runs on EVERY request. These tests pin
// that behaviour: an ended, expired or mismatched session must be refused even though its JWT is still
// cryptographically valid and unexpired.
function strategyWith(session: any) {
  const prisma: any = {
    impersonationSession: { findUnique: jest.fn(async () => session) },
    // The account and its fellowship status come back from one joined query.
    $queryRaw: jest.fn(async () => [{
      id: '99999999-9999-4999-8999-999999999999',
      email: 'secretary@tenant.test',
      first_name: 'Grace', last_name: 'Mwangi', gender: null,
      roles: ['secretary'], fellowship_id: '11111111-1111-4111-8111-111111111111',
      department_id: null, is_active: true, deleted_at: null, token_version: 0, must_change_password: false,
      fellowship_status: 'active',
    }]),
  };
  const config: any = { get: jest.fn(() => 'test-secret-test-secret-test-secret-test-secret-1234') };
  const s = new JwtStrategyService(config, prisma);
  return { s, prisma };
}

const basePayload = (extra: any = {}) => ({
  sub: '99999999-9999-4999-8999-999999999999',
  email: 'secretary@tenant.test',
  roles: ['secretary'],
  permissions: [],
  tv: 0,
  ...extra,
});

const liveSession = {
  id: '22222222-2222-4222-8222-222222222222',
  admin_user_id: 'admin-1',
  target_user_id: '99999999-9999-4999-8999-999999999999',
  status: 'active',
  expires_at: new Date(Date.now() + 60_000),
};

describe('impersonation tokens are only honoured while the session is live', () => {
  it('accepts a genuine live session and reports who is behind it', async () => {
    const { s } = strategyWith(liveSession);
    const user = await s.validate(basePayload({ imp: liveSession.id, impBy: 'admin-1' }) as any);
    expect(user.userId).toBe('99999999-9999-4999-8999-999999999999');
    expect(user.impersonation).toEqual({
      sessionId: liveSession.id,
      adminUserId: 'admin-1',
      targetUserId: '99999999-9999-4999-8999-999999999999',
      expiresAt: liveSession.expires_at,
    });
  });

  it('leaves a normal token with no impersonation context', async () => {
    const { s, prisma } = strategyWith(liveSession);
    const user = await s.validate(basePayload() as any);
    expect(user.impersonation).toBeNull();
    // A real sign-in must not even query the session table.
    expect(prisma.impersonationSession.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a session that was ended, even though the JWT is still valid', async () => {
    const { s } = strategyWith({ ...liveSession, status: 'expired' });
    await expect(s.validate(basePayload({ imp: liveSession.id }) as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a revoked or cancelled session', async () => {
    for (const status of ['cancelled', 'requested', 'approved']) {
      const { s } = strategyWith({ ...liveSession, status });
      await expect(s.validate(basePayload({ imp: liveSession.id }) as any)).rejects.toThrow(/has ended/);
    }
  });

  it('refuses a session whose expiry has passed', async () => {
    const { s } = strategyWith({ ...liveSession, expires_at: new Date(Date.now() - 1000) });
    await expect(s.validate(basePayload({ imp: liveSession.id }) as any)).rejects.toThrow(/has expired/);
  });

  it('refuses a session that no longer exists', async () => {
    const { s } = strategyWith(null);
    await expect(s.validate(basePayload({ imp: liveSession.id }) as any)).rejects.toThrow(/no longer exists/);
  });

  it('refuses a token whose subject is not the session target', async () => {
    const { s } = strategyWith({ ...liveSession, target_user_id: '77777777-7777-4777-8777-777777777777' });
    await expect(s.validate(basePayload({ imp: liveSession.id }) as any)).rejects.toThrow(/does not match/);
  });

  it('still refuses a refresh token, impersonated or not', async () => {
    const { s } = strategyWith(liveSession);
    await expect(s.validate(basePayload({ tokenType: 'refresh', imp: liveSession.id }) as any)).rejects.toThrow(/Invalid token type/);
  });

  it('checks the session BEFORE the account, so a dead session cannot read a live account', async () => {
    const { s, prisma } = strategyWith({ ...liveSession, status: 'expired' });
    await expect(s.validate(basePayload({ imp: liveSession.id }) as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('account checks share one query', () => {
  const row = (extra: any = {}) => ({
    id: '99999999-9999-4999-8999-999999999999', email: 'secretary@tenant.test', first_name: 'Grace', last_name: 'Mwangi',
    gender: null, roles: ['secretary'], fellowship_id: '11111111-1111-4111-8111-111111111111', department_id: null,
    is_active: true, deleted_at: null, token_version: 0, must_change_password: false, fellowship_status: 'active', ...extra,
  });
  const make = (r: any) => {
    const prisma: any = { $queryRaw: jest.fn(async () => (r ? [r] : [])) };
    const config: any = { get: jest.fn(() => 'test-secret-test-secret-test-secret-test-secret-1234') };
    return { s: new JwtStrategyService(config, prisma), prisma };
  };

  it('authenticates with a single database query', async () => {
    const { s, prisma } = make(row());
    await expect(s.validate(basePayload() as any)).resolves.toMatchObject({ fellowshipId: '11111111-1111-4111-8111-111111111111' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses a user of a suspended or missing fellowship', async () => {
    for (const fellowship_status of ['suspended', null]) {
      const { s } = make(row({ fellowship_status }));
      await expect(s.validate(basePayload() as any)).rejects.toThrow(/suspended/);
    }
  });

  it('still lets a platform account in without a fellowship', async () => {
    const { s } = make(row({ roles: ['platform_admin'], fellowship_id: null, fellowship_status: null }));
    await expect(s.validate(basePayload({ roles: ['platform_admin'] }) as any)).resolves.toBeTruthy();
  });

  it('refuses a deactivated, deleted, unknown or stale-session account', async () => {
    for (const r of [row({ is_active: false }), row({ deleted_at: new Date() }), null, row({ token_version: 3 })]) {
      const { s } = make(r);
      await expect(s.validate(basePayload() as any)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('refuses a malformed subject without querying', async () => {
    const { s, prisma } = make(row());
    await expect(s.validate(basePayload({ sub: "x' or 1=1" }) as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
