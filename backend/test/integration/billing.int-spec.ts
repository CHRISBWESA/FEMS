import { INestApplication } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, makeMember, makeUser, uniq } from './harness';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const supertest = require('supertest');
const SECRET = 'test-billing-webhook-secret-0123456789abcdef';
const DAY = 86_400_000;

describeDb('Phase 20 - SaaS billing, plans & subscriptions (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let padmin: any, support: any, secA: any, asstA: any, chairA: any, treasA: any, ordA: any, secB: any;
  let fA: any, fB: any;
  let starter: any, pro: any, free: any, tiny: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const B = '/platform/billing';
  const login = (email: string, password: string) => api(app).post('/auth/login', { email, password });

  // A tenant created through onboarding has a real secretary who can sign in.
  const tenant = async () => {
    const name = `Billing tenant ${uniq()}`;
    const email = `bt${uniq()}@test.local`;
    const r = (await post(padmin, '/platform/onboarding', { name, administrator: { email, firstName: 'Bea', lastName: 'Tenant' } }).expect(201)).body;
    // A temporary password only allows choosing a real one (enforced by the server since Phase 22).
    const first = (await login(email, r.administrator.temporaryPassword).expect(201)).body;
    const changed = (await post({ token: first.accessToken }, '/auth/change-password', { oldPassword: r.administrator.temporaryPassword, newPassword: 'Sturdy-Passphrase-42' }).expect(201)).body;
    return { id: r.fellowship.id as string, name, email, password: 'Sturdy-Passphrase-42', sec: { token: changed.accessToken as string, id: first.user.id as string } };
  };
  const assign = (id: string, plan: any, body: object = {}) => post(padmin, `${B}/subscriptions/${id}/assign`, { planId: plan.id, ...body });
  const sub = (id: string) => prisma.saasSubscription.findUnique({ where: { fellowship_id: id } });
  const events = (id: string) => prisma.saasSubscriptionEvent.findMany({ where: { fellowship_id: id }, orderBy: { occurred_at: 'asc' } });

  const sign = (body: string, opts: { t?: number; secret?: string } = {}) => {
    const t = opts.t ?? Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', opts.secret ?? SECRET).update(`${t}.${body}`).digest('hex');
    return `t=${t},v1=${v1}`;
  };
  const hook = (body: object | string, headers: Record<string, string> = {}, provider = 'signed') => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const req = supertest(app.getHttpServer()).post(`/api/v1/billing/webhooks/${provider}`).set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries({ 'X-Fems-Signature': sign(raw), ...headers })) if (v !== '') req.set(k, v);
    return req.send(raw);
  };
  const evt = (type: string, data: object, id = `evt_${uniq()}${uniq()}`) => ({ id, type, data });

  beforeAll(async () => {
    process.env.BILLING_WEBHOOK_SECRET = SECRET;
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'BA');
    fB = await makeFellowship(prisma, 'BB');
    padmin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    support = await makeUser(prisma, { fellowshipId: null, roles: ['platform_support'] });
    const mk = (roles: string[], f = fA) => makeUser(prisma, { fellowshipId: f.id, roles });
    secA = await mk(['secretary']); asstA = await mk(['assistant_secretary']); chairA = await mk(['chairperson']); treasA = await mk(['treasurer']); ordA = await mk(['ordinary_member']);
    secB = await mk(['secretary'], fB);
    const mkPlan = async (body: object) => (await post(padmin, `${B}/plans`, body).expect(201)).body;
    starter = await mkPlan({ code: `starter-${uniq()}`, name: 'Starter', price: 10, currency: 'USD', billingInterval: 'month', trialDays: 14, modules: ['finance', 'analytics'], limits: { max_users: 3, max_members: 5 } });
    pro = await mkPlan({ code: `pro-${uniq()}`, name: 'Pro', price: '500.00', billingInterval: 'year', trialDays: 30, modules: ['finance', 'youth', 'resources', 'volunteers', 'analytics', 'member_engagement'], limits: { max_users: 50 } });
    free = await mkPlan({ code: `free-${uniq()}`, name: 'Free', price: 0, modules: [], limits: {} });
    tiny = await mkPlan({ code: `tiny-${uniq()}`, name: 'Tiny', price: 5, modules: ['finance'], limits: { max_users: 1, max_storage_mb: 1 } });
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('access: billing is a platform matter, visible read-only to the fellowship\'s secretary', () => {
    it('401 without a token', async () => {
      for (const url of [`${B}/plans`, `${B}/subscriptions`, `${B}/invoices`, '/billing/subscription']) await api(app).get(url).expect(401);
    });

    it('fellowship users cannot touch platform billing at all', async () => {
      for (const u of [secA, asstA, chairA, treasA, ordA]) {
        await get(u, `${B}/plans`).expect(403);
        await get(u, `${B}/subscriptions`).expect(403);
        await post(u, `${B}/plans`, { code: 'x-plan', name: 'X' }).expect(403);
        await post(u, `${B}/subscriptions/${fA.id}/assign`, { planId: pro.id }).expect(403);
        await post(u, `${B}/subscriptions/${fA.id}/change-plan`, { planId: pro.id }).expect(403);
        await post(u, `${B}/subscriptions/${fA.id}/cancel`, { reason: 'because' }).expect(403);
        await post(u, `${B}/maintenance`).expect(403);
      }
      expect(await prisma.saasSubscription.count({ where: { fellowship_id: fA.id } })).toBe(0);
    });

    it('support staff read but cannot change; the platform administrator can', async () => {
      await get(support, `${B}/plans`).expect(200);
      await get(support, `${B}/subscriptions`).expect(200);
      await get(support, `${B}/invoices`).expect(200);
      await get(support, `${B}/webhook-events`).expect(200);
      await post(support, `${B}/plans`, { code: 'sup-plan', name: 'Nope' }).expect(403);
      await put(support, `${B}/plans/${pro.id}`, { name: 'Hijack' }).expect(403);
      await post(support, `${B}/subscriptions/${fA.id}/assign`, { planId: pro.id }).expect(403);
      await post(support, `${B}/maintenance`).expect(403);
    });

    it('only the Secretary sees the fellowship\'s billing page; platform accounts are not fellowship users', async () => {
      await get(secA, '/billing/subscription').expect(200);
      for (const u of [asstA, chairA, treasA, ordA, padmin, support]) await get(u, '/billing/subscription').expect(403);
      expect((await get(secA, '/billing/subscription').expect(200)).body.managed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('plans', () => {
    it('validates plan definitions', async () => {
      const bad = (body: object) => post(padmin, `${B}/plans`, { code: `p-${uniq()}`, name: 'Valid', ...body }).expect(400);
      await bad({ code: 'UPPER' });
      await bad({ code: 'a' });
      await bad({ name: '' });
      await bad({ price: -1 });
      await bad({ price: 1.234 });
      await bad({ price: 'free' });
      await bad({ currency: 'dollars' });
      await bad({ billingInterval: 'week' });
      await bad({ trialDays: 91 });
      await bad({ trialDays: -1 });
      await bad({ modules: ['nonsense'] });
      await bad({ modules: 'youth' });
      await bad({ limits: { max_users: 0 } });
      await bad({ limits: { max_users: 1.5 } });
      await bad({ limits: { max_ghosts: 3 } });
      await bad({ limits: [] });
      await post(padmin, `${B}/plans`, { code: starter.code, name: 'Duplicate' }).expect(409);
    });

    it('edits a plan; the code is fixed; currency/interval are fixed once fellowships subscribe', async () => {
      const p = (await post(padmin, `${B}/plans`, { code: `edit-${uniq()}`, name: 'Editable', price: 20, modules: ['finance'] }).expect(201)).body;
      const u = (await put(padmin, `${B}/plans/${p.id}`, { price: '25.50', modules: ['finance', 'youth'], limits: { max_members: 40 }, trialDays: 7 }).expect(200)).body;
      expect(u).toMatchObject({ price: '25.50', modules: ['finance', 'youth'], limits: { max_members: 40 }, trialDays: 7 });
      await put(padmin, `${B}/plans/${p.id}`, { code: 'renamed' }).expect(400);
      await put(padmin, `${B}/plans/${p.id}`, {}).expect(400);
      await put(padmin, `${B}/plans/${p.id}`, { isActive: 'no' }).expect(400);
      await put(padmin, `${B}/plans/nope`, { name: 'x' }).expect(400);
      await put(padmin, `${B}/plans/${randomUUID()}`, { name: 'x' }).expect(404);
      await put(padmin, `${B}/plans/${p.id}`, { currency: 'EUR' }).expect(200); // nobody subscribed yet
      const t = await tenant();
      await assign(t.id, p).expect(201);
      await put(padmin, `${B}/plans/${p.id}`, { currency: 'GBP' }).expect(409);
      await put(padmin, `${B}/plans/${p.id}`, { billingInterval: 'year' }).expect(409);
      const listed = (await get(support, `${B}/plans`).expect(200)).body.find((x: any) => x.id === p.id);
      expect(listed.subscribers).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('subscription lifecycle', () => {
    it('starts a trial, then a paid subscription, with a history', async () => {
      const t = await tenant();
      await assign(t.id, starter, { startTrial: 'yes' }).expect(400);
      const r = (await assign(t.id, starter, { startTrial: true }).expect(201)).body;
      expect(r.subscription.status).toBe('trialing');
      expect(r.managed).toBe(true);
      const days = (new Date(r.subscription.trialEndsAt).getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);
      expect(r.subscription.currentPeriodEnd).toBeNull();
      expect((await events(t.id)).map((e) => e.event_type)).toEqual(['trial_started']);
      await assign(t.id, starter).expect(409); // one subscription per fellowship

      const t2 = await tenant();
      const paid = (await assign(t2.id, pro).expect(201)).body;
      expect(paid.subscription.status).toBe('active');
      const yearDays = (new Date(paid.subscription.currentPeriodEnd).getTime() - Date.now()) / DAY;
      expect(yearDays).toBeGreaterThan(364);
      expect(yearDays).toBeLessThan(367);
      await assign(t2.id, pro, { startTrial: true }).expect(409); // already subscribed
    });

    it('refuses bad assignments', async () => {
      const t = await tenant();
      await assign(t.id, free, { startTrial: true }).expect(400); // no trial on this plan
      await post(padmin, `${B}/subscriptions/${t.id}/assign`, {}).expect(400);
      await post(padmin, `${B}/subscriptions/${t.id}/assign`, { planId: randomUUID() }).expect(404);
      await post(padmin, `${B}/subscriptions/${randomUUID()}/assign`, { planId: pro.id }).expect(404);
      await post(padmin, `${B}/subscriptions/nope/assign`, { planId: pro.id }).expect(400);
      const off = (await post(padmin, `${B}/plans`, { code: `off-${uniq()}`, name: 'Retired plan', price: 1 }).expect(201)).body;
      await put(padmin, `${B}/plans/${off.id}`, { isActive: false }).expect(200);
      await assign(t.id, off).expect(409);
      // usage above the plan's limit: two accounts on a one-account plan
      await makeUser(prisma, { fellowshipId: t.id, roles: ['ordinary_member'] });
      const res = await assign(t.id, tiny).expect(409);
      expect(res.body.message).toMatch(/exceeds the plan's limits/);
      expect(await sub(t.id)).toBeNull();
    });

    it('two simultaneous assignments: exactly one wins', async () => {
      const t = await tenant();
      const r = await Promise.all([assign(t.id, starter), assign(t.id, pro)]);
      expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
      expect(await prisma.saasSubscription.count({ where: { fellowship_id: t.id } })).toBe(1);
    });

    it('changes plan only when usage fits, only while live, and records it', async () => {
      const t = await tenant();
      await assign(t.id, pro).expect(201);
      await post(padmin, `${B}/subscriptions/${t.id}/change-plan`, { planId: pro.id }).expect(409);
      // 1 account now; the starter plan allows 3
      const r = (await post(padmin, `${B}/subscriptions/${t.id}/change-plan`, { planId: starter.id }).expect(201)).body;
      expect(r.subscription.plan.id).toBe(starter.id);
      // grow to 3 accounts, then a 1-account plan no longer fits
      await makeUser(prisma, { fellowshipId: t.id, roles: ['ordinary_member'] });
      await makeUser(prisma, { fellowshipId: t.id, roles: ['ordinary_member'] });
      await post(padmin, `${B}/subscriptions/${t.id}/change-plan`, { planId: tiny.id }).expect(409);
      expect((await sub(t.id))!.plan_id).toBe(starter.id);
      const hist = await events(t.id);
      expect(hist.map((e) => e.event_type)).toEqual(['created', 'plan_changed']);
      expect(hist[1]).toMatchObject({ from_plan_id: pro.id, to_plan_id: starter.id, actor_id: padmin.id });
      await post(padmin, `${B}/subscriptions/${randomUUID()}/change-plan`, { planId: pro.id }).expect(404);
      const none = await tenant();
      await post(padmin, `${B}/subscriptions/${none.id}/change-plan`, { planId: pro.id }).expect(404);
    });

    it('cancels (at period end, or now), and reactivates', async () => {
      const t = await tenant();
      await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'no subscription yet' }).expect(404);
      await assign(t.id, pro).expect(201);
      await post(padmin, `${B}/subscriptions/${t.id}/cancel`, {}).expect(400); // a reason is required
      const sched = (await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'Customer asked to stop' }).expect(201)).body;
      expect(sched.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
      await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'Customer asked to stop' }).expect(409);
      const now = (await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'Stop it now', immediately: true }).expect(201)).body;
      expect(now.subscription.status).toBe('cancelled');
      await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'Again please' }).expect(409);
      await post(padmin, `${B}/subscriptions/${t.id}/change-plan`, { planId: starter.id }).expect(409);
      await post(padmin, `${B}/subscriptions/${t.id}/reactivate`, {}).expect(400);
      const back = (await post(padmin, `${B}/subscriptions/${t.id}/reactivate`, { reason: 'Paid offline', planId: starter.id }).expect(201)).body;
      expect(back.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false, cancelledAt: null });
      expect(back.subscription.plan.id).toBe(starter.id);
      await post(padmin, `${B}/subscriptions/${t.id}/reactivate`, { reason: 'Already live' }).expect(409);
      expect((await events(t.id)).map((e) => e.event_type)).toEqual(['created', 'cancel_scheduled', 'cancelled', 'reactivated']);

      const trial = await tenant();
      await assign(trial.id, starter, { startTrial: true }).expect(201);
      expect((await post(padmin, `${B}/subscriptions/${trial.id}/cancel`, { reason: 'Trial not needed' }).expect(201)).body.subscription.status).toBe('cancelled'); // a trial ends now
    });

    it('lists subscriptions and shows detail with usage against limits', async () => {
      const t = await tenant();
      await assign(t.id, starter).expect(201);
      const d = (await get(support, `${B}/subscriptions/${t.id}`).expect(200)).body;
      expect(d.usage.max_users).toEqual({ used: 1, limit: 3 });
      expect(d.usage.max_members).toEqual({ used: 1, limit: 5 });
      expect(d.usage.max_storage_mb).toEqual({ used: 0, limit: null });
      const list = (await get(support, `${B}/subscriptions?status=active&limit=200`).expect(200)).body;
      expect(list.data.some((x: any) => x.fellowshipId === t.id)).toBe(true);
      await get(support, `${B}/subscriptions?status=bogus`).expect(400);
      await get(support, `${B}/subscriptions/${randomUUID()}`).expect(404);
      expect((await get(support, `${B}/subscriptions/${fB.id}`).expect(200)).body.managed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('what a subscription entitles a fellowship to (authentication and RBAC are untouched)', () => {
    it('a fellowship without a subscription is unmanaged and unaffected', async () => {
      for (const url of ['/youth', '/resources/assets', '/volunteers/opportunities', '/finance/periods', '/analytics/overview']) await get(secA, url).expect(200);
      expect((await get(secA, '/profile').expect(200)).body.disabledModules).toEqual([]);
    });

    it('the plan decides which optional modules exist; core features and RBAC carry on', async () => {
      const t = await tenant();
      await assign(t.id, starter).expect(201); // finance + analytics only
      const s = t.sec;
      await get(s, '/finance/periods').expect(200);
      await get(s, '/analytics/overview').expect(200);
      for (const url of ['/youth', '/resources/assets', '/volunteers/opportunities', '/member-groups']) {
        const r = await get(s, url).expect(403);
        expect(r.body.message).toMatch(/not enabled/i);
      }
      expect((await get(s, '/profile').expect(200)).body.disabledModules.sort()).toEqual(['member_engagement', 'resources', 'volunteers', 'youth']);
      await get(s, '/members').expect(200); // core features are never plan-gated
      // RBAC still applies inside an included module: a treasurer-only login could not do a secretary's job
      const ord = await makeUser(prisma, { fellowshipId: t.id, roles: ['ordinary_member'] });
      await get(ord, '/finance/periods').expect(403);
      // upgrading opens the modules immediately
      await post(padmin, `${B}/subscriptions/${t.id}/change-plan`, { planId: pro.id }).expect(201);
      await get(s, '/youth').expect(200);
      expect((await get(s, '/profile').expect(200)).body.disabledModules).toEqual([]);
      // the platform's own module switch still wins over a plan that includes the module
      await put(padmin, `/platform/tenants/${t.id}/modules`, { modules: { youth: false } }).expect(200);
      await get(s, '/youth').expect(403);
      // ...and the plan's analytics section list follows
      expect((await get(s, '/analytics/overview').expect(200)).body.available).not.toContain('youth');
    });

    it('a lapsed subscription switches optional modules off and blocks additions, but never blocks sign-in or core access', async () => {
      const t = await tenant();
      await assign(t.id, pro).expect(201);
      await get(t.sec, '/youth').expect(200);
      await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'Lapsed for the test', immediately: true }).expect(201);
      await login(t.email, t.password).expect(201); // authentication is unaffected
      await get(t.sec, '/members').expect(200);
      await get(t.sec, '/profile').expect(200);
      for (const url of ['/youth', '/finance/periods', '/analytics/overview']) await get(t.sec, url).expect(403);
      const m = await makeMember(prisma, { fellowshipId: t.id });
      const blocked = await post(t.sec, '/users', { email: `x${uniq()}@test.local`, password: 'Passw0rd!x', firstName: 'A', lastName: 'B', memberId: m.id }).expect(403);
      expect(blocked.body.message).toMatch(/subscription is not active/);
      // the platform (not the tenant) restores it
      await post(padmin, `${B}/subscriptions/${t.id}/reactivate`, { reason: 'Paid offline' }).expect(201);
      await get(t.sec, '/youth').expect(200);
    });

    it('enforces user, member and storage limits at the point where things are added', async () => {
      const t = await tenant();
      await assign(t.id, starter).expect(201); // 3 accounts, 5 members
      const mkMember = () => makeMember(prisma, { fellowshipId: t.id });
      const add = async () => post(t.sec, '/users', { email: `u${uniq()}@test.local`, password: 'Passw0rd!x', firstName: 'A', lastName: 'B', memberId: (await mkMember()).id, roles: ['ordinary_member'] });
      await add().then((r) => expect(r.status).toBe(201));
      await add().then((r) => expect(r.status).toBe(201)); // 3 accounts now
      const over = await add();
      expect(over.status).toBe(403);
      expect(over.body.message).toMatch(/plan allows at most 3 user accounts/);
      // members: 1 + 3 already created above = 4 of 5
      const newMember = (n: number) => post(t.sec, '/members', { fullName: `Extra ${n}`, gender: 'female', expectedGraduationYear: 2035, expectedGraduationMonth: 6 });
      await newMember(1).then((r) => expect(r.status).toBe(201)); // 5 of 5
      const cap = await newMember(2);
      expect(cap.status).toBe(403);
      expect(cap.body.message).toMatch(/plan allows at most 5 members/);
      // a different fellowship (no subscription) is not limited by this one
      await post(secA, '/members', { fullName: 'Unlimited', gender: 'female', expectedGraduationYear: 2035, expectedGraduationMonth: 6 }).expect(201);

      // storage, measured from stored document sizes (checked at the service, which the upload path calls)
      const t2 = await tenant();
      await assign(t2.id, tiny).expect(201); // 1 MB
      const ent = app.get((await import('../../src/shared/billing/entitlements.service')).EntitlementsService);
      await prisma.documentEntity.create({ data: { title: 'Big', filename: 'a.pdf', stored_filename: `s-${uniq()}`, file_size: 900 * 1024, mime_type: 'application/pdf', fellowship_id: t2.id, uploaded_by: randomUUID() } });
      await expect(ent.assertWithinLimit(t2.id, 'max_storage_mb', 200 * 1024)).rejects.toThrow(/1 MB of document storage/);
      await expect(ent.assertWithinLimit(t2.id, 'max_storage_mb', 50 * 1024)).resolves.toBeUndefined();
      await expect(ent.assertWithinLimit(null, 'max_users', 999)).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('invoices and receipts', () => {
    it('issues one open invoice at a time, priced from the plan at that moment', async () => {
      const t = await tenant();
      await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(404); // no subscription
      const p = (await post(padmin, `${B}/plans`, { code: `inv-${uniq()}`, name: 'Invoiced', price: '40.00', currency: 'EUR', modules: ['finance'] }).expect(201)).body;
      await assign(t.id, p).expect(201);
      await post(padmin, `${B}/subscriptions/${t.id}/invoices`, { dueInDays: 99 }).expect(400);
      const inv = (await post(padmin, `${B}/subscriptions/${t.id}/invoices`, { dueInDays: 10 }).expect(201)).body;
      expect(inv).toMatchObject({ amount: '40.00', currency: 'EUR', status: 'open', planName: 'Invoiced' });
      expect(inv.number).toMatch(/^INV-\d{6}$/);
      const due = (new Date(inv.dueAt).getTime() - Date.now()) / DAY;
      expect(due).toBeGreaterThan(9.9);
      await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(409); // one open invoice at a time
      await put(padmin, `${B}/plans/${p.id}`, { price: 400 }).expect(200); // later price changes never touch it
      expect((await get(support, `${B}/invoices/${inv.id}`).expect(200)).body.amount).toBe('40.00');
      const t2 = await tenant();
      await assign(t2.id, free).expect(201);
      await post(padmin, `${B}/subscriptions/${t2.id}/invoices`, {}).expect(409); // nothing to bill on a free plan
    });

    it('two simultaneous requests issue only one invoice', async () => {
      const t = await tenant();
      await assign(t.id, pro).expect(201);
      const r = await Promise.all([post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}), post(padmin, `${B}/subscriptions/${t.id}/invoices`, {})]);
      expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    });

    it('recording a payment activates the subscription, is final, and produces a receipt', async () => {
      const t = await tenant();
      await assign(t.id, starter, { startTrial: true }).expect(201);
      const inv = (await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(201)).body;
      await post(padmin, `${B}/invoices/${inv.id}/mark-paid`, {}).expect(400); // a reference is required
      await post(padmin, `${B}/invoices/${inv.id}/mark-paid`, { reference: 'x' }).expect(400);
      await post(support, `${B}/invoices/${inv.id}/mark-paid`, { reference: 'BANK-123456' }).expect(403);
      const paid = (await post(padmin, `${B}/invoices/${inv.id}/mark-paid`, { reference: 'BANK-123456', method: 'bank transfer' }).expect(201)).body;
      expect(paid.status).toBe('paid');
      expect(paid.receipt).toMatchObject({ method: 'bank transfer', reference: 'BANK-123456' });
      expect(paid.receipt.number).toMatch(/^RCP-\d{6}$/);
      const s = (await sub(t.id))!;
      expect(s.status).toBe('active');
      expect(s.current_period_start!.getTime()).toBe(new Date(paid.periodStart).getTime());
      expect(s.current_period_end!.getTime()).toBe(new Date(paid.periodEnd).getTime());
      await post(padmin, `${B}/invoices/${inv.id}/mark-paid`, { reference: 'BANK-999999' }).expect(409);
      await post(padmin, `${B}/invoices/${inv.id}/void`, { reason: 'too late to void' }).expect(409);
      expect((await events(t.id)).map((e) => e.event_type)).toEqual(['trial_started', 'invoice_issued', 'payment_recorded']);
      // the fellowship's Secretary sees its own invoice and receipt, and nobody else's
      const mine = (await get(t.sec, '/billing/subscription').expect(200)).body;
      expect(mine.invoices[0]).toMatchObject({ id: inv.id, status: 'paid' });
      expect(mine.subscription.status).toBe('active');
      expect(mine.history).toBeUndefined(); // internal history stays with the platform
      await get(t.sec, `/billing/invoices/${inv.id}`).expect(200);
      await get(secB, `/billing/invoices/${inv.id}`).expect(403);
      await get(t.sec, `/billing/invoices/${randomUUID()}`).expect(404);
      await get(t.sec, '/billing/invoices/nope').expect(400);
      expect((await get(secB, '/billing/subscription').expect(200)).body.invoices).toEqual([]);
    });

    it('voids an open invoice; a payment cannot be recorded twice at the same moment', async () => {
      const t = await tenant();
      await assign(t.id, pro).expect(201);
      const a = (await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(201)).body;
      await post(padmin, `${B}/invoices/${a.id}/void`, {}).expect(400);
      const v = (await post(padmin, `${B}/invoices/${a.id}/void`, { reason: 'Issued in error' }).expect(201)).body;
      expect(v).toMatchObject({ status: 'void', voidReason: 'Issued in error' });
      await post(padmin, `${B}/invoices/${a.id}/mark-paid`, { reference: 'BANK-777777' }).expect(409); // a void invoice cannot be paid
      const b = (await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(201)).body;
      const r = await Promise.all([post(padmin, `${B}/invoices/${b.id}/mark-paid`, { reference: 'BANK-111111' }), post(padmin, `${B}/invoices/${b.id}/mark-paid`, { reference: 'BANK-222222' })]);
      expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
      expect(a.number < b.number).toBe(true); // numbers only go up
      await get(support, `${B}/invoices?status=bogus`).expect(400);
      await get(support, `${B}/invoices/nope`).expect(400);
      await get(support, `${B}/invoices/${randomUUID()}`).expect(404);
      expect((await get(support, `${B}/invoices?fellowshipId=${t.id}`).expect(200)).body.total).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('time-driven transitions (maintenance)', () => {
    it('expires a finished trial, marks overdue subscriptions, expires after the grace period, ends scheduled cancellations - idempotently', async () => {
      const trial = await tenant(); await assign(trial.id, starter, { startTrial: true }).expect(201);
      const overdue = await tenant(); await assign(overdue.id, pro).expect(201);
      const grace = await tenant(); await assign(grace.id, pro).expect(201);
      const cancelling = await tenant(); await assign(cancelling.id, pro).expect(201);
      const healthy = await tenant(); await assign(healthy.id, pro).expect(201);
      const ago = (d: number) => new Date(Date.now() - d * DAY);

      await prisma.saasSubscription.update({ where: { fellowship_id: trial.id }, data: { trial_ends_at: ago(1) } });
      await post(padmin, `${B}/subscriptions/${overdue.id}/invoices`, { dueInDays: 0 }).expect(201); // due immediately
      await prisma.saasInvoice.updateMany({ where: { fellowship_id: overdue.id }, data: { due_at: ago(1) } });
      await prisma.saasSubscription.update({ where: { fellowship_id: grace.id }, data: { status: 'past_due', past_due_since: ago(15) } });
      await post(padmin, `${B}/subscriptions/${cancelling.id}/cancel`, { reason: 'Leaving at period end' }).expect(201);
      await prisma.saasSubscription.update({ where: { fellowship_id: cancelling.id }, data: { current_period_end: ago(1) } });

      const first = (await post(padmin, `${B}/maintenance`).expect(201)).body;
      expect(first.trialsExpired).toBeGreaterThanOrEqual(1);
      expect(first.pastDue).toBeGreaterThanOrEqual(1);
      expect(first.expiredAfterGrace).toBeGreaterThanOrEqual(1);
      expect(first.cancelledAtPeriodEnd).toBeGreaterThanOrEqual(1);
      expect((await sub(trial.id))!.status).toBe('expired');
      expect((await sub(overdue.id))!.status).toBe('past_due');
      expect((await sub(grace.id))!.status).toBe('expired');
      expect((await sub(cancelling.id))!.status).toBe('cancelled');
      expect((await sub(healthy.id))!.status).toBe('active');
      const before = (await events(overdue.id)).length;
      const second = (await post(padmin, `${B}/maintenance`).expect(201)).body;
      expect(second).toEqual({ trialsExpired: 0, pastDue: 0, expiredAfterGrace: 0, cancelledAtPeriodEnd: 0 });
      expect((await events(overdue.id)).length).toBe(before);

      // access is never removed: the tenant can still sign in and use core features, while modules are off
      await login(trial.email, trial.password).expect(201);
      await get(trial.sec, '/members').expect(200);
      await get(trial.sec, '/finance/periods').expect(403);
      // paying the overdue invoice puts it back in good standing
      const inv = await prisma.saasInvoice.findFirst({ where: { fellowship_id: overdue.id } });
      await post(padmin, `${B}/invoices/${inv!.id}/mark-paid`, { reference: 'BANK-OVERDUE-1' }).expect(201);
      expect(await sub(overdue.id)).toMatchObject({ status: 'active', past_due_since: null });
      // an expired subscription that pays is restored too
      await post(padmin, `${B}/subscriptions/${grace.id}/invoices`, {}).expect(201);
      const gi = await prisma.saasInvoice.findFirst({ where: { fellowship_id: grace.id } });
      await post(padmin, `${B}/invoices/${gi!.id}/mark-paid`, { reference: 'BANK-GRACE-1' }).expect(201);
      expect((await sub(grace.id))!.status).toBe('active');
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('signed webhooks: authenticated, replay-safe, idempotent, audited', () => {
    let t: any, inv: any;
    beforeAll(async () => {
      t = await tenant();
      await assign(t.id, pro).expect(201);
      inv = (await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(201)).body;
    });

    const paidEvent = (over: object = {}, id?: string) => evt('invoice.paid', { invoiceId: inv.id, amount: inv.amount, currency: inv.currency, reference: 'PSP-REF-1', ...over }, id);

    it('rejects anything that is not correctly signed - and applies nothing', async () => {
      const e = JSON.stringify(paidEvent());
      await hook(e, { 'X-Fems-Signature': '' }).expect(401); // missing
      await hook(e, { 'X-Fems-Signature': 'garbage' }).expect(401);
      await hook(e, { 'X-Fems-Signature': 't=1,v1=zz' }).expect(401);
      await hook(e, { 'X-Fems-Signature': sign(e, { secret: 'the-wrong-secret-the-wrong-secret-0000' }) }).expect(401);
      await hook(e, { 'X-Fems-Signature': sign(JSON.stringify(paidEvent({ amount: '1' }))) }).expect(401); // signature of a different body
      await hook(e, { 'X-Fems-Signature': sign(e, { t: Math.floor(Date.now() / 1000) - 600 }) }).expect(401); // replay of an old request
      await hook(e, { 'X-Fems-Signature': sign(e, { t: Math.floor(Date.now() / 1000) + 600 }) }).expect(401); // from the future
      expect((await prisma.saasInvoice.findUnique({ where: { id: inv.id } }))!.status).toBe('open');
      expect(await prisma.saasWebhookEvent.count({ where: { event_type: 'invoice.paid', fellowship_id: t.id } })).toBe(0);
    });

    it('answers 404 for an unknown provider and 503 when no secret is configured (no unsigned events are ever accepted)', async () => {
      await hook(paidEvent(), {}, 'stripe').expect(404);
      delete process.env.BILLING_WEBHOOK_SECRET;
      try {
        await hook(paidEvent()).expect(503);
      } finally {
        process.env.BILLING_WEBHOOK_SECRET = SECRET;
      }
      process.env.BILLING_WEBHOOK_SECRET = 'too-short';
      try {
        await hook(paidEvent()).expect(503);
      } finally {
        process.env.BILLING_WEBHOOK_SECRET = SECRET;
      }
    });

    it('validates the payload after the signature', async () => {
      const raw = 'not json';
      await hook(raw).expect(400);
      await hook({ type: 'invoice.paid', data: {} }).expect(400); // no id
      await hook({ id: 'short', type: 'invoice.paid' }).expect(400);
      await hook({ id: `evt_${uniq()}${uniq()}`, data: {} }).expect(400); // no type
      await hook({ id: `evt_${uniq()}${uniq()}`, type: 'invoice.paid', data: [] }).expect(400);
    });

    it('refuses payments that do not match the invoice, and records the failure', async () => {
      const wrongAmount = paidEvent({ amount: '1.00' });
      const r = await hook(wrongAmount).expect(422);
      expect(r.body.message).toMatch(/Amount does not match/);
      await hook(paidEvent({ currency: 'JPY' })).expect(422);
      await hook(paidEvent({ invoiceId: randomUUID() })).expect(422);
      await hook(paidEvent({ invoiceId: 'nope' })).expect(422);
      expect((await prisma.saasInvoice.findUnique({ where: { id: inv.id } }))!.status).toBe('open');
      const failed = await prisma.saasWebhookEvent.findUnique({ where: { provider_event_id: { provider: 'signed', event_id: wrongAmount.id } } });
      expect(failed).toMatchObject({ status: 'failed' });
      expect(failed!.error).toMatch(/Amount/);
    });

    it('applies a valid payment exactly once, however often it is delivered', async () => {
      const e = paidEvent();
      const first = await hook(e).expect(200);
      expect(first.body.status).toBe('processed');
      const paid = (await prisma.saasInvoice.findUnique({ where: { id: inv.id } }))!;
      expect(paid).toMatchObject({ status: 'paid', payment_method: 'provider', payment_reference: 'PSP-REF-1' });
      expect((await sub(t.id))!.current_period_end!.getTime()).toBe(paid.period_end.getTime());

      for (let i = 0; i < 3; i++) expect((await hook(e).expect(200)).body.status).toBe('duplicate');
      expect((await prisma.saasInvoice.findUnique({ where: { id: inv.id } }))!.paid_at!.getTime()).toBe(paid.paid_at!.getTime());
      expect(await prisma.saasSubscriptionEvent.count({ where: { fellowship_id: t.id, event_type: 'payment_recorded' } })).toBe(1);
      // concurrent deliveries of one event
      const e2 = evt('payment.failed', { invoiceId: inv.id });
      const rs = await Promise.all([hook(e2), hook(e2), hook(e2)]);
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(await prisma.saasWebhookEvent.count({ where: { provider: 'signed', event_id: e2.id } })).toBe(1);
      // the same event id with a different body is not accepted as a "retry"
      await hook({ ...e, data: { ...e.data, reference: 'SOMETHING-ELSE' } }).expect(409);
      // a different event that tries to pay the (already paid) invoice again again does nothing new
      const again = await hook(paidEvent({}, `evt_${uniq()}${uniq()}`)).expect(200);
      expect(again.body.status).toBe('already_applied');
      expect(await prisma.saasSubscriptionEvent.count({ where: { fellowship_id: t.id, event_type: 'payment_recorded' } })).toBe(1);
      const other = await hook(paidEvent({ reference: 'PSP-REF-2' }, `evt_${uniq()}${uniq()}`)).expect(422);
      expect(other.body.message).toMatch(/already been paid/);
    });

    it('handles failed payments and cancellations, ignores unknown types, and is audited', async () => {
      const t2 = await tenant();
      await assign(t2.id, pro).expect(201);
      const i2 = (await post(padmin, `${B}/subscriptions/${t2.id}/invoices`, {}).expect(201)).body;
      expect((await hook(evt('payment.failed', { invoiceId: i2.id })).expect(200)).body.status).toBe('processed');
      expect((await sub(t2.id))!.status).toBe('past_due');
      expect((await hook(evt('payment.failed', { invoiceId: i2.id })).expect(200)).body.status).toBe('no_change');
      expect((await hook(evt('subscription.cancelled', { fellowshipId: t2.id })).expect(200)).body.status).toBe('processed');
      expect((await sub(t2.id))!.status).toBe('cancelled');
      expect((await hook(evt('subscription.cancelled', { fellowshipId: t2.id })).expect(200)).body.status).toBe('no_change');
      await hook(evt('subscription.cancelled', { fellowshipId: 'nope' })).expect(422);
      expect((await hook(evt('customer.updated', { anything: true })).expect(200)).body.status).toBe('ignored');
      const rows = (await get(support, `${B}/webhook-events`).expect(200)).body;
      expect(rows.length).toBeGreaterThan(5);
      expect(Object.keys(rows[0]).sort()).toEqual(['error', 'eventId', 'id', 'processedAt', 'provider', 'receivedAt', 'status', 'type']); // no payloads
      expect(await prisma.auditLog.count({ where: { fellowship_id: t2.id, action: 'billing.webhook_processed', user_id: null } })).toBeGreaterThanOrEqual(2);
      for (const u of [secA, ordA]) await get(u, `${B}/webhook-events`).expect(403);
    });

    it('a failed event may be retried by the provider with the same body (idempotent re-arm)', async () => {
      const t3 = await tenant();
      await assign(t3.id, pro).expect(201);
      const i3 = (await post(padmin, `${B}/subscriptions/${t3.id}/invoices`, {}).expect(201)).body;
      await post(padmin, `${B}/invoices/${i3.id}/void`, { reason: 'Voided before payment' }).expect(201);
      const e = evt('invoice.paid', { invoiceId: i3.id, amount: i3.amount, currency: i3.currency, reference: 'PSP-LATE' });
      await hook(e).expect(422);
      await hook(e).expect(422); // retried: still refused, still one record
      expect(await prisma.saasWebhookEvent.count({ where: { provider: 'signed', event_id: e.id } })).toBe(1);
      expect((await prisma.saasInvoice.findUnique({ where: { id: i3.id } }))!.status).toBe('void');
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('domain separation: SaaS billing is not fellowship Finance', () => {
    it('billing operations never touch a fellowship\'s finance data', async () => {
      const t = await tenant();
      const tables = () => Promise.all([
        prisma.contribution.count({ where: { fellowship_id: t.id } }), prisma.incomeRecord.count({ where: { fellowship_id: t.id } }),
        prisma.expense.count({ where: { fellowship_id: t.id } }), prisma.budget.count({ where: { fellowship_id: t.id } }),
        prisma.moneyRequest.count({ where: { fellowship_id: t.id } }), prisma.financialPeriod.count({ where: { fellowship_id: t.id } }),
      ]);
      const summary = async () => JSON.stringify((await get(t.sec, '/finance/reports/summary').expect(200)).body).replace(/"(generatedAt|to)":"[^"]+"/g, '');
      const before = { counts: await tables(), summary: await summary() };
      await assign(t.id, pro).expect(201);
      const inv = (await post(padmin, `${B}/subscriptions/${t.id}/invoices`, {}).expect(201)).body;
      await post(padmin, `${B}/invoices/${inv.id}/mark-paid`, { reference: 'BANK-SEP-1' }).expect(201);
      await post(padmin, `${B}/subscriptions/${t.id}/change-plan`, { planId: starter.id }).expect(201);
      await hook(evt('payment.failed', { invoiceId: inv.id })).expect(200);
      expect(await tables()).toEqual(before.counts);
      expect(await summary()).toBe(before.summary);
      expect(before.summary).not.toMatch(/INV-|subscription|saas/i);
    });

    it('finance users are not billing users, and the two code bases do not reference each other', async () => {
      await get(treasA, '/billing/subscription').expect(403);
      await get(treasA, `${B}/invoices`).expect(403);
      const src = path.join(__dirname, '..', '..', 'src');
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path.join(d, e.name)] : []));
      for (const f of walk(path.join(src, 'finance'))) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/saas|billing/i);
      for (const f of walk(path.join(src, 'billing'))) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/prisma\.(contribution|incomeRecord|expense|budget|moneyRequest|financialPeriod|pledge)/i);
    });

    it('no card or bank details can be stored: the billing tables have no such columns', async () => {
      const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`SELECT table_name, column_name FROM information_schema.columns WHERE table_name LIKE 'saas\\_%'`;
      expect(cols.length).toBeGreaterThan(30);
      const offending = cols.filter((c) => /card|pan|cvv|cvc|iban|account_number|routing|secret|password|token/i.test(c.column_name));
      expect(offending).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('audit and tenant isolation', () => {
    it('billing changes are audited against the fellowship; tenants see only their own trail', async () => {
      const t = await tenant();
      await assign(t.id, pro).expect(201);
      await post(padmin, `${B}/subscriptions/${t.id}/cancel`, { reason: 'Audit trail check' }).expect(201);
      const rows = await prisma.auditLog.findMany({ where: { fellowship_id: t.id, action: { startsWith: 'platform.billing_' } }, orderBy: { timestamp: 'asc' } });
      expect(rows.map((r) => r.action)).toEqual(['platform.billing_subscription_assign', 'platform.billing_subscription_cancel']);
      expect(rows.every((r) => r.user_id === padmin.id)).toBe(true);
      const seen = (await api(app, t.sec.token).get('/audit?action=platform.billing_&limit=100').expect(200)).body.data;
      expect(seen.length).toBe(2);
      expect((await get(secB, '/audit?action=platform.billing_&limit=100').expect(200)).body.data.some((r: any) => r.fellowship_id === t.id)).toBe(false);
      const viaPlatform = (await get(padmin, '/platform/audit?action=platform.billing_&limit=100').expect(200)).body.data;
      expect(viaPlatform.some((r: any) => r.fellowship_id === t.id)).toBe(true);
      const planRows = await prisma.auditLog.count({ where: { action: 'platform.billing_plan_create', user_id: padmin.id, fellowship_id: null } });
      expect(planRows).toBeGreaterThanOrEqual(4);
    });

    it('a fellowship never sees another fellowship\'s subscription or invoices', async () => {
      const a = await tenant(), b = await tenant();
      await assign(a.id, pro).expect(201);
      await assign(b.id, starter).expect(201);
      const ia = (await post(padmin, `${B}/subscriptions/${a.id}/invoices`, {}).expect(201)).body;
      const mineA = (await get(a.sec, '/billing/subscription').expect(200)).body;
      const mineB = (await get(b.sec, '/billing/subscription').expect(200)).body;
      expect(mineA.subscription.plan.id).toBe(pro.id);
      expect(mineB.subscription.plan.id).toBe(starter.id);
      expect(mineB.invoices).toEqual([]);
      await get(b.sec, `/billing/invoices/${ia.id}`).expect(403);
      // a body-supplied fellowship id is ignored on the tenant endpoints
      expect((await api(app, b.sec.token).get(`/billing/subscription?fellowshipId=${a.id}`).expect(200)).body.subscription.plan.id).toBe(starter.id);
    });
  });
});
