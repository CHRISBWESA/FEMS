import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { addToDepartment, api, createTestApp, describeDb, getPrisma, makeActivity, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

const H = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * H).toISOString();

describeDb('Phase 17 - volunteer & service management (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, D1: any, D2: any, DB: any;
  let sec: any, asst: any, chair: any, treas: any, ds1: any, ds2: any, ord: any, ord2: any, coord: any, gl: any, admin: any, secB: any, ordB: any, loner: any;
  let m1: any, m2: any, m3: any, mc: any, mB: any;
  let O1: any; // open, department D1, coordinated by `coord`

  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const get = (u: any, url: string) => api(app, u.token).get(url);

  const mkOpp = async (extra: object = {}, by = sec) =>
    (await post(by, '/volunteers/opportunities', { title: `Opp ${uniq()}`, status: 'open', ...extra }).expect(201)).body;
  // Every helper shift gets its own time slot (far from the explicit times used below), so unrelated tests
  // never trip the overlapping-assignment rule for the shared members.
  let slot = 0;
  const mkShift = async (oppId: string, extra: object = {}, by = sec) => {
    const start = 1000 + 4 * slot++;
    return (await post(by, `/volunteers/opportunities/${oppId}/shifts`, { startsAt: at(start), endsAt: at(start + 2), capacity: 2, ...extra }).expect(201)).body;
  };
  // Shifts in the past cannot be created through the API (by design), so history-style data is seeded directly.
  const pastShift = (oppId: string, hoursAgo: number, lengthH: number, capacity = 1, fellowshipId = fA.id, extra: object = {}) =>
    prisma.serviceShift.create({ data: { fellowship_id: fellowshipId, opportunity_id: oppId, starts_at: new Date(Date.now() - hoursAgo * H), ends_at: new Date(Date.now() - (hoursAgo - lengthH) * H), capacity, created_by: randomUUID(), ...extra } });
  const seedAssignment = (shiftId: string, memberId: string, status: string, fellowshipId = fA.id) =>
    prisma.serviceAssignment.create({ data: { fellowship_id: fellowshipId, shift_id: shiftId, member_id: memberId, status: status as any, created_by: randomUUID() } });
  const dbStatus = async (assignmentId: string) => (await prisma.serviceAssignment.findUnique({ where: { id: assignmentId } }))?.status;
  const notes = (userId: string, entityId: string, event = 'volunteer_update') => prisma.notification.findMany({ where: { recipient_user_id: userId, entity_id: entityId, event_type: event } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'VA');
    fB = await makeFellowship(prisma, 'VB');
    D1 = await makeDepartment(prisma, fA.id, 'VD1');
    D2 = await makeDepartment(prisma, fA.id, 'VD2');
    DB = await makeDepartment(prisma, fB.id, 'VDB');
    const mk = (roles: string[], departmentId?: string) => makeUser(prisma, { fellowshipId: fA.id, roles, departmentId });
    sec = await mk(['secretary']);
    asst = await mk(['assistant_secretary']);
    chair = await mk(['chairperson']);
    treas = await mk(['treasurer']);
    ds1 = await mk(['department_secretary'], D1.id);
    ds2 = await mk(['department_secretary'], D2.id);
    ord = await mk(['ordinary_member']);
    ord2 = await mk(['ordinary_member']);
    coord = await mk(['ordinary_member']);
    gl = await mk(['gender_leader']);
    loner = await mk(['ordinary_member']); // account with no member profile
    admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    ordB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['ordinary_member'] });
    m1 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Volunteer One', userId: ord.id });
    m2 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Volunteer Two', userId: ord2.id });
    mc = await makeMember(prisma, { fellowshipId: fA.id, name: 'Coordinator Person', userId: coord.id });
    m3 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Volunteer NoAccount' });
    mB = await makeMember(prisma, { fellowshipId: fB.id, name: 'Foreign Member', userId: ordB.id });
    await addToDepartment(prisma, m1.id, D1.id);
    await addToDepartment(prisma, m2.id, D2.id);
    await addToDepartment(prisma, m3.id, D1.id);
    O1 = await mkOpp({ departmentId: D1.id, coordinatorMemberId: mc.id, title: 'Sunday ushering' });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('authentication, permissions and validation', () => {
    it('401 without a token on every entry point', async () => {
      for (const url of ['/volunteers/opportunities', '/volunteers/roles', '/volunteers/my-service', '/volunteers/reports/summary']) {
        await api(app).get(url).expect(401);
      }
      await api(app).post('/volunteers/opportunities', {}).expect(401);
    });

    it('everyone signed in can browse; only managers/department leaders can create', async () => {
      for (const u of [sec, chair, treas, ds1, ord, gl, coord]) await get(u, '/volunteers/opportunities').expect(200);
      for (const u of [chair, treas, ord, gl, coord]) await post(u, '/volunteers/opportunities', { title: 'x' }).expect(403);
      const a = await post(asst, '/volunteers/opportunities', { title: `A ${uniq()}` }).expect(201);
      expect(a.body.status).toBe('draft');
    });

    it('a department leader creates only for their own department and cannot pick another', async () => {
      const own = await post(ds1, '/volunteers/opportunities', { title: `Own ${uniq()}` }).expect(201);
      expect(own.body.department_id).toBe(D1.id);
      await post(ds1, '/volunteers/opportunities', { title: 'x', departmentId: D2.id }).expect(403);
    });

    it('validates input and refuses references from another fellowship', async () => {
      await post(sec, '/volunteers/opportunities', {}).expect(400);
      await post(sec, '/volunteers/opportunities', { title: 'x'.repeat(151) }).expect(400);
      await post(sec, '/volunteers/opportunities', { title: 'x', status: 'cancelled' }).expect(400);
      await post(sec, '/volunteers/opportunities', { title: 'x', status: 'bogus' }).expect(400);
      await post(sec, '/volunteers/opportunities', { title: 'x', departmentId: 'nope' }).expect(400);
      await post(sec, '/volunteers/opportunities', { title: 'x', departmentId: DB.id }).expect(404);
      await post(sec, '/volunteers/opportunities', { title: 'x', coordinatorMemberId: mB.id }).expect(404);
      await get(sec, '/volunteers/opportunities?status=bogus').expect(400);
      await get(sec, '/volunteers/opportunities?limit=0').expect(400);
      await get(sec, '/volunteers/opportunities?limit=9999').expect(400);
      await get(sec, '/volunteers/opportunities?departmentId=nope').expect(400);
    });

    it('ignores mass-assigned fields and stamps the caller\'s own fellowship', async () => {
      const r = await post(sec, '/volunteers/opportunities', { title: `M ${uniq()}`, fellowshipId: fB.id, fellowship_id: fB.id, created_by: 'x', id: randomUUID() }).expect(201);
      expect(r.body.fellowship_id).toBe(fA.id);
      expect(r.body.created_by).toBe(sec.id);
    });

    it('platform accounts (admin) are outside the fellowship: no volunteering access at all (Phase 19 boundary)', async () => {
      await post(admin, '/volunteers/opportunities', { title: 'x', fellowshipId: fA.id }).expect(403);
      await get(admin, '/volunteers/opportunities').expect(403);
      await get(admin, '/volunteers/reports/summary').expect(403);
    });

    it('garbage and unknown ids are 404 on every route', async () => {
      const bad = ['not-a-uuid', randomUUID()];
      for (const id of bad) {
        await get(sec, `/volunteers/opportunities/${id}`).expect(404);
        await put(sec, `/volunteers/opportunities/${id}`, { title: 'x' }).expect(404);
        await post(sec, `/volunteers/opportunities/${id}/status`, { status: 'closed' }).expect(404);
        await post(sec, `/volunteers/opportunities/${id}/shifts`, {}).expect(404);
        await put(sec, `/volunteers/shifts/${id}`, { capacity: 2 }).expect(404);
        await post(sec, `/volunteers/shifts/${id}/cancel`).expect(404);
        await get(sec, `/volunteers/shifts/${id}/assignments`).expect(404);
        await post(sec, `/volunteers/shifts/${id}/assign`, { memberId: m1.id }).expect(404);
        await post(ord, `/volunteers/shifts/${id}/apply`).expect(404);
        await post(sec, `/volunteers/assignments/${id}/decide`, { decision: 'approve' }).expect(404);
        await post(ord, `/volunteers/assignments/${id}/withdraw`).expect(404);
        await post(sec, `/volunteers/assignments/${id}/cancel`).expect(404);
        await post(sec, `/volunteers/assignments/${id}/attendance`, { outcome: 'attended' }).expect(404);
        await put(sec, `/volunteers/roles/${id}`, { name: 'x' }).expect(404);
      }
      await get(sec, '/volunteers/members/not-a-uuid/history').expect(400);
      await get(sec, `/volunteers/members/${randomUUID()}/history`).expect(404);
    });
  });

  describe('visibility and scope', () => {
    it('drafts are invisible to ordinary members; open ones are visible to all; staff and the coordinator see drafts', async () => {
      const draft = await mkOpp({ status: 'draft', departmentId: D1.id, coordinatorMemberId: mc.id, title: `Draft ${uniq()}` });
      const ids = async (u: any) => (await get(u, '/volunteers/opportunities?limit=200').expect(200)).body.map((o: any) => o.id);
      expect(await ids(ord)).not.toContain(draft.id);
      expect(await ids(ord)).toContain(O1.id);
      expect(await ids(ds2)).not.toContain(draft.id); // another department's leader
      expect(await ids(ds1)).toContain(draft.id); // owning department
      expect(await ids(coord)).toContain(draft.id); // its coordinator
      expect(await ids(sec)).toContain(draft.id);
      await get(ord, `/volunteers/opportunities/${draft.id}`).expect(404);
      await get(ds2, `/volunteers/opportunities/${draft.id}`).expect(404);
      await get(coord, `/volunteers/opportunities/${draft.id}`).expect(200);
      expect((await get(ds1, `/volunteers/opportunities/${draft.id}`).expect(200)).body.canCoordinate).toBe(true);
    });

    it('the list is tenant-scoped: another fellowship sees none of these', async () => {
      const r = await get(secB, '/volunteers/opportunities?limit=200').expect(200);
      expect(r.body.some((o: any) => o.id === O1.id)).toBe(false);
    });

    it('non-staff see only upcoming scheduled shifts and no roster; staff see counts', async () => {
      const opp = await mkOpp();
      const s = await mkShift(opp.id);
      const past = await pastShift(opp.id, 5, 2);
      const asOrd = (await get(ord, `/volunteers/opportunities/${opp.id}`).expect(200)).body;
      expect(asOrd.shifts.map((x: any) => x.id)).toEqual([s.id]);
      expect(asOrd.canCoordinate).toBe(false);
      expect(asOrd.shifts[0].pendingApplications).toBeUndefined();
      const asSec = (await get(sec, `/volunteers/opportunities/${opp.id}`).expect(200)).body;
      expect(asSec.shifts.map((x: any) => x.id).sort()).toEqual([s.id, past.id].sort());
      expect(asSec.shifts[0].pendingApplications).toBeDefined();
      await get(ord, `/volunteers/shifts/${s.id}/assignments`).expect(403);
    });

    it('cross-tenant ids are refused on every route', async () => {
      const opp = await mkOpp();
      const s = await mkShift(opp.id);
      const a = (await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m3.id }).expect(201)).body;
      await get(secB, `/volunteers/opportunities/${opp.id}`).expect(403);
      await put(secB, `/volunteers/opportunities/${opp.id}`, { title: 'hijack' }).expect(403);
      await post(secB, `/volunteers/opportunities/${opp.id}/status`, { status: 'closed' }).expect(403);
      await post(secB, `/volunteers/opportunities/${opp.id}/shifts`, { startsAt: at(48), endsAt: at(50) }).expect(403);
      await put(secB, `/volunteers/shifts/${s.id}`, { capacity: 9 }).expect(403);
      await post(secB, `/volunteers/shifts/${s.id}/cancel`).expect(403);
      await get(secB, `/volunteers/shifts/${s.id}/assignments`).expect(403);
      await post(secB, `/volunteers/shifts/${s.id}/assign`, { memberId: mB.id }).expect(403);
      await post(ordB, `/volunteers/shifts/${s.id}/apply`).expect(403);
      await post(secB, `/volunteers/assignments/${a.id}/decide`, { decision: 'reject' }).expect(403);
      await post(secB, `/volunteers/assignments/${a.id}/cancel`).expect(403);
      await post(secB, `/volunteers/assignments/${a.id}/attendance`, { outcome: 'attended' }).expect(403);
      await post(ordB, `/volunteers/assignments/${a.id}/withdraw`).expect(403);
      await get(secB, `/volunteers/members/${m3.id}/history`).expect(403);
      expect((await prisma.serviceOpportunity.findUnique({ where: { id: opp.id } }))!.title).toBe(opp.title);
    });
  });

  describe('opportunity lifecycle', () => {
    it('enforces the status machine; cancelling is final; department scope applies', async () => {
      const opp = await mkOpp({ status: 'draft', departmentId: D1.id, coordinatorMemberId: mc.id });
      await post(coord, `/volunteers/opportunities/${opp.id}/status`, { status: 'open' }).expect(403); // coordinators run shifts, not the opportunity
      await post(ds2, `/volunteers/opportunities/${opp.id}/status`, { status: 'open' }).expect(403);
      await post(ds1, `/volunteers/opportunities/${opp.id}/status`, { status: 'open' }).expect(201);
      await post(sec, `/volunteers/opportunities/${opp.id}/status`, { status: 'draft' }).expect(409);
      await post(sec, `/volunteers/opportunities/${opp.id}/status`, { status: 'bogus' }).expect(400);
      await post(sec, `/volunteers/opportunities/${opp.id}/status`, { status: 'closed' }).expect(201);
      await post(sec, `/volunteers/opportunities/${opp.id}/status`, { status: 'open' }).expect(201);
      await post(ds1, `/volunteers/opportunities/${opp.id}/status`, { status: 'cancelled' }).expect(201);
      await post(sec, `/volunteers/opportunities/${opp.id}/status`, { status: 'open' }).expect(409);
      await put(sec, `/volunteers/opportunities/${opp.id}`, { title: 'zombie' }).expect(409);
      await post(sec, `/volunteers/opportunities/${opp.id}/shifts`, { startsAt: at(48), endsAt: at(50) }).expect(409);
    });

    it('edits: managers/owning department only; department moves are manager-only; audited', async () => {
      const opp = await mkOpp({ departmentId: D1.id });
      await put(coord, `/volunteers/opportunities/${opp.id}`, { title: 'x' }).expect(403);
      await put(ds2, `/volunteers/opportunities/${opp.id}`, { title: 'x' }).expect(403);
      await put(ds1, `/volunteers/opportunities/${opp.id}`, { title: 'Renamed' }).expect(200);
      await put(ds1, `/volunteers/opportunities/${opp.id}`, { departmentId: D2.id }).expect(403);
      await put(sec, `/volunteers/opportunities/${opp.id}`, { departmentId: D2.id }).expect(200);
      await put(sec, `/volunteers/opportunities/${opp.id}`, { departmentId: DB.id }).expect(404);
      await put(sec, `/volunteers/opportunities/${opp.id}`, {}).expect(400);
      expect(await prisma.auditLog.count({ where: { entity_id: opp.id, action: 'volunteer.opportunity_update' } })).toBe(2);
      expect(await prisma.auditLog.count({ where: { entity_id: opp.id, action: 'volunteer.opportunity_create' } })).toBe(1);
    });

    it('cancelling an opportunity cancels its shifts and active assignments and tells the volunteers', async () => {
      const opp = await mkOpp();
      const s1 = await mkShift(opp.id);
      const s2 = await mkShift(opp.id, { startsAt: at(72), endsAt: at(74) });
      const a1 = (await post(sec, `/volunteers/shifts/${s1.id}/assign`, { memberId: m1.id }).expect(201)).body;
      const a2 = (await post(ord2, `/volunteers/shifts/${s2.id}/apply`).expect(201)).body;
      await post(sec, `/volunteers/opportunities/${opp.id}/status`, { status: 'cancelled' }).expect(201);
      expect(await dbStatus(a1.id)).toBe('cancelled');
      expect(await dbStatus(a2.id)).toBe('cancelled');
      expect((await prisma.serviceShift.findMany({ where: { opportunity_id: opp.id } })).every((s) => s.status === 'cancelled')).toBe(true);
      const n = (await notes(ord.id, s1.id)).filter((x) => x.title === 'Service cancelled'); // (the assignment notice came first)
      expect(n).toHaveLength(1);
      expect(n[0].message).not.toMatch(/Opp /); // neutral text: no opportunity title in the notification
      expect((await notes(ord2.id, s2.id)).filter((x) => x.title === 'Service cancelled')).toHaveLength(1);
      await post(ord, `/volunteers/shifts/${s1.id}/apply`).expect(404); // no longer visible
    });
  });

  describe('roles (configuration, not code)', () => {
    it('managers configure roles; unique per fellowship; members see only active ones', async () => {
      const name = `Usher ${uniq()}`;
      const r = (await post(asst, '/volunteers/roles', { name, requiredSkills: ['Greeting', ' greeting ', 'WELCOME'] }).expect(201)).body;
      expect(r.required_skills.sort()).toEqual(['greeting', 'welcome']);
      await post(sec, '/volunteers/roles', { name }).expect(400);
      await post(chair, '/volunteers/roles', { name: 'x' }).expect(403);
      await post(ds1, '/volunteers/roles', { name: 'x' }).expect(403);
      await post(sec, '/volunteers/roles', { name: '' }).expect(400);
      await put(secB, `/volunteers/roles/${r.id}`, { name: 'hijack' }).expect(403);
      await put(sec, `/volunteers/roles/${r.id}`, { isActive: false }).expect(200);
      expect((await get(ord, '/volunteers/roles').expect(200)).body.some((x: any) => x.id === r.id)).toBe(false);
      expect((await get(sec, '/volunteers/roles').expect(200)).body.some((x: any) => x.id === r.id)).toBe(true);
      expect((await get(secB, '/volunteers/roles').expect(200)).body.some((x: any) => x.id === r.id)).toBe(false);
      await put(sec, `/volunteers/roles/${r.id}`, { isActive: 'yes' }).expect(400);
    });
  });

  describe('shifts', () => {
    it('are created by managers, the owning department and the coordinator only, with validated windows', async () => {
      await post(ord, `/volunteers/opportunities/${O1.id}/shifts`, { startsAt: at(48), endsAt: at(50) }).expect(403);
      await post(ds2, `/volunteers/opportunities/${O1.id}/shifts`, { startsAt: at(48), endsAt: at(50) }).expect(403);
      await post(chair, `/volunteers/opportunities/${O1.id}/shifts`, { startsAt: at(48), endsAt: at(50) }).expect(403);
      for (const u of [coord, ds1, sec]) await post(u, `/volunteers/opportunities/${O1.id}/shifts`, { startsAt: at(48), endsAt: at(50), capacity: 3 }).expect(201);
      const bad = (body: object) => post(sec, `/volunteers/opportunities/${O1.id}/shifts`, body).expect(400);
      await bad({});
      await bad({ startsAt: at(50), endsAt: at(48) });
      await bad({ startsAt: at(50), endsAt: at(50) });
      await bad({ startsAt: at(-5), endsAt: at(-3) });
      await bad({ startsAt: at(48), endsAt: at(48 + 100) });
      await bad({ startsAt: 'yesterday-ish', endsAt: at(50) });
      await bad({ startsAt: at(48), endsAt: at(50), capacity: 0 });
      await bad({ startsAt: at(48), endsAt: at(50), capacity: 1001 });
      await bad({ startsAt: at(48), endsAt: at(50), capacity: 1.5 });
      await bad({ startsAt: at(48), endsAt: at(50), roleId: 'nope' });
      await bad({ startsAt: at(48), endsAt: at(50), roleId: randomUUID() });
      await bad({ startsAt: at(48), endsAt: at(50), activityId: randomUUID() });
      const foreignAct = await makeActivity(prisma, { fellowshipId: fB.id });
      await bad({ startsAt: at(48), endsAt: at(50), activityId: foreignAct.id });
    });

    it('capacity and time edits respect existing volunteers (under a row lock)', async () => {
      const opp = await mkOpp();
      const s = await mkShift(opp.id, { capacity: 2 });
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id }).expect(201);
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m2.id }).expect(201);
      await put(sec, `/volunteers/shifts/${s.id}`, { capacity: 1 }).expect(409);
      await put(sec, `/volunteers/shifts/${s.id}`, { capacity: 3, location: 'Main hall' }).expect(200);
      await put(sec, `/volunteers/shifts/${s.id}`, { startsAt: at(60), endsAt: at(62) }).expect(409);
      await put(sec, `/volunteers/shifts/${s.id}`, {}).expect(400);
      await put(ord, `/volunteers/shifts/${s.id}`, { capacity: 5 }).expect(403);
      const empty = await mkShift(opp.id);
      await put(sec, `/volunteers/shifts/${empty.id}`, { startsAt: at(60), endsAt: at(62) }).expect(200);
      await put(sec, `/volunteers/shifts/${empty.id}`, { startsAt: at(-1) }).expect(400);
      const started = await pastShift(opp.id, 1, 3);
      await put(sec, `/volunteers/shifts/${started.id}`, { capacity: 5 }).expect(409);
      await post(sec, `/volunteers/shifts/${started.id}/cancel`).expect(409);
    });

    it('cancelling a shift cancels its active assignments and notifies (neutral text)', async () => {
      const opp = await mkOpp();
      const s = await mkShift(opp.id);
      const a = (await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id }).expect(201)).body;
      await post(ord2, `/volunteers/shifts/${s.id}/cancel`).expect(403);
      const r = (await post(sec, `/volunteers/shifts/${s.id}/cancel`).expect(201)).body;
      expect(r.assignmentsCancelled).toBe(1);
      expect(await dbStatus(a.id)).toBe('cancelled');
      expect((await notes(ord.id, s.id)).filter((x) => x.title === 'Service cancelled')).toHaveLength(1);
      await post(sec, `/volunteers/shifts/${s.id}/cancel`).expect(409);
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m2.id }).expect(409);
    });
  });

  describe('applications and self-service', () => {
    it('apply -> coordinator is told -> approve/reject; duplicates and bad states are refused', async () => {
      const s = await mkShift(O1.id, { capacity: 1 });
      await post(loner, `/volunteers/shifts/${s.id}/apply`).expect(404); // no linked member
      const a1 = (await post(ord, `/volunteers/shifts/${s.id}/apply`, { note: 'happy to help' }).expect(201)).body;
      expect(a1.status).toBe('applied');
      await post(ord, `/volunteers/shifts/${s.id}/apply`).expect(409);
      const told = await notes(coord.id, s.id);
      expect(told).toHaveLength(1);
      expect(told[0].message).not.toMatch(/Volunteer One/);
      const a2 = (await post(ord2, `/volunteers/shifts/${s.id}/apply`).expect(201)).body;

      // Only staff/coordinator decide; the applicant and other members cannot.
      await post(ord, `/volunteers/assignments/${a1.id}/decide`, { decision: 'approve' }).expect(403);
      await post(ord2, `/volunteers/assignments/${a1.id}/decide`, { decision: 'approve' }).expect(403);
      await post(chair, `/volunteers/assignments/${a1.id}/decide`, { decision: 'approve' }).expect(403);
      await post(ds2, `/volunteers/assignments/${a1.id}/decide`, { decision: 'approve' }).expect(403);
      await post(coord, `/volunteers/assignments/${a1.id}/decide`, { decision: 'maybe' }).expect(400);
      await post(coord, `/volunteers/assignments/${a1.id}/decide`, { decision: 'approve' }).expect(201);
      expect(await dbStatus(a1.id)).toBe('confirmed');
      expect(await notes(ord.id, s.id)).toHaveLength(1);
      // Capacity 1 is now full: the second approval is refused and the application stays pending.
      await post(coord, `/volunteers/assignments/${a2.id}/decide`, { decision: 'approve' }).expect(409);
      expect(await dbStatus(a2.id)).toBe('applied');
      await post(coord, `/volunteers/assignments/${a2.id}/decide`, { decision: 'reject' }).expect(201);
      expect(await dbStatus(a2.id)).toBe('rejected');
      await post(coord, `/volunteers/assignments/${a2.id}/decide`, { decision: 'reject' }).expect(409);
      // A rejected applicant cannot simply re-apply; only a manager can reinstate.
      await post(ord2, `/volunteers/shifts/${s.id}/apply`).expect(409);
    });

    it('only opportunities that are open accept applications; hidden ones do not exist for members', async () => {
      const draft = await mkOpp({ status: 'draft' });
      const ds = await mkShift(draft.id);
      await post(ord, `/volunteers/shifts/${ds.id}/apply`).expect(404);
      const closed = await mkOpp();
      const cs = await mkShift(closed.id);
      await post(sec, `/volunteers/opportunities/${closed.id}/status`, { status: 'closed' }).expect(201);
      await post(ord, `/volunteers/shifts/${cs.id}/apply`).expect(404); // closed = not visible to members
      const pastS = await pastShift((await mkOpp()).id, 2, 3);
      await post(ord, `/volunteers/shifts/${pastS.id}/apply`).expect(409);
    });

    it('withdraw: own assignments only, before the shift starts; a withdrawn volunteer may re-apply', async () => {
      const opp = await mkOpp({ coordinatorMemberId: mc.id });
      const s = await mkShift(opp.id);
      const a = (await post(ord, `/volunteers/shifts/${s.id}/apply`).expect(201)).body;
      await post(ord2, `/volunteers/assignments/${a.id}/withdraw`).expect(404); // somebody else's
      await post(coord, `/volunteers/assignments/${a.id}/withdraw`).expect(404); // coordinators cancel, they don't withdraw for others
      await post(ord, `/volunteers/assignments/${a.id}/withdraw`).expect(201);
      expect(await dbStatus(a.id)).toBe('withdrawn');
      await post(ord, `/volunteers/assignments/${a.id}/withdraw`).expect(409);
      const again = (await post(ord, `/volunteers/shifts/${s.id}/apply`).expect(201)).body;
      expect(again.id).toBe(a.id); // same row re-activated: one row per (shift, member)
      expect(again.status).toBe('applied');
      // confirmed volunteer withdrawing tells the coordinator
      await post(coord, `/volunteers/assignments/${a.id}/decide`, { decision: 'approve' }).expect(201);
      const before = (await notes(coord.id, s.id)).length;
      await post(ord, `/volunteers/assignments/${a.id}/withdraw`).expect(201);
      expect((await notes(coord.id, s.id)).length).toBe(before + 1);
      // after the start there is nothing to withdraw from
      const ps = await pastShift(opp.id, 2, 3);
      const pa = await seedAssignment(ps.id, m1.id, 'confirmed');
      await post(ord, `/volunteers/assignments/${pa.id}/withdraw`).expect(409);
    });
  });

  describe('direct assignment', () => {
    it('managers assign anyone in the fellowship; department leaders only their own members; coordinators cannot look members up', async () => {
      const opp = await mkOpp({ departmentId: D1.id, coordinatorMemberId: mc.id });
      const s = await mkShift(opp.id, { capacity: 5 });
      const a = (await post(ds1, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id, note: 'front door' }).expect(201)).body;
      expect(a.status).toBe('confirmed');
      expect((await notes(ord.id, s.id))[0].message).toBe('You have been assigned to a service shift.');
      await post(ds1, `/volunteers/shifts/${s.id}/assign`, { memberId: m2.id }).expect(403); // m2 is in D2
      await post(ds2, `/volunteers/shifts/${s.id}/assign`, { memberId: m2.id }).expect(403); // not their opportunity
      await post(coord, `/volunteers/shifts/${s.id}/assign`, { memberId: m3.id }).expect(403);
      await post(ord, `/volunteers/shifts/${s.id}/assign`, { memberId: m3.id }).expect(403);
      await post(chair, `/volunteers/shifts/${s.id}/assign`, { memberId: m3.id }).expect(403);
      await post(asst, `/volunteers/shifts/${s.id}/assign`, { memberId: m2.id }).expect(201);
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id }).expect(409); // already on the roster
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: mB.id }).expect(404); // foreign member
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: 'nope' }).expect(400);
      await post(sec, `/volunteers/shifts/${s.id}/assign`, {}).expect(400);
      const roster = (await get(coord, `/volunteers/shifts/${s.id}/assignments`).expect(200)).body;
      expect(roster).toHaveLength(2);
      expect(Object.keys(roster[0].member).sort()).toEqual(['full_name', 'id']); // no phone/e-mail/profile
      await get(ds2, `/volunteers/shifts/${s.id}/assignments`).expect(403);
      expect(await prisma.auditLog.count({ where: { entity_id: s.id, action: 'volunteer.assign' } })).toBe(2);
    });

    it('a manager can reinstate a rejected, cancelled or withdrawn volunteer', async () => {
      const opp = await mkOpp({ coordinatorMemberId: mc.id });
      const s = await mkShift(opp.id, { capacity: 3 });
      const a = (await post(ord, `/volunteers/shifts/${s.id}/apply`).expect(201)).body;
      await post(coord, `/volunteers/assignments/${a.id}/decide`, { decision: 'reject' }).expect(201);
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id }).expect(201);
      expect(await dbStatus(a.id)).toBe('confirmed');
      await post(coord, `/volunteers/assignments/${a.id}/cancel`).expect(201);
      expect(await notes(ord.id, s.id, 'volunteer_update')).not.toHaveLength(0);
      await post(coord, `/volunteers/assignments/${a.id}/cancel`).expect(409);
      await post(ord, `/volunteers/assignments/${a.id}/cancel`).expect(403);
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id }).expect(201);
      expect(await dbStatus(a.id)).toBe('confirmed');
    });
  });

  describe('conflicts and concurrency', () => {
    it('a member cannot hold two overlapping confirmed shifts; back-to-back is fine', async () => {
      const opp = await mkOpp();
      const A = await mkShift(opp.id, { startsAt: at(100), endsAt: at(102), capacity: 5 });
      const B = await mkShift(opp.id, { startsAt: at(101), endsAt: at(103), capacity: 5 });
      const C = await mkShift(opp.id, { startsAt: at(102), endsAt: at(104), capacity: 5 });
      await post(sec, `/volunteers/shifts/${A.id}/assign`, { memberId: m3.id }).expect(201);
      const clash = await post(sec, `/volunteers/shifts/${B.id}/assign`, { memberId: m3.id }).expect(409);
      expect(clash.body.message).toMatch(/conflicting/);
      await post(sec, `/volunteers/shifts/${C.id}/assign`, { memberId: m3.id }).expect(201);
      // the same rule applies to self-service applications (checked at apply and again at approval)
      const A2 = await mkShift(opp.id, { startsAt: at(200), endsAt: at(202), capacity: 5 });
      const B2 = await mkShift(opp.id, { startsAt: at(201), endsAt: at(203), capacity: 5 });
      const a = (await post(ord, `/volunteers/shifts/${A2.id}/apply`).expect(201)).body;
      const b = (await post(ord, `/volunteers/shifts/${B2.id}/apply`).expect(201)).body; // pending applications do not block each other
      await post(sec, `/volunteers/assignments/${a.id}/decide`, { decision: 'approve' }).expect(201);
      await post(sec, `/volunteers/assignments/${b.id}/decide`, { decision: 'approve' }).expect(409);
      expect(await dbStatus(b.id)).toBe('applied');
      // once the first is cancelled the second can be approved
      await post(sec, `/volunteers/assignments/${a.id}/cancel`).expect(201);
      await post(sec, `/volunteers/assignments/${b.id}/decide`, { decision: 'approve' }).expect(201);
    });

    it('capacity holds under concurrency: 6 simultaneous assignments into 2 places -> exactly 2 win', async () => {
      const opp = await mkOpp();
      const s = await mkShift(opp.id, { capacity: 2 });
      const members = await Promise.all(Array.from({ length: 6 }, (_, i) => makeMember(prisma, { fellowshipId: fA.id, name: `Racer ${i}` })));
      const results = await Promise.all(members.map((m) => post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m.id })));
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 201, 409, 409, 409, 409]);
      expect(await prisma.serviceAssignment.count({ where: { shift_id: s.id, status: 'confirmed' } })).toBe(2);
    });

    it('a member cannot be double-booked by two simultaneous requests for overlapping shifts', async () => {
      const opp = await mkOpp();
      const s1 = await mkShift(opp.id, { startsAt: at(300), endsAt: at(302), capacity: 5 });
      const s2 = await mkShift(opp.id, { startsAt: at(301), endsAt: at(303), capacity: 5 });
      const m = await makeMember(prisma, { fellowshipId: fA.id, name: 'Double Booked' });
      const results = await Promise.all([post(sec, `/volunteers/shifts/${s1.id}/assign`, { memberId: m.id }), post(asst, `/volunteers/shifts/${s2.id}/assign`, { memberId: m.id })]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.serviceAssignment.count({ where: { member_id: m.id, status: 'confirmed' } })).toBe(1);
    });

    it('two concurrent decisions on one application: one wins, the other gets 409', async () => {
      const opp = await mkOpp({ coordinatorMemberId: mc.id });
      const s = await mkShift(opp.id, { capacity: 3 });
      const a = (await post(ord, `/volunteers/shifts/${s.id}/apply`).expect(201)).body;
      const r = await Promise.all([post(coord, `/volunteers/assignments/${a.id}/decide`, { decision: 'approve' }), post(sec, `/volunteers/assignments/${a.id}/decide`, { decision: 'reject' })]);
      expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    });
  });

  describe('service attendance and history', () => {
    it('only a confirmed volunteer of a started shift can be marked; attended is final and links to the activity once', async () => {
      const opp = await mkOpp({ coordinatorMemberId: mc.id });
      const act = await makeActivity(prisma, { fellowshipId: fA.id });
      const started = await pastShift(opp.id, 3, 2, 3, fA.id, { activity_id: act.id });
      const upcoming = await mkShift(opp.id);
      const att = await seedAssignment(started.id, m1.id, 'confirmed');
      const nos = await seedAssignment(started.id, m2.id, 'confirmed');
      const pend = await seedAssignment(started.id, m3.id, 'applied');
      const fut = (await post(sec, `/volunteers/shifts/${upcoming.id}/assign`, { memberId: m1.id }).expect(201)).body;

      await post(ord, `/volunteers/assignments/${att.id}/attendance`, { outcome: 'attended' }).expect(403);
      await post(ds2, `/volunteers/assignments/${att.id}/attendance`, { outcome: 'attended' }).expect(403);
      await post(coord, `/volunteers/assignments/${att.id}/attendance`, { outcome: 'present' }).expect(400);
      await post(coord, `/volunteers/assignments/${fut.id}/attendance`, { outcome: 'attended' }).expect(409); // not started
      await post(coord, `/volunteers/assignments/${pend.id}/attendance`, { outcome: 'attended' }).expect(409); // never confirmed
      await post(coord, `/volunteers/assignments/${att.id}/attendance`, { outcome: 'attended' }).expect(201);
      await post(coord, `/volunteers/assignments/${att.id}/attendance`, { outcome: 'attended' }).expect(409);
      await post(coord, `/volunteers/assignments/${att.id}/attendance`, { outcome: 'no_show' }).expect(409); // attended is final
      expect(await prisma.attendance.count({ where: { activity_id: act.id, member_id: m1.id } })).toBe(1);

      // a wrongly recorded no-show can be corrected once; the activity attendance is then recorded exactly once
      await post(coord, `/volunteers/assignments/${nos.id}/attendance`, { outcome: 'no_show' }).expect(201);
      await post(coord, `/volunteers/assignments/${nos.id}/attendance`, { outcome: 'attended' }).expect(201);
      expect(await prisma.attendance.count({ where: { activity_id: act.id, member_id: m2.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entity_id: nos.id, action: 'volunteer.attendance' } })).toBe(2);
    });

    it('a member\'s own service history has correct totals; others need volunteer.history_view', async () => {
      const u = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      const m = await makeMember(prisma, { fellowshipId: fA.id, name: 'History Person', userId: u.id });
      const opp = await mkOpp({ title: 'History opp', departmentId: D1.id });
      const s1 = await pastShift(opp.id, 30, 2);
      const s2 = await pastShift(opp.id, 20, 3);
      const s3 = await mkShift(opp.id);
      await seedAssignment(s1.id, m.id, 'attended');
      await seedAssignment(s2.id, m.id, 'no_show');
      await post(sec, `/volunteers/shifts/${s3.id}/assign`, { memberId: m.id }).expect(201);

      const mine = (await get(u, '/volunteers/my-service').expect(200)).body;
      expect(mine.totals).toEqual({ attended: 1, noShow: 1, upcoming: 1, hoursServed: 2 });
      expect(mine.items).toHaveLength(3);
      expect(mine.items[0].opportunity.title).toBe('History opp');
      await get(loner, '/volunteers/my-service').expect(404);
      await get(ord, '/volunteers/my-service').expect(200); // only ever their own member record

      const asSec = (await get(sec, `/volunteers/members/${m.id}/history`).expect(200)).body;
      expect(asSec.totals).toEqual(mine.totals);
      expect(asSec.member.fullName).toBe('History Person');
      for (const denied of [chair, treas, ds1, ord, gl, coord]) await get(denied, `/volunteers/members/${m.id}/history`).expect(403);
      await get(asst, `/volunteers/members/${m.id}/history`).expect(200);
      expect(await prisma.auditLog.count({ where: { entity_id: m.id, action: 'volunteer.history_view' } })).toBe(2);
    });
  });

  describe('reports (aggregates only)', () => {
    let fR: any, DR1: any, DR2: any, secR: any, chairR: any, dsR1: any, dsR2: any, ordR: any;
    beforeAll(async () => {
      fR = await makeFellowship(prisma, 'VR');
      DR1 = await makeDepartment(prisma, fR.id, 'VR1');
      DR2 = await makeDepartment(prisma, fR.id, 'VR2');
      const mk = (roles: string[], departmentId?: string) => makeUser(prisma, { fellowshipId: fR.id, roles, departmentId });
      secR = await mk(['secretary']);
      chairR = await mk(['chairperson']);
      dsR1 = await mk(['department_secretary'], DR1.id);
      dsR2 = await mk(['department_secretary'], DR2.id);
      ordR = await mk(['ordinary_member']);
      const [x, y, z] = await Promise.all(['Vol X', 'Vol Y', 'Vol Z'].map((n) => makeMember(prisma, { fellowshipId: fR.id, name: `Secret ${n}` })));
      const oA = await prisma.serviceOpportunity.create({ data: { fellowship_id: fR.id, department_id: DR1.id, title: 'Opp A', status: 'open', created_by: randomUUID() } });
      const oB = await prisma.serviceOpportunity.create({ data: { fellowship_id: fR.id, department_id: DR2.id, title: 'Opp B', status: 'open', created_by: randomUUID() } });
      const a1 = await pastShift(oA.id, 72, 2, 2, fR.id);
      const a2 = await pastShift(oA.id, 48, 3, 1, fR.id);
      const b1 = await pastShift(oB.id, 24, 4, 1, fR.id);
      await seedAssignment(a1.id, x.id, 'attended', fR.id);
      await seedAssignment(a1.id, y.id, 'no_show', fR.id);
      await seedAssignment(a2.id, x.id, 'attended', fR.id);
      await seedAssignment(b1.id, z.id, 'attended', fR.id);
      // one upcoming, unfilled shift
      await prisma.serviceShift.create({ data: { fellowship_id: fR.id, opportunity_id: oA.id, starts_at: new Date(Date.now() + 48 * H), ends_at: new Date(Date.now() + 50 * H), capacity: 2, created_by: randomUUID() } });
    });

    it('fellowship-wide figures are correct for managers and chairs, with no personal data', async () => {
      for (const u of [secR, chairR]) {
        const r = (await get(u, '/volunteers/reports/summary').expect(200)).body;
        expect(r.scope).toBe('fellowship');
        expect(r.assignments).toMatchObject({ attended: 3, no_show: 1 });
        expect(r.participation).toEqual({ volunteers: 2, hoursServed: 9, attendanceRate: 75, fillRate: 75 });
        const dep = (id: string) => r.byDepartment.find((d: any) => d.departmentId === id);
        expect(dep(DR1.id)).toMatchObject({ attended: 2, hours: 5, volunteers: 1, shifts: 2 });
        expect(dep(DR2.id)).toMatchObject({ attended: 1, hours: 4, volunteers: 1, shifts: 1 });
        expect(r.byOpportunity.map((o: any) => o.title).sort()).toEqual(['Opp A', 'Opp B']);
        expect(r.upcoming).toEqual({ next14Days: 1, unfilled: 1 });
        expect(JSON.stringify(r)).not.toMatch(/Secret Vol/);
      }
    });

    it('department leaders see only their own department; others are refused; other tenants see nothing', async () => {
      const r1 = (await get(dsR1, '/volunteers/reports/summary').expect(200)).body;
      expect(r1.scope).toBe('department');
      expect(r1.participation.hoursServed).toBe(5);
      expect(r1.byOpportunity.map((o: any) => o.title)).toEqual(['Opp A']);
      const r2 = (await get(dsR2, '/volunteers/reports/summary').expect(200)).body;
      expect(r2.participation.hoursServed).toBe(4);
      expect(r2.byOpportunity.map((o: any) => o.title)).toEqual(['Opp B']);
      for (const u of [ordR, ord, gl, treas]) await get(u, '/volunteers/reports/summary').expect(403);
      const other = (await get(secB, '/volunteers/reports/summary').expect(200)).body;
      expect(other.participation.hoursServed).toBe(0);
      expect(other.byOpportunity).toEqual([]);
      // platform accounts are not part of any fellowship's reporting
      await get(admin, `/volunteers/reports/summary?fellowshipId=${fR.id}`).expect(403);
    });

    it('validates the reporting window', async () => {
      await get(secR, '/volunteers/reports/summary?from=garbage').expect(400);
      await get(secR, `/volunteers/reports/summary?from=${at(5)}&to=${at(-5)}`).expect(400);
      await get(secR, `/volunteers/reports/summary?from=2000-02-01&to=${at(0)}`).expect(400);
      await get(secR, '/volunteers/reports/summary?fellowshipId=nope').expect(400);
    });
  });

  describe('skills-based suggestions', () => {
    it('match role skills against member profiles, gated by profile permission and department scope', async () => {
      const role = (await post(sec, '/volunteers/roles', { name: `Sound ${uniq()}`, requiredSkills: ['Sound Desk', 'audio'] }).expect(201)).body;
      const plain = (await post(sec, '/volunteers/roles', { name: `Plain ${uniq()}` }).expect(201)).body;
      await prisma.memberProfile.create({ data: { member_id: m1.id, fellowship_id: fA.id, skills: ['sound desk'] } });
      await prisma.memberProfile.create({ data: { member_id: m2.id, fellowship_id: fA.id, service_interests: ['audio'] } });
      await prisma.memberProfile.create({ data: { member_id: m3.id, fellowship_id: fA.id, skills: ['cooking'] } });
      const opp = await mkOpp({ departmentId: D1.id, coordinatorMemberId: mc.id });
      const s = await mkShift(opp.id, { roleId: role.id, capacity: 5 });
      const plainShift = await mkShift(opp.id, { roleId: plain.id });

      const all = (await get(sec, `/volunteers/shifts/${s.id}/suggestions`).expect(200)).body;
      expect(all.candidates.map((c: any) => c.memberId).sort()).toEqual([m1.id, m2.id].sort());
      expect(all.candidates.find((c: any) => c.memberId === m1.id).matched).toEqual(['sound desk']);
      const dept = (await get(ds1, `/volunteers/shifts/${s.id}/suggestions`).expect(200)).body;
      expect(dept.candidates.map((c: any) => c.memberId)).toEqual([m1.id]); // only members of D1
      expect((await get(sec, `/volunteers/shifts/${plainShift.id}/suggestions`).expect(200)).body.candidates).toEqual([]);
      for (const denied of [coord, ord, chair, treas, gl]) await get(denied, `/volunteers/shifts/${s.id}/suggestions`).expect(403);
      await get(ds2, `/volunteers/shifts/${s.id}/suggestions`).expect(403);
      await get(secB, `/volunteers/shifts/${s.id}/suggestions`).expect(403);

      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m1.id }).expect(201);
      const after = (await get(sec, `/volunteers/shifts/${s.id}/suggestions`).expect(200)).body;
      expect(after.candidates.map((c: any) => c.memberId)).toEqual([m2.id]); // already placed -> excluded
      expect(JSON.stringify(after)).not.toMatch(/cooking/);
    });
  });

  describe('reminders', () => {
    it('remind confirmed volunteers once, neutrally, and only for managers', async () => {
      const opp = await mkOpp();
      const s = await mkShift(opp.id, { startsAt: at(10), endsAt: at(12) });
      await post(sec, `/volunteers/shifts/${s.id}/assign`, { memberId: m2.id }).expect(201);
      const far = await mkShift(opp.id, { startsAt: at(400), endsAt: at(402) });
      await post(sec, `/volunteers/shifts/${far.id}/assign`, { memberId: m3.id }).expect(201);
      for (const denied of [ord, chair, ds1, coord]) await post(denied, '/volunteers/reminders/run').expect(403);
      const first = (await post(sec, '/volunteers/reminders/run').expect(201)).body;
      expect(first.sent).toBeGreaterThanOrEqual(1);
      const n = await notes(ord2.id, s.id, 'volunteer_reminder');
      expect(n).toHaveLength(1);
      expect(n[0].message).toBe('You are scheduled to serve within the next 24 hours.');
      expect(await notes(ord2.id, far.id, 'volunteer_reminder')).toHaveLength(0);
      const second = (await post(asst, '/volunteers/reminders/run').expect(201)).body;
      expect(second.sent).toBe(0);
      expect(await notes(ord2.id, s.id, 'volunteer_reminder')).toHaveLength(1);
      // another fellowship's manager never reminds (or sees) this fellowship's volunteers
      const b = (await post(secB, '/volunteers/reminders/run').expect(201)).body;
      expect(b.candidates).toBe(0);
    });
  });
});
