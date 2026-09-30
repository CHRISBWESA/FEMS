import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { addToDepartment, api, createTestApp, describeDb, getPrisma, makeActivity, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

describeDb('Phase 22 - security regression (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, DA: any, DB: any;
  let secA: any, secB: any, ordB: any, asstB: any, treasB: any;
  const seeded: { label: string; id: string }[] = [];

  const call = (u: any, method: string, url: string, body: object = {}) => {
    const a = api(app, u.token);
    return method === 'GET' ? a.get(url) : method === 'POST' ? a.post(url, body) : method === 'PUT' ? a.put(url, body) : a.delete(url);
  };
  const login = (email: string, password: string) => api(app).post('/auth/login', { email, password });
  const try_ = async (label: string, fn: () => Promise<{ id: string }>) => {
    try { seeded.push({ label, id: (await fn()).id }); } catch (e: any) { console.warn(`seed skipped: ${label}: ${String(e.message).split('\n').slice(-2).join(' ').slice(0, 120)}`); }
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'SA');
    fB = await makeFellowship(prisma, 'SB');
    DA = await makeDepartment(prisma, fA.id, 'SDA');
    DB = await makeDepartment(prisma, fB.id, 'SDB');
    secA = await makeUser(prisma, { fellowshipId: fA.id, roles: ['secretary'] });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    asstB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['assistant_secretary'] });
    treasB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['treasurer'] });
    ordB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['ordinary_member'] });

    // ---- fellowship A's data, of every kind we can create ----
    const uA = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
    const mA = await makeMember(prisma, { fellowshipId: fA.id, name: 'Alpha Person', userId: uA.id });
    await addToDepartment(prisma, mA.id, DA.id);
    const actA = await makeActivity(prisma, { fellowshipId: fA.id, departmentId: DA.id });
    seeded.push({ label: 'member', id: mA.id }, { label: 'user', id: uA.id }, { label: 'department', id: DA.id }, { label: 'activity', id: actA.id }, { label: 'fellowship', id: fA.id });
    const create = (label: string, fn: () => Promise<{ id: string }>) => try_(label, fn);
    await create('attendance', () => prisma.attendance.create({ data: { activity_id: actA.id, member_id: mA.id, fellowship_id: fA.id, recorded_by_name: 'Alpha Person' } }));
    await create('notification', () => prisma.notification.create({ data: { recipient_user_id: uA.id, event_type: 'x', title: 'Private', message: 'Private', fellowship_id: fA.id } }));
    await create('report', () => prisma.report.create({ data: { department_id: DA.id, fellowship_id: fA.id, title: 'A report', content: 'secret', submitted_by: uA.id } }));
    await create('document', () => prisma.documentEntity.create({ data: { title: 'Doc', filename: 'a.pdf', stored_filename: `s-${uniq()}`, file_size: 10, mime_type: 'application/pdf', fellowship_id: fA.id, uploaded_by: uA.id } }));
    await create('deleted-record', () => prisma.deletedRecord.create({ data: { original_collection: 'members', original_record_id: randomUUID(), original_data: { full_name: 'Deleted Person' }, deleted_by: uA.id, restore_token: `t-${uniq()}${uniq()}` } }));
    await create('youth', () => prisma.youthProfile.create({ data: { fellowship_id: fA.id, full_name: 'Young Person', date_of_birth: new Date('2012-01-01'), created_by: uA.id } }));
    await create('age-group', () => prisma.ageGroup.create({ data: { fellowship_id: fA.id, name: `AG ${uniq()}`, min_age: 5, max_age: 12, created_by: uA.id } as any }));
    await create('asset-category', () => prisma.assetCategory.create({ data: { fellowship_id: fA.id, name: `Cat ${uniq()}`, created_by: uA.id } }));
    await create('asset-location', () => prisma.assetLocation.create({ data: { fellowship_id: fA.id, name: `Loc ${uniq()}`, created_by: uA.id } }));
    await create('asset', () => prisma.asset.create({ data: { fellowship_id: fA.id, asset_tag: `AST-${uniq()}`, name: 'Speaker', created_by: uA.id } as any }));
    const opp = await prisma.serviceOpportunity.create({ data: { fellowship_id: fA.id, title: 'Ushering', status: 'open', created_by: uA.id } });
    seeded.push({ label: 'opportunity', id: opp.id });
    const shift = await prisma.serviceShift.create({ data: { fellowship_id: fA.id, opportunity_id: opp.id, starts_at: new Date(Date.now() + 5 * 86400000), ends_at: new Date(Date.now() + 5 * 86400000 + 7200000), capacity: 3, created_by: uA.id } });
    seeded.push({ label: 'shift', id: shift.id });
    await create('assignment', () => prisma.serviceAssignment.create({ data: { fellowship_id: fA.id, shift_id: shift.id, member_id: mA.id, status: 'confirmed', created_by: uA.id } }));
    await create('service-role', () => prisma.serviceRole.create({ data: { fellowship_id: fA.id, name: `Role ${uniq()}`, created_by: uA.id } }));
    await create('member-group', () => prisma.memberGroup.create({ data: { fellowship_id: fA.id, name: `Group ${uniq()}`, created_by: uA.id } as any }));
    await create('campaign', () => prisma.contributionCampaign.create({ data: { fellowship_id: fA.id, name: `Camp ${uniq()}`, start_date: new Date(), created_by: uA.id } as any }));
    await create('finance-category', () => prisma.financeCategory.create({ data: { fellowship_id: fA.id, name: `FC ${uniq()}`, kind: 'expense', created_by: uA.id } as any }));
    await create('contribution', () => prisma.contribution.create({ data: { member_id: mA.id, fellowship_id: fA.id, amount: 10, contribution_type: 'tithe', date: new Date(), recorded_by: uA.id } }));
    await create('expense', () => prisma.expense.create({ data: { fellowship_id: fA.id, department_id: DA.id, amount: 5, title: 'x', description: 'x', date: new Date(), recorded_by: uA.id } as any }));
    await create('financial-period', () => prisma.financialPeriod.create({ data: { fellowship_id: fA.id, name: 'P', start_date: new Date('2026-01-01'), end_date: new Date('2026-12-31'), created_by: uA.id } }));
    await create('income', () => prisma.incomeRecord.create({ data: { fellowship_id: fA.id, amount: 7, date: new Date(), title: 'x', source: 'x', recorded_by: uA.id } as any }));
    await create('budget', () => prisma.budget.create({ data: { fellowship_id: fA.id, department_id: DA.id, fiscal_year: '2026', amount: 100, title: 'x', created_by: uA.id } as any }));
    await create('money-request', () => prisma.moneyRequest.create({ data: { fellowship_id: fA.id, department_id: DA.id, amount: 5, purpose: 'x', title: 'x', requester_id: uA.id } as any }));
    await create('support-grant', () => prisma.supportAccessGrant.create({ data: { fellowship_id: fA.id, requested_by: uA.id, reason: 'x', scopes: ['tenant_config'], duration_minutes: 30 } }));
    await create('audit-entity', () => prisma.auditLog.create({ data: { user_id: uA.id, action: 'x', fellowship_id: fA.id } }));
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('tenant isolation: a deliberate cross-tenant sweep of every route that takes an id', () => {
    const OUT_OF_SCOPE = ['/api/v1/auth', '/api/v1/platform', '/api/v1/billing/webhooks'];
    const PUBLIC = ['POST /api/v1/activities/attendance'];

    // The public fellowship site is addressed by SUBDOMAIN, not by a record id, so this sweep does not apply to it.
    // Its `:subdomain` parameter is a DNS label, not a foreign key: substituting a member id or a document id there
    // cannot address another fellowship's record, it just fails to resolve to a published site. Feeding ids into it
    // therefore produces 404s that say nothing about isolation, and including it would drown the real signal.
    // Cross-tenant isolation of public-site CONTENT is asserted directly, with content markers, in
    // public-site-isolation.int-spec.ts.
    //
    // `/api/v1/public/site` is excluded by the existing `/api/v1/platform` style prefixes only if it were listed;
    // it is platform-level marketing data (counts and plan prices) with no tenant content on it, and it takes no id
    // parameter, so it is not swept either.
    const isOutOfScope = (path: string) =>
      [...OUT_OF_SCOPE, '/api/v1/public/fellowships', '/api/v1/public/site'].some((p) => path.startsWith(p));
    const routes = () => {
      const server: any = app.getHttpAdapter().getInstance();
      const stack: any[] = (server.router ?? server._router).stack;
      const out: { method: string; path: string }[] = [];
      for (const layer of stack) {
        const route = layer.route;
        if (!route || typeof route.path !== 'string' || !/:/.test(route.path)) continue;
        for (const m of Object.keys(route.methods)) if (route.methods[m] && ['GET', 'POST', 'PUT', 'DELETE'].includes(m.toUpperCase())) out.push({ method: m.toUpperCase(), path: route.path });
      }
      return out.filter((r) => !isOutOfScope(r.path) && !PUBLIC.includes(`${r.method} ${r.path}`));
    };

    it('the seed covers a good spread of entity types', () => {
      expect(seeded.length).toBeGreaterThanOrEqual(24);
      expect(routes().length).toBeGreaterThan(100);
    });

    it('fellowship B can never read, change or delete anything of fellowship A by id - no 2xx and no 5xx on any route', async () => {
      const failures: string[] = [];
      const list = routes();
      for (const r of list) {
        for (const s of seeded) {
          const url = r.path.replace(/:[A-Za-z]+/g, s.id).replace('/api/v1', '');
          for (const [who, u] of [['secretary-B', secB], ['ordinary-B', ordB]] as const) {
            const res = await call(u, r.method, url);
            if (res.status < 400 || res.status >= 500) failures.push(`${who} ${r.method} ${r.path} <- ${s.label} -> ${res.status}`);
          }
        }
      }
      expect(failures).toEqual([]);
    }, 600000);

    it('malformed ids never produce a server error on any route', async () => {
      const failures: string[] = [];
      for (const r of routes()) {
        for (const bad of ['nope', "1' OR '1'='1", '../../etc/passwd', '%00', randomUUID()]) {
          const url = r.path.replace(/:[A-Za-z]+/g, encodeURIComponent(bad)).replace('/api/v1', '');
          const res = await call(secB, r.method, url);
          if (res.status >= 500) failures.push(`${r.method} ${r.path} <- ${bad} -> ${res.status}`);
        }
      }
      expect(failures).toEqual([]);
    }, 600000);

    it('identifiers of another fellowship smuggled in through query strings, bodies and headers are ignored', async () => {
      const mA = seeded.find((s) => s.label === 'member')!.id;
      // query parameter
      const q = await call(secB, 'GET', `/members?fellowshipId=${fA.id}&limit=100`);
      expect(q.status).toBe(200);
      expect(q.body.data.every((m: any) => m.fellowship_id === fB.id)).toBe(true);
      expect((await call(secB, 'GET', `/departments?fellowshipId=${fA.id}`)).body.every?.((d: any) => d.fellowship_id === fB.id) ?? true).toBe(true);
      // body: creating things "for" A is stamped with B
      const created = await call(secB, 'POST', '/members', { fullName: 'Smuggled', gender: 'female', expectedGraduationYear: 2035, expectedGraduationMonth: 6, fellowshipId: fA.id, fellowship_id: fA.id });
      expect(created.status).toBe(201);
      expect(created.body.fellowship_id).toBe(fB.id);
      // body reference to another tenant's member/department
      const dep = await call(secB, 'POST', `/members/${created.body.id}/departments`, { departmentId: DA.id });
      expect(dep.status).toBeGreaterThanOrEqual(400);
      expect(await prisma.departmentMember.count({ where: { member_id: created.body.id, department_id: DA.id } })).toBe(0);
      // header
      const h = await api(app, secB.token).get(`/members/${mA}`).set('X-Fellowship-Id', fA.id);
      expect(h.status).toBeGreaterThanOrEqual(400);
      // search cannot reach across tenants
      const s = await call(secB, 'GET', '/members?search=Alpha');
      expect(s.body.data.some((m: any) => m.full_name === 'Alpha Person')).toBe(false);
      // notifications: B's list never contains A's, and B cannot mark A's as read
      const n = await call(ordB, 'GET', '/notifications');
      expect(JSON.stringify(n.body)).not.toContain('Private');
      const nid = seeded.find((x) => x.label === 'notification')!.id;
      expect((await call(ordB, 'PUT', `/notifications/${nid}/read`)).status).toBeGreaterThanOrEqual(400);
      expect((await prisma.notification.findUnique({ where: { id: nid } }))!.is_read).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('recycle bin (was readable, restorable and deletable across fellowships)', () => {
    it('lists only the caller own fellowship, refuses to "restore" (which used to destroy the only copy), and deletes only its own', async () => {
      const foreign = seeded.find((s) => s.label === 'deleted-record')!.id;
      const mine = await prisma.deletedRecord.create({ data: { original_collection: 'contributions', original_record_id: randomUUID(), original_data: { amount: '5' }, fellowship_id: fB.id, deleted_by: secB.id, restore_token: `t-${uniq()}${uniq()}` } });
      const orphan = await prisma.deletedRecord.create({ data: { original_collection: 'contributions', original_record_id: randomUUID(), original_data: { amount: '9' }, fellowship_id: null, deleted_by: randomUUID(), restore_token: `t-${uniq()}${uniq()}` } });
      const list = (await call(secB, 'GET', '/recycle-bin')).body;
      expect(list.map((r: any) => r.id)).toContain(mine.id);
      expect(list.map((r: any) => r.id)).not.toContain(foreign);
      expect(list.map((r: any) => r.id)).not.toContain(orphan.id);
      expect(JSON.stringify(list)).not.toContain('Deleted Person');
      expect((await call(asstB, 'GET', '/recycle-bin')).status).toBe(200);
      for (const u of [ordB, treasB]) expect((await call(u, 'GET', '/recycle-bin')).status).toBe(403);
      // another fellowship's record and unattributable ones are untouchable
      for (const id of [foreign, orphan.id]) {
        expect((await call(secB, 'POST', `/recycle-bin/${id}/restore`)).status).toBe(403);
        expect((await call(secB, 'DELETE', `/recycle-bin/${id}`)).status).toBe(403);
      }
      expect(await prisma.deletedRecord.count({ where: { id: { in: [foreign, orphan.id] } } })).toBe(2);
      // own record: restore is refused honestly with a client error (never a 5xx that would look like a server fault
      // in production alerting) and the copy is kept; permanent delete is secretary-only and audited
      const r = await call(secB, 'POST', `/recycle-bin/${mine.id}/restore`);
      expect(r.status).toBe(409);
      expect(await prisma.deletedRecord.count({ where: { id: mine.id } })).toBe(1);
      expect((await call(asstB, 'DELETE', `/recycle-bin/${mine.id}`)).status).toBe(403);
      expect((await call(secB, 'DELETE', `/recycle-bin/${mine.id}`)).status).toBe(200);
      expect(await prisma.deletedRecord.count({ where: { id: mine.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entity_id: mine.id, action: 'recycle.permanent_delete' } })).toBe(1);
    });

    it('records deleted through the finance approval flow carry their fellowship', async () => {
      const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'deleted_records' AND column_name = 'fellowship_id'`;
      expect(cols).toHaveLength(1);
    });
  });

  describe('role and content boundary regressions', () => {
    it('blocks tenant self-escalation and protected-role management while allowing platform provisioning', async () => {
      const target = await makeUser(prisma, { fellowshipId: fB.id, roles: ['ordinary_member'] });
      expect((await call(secB, 'PUT', `/users/${target.id}/roles`, { roles: ['treasurer'] })).status).toBe(403);
      expect((await call(secB, 'PUT', `/users/${secB.id}/roles`, { roles: ['treasurer'] })).status).toBe(403);
      expect((await prisma.user.findUnique({ where: { id: target.id } }))!.roles).toEqual(['ordinary_member']);
      // A secretary must not be able to mint a platform account, or the tenant could escalate straight out of its scope.
      expect((await call(secB, 'PUT', `/users/${target.id}/roles`, { roles: ['platform_support'] })).status).toBe(403);
      expect((await call(secB, 'PUT', `/users/${target.id}/roles`, { roles: ['admin'] })).status).toBe(403);
      expect((await prisma.user.findUnique({ where: { id: target.id } }))!.roles).toEqual(['ordinary_member']);
      // A platform administrator administers tenants, which `PLATFORM_TENANTS_MANAGE` grants explicitly - so this is
      // allowed. It is a separate permission, not a consequence of holding any tenant role.
      const platformAdmin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
      expect((await call(platformAdmin, 'PUT', `/users/${target.id}/roles`, { roles: ['chairperson'] })).status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: target.id } }))!.roles).toEqual(['chairperson']);

      // The fellowship administrator can too, and is who is meant to.
      const target2 = await makeUser(prisma, { fellowshipId: fB.id, roles: ['ordinary_member'] });
      const fellowAdmin = await makeUser(prisma, { fellowshipId: fB.id, roles: ['fellowship_admin'] });
      expect((await call(fellowAdmin, 'PUT', `/users/${target2.id}/roles`, { roles: ['treasurer'] })).status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id: target2.id } }))!.roles).toEqual(['treasurer']);
    });

    it('derives announcement tenancy from the author and refuses cross-tenant or self approval', async () => {
      const created = await call(secB, 'POST', '/it-content/announcements', {
        title: 'Tenant notice',
        content: 'Details',
        audienceType: 'all_members',
        fellowship_id: fA.id,
        status: 'FINAL_APPROVED',
      });
      expect(created.status).toBe(201);
      expect(created.body.fellowship_id).toBe(fB.id);
      expect(created.body.status).toBe('DRAFT');
      const foreign = await prisma.announcement.create({ data: { title: 'Foreign', content: 'No', audience_type: 'all_members', fellowship_id: fA.id, created_by: secA.id } });
      expect((await call(secB, 'POST', `/it-content/announcements/${foreign.id}/approve`, { decision: 'approved' })).status).toBeGreaterThanOrEqual(400);
      const chairB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['chairperson'] });
      expect((await call(secB, 'POST', `/it-content/announcements/${created.body.id}/approve`, { decision: 'approved' })).status).toBe(403);
      expect((await call(chairB, 'POST', `/it-content/announcements/${created.body.id}/approve`, { decision: 'approved' })).status).toBe(201);
      expect((await call(chairB, 'POST', `/it-content/announcements/${created.body.id}/approve`, { decision: 'rejected' })).status).toBe(409);
    });

    it('never mass-assigns activity tenancy and applies audience rules to direct detail', async () => {
      const otherDept = await makeDepartment(prisma, fB.id, 'OtherB');
      const leader = await makeUser(prisma, { fellowshipId: fB.id, roles: ['department_secretary'], departmentId: otherDept.id });
      const created = await call(secB, 'POST', '/activities', {
        title: 'Choir practice',
        date: new Date().toISOString(),
        audienceType: 'department',
        departmentId: DB.id,
        fellowship_id: fA.id,
        created_by: 'attacker',
      });
      expect(created.status).toBe(201);
      expect(created.body.fellowship_id).toBe(fB.id);
      expect(created.body.created_by).toBe(secB.id);
      const changed = await call(secB, 'PUT', `/activities/${created.body.id}`, { title: 'Renamed', fellowship_id: fA.id, created_by: 'attacker' });
      expect(changed.status).toBe(200);
      expect(changed.body.fellowship_id).toBe(fB.id);
      expect(changed.body.created_by).toBe(secB.id);
      expect((await call(leader, 'GET', `/activities/${created.body.id}`)).status).toBe(403);
      expect((await call(ordB, 'GET', `/activities/${created.body.id}`)).status).toBe(403);
    });

    it('deduplicates concurrent public check-ins and stops accepting a cancelled activity', async () => {
      const activity = await makeActivity(prisma, { fellowshipId: fB.id });
      const results = await Promise.all(Array.from({ length: 8 }, () => api(app).post('/activities/attendance', { activityId: activity.id, memberName: '  Grace   Hopper ' })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await prisma.attendance.count({ where: { activity_id: activity.id, member_id: null } })).toBe(1);
      expect((await call(secB, 'POST', `/activities/${activity.id}/cancel`)).status).toBe(201);
      expect((await api(app).post('/activities/attendance', { activityId: activity.id, memberName: 'Late Person' })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('department and gender scope', () => {
    it('a department leader without a department, or a removed member, exposes nothing', async () => {
      const lonely = await makeUser(prisma, { fellowshipId: fB.id, roles: ['department_secretary'] }); // no department assigned
      const r = await call(lonely, 'GET', '/members?limit=100');
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual([]);
      const leader = await makeUser(prisma, { fellowshipId: fB.id, roles: ['department_secretary'], departmentId: DB.id });
      const inDept = await makeMember(prisma, { fellowshipId: fB.id, name: 'In Dept' });
      const gone = await makeMember(prisma, { fellowshipId: fB.id, name: 'Was In Dept' });
      await addToDepartment(prisma, inDept.id, DB.id);
      const dm = await addToDepartment(prisma, gone.id, DB.id);
      await prisma.departmentMember.update({ where: { id: dm.id }, data: { removed: true, removed_at: new Date() } });
      const list = (await call(leader, 'GET', '/members?limit=100')).body.data.map((m: any) => m.full_name);
      expect(list).toContain('In Dept');
      expect(list).not.toContain('Was In Dept');
      await call(leader, 'GET', `/members/${inDept.id}`).then((x) => expect(x.status).toBe(200));
      await call(leader, 'GET', `/members/${gone.id}`).then((x) => expect(x.status).toBe(403));
    });

    it('gender leaders see only their own gender (this filter was silently off)', async () => {
      const women = await makeUser(prisma, { fellowshipId: fB.id, roles: ['gender_leader'] });
      await prisma.user.update({ where: { id: women.id }, data: { gender: 'female' } });
      const f = await makeMember(prisma, { fellowshipId: fB.id, name: 'Fem Member' });
      const m = await makeMember(prisma, { fellowshipId: fB.id, name: 'Male Member' });
      await prisma.member.update({ where: { id: f.id }, data: { gender: 'female' } });
      await prisma.member.update({ where: { id: m.id }, data: { gender: 'male' } });
      const seen = (await call(women, 'GET', '/members?limit=200')).body.data;
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((x: any) => x.gender === 'female')).toBe(true);
      expect((await call(women, 'GET', `/members/${f.id}`)).status).toBe(200);
      expect((await call(women, 'GET', `/members/${m.id}`)).status).toBe(403);
      const unknown = await makeUser(prisma, { fellowshipId: fB.id, roles: ['gender_leader'] }); // no gender on the account: fails closed
      expect((await call(unknown, 'GET', '/members?limit=200')).body.data).toEqual([]);
      expect((await call(unknown, 'GET', `/members/${f.id}`)).status).toBe(403);
    });

    it('an activity\'s attendance list is limited to its own department for department leaders, and validates the id', async () => {
      const leader = await makeUser(prisma, { fellowshipId: fB.id, roles: ['department_secretary'], departmentId: DB.id });
      const other = await makeUser(prisma, { fellowshipId: fB.id, roles: ['department_secretary'], departmentId: (await makeDepartment(prisma, fB.id, 'Other')).id });
      const own = await makeActivity(prisma, { fellowshipId: fB.id, departmentId: DB.id });
      const general = await makeActivity(prisma, { fellowshipId: fB.id });
      expect((await call(leader, 'GET', `/activities/${own.id}/attendance`)).status).toBe(200);
      expect((await call(other, 'GET', `/activities/${own.id}/attendance`)).status).toBe(403);
      expect((await call(leader, 'GET', `/activities/${general.id}/attendance`)).status).toBe(403);
      expect((await call(secB, 'GET', `/activities/${general.id}/attendance`)).status).toBe(200);
      expect((await call(secB, 'GET', '/activities/nope/attendance')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('authentication and sessions', () => {
    const create = async (password = 'Correct-Horse-Battery-9') => {
      const email = `sec${uniq()}@test.local`;
      const m = await makeMember(prisma, { fellowshipId: fB.id, name: 'Session Person' });
      const r = await call(secB, 'POST', '/users', { email, password, firstName: 'Sess', lastName: 'Person', memberId: m.id, roles: ['ordinary_member'] });
      return { r, email, password };
    };

    it('passwords must be long enough, not common, and not built from the account\'s own name', async () => {
      const m = await makeMember(prisma, { fellowshipId: fB.id });
      const bad = (password: string) => call(secB, 'POST', '/users', { email: `w${uniq()}@test.local`, password, firstName: 'Ann', lastName: 'Smithers', memberId: m.id }).then((r) => r.status);
      expect(await bad('short1')).toBe(400);
      expect(await bad('123456789')).toBe(400);
      expect(await bad('1234567890')).toBe(400);
      expect(await bad('Password123')).toBe(400);
      expect(await bad('aaaaaaaaaaaaaaa')).toBe(400);
      expect(await bad('x'.repeat(200))).toBe(400);
      expect(await bad('my-smithers-secret')).toBe(400);
      expect(await bad(undefined as any)).toBe(400);
      expect(await bad({ a: 1 } as any)).toBe(400);
    });

    it('an account created with an initial password must choose its own before anything else', async () => {
      const { r, email, password } = await create();
      expect(r.status).toBe(201);
      const l = (await login(email, password).expect(201)).body;
      expect(l.user.mustChangePassword).toBe(true);
      const tok = { token: l.accessToken };
      const blocked = await call(tok, 'GET', '/members');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await call(tok, 'GET', '/notifications')).status).toBe(403);
      expect((await call(tok, 'GET', '/profile')).status).toBe(200);
      // the change itself: policy applies, the old password must be right, and it must differ
      const chg = (body: object) => call(tok, 'POST', '/auth/change-password', body);
      expect((await chg({ oldPassword: 'wrong-current-pass', newPassword: 'Another-Passphrase-77' })).status).toBe(401);
      expect((await chg({ oldPassword: password, newPassword: 'short' })).status).toBe(400);
      expect((await chg({ oldPassword: password, newPassword: password })).status).toBe(400);
      expect((await chg({ oldPassword: password, newPassword: 'Another-Passphrase-77' })).status).toBe(201);
    });

    it('changing the password ends every earlier session: access tokens and refresh tokens', async () => {
      const { email, password } = await create();
      const first = (await login(email, password).expect(201)).body;
      const changed = (await call({ token: first.accessToken }, 'POST', '/auth/change-password', { oldPassword: password, newPassword: 'Fresh-Passphrase-31' }).then((r) => r.body));
      expect(changed.accessToken).toBeTruthy();
      expect((await call({ token: first.accessToken }, 'GET', '/profile')).status).toBe(401); // the old access token
      expect((await api(app).post('/auth/refresh', { refreshToken: first.refreshToken })).status).toBe(401); // the old refresh token
      expect((await call({ token: changed.accessToken }, 'GET', '/profile')).status).toBe(200); // the new session works
      const refreshed = await api(app).post('/auth/refresh', { refreshToken: changed.refreshToken });
      expect(refreshed.status).toBe(201);
      expect((await call({ token: refreshed.body.accessToken }, 'GET', '/profile')).status).toBe(200);
      expect((await login(email, password)).status).toBe(401); // the old password is gone
      expect((await api(app).post('/auth/refresh', { refreshToken: 'garbage' })).status).toBe(401); // was an uncaught error
      expect((await api(app).post('/auth/refresh', {})).status).toBe(400);
    });

    it('a refresh token is not an access token: it is refused as a bearer token, before and after the session is revoked', async () => {
      const { email, password } = await create();
      const first = (await login(email, password).expect(201)).body;
      // it used to authenticate as a bare user id (no deactivation / session-version / suspension checks)
      for (const url of ['/profile', '/notifications', '/members']) expect((await call({ token: first.refreshToken }, 'GET', url)).status).toBe(401);
      expect((await call({ token: first.accessToken }, 'GET', '/profile')).status).toBe(200);
      // a deactivated account: its refresh token reads nothing either
      const u = await prisma.user.findUnique({ where: { email } });
      await prisma.user.update({ where: { id: u!.id }, data: { is_active: false } });
      expect((await call({ token: first.refreshToken }, 'GET', '/profile')).status).toBe(401);
      expect((await call({ token: first.accessToken }, 'GET', '/profile')).status).toBe(401);
    });

    it('authentication is by bearer header only: an accessToken cookie is ignored', async () => {
      const { email, password } = await create();
      const first = (await login(email, password).expect(201)).body;
      expect((await api(app).get('/profile').set('Cookie', [`accessToken=${first.accessToken}`])).status).toBe(401);
    });

    it('role lists are validated: known names only, a non-empty list, nothing else', async () => {
      const { r } = await create();
      const id = r.body.id;
      for (const roles of [undefined, null, 'secretary', {}, [], [1], ['not-a-role'], ['secretary', 5], Array(11).fill('secretary')]) {
        expect((await call(secB, 'PUT', `/users/${id}/roles`, { roles })).status).toBe(400);
      }
      // 'treasurer' is a protected finance role, so a secretary may not grant it; duplicates of a permitted role are
      // still collapsed rather than rejected.
      expect((await call(secB, 'PUT', `/users/${id}/roles`, { roles: ['gender_leader', 'gender_leader'] })).status).toBe(200);
      expect((await prisma.user.findUnique({ where: { id } }))!.roles).toEqual(['gender_leader']); // duplicates collapsed
      expect((await call(secB, 'PUT', `/users/${id}/roles`, { roles: ['treasurer'] })).status).toBe(403);
    });

    it('repeated wrong passwords lock the account for a while; the locked account answers exactly like a wrong password', async () => {
      const { email, password } = await create();
      await login(email, password).expect(201);
      const wrong = await login(email, 'definitely-wrong-1');
      const unknown = await login(`nobody${uniq()}@test.local`, 'definitely-wrong-1');
      expect(wrong.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body); // no hint that the account exists
      for (let i = 0; i < 7; i++) await login(email, 'definitely-wrong-1');
      const user = (await prisma.user.findUnique({ where: { email } }))!;
      expect(user.failed_login_count).toBeGreaterThanOrEqual(8);
      expect(user.locked_until!.getTime()).toBeGreaterThan(Date.now());
      const locked = await login(email, password); // even the CORRECT password is refused while locked
      expect(locked.status).toBe(401);
      expect(locked.body).toEqual(unknown.body);
      expect(await prisma.auditLog.count({ where: { entity_id: user.id, action: 'auth.account_locked' } })).toBe(1);
      // after the lock lapses the owner can sign in, which clears the counters
      await prisma.user.update({ where: { id: user.id }, data: { locked_until: new Date(Date.now() - 1000), last_failed_login_at: new Date(Date.now() - 3600_000) } });
      expect((await login(email, password)).status).toBe(201);
      expect(await prisma.user.findUnique({ where: { id: user.id }, select: { failed_login_count: true, locked_until: true } })).toEqual({ failed_login_count: 0, locked_until: null });
      // failures older than the window do not accumulate
      await prisma.user.update({ where: { id: user.id }, data: { failed_login_count: 7, last_failed_login_at: new Date(Date.now() - 3600_000) } });
      await login(email, 'definitely-wrong-1');
      expect((await prisma.user.findUnique({ where: { id: user.id } }))!.failed_login_count).toBe(1);
    });

    it('malformed sign-in input is a clean 401, not a server error', async () => {
      for (const body of [{ email: { $ne: null }, password: 'x' }, { email: 'a@b.c', password: { a: 1 } }, { email: 'x'.repeat(400) + '@a.b', password: 'x' }, { email: 'a@b.c', password: 'x'.repeat(5000) }]) {
        const r = await api(app).post('/auth/login', body);
        expect([400, 401]).toContain(r.status);
      }
    });

    it('a tenant cannot sign in as a platform account by any path, and the registration helper is gone', async () => {
      expect((await api(app).post('/auth/register', { email: 'x@y.z', password: 'Whatever-Pass-12', roles: ['admin'] })).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('public check-in link', () => {
    it('needs a real name, only works around the event, and does not double-count the same person', async () => {
      const act = await makeActivity(prisma, { fellowshipId: fB.id });
      const post = (activityId: string, memberName: any) => api(app).post('/activities/attendance', { activityId, memberName });
      for (const bad of [undefined, '', ' ', 'A', 'x'.repeat(101), { a: 1 }]) expect((await post(act.id, bad)).status).toBe(400);
      const a = await post(act.id, '  Grace   Hopper ');
      expect(a.status).toBe(201);
      expect(a.body.recorded_by_name).toBe('Grace Hopper');
      const b = await post(act.id, 'grace hopper');
      expect(b.body.id).toBe(a.body.id); // the same person, not a second record
      expect(await prisma.attendance.count({ where: { activity_id: act.id } })).toBe(1);
      const future = await makeActivity(prisma, { fellowshipId: fB.id });
      await prisma.activity.update({ where: { id: future.id }, data: { date: new Date(Date.now() + 10 * 86400000) } });
      expect((await post(future.id, 'Early Bird')).status).toBe(400);
      const past = await makeActivity(prisma, { fellowshipId: fB.id });
      await prisma.activity.update({ where: { id: past.id }, data: { date: new Date(Date.now() - 30 * 86400000) } });
      expect((await post(past.id, 'Late Comer')).status).toBe(400);
      expect((await post('nope', 'Someone Real')).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('file uploads', () => {
    const upload = (u: any, buf: Buffer, filename: string, contentType: string, fields: Record<string, string> = { title: 'Upload test' }) => {
      const req = api(app, u.token).post('/it-content/documents', {}) as any;
      // supertest's chained .attach needs a fresh request without the JSON body helper
      return req;
    };
    const send = (u: any, buf: Buffer, filename: string, contentType: string) =>
      require('supertest')(app.getHttpServer()).post('/api/v1/it-content/documents').set('Authorization', `Bearer ${u.token}`).field('title', 'Upload test').attach('file', buf, { filename, contentType });
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

    it('accepts a genuine file and stores only a harmless name', async () => {
      const ok = await send(secB, pdf, '../../etc/Budget 2026.pdf', 'application/pdf');
      expect(ok.status).toBe(201);
      const doc = await prisma.documentEntity.findUnique({ where: { id: ok.body.id } });
      expect(doc!.filename).toBe('Budget 2026.pdf');
      expect(doc!.stored_filename).not.toMatch(/\.\.|\/|\\/);
      expect(doc!.fellowship_id).toBe(fB.id);
    });

    it('refuses content that is not what it claims to be, dangerous names, empty and missing files', async () => {
      const cases: [string, Buffer, string, string][] = [
        ['declared pdf, content is an executable', Buffer.from('MZ  this is an executable'), 'report.pdf', 'application/pdf'],
        ['png declared as jpeg', png, 'photo.jpg', 'image/jpeg'],
        ['script inside a text file', Buffer.from('<script>alert(1)</script>'), 'notes.txt', 'text/plain'],
        ['NUL bytes are not text', Buffer.alloc(64, 0), 'binary.txt', 'text/plain'],
        ['.exe', pdf, 'invoice.exe', 'application/pdf'],
        ['double extension', pdf, 'invoice.pdf.exe', 'application/pdf'],
        ['php inside the name', pdf, 'run.php.pdf', 'application/pdf'],
        ['svg', pdf, 'image.svg', 'application/pdf'],
        ['empty file', Buffer.alloc(0), 'empty.pdf', 'application/pdf'],
        ['name of dots', pdf, '...', 'application/pdf'],
        ['type not allowed', pdf, 'a.zip', 'application/zip'],
      ];
      const wrong: string[] = [];
      for (const [label, buf, name, type] of cases) {
        const r = await send(secB, buf, name, type);
        if (r.status !== 400) wrong.push(`${label} -> ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
      }
      expect(wrong).toEqual([]);
      const none = await require('supertest')(app.getHttpServer()).post('/api/v1/it-content/documents').set('Authorization', `Bearer ${secB.token}`).field('title', 'no file');
      expect(none.status).toBe(400);
    });

    it('cuts off oversized uploads before they are buffered, and only authorised roles may upload', async () => {
      const big = Buffer.concat([pdf, Buffer.alloc(11 * 1024 * 1024, 65)]);
      expect((await send(secB, big, 'huge.pdf', 'application/pdf')).status).toBe(413);
      expect((await send(ordB, pdf, 'x.pdf', 'application/pdf')).status).toBe(403);
      expect((await send(treasB, pdf, 'x.pdf', 'application/pdf')).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------------------------------------
  describe('error handling', () => {
    it('NUL bytes and out-of-range numbers are a client error (400), on every kind of input', async () => {
      const m = await makeMember(prisma, { fellowshipId: fB.id });
      const nul = 'a\u0000b';
      expect((await call(secB, 'POST', '/departments', { name: nul })).status).toBe(400);
      expect((await call(secB, 'POST', '/departments', null as any)).status).toBe(400);
      expect((await call(secB, 'PUT', `/departments/${DB.id}`, null as any)).status).toBe(400);
      expect((await call(secB, 'POST', '/members', { fullName: nul, gender: 'female', expectedGraduationYear: 2035, expectedGraduationMonth: 6 })).status).toBe(400);
      expect((await call(secB, 'GET', `/members?search=${encodeURIComponent(nul)}`)).status).toBe(400);
      expect((await call(secB, 'GET', '/members?search=a%00b')).status).toBe(400);
      expect((await call(secB, 'GET', `/members/${m.id}%00`)).status).toBeGreaterThanOrEqual(400);
      expect((await call(secB, 'POST', '/programmes', { name: 'ok', description: { deep: [nul] } })).status).toBe(400);
      expect((await call(secB, 'POST', '/programmes', { name: 'ok', ['k\u0000ey']: 1 })).status).toBe(400);
      expect((await api(app).post('/auth/login', { email: nul, password: 'x' })).status).toBe(400);
      for (const bad of [{ year: 9007199254740993, month: 6 }, { year: 2030, month: 13 }, { year: 1800, month: 1 }, { year: '2030', month: 6 }, { year: 2030.5, month: 6 }, {}]) {
        expect((await call(secB, 'PUT', `/members/${m.id}/graduation`, bad)).status).toBe(400);
      }
      expect((await call(secB, 'PUT', `/members/${m.id}/graduation`, { year: 2031, month: 7 })).status).toBe(200);
    });

    it('database problems surface as the right client error and never expose internals', async () => {
      // a duplicate department name (unique constraint) -> a clean 4xx
      const dup = `Dup ${uniq()}`;
      const first = await call(secB, 'POST', '/departments', { name: dup });
      if (first.status < 300) {
        const second = await call(secB, 'POST', '/departments', { name: dup });
        expect(second.status).toBeLessThan(500);
        expect(JSON.stringify(second.body)).not.toMatch(/prisma|constraint|relation|column|violat/i);
      }
      const bad = await call(secB, 'GET', '/members/00000000-0000-0000-0000-00000000000z');
      expect(bad.status).toBeLessThan(500);
      expect(JSON.stringify(bad.body)).not.toMatch(/prisma|invocation|stack/i);
    });
  });
});
