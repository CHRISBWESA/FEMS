import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { addToDepartment, api, createTestApp, describeDb, getPrisma, makeActivity, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

describeDb('Phase 19 - platform administration & tenant lifecycle (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any;
  let padmin: any, support: any, support2: any, secA: any, asstA: any, chairA: any, ordA: any, secB: any, ordB: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const login = (email: string, password: string) => api(app).post('/auth/login', { email, password });
  const admin1 = (email: string) => ({ email, firstName: 'New', lastName: 'Admin' });
  const onboard = async (extra: object = {}, by = padmin) => {
    const name = `Tenant ${uniq()}`;
    const r = await post(by, '/platform/onboarding', { name, administrator: admin1(`adm${uniq()}@test.local`), ...extra }).expect(201);
    return { name, ...r.body };
  };
  // A temporary password only allows choosing a real one (server-enforced since Phase 22).
  const NEW_PASSWORD = 'Sturdy-Passphrase-42';
  const settle = async (email: string, temp: string) => {
    const l = (await login(email, temp).expect(201)).body;
    expect(l.user.mustChangePassword).toBe(true);
    const c = (await post({ token: l.accessToken }, '/auth/change-password', { oldPassword: temp, newPassword: NEW_PASSWORD }).expect(201)).body;
    return { token: c.accessToken as string, id: l.user.id as string };
  };
  const notes = (userId: string, event: string, entityId?: string) => prisma.notification.findMany({ where: { recipient_user_id: userId, event_type: event, ...(entityId ? { entity_id: entityId } : {}) } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'PA');
    fB = await makeFellowship(prisma, 'PB');
    padmin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    support = await makeUser(prisma, { fellowshipId: null, roles: ['platform_support'] });
    support2 = await makeUser(prisma, { fellowshipId: null, roles: ['platform_support'] });
    const mk = (roles: string[], f = fA) => makeUser(prisma, { fellowshipId: f.id, roles });
    secA = await mk(['secretary']); asstA = await mk(['assistant_secretary']); chairA = await mk(['chairperson']); ordA = await mk(['ordinary_member']);
    secB = await mk(['secretary'], fB); ordB = await mk(['ordinary_member'], fB);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('platform accounts are outside every fellowship (default-deny, checked over every registered route)', () => {
    const OPEN_TO_PLATFORM = ['/api/v1/auth', '/api/v1/users', '/api/v1/fellowships', '/api/v1/backups', '/api/v1/audit', '/api/v1/notifications', '/api/v1/dashboard', '/api/v1/profile', '/api/v1/platform'];
    // Public by design: the attendance link, the provider webhook (authenticated by signature, see billing tests) and the
    // liveness/database probe, which returns only {status, database} and touches no tenant data.
    const PUBLIC = [
      'POST /api/v1/activities/attendance',
      'POST /api/v1/billing/webhooks/:provider',
      'GET /api/v1/health',
      'GET /api/v1/health/live',
      'GET /api/v1/health/ready',
      // The two public sites are @Public() BY DESIGN. A landing page is meant to be readable by anybody who can
      // reach the internet, and this assertion is that a platform account cannot read a TENANT's content - which a
      // public page is not. These routes take a subdomain rather than a record id and answer 404 for anything that
      // is not a published site, so they disclose nothing to a platform account beyond what a stranger sees.
      // A platform administrator genuinely being able to edit a tenant's landing page is refused outright (403) and
      // is asserted in public-site-publish.int-spec.ts, along with public-site content isolation in
      // public-site-isolation.int-spec.ts.
      'GET /api/v1/public/site/stats',
      'GET /api/v1/public/site/plans',
      'GET /api/v1/public/fellowships/:subdomain',
      'GET /api/v1/public/fellowships/:subdomain/pages/:key',
      'GET /api/v1/public/fellowships/:subdomain/leadership',
      'GET /api/v1/public/fellowships/:subdomain/departments',
      'GET /api/v1/public/fellowships/:subdomain/ministries',
      'GET /api/v1/public/fellowships/:subdomain/events',
      'GET /api/v1/public/fellowships/:subdomain/news',
      'GET /api/v1/public/fellowships/:subdomain/publications',
      'GET /api/v1/public/fellowships/:subdomain/gallery',
      'GET /api/v1/public/fellowships/:subdomain/gallery/photos',
      'GET /api/v1/public/fellowships/:subdomain/sermons',
      'GET /api/v1/public/fellowships/:subdomain/testimonies',
      'GET /api/v1/public/fellowships/:subdomain/projects',
      'GET /api/v1/public/fellowships/:subdomain/get-involved',
      'GET /api/v1/public/fellowships/:subdomain/giving',
    ];

    const routes = () => {
      const server: any = app.getHttpAdapter().getInstance();
      const stack: any[] = (server.router ?? server._router).stack;
      const out: { method: string; path: string }[] = [];
      for (const layer of stack) {
        const route = layer.route;
        if (!route || typeof route.path !== 'string') continue;
        for (const method of Object.keys(route.methods)) if (route.methods[method]) out.push({ method: method.toUpperCase(), path: route.path });
      }
      return out;
    };
    const fill = (p: string) => p.replace(/:[A-Za-z]+/g, () => randomUUID());
    const call = (u: any, method: string, path: string) => {
      const a = api(app, u.token);
      const url = fill(path).replace('/api/v1', '');
      return method === 'GET' ? a.get(url) : method === 'POST' ? a.post(url, {}) : a.put(url, {});
    };

    it('finds the application routes', () => {
      expect(routes().length).toBeGreaterThan(150);
    });

    it('admin and platform_support get 403 on every route that is not marked as platform-safe', async () => {
      const closed = routes().filter((r) => !OPEN_TO_PLATFORM.some((p) => r.path.startsWith(p)) && !PUBLIC.includes(`${r.method} ${r.path}`) && ['GET', 'POST', 'PUT'].includes(r.method));
      expect(closed.length).toBeGreaterThan(100);
      const failures: string[] = [];
      for (const r of closed) {
        for (const [who, u] of [['admin', padmin], ['support', support]] as const) {
          const res = await call(u, r.method, r.path);
          if (res.status !== 403) failures.push(`${who} ${r.method} ${r.path} -> ${res.status}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('DELETE routes are closed too', async () => {
      const closed = routes().filter((r) => r.method === 'DELETE' && !OPEN_TO_PLATFORM.some((p) => r.path.startsWith(p)));
      expect(closed.length).toBeGreaterThan(0);
      for (const r of closed) {
        for (const u of [padmin, support]) {
          const del = await api(app, u.token).delete(fill(r.path).replace('/api/v1', ''));
          expect(del.status).toBe(403);
        }
      }
    });

    it('the platform-safe surfaces do work for platform accounts', async () => {
      await get(padmin, '/platform/dashboard').expect(200);
      await get(padmin, '/fellowships').expect(200);
      await get(padmin, '/audit').expect(200);
      await get(padmin, '/backups').expect(200);
      await get(padmin, '/profile').expect(200);
      await get(padmin, '/notifications').expect(200);
      await get(support, '/platform/dashboard').expect(200);
      await get(support, '/platform/tenants').expect(200);
    });

    it('tenant users cannot reach any platform route, and platform accounts cannot decide support requests', async () => {
      for (const u of [secA, asstA, chairA, ordA]) {
        for (const url of ['/platform/dashboard', '/platform/tenants', '/platform/audit', '/platform/staff', '/platform/support/grants']) await get(u, url).expect(403);
        await post(u, '/platform/onboarding', {}).expect(403);
      }
      for (const u of [padmin, support]) {
        await get(u, '/support/grants').expect(403);
        await post(u, `/support/grants/${randomUUID()}/decide`, { decision: 'approve' }).expect(403);
      }
      for (const url of ['/platform/dashboard', '/platform/tenants', '/support/grants']) await api(app).get(url).expect(401);
    });

    it('support staff are read-only: they cannot change tenants, onboard, manage staff or read the platform audit', async () => {
      await post(support, '/platform/onboarding', { name: 'x', administrator: admin1('x@test.local') }).expect(403);
      await post(support, `/platform/tenants/${fA.id}/suspend`, { reason: 'because reasons' }).expect(403);
      await put(support, `/platform/tenants/${fA.id}/modules`, { modules: { youth: false } }).expect(403);
      await put(support, `/platform/tenants/${fA.id}`, { name: 'hijack' }).expect(403);
      await post(support, `/platform/tenants/${fA.id}/administrators`, admin1('y@test.local')).expect(403);
      await get(support, '/platform/staff').expect(403);
      await post(support, '/platform/staff', { email: 'z@test.local', firstName: 'a', lastName: 'b' }).expect(403);
      await get(support, '/platform/audit').expect(403);
      await get(support, '/fellowships').expect(403);
      await get(support, '/users').expect(403);
      await get(support, '/backups').expect(403);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('account security fixes found in this phase', () => {
    it('a deactivated or deleted account loses access immediately (its token stops working)', async () => {
      const u = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      await get(u, '/profile').expect(200);
      await prisma.user.update({ where: { id: u.id }, data: { is_active: false } });
      await get(u, '/profile').expect(401);
      await prisma.user.update({ where: { id: u.id }, data: { is_active: true, deleted_at: new Date() } });
      await get(u, '/profile').expect(401);
    });

    it('a deactivated account cannot mint new access tokens from its refresh token', async () => {
      const u = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      const refresh = jwt.sign({ sub: u.id, tokenType: 'refresh' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
      await api(app).post('/auth/refresh', { refreshToken: refresh }).expect(201);
      await prisma.user.update({ where: { id: u.id }, data: { is_active: false } });
      await api(app).post('/auth/refresh', { refreshToken: refresh }).expect(401);
    });

    it('password reset is tenant-scoped, protects platform accounts, and issues a random temporary password', async () => {
      const target = await makeUser(prisma, { fellowshipId: fA.id, roles: ['treasurer'] });
      // Treasurer is a protected finance role, so no tenant officer may reset it: a secretary or assistant must not be
      // able to lock a peer out of an account they can see. Only the platform administrator may.
      await post(secA, '/auth/reset-password', { targetUserId: target.id }).expect(403);
      await post(asstA, '/auth/reset-password', { targetUserId: target.id }).expect(403);
      await post(chairA, '/auth/reset-password', { targetUserId: target.id }).expect(403); // role gate
      const r1 = (await post(padmin, '/auth/reset-password', { targetUserId: target.id }).expect(201)).body;
      expect(r1.temporaryPassword).not.toBe('123456789');
      expect(r1.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      // the temporary password really works, once, and the old constant does not
      await login(target.email, '123456789').expect(401);
      const ok = await login(target.email, r1.temporaryPassword).expect(201);
      expect(ok.body.user.roles).toEqual(['treasurer']);
      const r2 = (await post(padmin, '/auth/reset-password', { targetUserId: target.id }).expect(201)).body;
      expect(r2.temporaryPassword).not.toBe(r1.temporaryPassword);

      // cross-tenant, platform accounts, and higher authority are all refused
      await post(secA, '/auth/reset-password', { targetUserId: secB.id }).expect(403);
      await post(secA, '/auth/reset-password', { targetUserId: ordB.id }).expect(403);
      await post(secA, '/auth/reset-password', { targetUserId: padmin.id }).expect(403);
      await post(secA, '/auth/reset-password', { targetUserId: support.id }).expect(403);
      await post(asstA, '/auth/reset-password', { targetUserId: secA.id }).expect(403);
      await post(secA, '/auth/reset-password', { targetUserId: 'nope' }).expect(404);
      await post(secA, '/auth/reset-password', { targetUserId: randomUUID() }).expect(404);
      // a secretary may still reset an ordinary member of their own fellowship
      const ownOrd = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      await post(secA, '/auth/reset-password', { targetUserId: ownOrd.id }).expect(201);
      // the platform administrator may reset tenant leadership and support accounts
      // (fresh accounts: a reset signs the target out everywhere, which would invalidate the shared fixtures' tokens)
      const secB2 = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
      const support3 = await makeUser(prisma, { fellowshipId: null, roles: ['platform_support'] });
      const ordB2 = await makeUser(prisma, { fellowshipId: fB.id, roles: ['ordinary_member'] });
      await post(padmin, '/auth/reset-password', { targetUserId: secB2.id }).expect(201);
      await post(padmin, '/auth/reset-password', { targetUserId: support3.id }).expect(201);
      await post(padmin, '/auth/reset-password', { targetUserId: ordB2.id }).expect(201);
      await get(secB2, '/profile').expect(401); // the reset ended the account's existing sessions
      await post(padmin, '/auth/reset-password', { targetUserId: padmin.id }).expect(403);
      const other = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
      await post(padmin, '/auth/reset-password', { targetUserId: other.id }).expect(403);
    });

    it('a secretary cannot hand out platform roles, and the platform admin still provisions tenant leadership', async () => {
      await put(secA, `/users/${ordA.id}/roles`, { roles: ['platform_support'] }).expect(403);
      await put(secA, `/users/${ordA.id}/roles`, { roles: ['admin'] }).expect(403);
      expect((await prisma.user.findUnique({ where: { id: ordA.id } }))!.roles).toEqual(['ordinary_member']);
      // the escalation attempt must not have been silently applied, nor the shared fixture's session invalidated
      await get(ordA, '/profile').expect(200);
      // the supported path: the platform administrator provisions the protected tenant role (on a fresh account,
      // because granting roles bumps token_version and would sign the shared fixture out)
      const fresh = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      await put(padmin, `/users/${fresh.id}/roles`, { roles: ['chairperson'] }).expect(200);
      expect((await prisma.user.findUnique({ where: { id: fresh.id } }))!.roles).toEqual(['chairperson']);
    });

    it('impersonation has been retired', async () => {
      await post(padmin, '/auth/request-impersonation', { targetUserId: secA.id, reason: 'help' }).expect(410);
      await post(padmin, '/auth/cancel-impersonation').expect(410);
      await api(app).post('/auth/approve-impersonation/anything', {}).expect(410);
      await post(secA, '/auth/request-impersonation', { targetUserId: ordA.id, reason: 'x' }).expect(403);
    });

    it('backups are platform-level: fellowship staff no longer reach them', async () => {
      for (const u of [secA, asstA, chairA, ordA]) await get(u, '/backups').expect(403);
      await post(secA, '/backups').expect(403);
      await post(asstA, `/backups/${randomUUID()}/restore`, { confirmSafetyBackup: true }).expect(403);
      await get(padmin, '/backups').expect(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('tenant audit trail is tenant-scoped; the platform sees platform entries only', () => {
    it('a fellowship\'s secretary or chairperson sees only their own fellowship\'s entries', async () => {
      const a = `test.tenant_a_${uniq()}`, b = `test.tenant_b_${uniq()}`;
      await prisma.auditLog.create({ data: { user_id: secA.id, action: a, fellowship_id: fA.id } });
      await prisma.auditLog.create({ data: { user_id: secB.id, action: b, fellowship_id: fB.id } });
      const seenByA = (await get(secA, '/audit?limit=100').expect(200)).body;
      expect(seenByA.data.every((r: any) => r.fellowship_id === fA.id)).toBe(true);
      expect((await get(secA, `/audit?action=${a}`).expect(200)).body.data).toHaveLength(1);
      expect((await get(secA, `/audit?action=${b}`).expect(200)).body.data).toHaveLength(0);
      expect((await get(secB, `/audit?action=${a}`).expect(200)).body.data).toHaveLength(0);
      expect((await get(chairA, `/audit?action=${b}`).expect(200)).body.data).toHaveLength(0);
      await get(ordA, '/audit').expect(403);
      await get(asstA, '/audit').expect(403);
      const stats = (await get(secA, '/audit/stats').expect(200)).body;
      expect(stats.recentActions.every((r: any) => r.fellowship_id === fA.id)).toBe(true);
      expect(stats.totalEntries).toBe(await prisma.auditLog.count({ where: { fellowship_id: fA.id } }));
    });

    it('audit entries written by the application carry the acting user\'s fellowship', async () => {
      // A tenant officer resetting an ordinary member of their own fellowship: the row must be stamped with the
      // actor's fellowship (secA/fA), not the target's, so tenant audit scoping stays correct.
      const t = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      await post(secA, '/auth/reset-password', { targetUserId: t.id }).expect(201);
      const row = await prisma.auditLog.findFirst({ where: { user_id: secA.id, action: 'password.reset', entity_id: t.id } });
      expect(row!.fellowship_id).toBe(fA.id);
    });

    it('the platform administrator sees platform-level entries, never a fellowship\'s operational audit', async () => {
      const op = `member.edit_${uniq()}`;
      await prisma.auditLog.create({ data: { user_id: secA.id, action: op, fellowship_id: fA.id, old_value: { phone: '0700-secret' } } });
      const viaAudit = (await get(padmin, `/audit?action=${op}`).expect(200)).body;
      const viaPlatform = (await get(padmin, `/platform/audit?action=${op}`).expect(200)).body;
      expect(viaAudit.data).toHaveLength(0);
      expect(viaPlatform.data).toHaveLength(0);
      const t = await onboard();
      const mine = (await get(padmin, '/platform/audit?action=platform.tenant_onboard&limit=100').expect(200)).body;
      expect(mine.data.some((r: any) => r.entity_id === t.fellowship.id)).toBe(true);
      const stats = (await get(padmin, '/audit/stats').expect(200)).body;
      expect(JSON.stringify(stats)).not.toContain('0700-secret');
    });

    it('validates audit filters', async () => {
      await get(secA, '/audit?userId=nope').expect(400);
      await get(secA, '/audit?entityId=nope').expect(400);
      await get(secA, '/audit?from=garbage').expect(400);
      await get(secA, '/audit?to=garbage').expect(400);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('onboarding', () => {
    it('creates a fellowship, its module settings and its first administrator in one step', async () => {
      const email = `first${uniq()}@test.local`;
      const name = `Grace Fellowship ${uniq()}`;
      const r = (await post(padmin, '/platform/onboarding', { name, location: 'Nairobi', description: 'x', modules: { youth: false, finance: true }, administrator: { ...admin1(email), phone: '0711' } }).expect(201)).body;
      expect(r.fellowship).toMatchObject({ name, status: 'active' });
      expect(r.administrator.email).toBe(email);
      expect(r.administrator.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(JSON.stringify(r)).not.toMatch(/password_hash|\$2[aby]\$/);

      const user = (await prisma.user.findUnique({ where: { email } }))!;
      expect(user).toMatchObject({ fellowship_id: r.fellowship.id, is_active: true, must_change_password: true });
      // The onboarding administrator is the fellowship's SYSTEM administrator, not its Secretary: configuring the
      // FEMS account is a different job from being an officer of the congregation.
      expect(user.roles).toEqual(['fellowship_admin']);
      const settings = await prisma.fellowshipModuleSetting.findMany({ where: { fellowship_id: r.fellowship.id } });
      expect(settings).toHaveLength(1);
      expect(settings[0]).toMatchObject({ module_key: 'youth', enabled: false });

      // the administrator can sign in with the temporary password, must change it, and is confined to the new fellowship
      const l = (await login(email, r.administrator.temporaryPassword).expect(201)).body;
      expect(l.user.roles).toEqual(['fellowship_admin']);
      const token = l.accessToken;
      const me = await api(app, token).get('/profile').expect(200);
      expect(me.body.mustChangePassword).toBe(true);
      expect(me.body.disabledModules).toEqual(['youth']);
      // until the temporary password is replaced, nothing else works
      const blocked = await api(app, token).get('/members').expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      const changed = (await post({ token }, '/auth/change-password', { oldPassword: r.administrator.temporaryPassword, newPassword: NEW_PASSWORD }).expect(201)).body;
      const fresh = changed.accessToken;
      await api(app, token).get('/profile').expect(401); // every token issued before the change is dead
      await api(app, fresh).get('/youth').expect(403); // switched off at onboarding
      expect((await api(app, fresh).get('/members').expect(200)).body.data.length).toBe(1); // only their own member record
      expect((await api(app, fresh).get('/profile').expect(200)).body.mustChangePassword).toBe(false);

      // the audit entry never carries the password or the address
      const audit = await prisma.auditLog.findFirst({ where: { action: 'platform.tenant_onboard', entity_id: r.fellowship.id } });
      expect(audit!.fellowship_id).toBe(r.fellowship.id);
      const blob = JSON.stringify(audit);
      expect(blob).not.toContain(r.administrator.temporaryPassword);
      expect(blob).not.toContain(email);
    });

    it('validates input and is atomic', async () => {
      const bad = (body: object) => post(padmin, '/platform/onboarding', body).expect(400);
      await bad({});
      await bad({ name: 'x', administrator: admin1('a@test.local') });
      await bad({ name: 'Valid name', administrator: { firstName: 'a', lastName: 'b', email: 'not-an-email' } });
      await bad({ name: 'Valid name', administrator: { email: 'ok@test.local', lastName: 'b' } });
      await bad({ name: 'Valid name' });
      await bad({ name: 'Valid name', administrator: admin1('ok@test.local'), modules: { nonsense: false } });
      await bad({ name: 'Valid name', administrator: admin1('ok@test.local'), modules: { youth: 'no' } });
      await bad({ name: 'Valid name', administrator: admin1('ok@test.local'), modules: [] });
      // duplicates
      const t = await onboard();
      await post(padmin, '/platform/onboarding', { name: t.name.toUpperCase(), administrator: admin1(`other${uniq()}@test.local`) }).expect(409);
      const ghost = `Ghost ${uniq()}`;
      await post(padmin, '/platform/onboarding', { name: ghost, administrator: admin1(t.administrator.email) }).expect(409);
      expect(await prisma.fellowship.count({ where: { name: ghost } })).toBe(0); // nothing half-created
    });

    it('adds a further administrator to an existing fellowship without seeing its members', async () => {
      const t = await onboard();
      const email = `second${uniq()}@test.local`;
      const r = (await post(padmin, `/platform/tenants/${t.fellowship.id}/administrators`, admin1(email)).expect(201)).body;
      await login(email, r.administrator.temporaryPassword).expect(201);
      await post(padmin, `/platform/tenants/${t.fellowship.id}/administrators`, admin1(email)).expect(409);
      await post(padmin, `/platform/tenants/${randomUUID()}/administrators`, admin1(`x${uniq()}@test.local`)).expect(404);
      await post(padmin, '/platform/tenants/nope/administrators', admin1(`y${uniq()}@test.local`)).expect(400);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('tenant lifecycle: suspension is enforced everywhere', () => {
    it('suspends and reactivates; suspended users are locked out at once; other fellowships are unaffected', async () => {
      const t = await onboard();
      const fid = t.fellowship.id;
      const s0 = await settle(t.administrator.email, t.administrator.temporaryPassword);
      const tok = { token: s0.token };
      await get(tok, '/profile').expect(200);
      const act = await makeActivity(prisma, { fellowshipId: fid });
      await api(app).post('/activities/attendance', { activityId: act.id, memberName: 'Visitor' }).expect(201);

      await post(padmin, `/platform/tenants/${fid}/suspend`, {}).expect(400); // a reason is required
      await post(padmin, `/platform/tenants/${fid}/suspend`, { reason: 'ok' }).expect(400);
      const s = (await post(padmin, `/platform/tenants/${fid}/suspend`, { reason: 'Unpaid invoices - contacted' }).expect(201)).body;
      expect(s.status).toBe('suspended');
      expect(s.suspensionReason).toBe('Unpaid invoices - contacted');
      expect(await prisma.fellowship.findUnique({ where: { id: fid } })).toMatchObject({ status: 'suspended', is_active: false });

      // existing token, new login, and the public attendance link are all refused
      for (const url of ['/profile', '/members', '/dashboard', '/notifications']) await get(tok, url).expect(403);
      const denied = await login(t.administrator.email, NEW_PASSWORD).expect(403);
      expect(denied.body.message).toMatch(/suspended/i);
      await login(t.administrator.email, 'wrong-password').expect(401); // a wrong password still reveals nothing about the tenant
      await api(app).post('/activities/attendance', { activityId: act.id, memberName: 'Visitor' }).expect(404);
      // ...while other fellowships carry on
      await get(secB, '/members').expect(200);
      await get(secA, '/dashboard').expect(200);

      await post(padmin, `/platform/tenants/${fid}/suspend`, { reason: 'again please' }).expect(409);
      await post(support, `/platform/tenants/${fid}/reactivate`, {}).expect(403);
      await post(secA, `/platform/tenants/${fid}/reactivate`, {}).expect(403);
      await post(padmin, `/platform/tenants/${fid}/reactivate`, { reason: 'Paid' }).expect(201);
      await post(padmin, `/platform/tenants/${fid}/reactivate`, {}).expect(409);
      await get(tok, '/profile').expect(200);
      await login(t.administrator.email, NEW_PASSWORD).expect(201);
      await api(app).post('/activities/attendance', { activityId: act.id, memberName: 'Visitor' }).expect(201);

      // both actions are on the record, against the fellowship
      const rows = await prisma.auditLog.findMany({ where: { fellowship_id: fid, action: { startsWith: 'platform.tenant_' } }, orderBy: { timestamp: 'asc' } });
      expect(rows.map((r) => r.action)).toEqual(['platform.tenant_onboard', 'platform.tenant_suspend', 'platform.tenant_reactivate']);
    });

    it('the legacy fellowships screen keeps the lifecycle consistent', async () => {
      const t = await onboard();
      const l = await settle(t.administrator.email, t.administrator.temporaryPassword);
      await put(padmin, `/fellowships/${t.fellowship.id}`, { is_active: false }).expect(200);
      expect((await prisma.fellowship.findUnique({ where: { id: t.fellowship.id } }))!.status).toBe('suspended');
      await api(app, l.token).get('/profile').expect(403);
      await put(padmin, `/fellowships/${t.fellowship.id}`, { is_active: true }).expect(200);
      await api(app, l.token).get('/profile').expect(200);
    });

    it('suspending ends any open support access', async () => {
      const t = await onboard();
      const g = (await post(support, '/platform/support/requests', { fellowshipId: t.fellowship.id, scopes: ['tenant_config'], reason: 'Investigating a report' }).expect(201)).body;
      await post(padmin, `/platform/tenants/${t.fellowship.id}/suspend`, { reason: 'security review' }).expect(201);
      expect((await prisma.supportAccessGrant.findUnique({ where: { id: g.id } }))!.status).toBe('revoked');
      await post(support, '/platform/support/requests', { fellowshipId: t.fellowship.id, scopes: ['tenant_config'], reason: 'Investigating a report' }).expect(409);
    });

    it('lists and details tenants with aggregate counts only', async () => {
      const t = await onboard();
      const list = (await get(padmin, `/platform/tenants?search=${encodeURIComponent(t.name)}`).expect(200)).body;
      expect(list.total).toBe(1);
      expect(list.data[0]).toMatchObject({ id: t.fellowship.id, status: 'active', users: 1, members: 1, modulesDisabled: 0 });
      expect(Object.keys(list.data[0]).sort()).toEqual(['createdAt', 'id', 'location', 'members', 'modulesDisabled', 'name', 'status', 'suspendedAt', 'users']);
      const detail = (await get(support, `/platform/tenants/${t.fellowship.id}`).expect(200)).body;
      expect(detail.counts).toEqual({ users: 1, members: 1, activeSecretaries: 1 });
      expect(detail.modules).toHaveLength(6);
      expect(detail.modules.every((m: any) => m.enabled)).toBe(true);
      await get(padmin, '/platform/tenants?status=bogus').expect(400);
      await get(padmin, '/platform/tenants?limit=0').expect(400);
      await get(padmin, '/platform/tenants?limit=9999').expect(400);
      await get(padmin, '/platform/tenants/nope').expect(400);
      await get(padmin, `/platform/tenants/${randomUUID()}`).expect(404);
      await put(padmin, `/platform/tenants/${t.fellowship.id}`, { name: fA.name }).expect(400);
      await put(padmin, `/platform/tenants/${t.fellowship.id}`, {}).expect(400);
      const renamed = (await put(padmin, `/platform/tenants/${t.fellowship.id}`, { location: 'Kisumu' }).expect(200)).body;
      expect(renamed.location).toBe('Kisumu');
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('module availability', () => {
    it('a switched-off module is closed to that fellowship only, and can be switched back on', async () => {
      const probes: [string, string][] = [['youth', '/youth'], ['resources', '/resources/assets'], ['volunteers', '/volunteers/opportunities'], ['analytics', '/analytics/overview'], ['finance', '/finance/periods'], ['member_engagement', '/member-groups']];
      for (const [key, url] of probes) {
        await get(secA, url).expect(200);
        await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: { [key]: false } }).expect(200);
        const blocked = await get(secA, url).expect(403);
        expect(blocked.body.message).toMatch(/not enabled/i);
        await get(secB, url).expect(200); // another fellowship is unaffected
        expect((await get(secA, '/profile').expect(200)).body.disabledModules).toEqual([key]);
        await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: { [key]: true } }).expect(200);
        await get(secA, url).expect(200);
      }
    });

    it('analytics sections of a switched-off module disappear too', async () => {
      await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: { youth: false, resources: false } }).expect(200);
      const ov = (await get(secA, '/analytics/overview').expect(200)).body;
      expect(ov.available).not.toContain('youth');
      expect(ov.available).not.toContain('resources');
      expect(ov.available).toContain('membership');
      await get(secA, '/analytics/youth').expect(403);
      await get(secA, '/analytics/resources').expect(403);
      await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: { youth: true, resources: true } }).expect(200);
      expect((await get(secA, '/analytics/overview').expect(200)).body.available).toContain('youth');
    });

    it('is validated, audited, and reserved for platform administrators', async () => {
      await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: { nonsense: false } }).expect(400);
      await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: { youth: 'off' } }).expect(400);
      await put(padmin, `/platform/tenants/${fA.id}/modules`, { modules: {} }).expect(400);
      await put(padmin, `/platform/tenants/${fA.id}/modules`, {}).expect(400);
      await put(padmin, `/platform/tenants/${randomUUID()}/modules`, { modules: { youth: false } }).expect(404);
      for (const u of [secA, ordA, support]) await put(u, `/platform/tenants/${fA.id}/modules`, { modules: { youth: false } }).expect(403);
      expect(await prisma.auditLog.count({ where: { fellowship_id: fA.id, action: 'platform.tenant_modules' } })).toBeGreaterThan(0);
      expect((await get(secA, '/profile').expect(200)).body.disabledModules).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('support access: scoped, time-boxed, tenant-approved, revocable, audited', () => {
    let t: any, tsec: any, req: any;

    beforeAll(async () => {
      t = await onboard();
      tsec = await settle(t.administrator.email, t.administrator.temporaryPassword);
      const d = await makeDepartment(prisma, t.fellowship.id, 'Support dept');
      const m = await makeMember(prisma, { fellowshipId: t.fellowship.id, name: 'Private Person' });
      await addToDepartment(prisma, m.id, d.id);
    });

    it('a request is validated and reaches the fellowship\'s secretary without its reason in the notification', async () => {
      const fid = t.fellowship.id;
      const bad = (body: object) => post(support, '/platform/support/requests', { fellowshipId: fid, ...body }).expect(400);
      await bad({ scopes: ['tenant_config'] });
      await bad({ scopes: [], reason: 'long enough reason' });
      await bad({ scopes: ['members'], reason: 'long enough reason' });
      await bad({ scopes: ['tenant_config'], reason: 'short' });
      await bad({ scopes: ['tenant_config'], reason: 'long enough reason', durationMinutes: 5 });
      await bad({ scopes: ['tenant_config'], reason: 'long enough reason', durationMinutes: 9999 });
      await bad({ scopes: ['tenant_config'], reason: 'long enough reason', durationMinutes: 'soon' });
      await post(support, '/platform/support/requests', { fellowshipId: 'nope', scopes: ['tenant_config'], reason: 'long enough reason' }).expect(400);
      await post(support, '/platform/support/requests', { fellowshipId: randomUUID(), scopes: ['tenant_config'], reason: 'long enough reason' }).expect(404);
      for (const u of [secA, ordA]) await post(u, '/platform/support/requests', { fellowshipId: fid, scopes: ['tenant_config'], reason: 'long enough reason' }).expect(403);

      req = (await post(support, '/platform/support/requests', { fellowshipId: fid, scopes: ['tenant_config'], reason: 'Sign-in problem reported by the treasurer', durationMinutes: 30 }).expect(201)).body;
      expect(req).toMatchObject({ status: 'requested', scopes: ['tenant_config'], durationMinutes: 30 });
      await post(support, '/platform/support/requests', { fellowshipId: fid, scopes: ['tenant_config'], reason: 'long enough reason' }).expect(409); // one pending request each
      const n = await notes(tsec.id, 'support_request', req.id);
      expect(n).toHaveLength(1);
      expect(n[0].message).not.toMatch(/treasurer|Sign-in/);
    });

    it('nothing can be read before approval, and the platform cannot approve for itself', async () => {
      await get(support, `/platform/support/tenants/${t.fellowship.id}/config`).expect(403);
      await get(support, `/platform/support/tenants/${t.fellowship.id}/users`).expect(403);
      await post(padmin, `/support/grants/${req.id}/decide`, { decision: 'approve' }).expect(403);
      await post(support, `/support/grants/${req.id}/decide`, { decision: 'approve' }).expect(403);
    });

    it('only the fellowship\'s own secretary can see and decide', async () => {
      const list = (await get(tsec, '/support/grants').expect(200)).body;
      expect(list.find((g: any) => g.id === req.id)).toMatchObject({ reason: 'Sign-in problem reported by the treasurer', requestedByName: expect.any(String), status: 'requested' });
      expect((await get(secA, '/support/grants').expect(200)).body.some((g: any) => g.id === req.id)).toBe(false); // another fellowship
      for (const u of [asstA, chairA, ordA]) await get(u, '/support/grants').expect(403);
      await post(secA, `/support/grants/${req.id}/decide`, { decision: 'approve' }).expect(403); // another fellowship's secretary
      await post(secB, `/support/grants/${req.id}/revoke`).expect(403);
      await post(tsec, `/support/grants/${req.id}/decide`, { decision: 'maybe' }).expect(400);
      await post(tsec, `/support/grants/nope/decide`, { decision: 'approve' }).expect(400);
      await post(tsec, `/support/grants/${randomUUID()}/decide`, { decision: 'approve' }).expect(404);
    });

    it('an approved grant unlocks exactly its scope for exactly its requester', async () => {
      const fid = t.fellowship.id;
      const ok = (await post(tsec, `/support/grants/${req.id}/decide`, { decision: 'approve' }).expect(201)).body;
      expect(ok.status).toBe('approved');
      const minutes = (new Date(ok.expiresAt).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(28);
      expect(minutes).toBeLessThanOrEqual(30);
      await post(tsec, `/support/grants/${req.id}/decide`, { decision: 'approve' }).expect(409);
      expect((await notes(support.id, 'support_decision', req.id))).toHaveLength(1);

      const cfg = (await get(support, `/platform/support/tenants/${fid}/config`).expect(200)).body;
      expect(cfg.fellowship).toMatchObject({ id: fid, status: 'active' });
      expect(cfg.departments.map((d: any) => d.name).length).toBe(1);
      expect(cfg.modules).toHaveLength(6);
      expect(cfg.accountsByRole).toEqual([{ role: 'secretary', count: 1 }]);
      const blob = JSON.stringify(cfg);
      expect(blob).not.toContain('Private Person'); // no member data
      expect(blob).not.toContain(t.administrator.email); // no account details in the config scope

      await get(support, `/platform/support/tenants/${fid}/users`).expect(403); // scope not granted
      await get(support2, `/platform/support/tenants/${fid}/config`).expect(403); // somebody else's grant
      await get(padmin, `/platform/support/tenants/${fid}/config`).expect(403); // not even the platform administrator
      await get(support, `/platform/support/tenants/${fA.id}/config`).expect(403); // another fellowship
      await get(support, '/platform/support/tenants/nope/config').expect(400);
      // every use is on the fellowship's own audit trail
      const uses = (await get(tsec, '/audit?action=support.view_config').expect(200)).body.data;
      expect(uses.length).toBeGreaterThan(0);
      expect(uses[0]).toMatchObject({ user_id: support.id, fellowship_id: fid });
      expect((await get(secB, '/audit?action=support.view_config').expect(200)).body.data).toHaveLength(0);
    });

    it('the user-directory scope shows accounts but never contact or credential data; limits are validated', async () => {
      const fid = t.fellowship.id;
      const g = (await post(support, '/platform/support/requests', { fellowshipId: fid, scopes: ['user_directory'], reason: 'Checking which accounts exist' }).expect(201)).body;
      await post(tsec, `/support/grants/${g.id}/decide`, { decision: 'approve' }).expect(201);
      const users = (await get(support, `/platform/support/tenants/${fid}/users`).expect(200)).body;
      expect(users).toHaveLength(1);
      expect(Object.keys(users[0]).sort()).toEqual(['createdAt', 'email', 'firstName', 'id', 'isActive', 'lastName', 'mustChangePassword', 'roles']);
      expect(JSON.stringify(users)).not.toMatch(/phone|password_hash|permissions|\$2[aby]\$/);
      await get(support, `/platform/support/tenants/${fid}/users?limit=1000`).expect(400);
      await get(support, `/platform/support/tenants/${fid}/users?page=0`).expect(400);
      expect(await prisma.auditLog.count({ where: { fellowship_id: fid, user_id: support.id, action: 'support.view_users' } })).toBe(1);
    });

    it('grants end on expiry, revocation, denial and cancellation - checked on every call', async () => {
      const fid = t.fellowship.id;
      const fresh = async (scopes = ['tenant_config']) => {
        const g = (await post(support2, '/platform/support/requests', { fellowshipId: fid, scopes, reason: 'Another look at the settings' }).expect(201)).body;
        return g;
      };
      const view = () => get(support2, `/platform/support/tenants/${fid}/config`);

      let g = await fresh();
      await post(tsec, `/support/grants/${g.id}/decide`, { decision: 'approve' }).expect(201);
      await view().expect(200);
      await prisma.supportAccessGrant.update({ where: { id: g.id }, data: { expires_at: new Date(Date.now() - 1000) } }); // expired
      await view().expect(403);
      expect((await get(support2, '/platform/support/grants').expect(200)).body.find((x: any) => x.id === g.id).status).toBe('expired');

      g = await fresh();
      await post(tsec, `/support/grants/${g.id}/decide`, { decision: 'approve' }).expect(201);
      await view().expect(200);
      await post(tsec, `/support/grants/${g.id}/revoke`).expect(201); // revoked by the fellowship: immediate
      await view().expect(403);
      await post(tsec, `/support/grants/${g.id}/revoke`).expect(409);

      g = await fresh();
      await post(tsec, `/support/grants/${g.id}/decide`, { decision: 'deny' }).expect(201);
      await view().expect(403);
      await post(tsec, `/support/grants/${g.id}/revoke`).expect(409); // only approved grants can be revoked

      g = await fresh();
      await post(tsec, `/support/grants/${g.id}/decide`, { decision: 'approve' }).expect(201);
      await post(support, `/platform/support/grants/${g.id}/cancel`).expect(404); // somebody else's grant
      await post(support2, `/platform/support/grants/${g.id}/cancel`).expect(201); // the requester ends their own access
      await view().expect(403);
      await post(support2, `/platform/support/grants/${g.id}/cancel`).expect(409);
    });

    it('two simultaneous decisions on one request: one wins', async () => {
      const g = (await post(support2, '/platform/support/requests', { fellowshipId: t.fellowship.id, scopes: ['tenant_config'], reason: 'Race between two approvers' }).expect(201)).body;
      const extra = await makeUser(prisma, { fellowshipId: t.fellowship.id, roles: ['secretary'] });
      const r = await Promise.all([post(tsec, `/support/grants/${g.id}/decide`, { decision: 'approve' }), post(extra, `/support/grants/${g.id}/decide`, { decision: 'deny' })]);
      expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    });

    it('a switched-off support account loses its grants', async () => {
      const s3 = (await post(padmin, '/platform/staff', { email: `s3${uniq()}@test.local`, firstName: 'Sam', lastName: 'Support' }).expect(201)).body;
      const tok = await settle(s3.email, s3.temporaryPassword);
      const g = (await post(tok, '/platform/support/requests', { fellowshipId: t.fellowship.id, scopes: ['tenant_config'], reason: 'Third support member request' }).expect(201)).body;
      await post(tsec, `/support/grants/${g.id}/decide`, { decision: 'approve' }).expect(201);
      await get(tok, `/platform/support/tenants/${t.fellowship.id}/config`).expect(200);
      await post(padmin, `/platform/staff/${s3.id}/deactivate`).expect(201);
      await get(tok, `/platform/support/tenants/${t.fellowship.id}/config`).expect(401); // the account itself is off
      expect((await prisma.supportAccessGrant.findUnique({ where: { id: g.id } }))!.status).toBe('revoked');
      await post(padmin, `/platform/staff/${s3.id}/activate`).expect(201);
      await get(tok, `/platform/support/tenants/${t.fellowship.id}/config`).expect(403); // and the old grant is gone
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('platform staff and dashboard', () => {
    it('only the platform administrator manages support accounts, and never other administrators', async () => {
      const list = (await get(padmin, '/platform/staff').expect(200)).body;
      expect(list.some((s: any) => s.id === padmin.id)).toBe(true);
      expect(list.every((s: any) => s.roles.includes('admin') || s.roles.includes('platform_support'))).toBe(true);
      const email = `staff${uniq()}@test.local`;
      const s = (await post(padmin, '/platform/staff', { email, firstName: 'Sue', lastName: 'Support' }).expect(201)).body;
      expect(s.roles).toEqual(['platform_support']);
      await post(padmin, '/platform/staff', { email, firstName: 'Sue', lastName: 'Support' }).expect(409);
      await post(padmin, '/platform/staff', { email: 'bad', firstName: 'a', lastName: 'b' }).expect(400);
      const l = (await login(email, s.temporaryPassword).expect(201)).body;
      expect(l.user.roles).toEqual(['platform_support']);
      await post(padmin, `/platform/staff/${padmin.id}/deactivate`).expect(403); // administrators are not managed here
      await post(padmin, `/platform/staff/${ordA.id}/deactivate`).expect(404); // a fellowship account is not platform staff
      await post(padmin, `/platform/staff/${randomUUID()}/deactivate`).expect(404);
      await post(padmin, `/platform/staff/${s.id}/activate`).expect(400); // already active
      for (const u of [secA, support]) await post(u, `/platform/staff/${s.id}/deactivate`).expect(403);
    });

    it('the dashboard is platform-level only: counts, no operational content, no personal data', async () => {
      await put(padmin, `/platform/tenants/${fB.id}/modules`, { modules: { youth: false } }).expect(200);
      await prisma.fellowship.update({ where: { id: fB.id }, data: {} });
      const d = (await get(padmin, '/platform/dashboard').expect(200)).body;
      expect(d.tenants.total).toBeGreaterThanOrEqual(3);
      expect(d.tenants.active + d.tenants.suspended).toBe(d.tenants.total);
      expect(d.modules.find((m: any) => m.key === 'youth').tenantsWithModuleOff).toBeGreaterThanOrEqual(1);
      expect(d.users.platformAccounts).toBeGreaterThanOrEqual(3);
      expect(typeof d.tenantsWithoutActiveSecretary).toBe('number');
      expect(d.support).toEqual({ pendingRequests: expect.any(Number), activeGrants: expect.any(Number) });
      const blob = JSON.stringify(d);
      expect(blob).not.toMatch(/@test\.local|full_name|first_name|password|member_code/);
      await get(support, '/platform/dashboard').expect(200);
      await put(padmin, `/platform/tenants/${fB.id}/modules`, { modules: { youth: true } }).expect(200);
    });
  });
});
