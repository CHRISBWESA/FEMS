import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ImpersonationService } from './impersonation.service';

const admin = { userId: 'admin-1', permissions: ['admin.impersonate'], roles: ['admin'] };
const support = { userId: 'sup-1', permissions: ['platform.tenants_view'], roles: ['platform_support'] };

const target = {
  id: '99999999-9999-4999-8999-999999999999', email: 'secretary@tenant.test', first_name: 'Grace', last_name: 'Mwangi',
  roles: ['secretary'], fellowship_id: '11111111-1111-4111-8111-111111111111', is_active: true, deleted_at: null,
  token_version: 0, department_id: null, must_change_password: false,
};

function makeService(o: any = {}) {
  const sessions: any[] = [];
  const prisma: any = {
    user: {
      findMany: jest.fn(async () => o.targetRows ?? []),
      count: jest.fn(async () => (o.targetRows ?? []).length),
      findUnique: jest.fn(async ({ where }: any) => (where.id === '99999999-9999-4999-8999-999999999999' ? (o.target ?? target) : (o.admin ?? { id: 'admin-1', first_name: 'Ann', last_name: 'Ad', email: 'a@b.c' }))),
    },
    fellowship: {
      findUnique: jest.fn(async () => o.tenant ?? { id: '11111111-1111-4111-8111-111111111111', name: 'Tenant Fellowship', status: 'active' }),
      findMany: jest.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Tenant Fellowship' }]),
    },
    impersonationSession: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: '22222222-2222-4222-8222-222222222222', started_at: new Date(), created_at: new Date(), ...data };
        sessions.push(row);
        return row;
      }),
      // Returns a created session when one matches, so the "is there a live session?" queries behave like the
      // database rather than always answering null.
      findFirst: jest.fn(async ({ where }: any) => {
        if (o.liveSession) return o.liveSession;
        const live = sessions.filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.target_user_id && s.target_user_id !== where.target_user_id) return false;
          if (where.admin_user_id && s.admin_user_id !== where.admin_user_id) return false;
          if (where.expires_at?.gt && !(s.expires_at > where.expires_at.gt)) return false;
          return true;
        });
        return live[0] ?? null;
      }),
      findUnique: jest.fn(async ({ where }: any) => sessions.find((s) => s.id === where.id) ?? o.session ?? null),
      findMany: jest.fn(async () => sessions),
      count: jest.fn(async () => sessions.length),
      update: jest.fn(async ({ where, data }: any) => {
        const row = sessions.find((s) => s.id === where.id);
        if (!row) throw new Error('missing');
        Object.assign(row, data);
        return row;
      }),
    },
  };
  const jwt = { sign: jest.fn((payload: any) => `tok:${payload.sub}:${payload.imp ?? 'real'}`) };
  const audit = { log: jest.fn(async (_entry: any) => undefined) };
  const notifications = { create: jest.fn(async (_n: any) => undefined) };
  const svc = new ImpersonationService(prisma as any, jwt as any, audit as any, notifications as any);
  return { svc, prisma, jwt, audit, notifications, sessions };
}

const goodStart = { targetUserId: '99999999-9999-4999-8999-999999999999', reason: 'Client reported a lockout and asked us to check their account.', durationMinutes: 30 };

describe('listing impersonation targets', () => {
  it('needs the impersonate permission', async () => {
    const { svc } = makeService();
    await expect(svc.targets(support, {})).rejects.toThrow(/permission/);
  });

  it('only ever offers active tenant accounts', async () => {
    const { svc, prisma } = makeService();
    await svc.targets(admin, {});
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.fellowship_id).toEqual({ not: null });
    expect(where.is_active).toBe(true);
    expect(where.deleted_at).toBeNull();
    // Platform roles are excluded from the target list.
    expect(where.NOT).toEqual({ roles: { hasSome: ['admin', 'platform_support'] } });
  });
});

describe('starting an impersonation session', () => {
  it('needs the impersonate permission', async () => {
    const { svc } = makeService();
    await expect(svc.start(support, goodStart)).rejects.toThrow(/permission/);
  });

  it('requires a real reason', async () => {
    const { svc } = makeService();
    await expect(svc.start(admin, { ...goodStart, reason: 'short' })).rejects.toThrow(/at least 10 characters/);
    await expect(svc.start(admin, { ...goodStart, reason: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.start(admin, { ...goodStart, reason: undefined })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bounds the duration to 5-120 minutes', async () => {
    const { svc } = makeService();
    for (const bad of [0, 4, 121, 1.5, -30]) {
      await expect(svc.start(admin, { ...goodStart, durationMinutes: bad })).rejects.toThrow(/between 5 and 120/);
    }
    await expect(svc.start(admin, { ...goodStart, durationMinutes: 120 })).resolves.toBeDefined();
  });

  it('refuses a platform account as a target', async () => {
    const { svc } = makeService({ target: { ...target, fellowship_id: null } });
    await expect(svc.start(admin, goodStart)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a target that holds a platform role', async () => {
    const { svc } = makeService({ target: { ...target, roles: ['secretary', 'admin'] } });
    await expect(svc.start(admin, goodStart)).rejects.toThrow(/platform role/);
  });

  it('refuses a deleted or deactivated account', async () => {
    await expect(makeService({ target: { ...target, deleted_at: new Date() } }).svc.start(admin, goodStart)).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeService({ target: { ...target, is_active: false } }).svc.start(admin, goodStart)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a suspended fellowship', async () => {
    const { svc } = makeService({ tenant: { id: '11111111-1111-4111-8111-111111111111', name: 'T', status: 'suspended' } });
    await expect(svc.start(admin, goodStart)).rejects.toThrow(/suspended/);
  });

  it('allows only one live session per administrator', async () => {
    const { svc } = makeService({ liveSession: { id: '33333333-3333-4333-8333-333333333333' } });
    await expect(svc.start(admin, goodStart)).rejects.toBeInstanceOf(ConflictException);
  });

  it('issues a token for the TARGET, carrying the session id', async () => {
    const { svc, jwt, prisma } = makeService();
    const out = await svc.start(admin, goodStart);
    const payload = jwt.sign.mock.calls[0][0];
    expect(payload.sub).toBe('99999999-9999-4999-8999-999999999999');
    expect(payload.roles).toEqual(['secretary']);
    expect(payload.imp).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload.impBy).toBe('admin-1');
    expect(out.accessToken).toContain('tok:99999999-9999-4999-8999-999999999999:22222222-2222-4222-8222-222222222222');
    // The session row records who, why, for how long and who was acted as.
    const row = prisma.impersonationSession.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ admin_user_id: 'admin-1', target_user_id: '99999999-9999-4999-8999-999999999999', fellowship_id: '11111111-1111-4111-8111-111111111111', status: 'active' });
    expect(row.approval_token).toBe('not-required');
  });

  it('notifies the account holder and audits BOTH sides', async () => {
    const { svc, audit, notifications } = makeService();
    await svc.start(admin, goodStart);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: '99999999-9999-4999-8999-999999999999',
      eventType: 'impersonation_started',
      fellowshipId: '11111111-1111-4111-8111-111111111111',
    }));
    const actions = audit.log.mock.calls.map((c) => c[0].action);
    expect(actions.filter((a: string) => a === 'impersonation.start')).toHaveLength(2);
    // Both entries carry the session, so the trail cannot be laundered.
    for (const c of audit.log.mock.calls) expect(c[0].impersonationSessionId).toBe('22222222-2222-4222-8222-222222222222');
    // The reason reaches the client in the notification, without naming the internal fields.
    expect(JSON.stringify(notifications.create.mock.calls[0][0].message)).toMatch(/lockout/);
  });
});

describe('ending a session', () => {
  async function started() {
    const m = makeService();
    const out = await m.svc.start(admin, goodStart);
    return { ...m, out };
  }

  it('lets the administrator end their own session', async () => {
    const { svc, audit } = await started();
    const done = await svc.end(admin, '22222222-2222-4222-8222-222222222222', { reason: 'Fixed it.' });
    expect(done.status).toBe('expired');
    expect(done.endReason).toBe('Fixed it.');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'impersonation.end' }));
  });

  it('refuses to let one administrator end another\'s session', async () => {
    const { svc } = await started();
    await expect(svc.end({ userid: '44444444-4444-4444-8444-444444444444', permissions: ['admin.impersonate'], roles: ['admin'] }, '22222222-2222-4222-8222-222222222222', {}))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the impersonated person end it, and records that they did', async () => {
    const { svc, audit } = await started();
    const done = await svc.end({ userId: '99999999-9999-4999-8999-999999999999' }, '22222222-2222-4222-8222-222222222222', {}, { asClient: true });
    expect(done.status).toBe('expired');
    expect(done.endReason).toBe('Ended by the account holder');
    expect(audit.log).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'impersonation.end', comment: 'Ended by the account holder' }));
  });

  it('does not let a bystander end someone else\'s session', async () => {
    const { svc } = await started();
    await expect(svc.end({ userId: '55555555-5555-4555-8555-555555555555' }, '22222222-2222-4222-8222-222222222222', {}, { asClient: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a second end', async () => {
    const { svc } = await started();
    await svc.end(admin, '22222222-2222-4222-8222-222222222222', {});
    await expect(svc.end(admin, '22222222-2222-4222-8222-222222222222', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s on an unknown session and 400s on a bad id', async () => {
    const { svc } = makeService();
    await expect(svc.end(admin, '00000000-0000-0000-0000-000000000000', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.end(admin, 'nope', {})).rejects.toThrow(/must be a valid id/);
  });
});

describe('the impersonated person\'s own view', () => {
  it('reports nothing when no session is live', async () => {
    const { svc } = makeService();
    await expect(svc.myActiveSession({ userId: '99999999-9999-4999-8999-999999999999' })).resolves.toEqual({ active: false, session: null });
  });

  it('exposes the reason and the expiry so it can be reviewed or revoked', async () => {
    const { svc } = makeService();
    await svc.start(admin, goodStart);
    const view = await svc.myActiveSession({ userId: '99999999-9999-4999-8999-999999999999' });
    expect(view.active).toBe(true);
    expect(view.session.reason).toMatch(/lockout/);
    expect(view.session.expiresAt).toBeInstanceOf(Date);
    expect(view.session.adminName).toBe('Ann Ad');
  });
});
