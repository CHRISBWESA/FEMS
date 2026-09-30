import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { addToDepartment, api, createTestApp, describeDb, getPrisma, makeActivity, makeDepartment, makeFellowship, makeMember, makeUser } from './harness';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const midMonth = (monthsAgo: number) => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - monthsAgo, 15, 12)); };
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

describeDb('Phase 18 - analytics & dashboards (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, D1: any, D2: any, DB: any;
  let sec: any, asst: any, chair: any, treas: any, ds1: any, ds2: any, ord: any, gl: any, admin: any, secB: any;
  let a1: any, a2: any, a3: any, a4: any, i1: any, g1: any;
  let E1: any, E2: any, E3: any, EB: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const att = (activityId: string, data: object, fellowshipId = fA.id) => prisma.attendance.create({ data: { activity_id: activityId, fellowship_id: fellowshipId, ...data } as any });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'AA');
    fB = await makeFellowship(prisma, 'AB');
    D1 = await makeDepartment(prisma, fA.id, 'AD1');
    D2 = await makeDepartment(prisma, fA.id, 'AD2');
    DB = await makeDepartment(prisma, fB.id, 'ADB');
    const mk = (roles: string[], departmentId?: string) => makeUser(prisma, { fellowshipId: fA.id, roles, departmentId });
    sec = await mk(['secretary']);
    asst = await mk(['assistant_secretary']);
    chair = await mk(['chairperson']);
    treas = await mk(['treasurer']);
    ds1 = await mk(['department_secretary'], D1.id);
    ds2 = await mk(['department_secretary'], D2.id);
    ord = await mk(['ordinary_member']);
    gl = await mk(['gender_leader']);
    admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });

    // membership: 4 active (one without a department), 1 inactive, 1 graduated
    const mkM = (name: string, status: 'active' | 'inactive' | 'graduated' = 'active') => makeMember(prisma, { fellowshipId: fA.id, name, status });
    a1 = await mkM('Alice Analytics'); a2 = await mkM('Bob Analytics'); a3 = await mkM('Cara Analytics'); a4 = await mkM('Dan Analytics');
    i1 = await mkM('Ivy Inactive', 'inactive'); g1 = await mkM('Gus Graduated', 'graduated');
    await addToDepartment(prisma, a1.id, D1.id); await addToDepartment(prisma, a2.id, D1.id); await addToDepartment(prisma, i1.id, D1.id);
    await addToDepartment(prisma, a3.id, D2.id);
    const hist = (m: any, event_type: any, occurred_at: Date, extra: object = {}) => prisma.membershipHistory.create({ data: { member_id: m.id, fellowship_id: fA.id, event_type, occurred_at, ...extra } });
    await hist(a1, 'registered', midMonth(0)); await hist(a2, 'registered', midMonth(0)); await hist(a3, 'registered', midMonth(2));
    await hist(i1, 'status_changed', midMonth(0), { from_status: 'active', to_status: 'inactive' });
    await hist(g1, 'status_changed', midMonth(1), { from_status: 'active', to_status: 'graduated' });

    // events + attendance
    E1 = await makeActivity(prisma, { fellowshipId: fA.id, departmentId: D1.id, title: 'E1 dept one' });
    E2 = await makeActivity(prisma, { fellowshipId: fA.id, title: 'E2 all members' });
    E3 = await makeActivity(prisma, { fellowshipId: fA.id, departmentId: D2.id, title: 'E3 dept two' });
    EB = await makeActivity(prisma, { fellowshipId: fB.id, title: 'EB foreign' });
    await prisma.activity.update({ where: { id: E1.id }, data: { date: daysAgo(10) } });
    await prisma.activity.update({ where: { id: E2.id }, data: { date: daysAgo(40) } });
    await prisma.activity.update({ where: { id: E3.id }, data: { date: daysAgo(5) } });
    const old = await makeActivity(prisma, { fellowshipId: fA.id, title: 'Old event' });
    await prisma.activity.update({ where: { id: old.id }, data: { date: daysAgo(400) } });
    await att(old.id, { member_id: a1.id });
    await att(E1.id, { member_id: a1.id }); await att(E1.id, { member_id: a1.id }); // duplicate row counts once
    await att(E1.id, { member_id: a2.id });
    await att(E1.id, { recorded_by_name: 'John Doe' }); await att(E1.id, { recorded_by_name: ' john doe ' }); // same person, name-only
    await att(E2.id, { member_id: a3.id }); await att(E2.id, { recorded_by_name: 'Mary Marker' });
    await att(E3.id, { member_id: a3.id });
    await att(EB.id, { member_id: (await makeMember(prisma, { fellowshipId: fB.id })).id }, fB.id);
    // youth attendance is privileged and must never be counted here
    const yp = await prisma.youthProfile.create({ data: { fellowship_id: fA.id, full_name: 'Secret Youth', date_of_birth: new Date('2012-01-01'), department_id: D1.id, created_by: randomUUID() } });
    await att(E1.id, { youth_profile_id: yp.id, recorded_by_name: 'Secret Youth' });
    await prisma.youthProfile.create({ data: { fellowship_id: fA.id, full_name: 'Inactive Youth', date_of_birth: new Date('2010-01-01'), status: 'inactive', created_by: randomUUID() } });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('dashboard (the pre-existing endpoint) is tenant-scoped', () => {
    it('shows each caller only their own fellowship\'s totals; the platform admin sees platform figures only', async () => {
      const mine = await prisma.member.count({ where: { fellowship_id: fA.id } });
      const theirs = await prisma.member.count({ where: { fellowship_id: fB.id } });
      const global = await prisma.member.count();
      expect(theirs).toBeGreaterThan(0);
      expect(global).toBeGreaterThan(mine); // otherwise the assertions below would prove nothing
      for (const u of [sec, ord, ds1, gl, treas]) {
        const r = (await get(u, '/dashboard').expect(200)).body;
        expect(r.totalMembers).toBe(mine);
        expect(r.totalDepartments).toBe(2);
        expect(r.totalActivities).toBe(await prisma.activity.count({ where: { fellowship_id: fA.id } }));
      }
      expect((await get(secB, '/dashboard').expect(200)).body.totalMembers).toBe(theirs);
      const adm = (await get(admin, '/dashboard').expect(200)).body;
      expect(adm.platform).toBe(true);
      expect(adm.totalMembers).toBeUndefined(); // no operational totals for platform accounts
      expect(adm.totalFellowships).toBeGreaterThanOrEqual(2);
      await api(app).get('/dashboard').expect(401);
    });
  });

  describe('authentication and access', () => {
    it('401 without a token; ordinary members and gender leaders are refused everywhere', async () => {
      for (const s of ['overview', 'membership', 'participation', 'finance', 'youth', 'resources', 'volunteers']) {
        await api(app).get(`/analytics/${s}`).expect(401);
        await get(ord, `/analytics/${s}`).expect(403);
        await get(gl, `/analytics/${s}`).expect(403);
      }
    });

    it('each section needs the permission of its source module', async () => {
      // membership / participation: member.reports_view (not the treasurer)
      for (const s of ['membership', 'participation']) {
        for (const u of [sec, asst, chair, ds1]) await get(u, `/analytics/${s}`).expect(200);
        await get(treas, `/analytics/${s}`).expect(403);
      }
      // finance: treasurer, chairs, secretaries and (department-scoped) leaders
      for (const u of [sec, chair, treas, ds1]) await get(u, '/analytics/finance').expect(200);
      // volunteers: reports_view (not the treasurer)
      for (const u of [sec, chair, ds1]) await get(u, '/analytics/volunteers').expect(200);
      await get(treas, '/analytics/volunteers').expect(403);
      // resources: viewers and department leaders
      for (const u of [sec, chair, treas, ds1]) await get(u, '/analytics/resources').expect(200);
      // youth: youth.reports_view
      await get(sec, '/analytics/youth').expect(200);
      await get(treas, '/analytics/youth').expect(403);
    });

    it('the overview lists only what the caller may see', async () => {
      const s = (await get(sec, '/analytics/overview').expect(200)).body;
      expect(s.available.sort()).toEqual(['finance', 'membership', 'participation', 'resources', 'volunteers', 'youth'].sort());
      expect(s.unavailable).toEqual([]);
      const t = (await get(treas, '/analytics/overview').expect(200)).body;
      expect(t.available.sort()).toEqual(['finance', 'resources']);
      expect(t.kpis.membership).toBeUndefined();
      expect(t.kpis.finance).toBeDefined();
      const d = (await get(ds1, '/analytics/overview').expect(200)).body;
      expect(d.scope).toBe('department');
      expect(d.available).toContain('membership');
    });
  });

  describe('membership analytics', () => {
    it('reports correct totals, growth and department distribution from the source tables', async () => {
      const r = (await get(sec, '/analytics/membership').expect(200)).body;
      expect(r.scope).toBe('fellowship');
      expect(r.totals).toEqual({ total: 6, active: 4, inactive: 1, graduated: 1 });
      const bucket = (m: number) => r.growth.find((g: any) => g.month === monthKey(midMonth(m)));
      expect(bucket(0)).toMatchObject({ registered: 2, deactivated: 1 });
      expect(bucket(1)).toMatchObject({ graduated: 1 });
      expect(bucket(2)).toMatchObject({ registered: 1 });
      expect(r.growth).toHaveLength(12);
      const d = (id: string) => r.byDepartment.find((x: any) => x.departmentId === id)?.activeMembers;
      expect(d(D1.id)).toBe(2); // the inactive member is not counted
      expect(d(D2.id)).toBe(1);
      expect(r.activeWithoutDepartment).toBe(1);
    });

    it('a department leader sees only their own department\'s members', async () => {
      const r = (await get(ds1, '/analytics/membership').expect(200)).body;
      expect(r.scope).toBe('department');
      expect(r.totals).toEqual({ total: 3, active: 2, inactive: 1, graduated: 0 });
      expect(r.byDepartment.map((x: any) => x.departmentId)).toEqual([D1.id]);
      expect(r.activeWithoutDepartment).toBeNull();
      const bucket0 = r.growth.find((g: any) => g.month === monthKey(midMonth(0)));
      expect(bucket0).toMatchObject({ registered: 2, deactivated: 1 });
      expect(r.growth.reduce((n: number, g: any) => n + g.graduated + (g.month === monthKey(midMonth(2)) ? g.registered : 0), 0)).toBe(0); // a3 / g1 belong to other groups
      // ...and cannot widen the view
      await get(ds1, `/analytics/membership?departmentId=${D2.id}`).expect(403);
      expect((await get(ds1, `/analytics/membership?departmentId=${D1.id}`).expect(200)).body.totals.total).toBe(3);
      const other = (await get(ds2, '/analytics/membership').expect(200)).body;
      expect(other.totals.total).toBe(1);
    });

    it('a fellowship-wide viewer can filter by department; other tenants see nothing', async () => {
      const r = (await get(chair, `/analytics/membership?departmentId=${D2.id}`).expect(200)).body;
      expect(r.scope).toBe('department-filter');
      expect(r.totals.total).toBe(1);
      const b = (await get(secB, '/analytics/membership').expect(200)).body;
      expect(b.totals.total).toBe(await prisma.member.count({ where: { fellowship_id: fB.id } }));
      await get(sec, `/analytics/membership?departmentId=${DB.id}`).expect(404); // another fellowship's department
      await get(secB, `/analytics/membership?departmentId=${D1.id}`).expect(404);
    });
  });

  describe('participation analytics', () => {
    it('counts events and attendance correctly: duplicates once, name-only deduplicated, youth excluded, window respected', async () => {
      const r = (await get(sec, '/analytics/participation').expect(200)).body;
      expect(r.totals).toMatchObject({ events: 3, memberLinked: 4, nameOnly: 2, attendanceRecords: 6, uniqueAttendees: 3, activeMembers: 4, participationRate: 75, averagePerEvent: 2, memberLinkedShare: 66.7 });
      const dep = (id: string | null) => r.byDepartment.find((x: any) => x.departmentId === id);
      expect(dep(D1.id)).toMatchObject({ events: 1, attendance: 3 });
      expect(dep(D2.id)).toMatchObject({ events: 1, attendance: 1 });
      expect(dep(null)).toMatchObject({ events: 1, attendance: 2 });
      expect(r.recentEvents.map((e: any) => e.title)).toEqual(['E3 dept two', 'E1 dept one', 'E2 all members']);
      expect(r.byAudience.map((x: any) => [x.audience, x.events]).sort()).toEqual([['all_members', 1], ['department', 2]]);
      expect(r.truncated).toBe(false);
      // a wider window brings the old event in
      const wide = (await get(sec, `/analytics/participation?from=${daysAgo(500).toISOString().slice(0, 10)}`).expect(200)).body;
      expect(wide.totals.events).toBe(4);
    });

    it('never exposes attendee names or youth data', async () => {
      const body = JSON.stringify((await get(chair, '/analytics/participation').expect(200)).body);
      for (const secret of ['John Doe', 'john doe', 'Mary Marker', 'Secret Youth', 'Alice Analytics']) expect(body).not.toContain(secret);
      const ov = JSON.stringify((await get(chair, '/analytics/overview').expect(200)).body);
      for (const secret of ['John Doe', 'Mary Marker', 'Secret Youth', 'Alice Analytics', '@test.local']) expect(ov).not.toContain(secret);
    });

    it('department leaders see only their department\'s events; departmentId filters for wide viewers', async () => {
      const r = (await get(ds1, '/analytics/participation').expect(200)).body;
      expect(r.scope).toBe('department');
      expect(r.totals).toMatchObject({ events: 1, memberLinked: 2, nameOnly: 1, uniqueAttendees: 2, activeMembers: 2, participationRate: 100 });
      expect(r.recentEvents.map((e: any) => e.title)).toEqual(['E1 dept one']);
      const f = (await get(sec, `/analytics/participation?departmentId=${D2.id}`).expect(200)).body;
      expect(f.totals.events).toBe(1);
      expect((await get(secB, '/analytics/participation').expect(200)).body.totals.events).toBe(1); // only its own foreign event
    });

    it('drill-down into one event is tenant- and department-scoped', async () => {
      const r = (await get(sec, `/analytics/participation?activityId=${E1.id}`).expect(200)).body;
      expect(r.event).toMatchObject({ id: E1.id, title: 'E1 dept one', memberLinked: 2, nameOnly: 1 });
      expect(r.event.attendeesByDepartment).toEqual([expect.objectContaining({ departmentId: D1.id, attendees: 2 })]);
      const mine = (await get(ds1, `/analytics/participation?activityId=${E1.id}`).expect(200)).body;
      expect(mine.event.attendeesByDepartment).toEqual([]); // no cross-department breakdown for leaders
      await get(ds1, `/analytics/participation?activityId=${E3.id}`).expect(403); // another department's event
      await get(ds2, `/analytics/participation?activityId=${E1.id}`).expect(403);
      await get(sec, `/analytics/participation?activityId=${EB.id}`).expect(403); // another fellowship's event
      await get(secB, `/analytics/participation?activityId=${E1.id}`).expect(403);
      await get(sec, `/analytics/participation?activityId=${randomUUID()}`).expect(404);
      await get(sec, '/analytics/participation?activityId=nope').expect(400);
      await get(sec, `/analytics/participation?departmentId=${D2.id}&activityId=${E1.id}`).expect(403); // the department filter cannot be bypassed
    });
  });

  describe('delegated sections keep the source module\'s rules', () => {
    it('youth aggregates come from the database and respect scope', async () => {
      const r = (await get(sec, '/analytics/youth').expect(200)).body;
      expect(r.totalParticipants).toBe(2);
      expect(r.activeParticipants).toBe(1);
      expect(r.byStatus.map((x: any) => [x.status, x.count]).sort()).toEqual([['active', 1], ['inactive', 1]]);
      await get(ds1, '/analytics/youth').expect(403); // youth.reports_view is not granted to department leaders (same as /youth/reports/summary)
      await get(ds1, '/youth/reports/summary').expect(403);
      expect((await get(ds1, '/analytics/overview').expect(200)).body.available).not.toContain('youth');
      expect(JSON.stringify(r)).not.toContain('Secret Youth');
      expect((await get(secB, '/analytics/youth').expect(200)).body.totalParticipants).toBe(0);
    });

    it('finance: fellowship viewers get contributions; department leaders never do; a financial period sets the window', async () => {
      const period = await prisma.financialPeriod.create({ data: { fellowship_id: fA.id, name: 'Test period', start_date: daysAgo(30), end_date: daysAgo(10), created_by: randomUUID() } });
      const c = (amount: number, date: Date) => prisma.contribution.create({ data: { member_id: a1.id, fellowship_id: fA.id, amount, contribution_type: 'tithe', date, recorded_by: randomUUID() } });
      await c(100, daysAgo(20)); await c(50, daysAgo(15)); await c(999, daysAgo(60)); // the last one is outside the period
      const r = (await get(treas, `/analytics/finance?periodId=${period.id}`).expect(200)).body;
      expect(r.period).toEqual({ id: period.id, name: 'Test period' });
      expect(r.contributions.total).toBe('150');
      expect(new Date(r.range.from).getTime()).toBe(period.start_date.getTime());
      const d = (await get(ds1, `/analytics/finance?periodId=${period.id}`).expect(200)).body;
      expect(d.scope).toBe('department');
      expect(d.contributions).toBeUndefined();
      expect(d.income).toBeUndefined();
      await get(secB, `/analytics/finance?periodId=${period.id}`).expect(404); // another fellowship's period
      await get(sec, `/analytics/finance?periodId=${randomUUID()}`).expect(404);
      await get(sec, '/analytics/finance?periodId=nope').expect(400);
      const ov = (await get(treas, `/analytics/overview?periodId=${period.id}`).expect(200)).body;
      expect(ov.kpis.finance.contributions).toBe('150');
      expect((await get(ds1, '/analytics/overview').expect(200)).body.kpis.finance.contributions).toBeUndefined();
    });

    it('resources and volunteers are tenant-scoped and department-scoped like their own modules', async () => {
      const r = (await get(sec, '/analytics/resources').expect(200)).body;
      expect(r.totals).toBeDefined();
      const v = (await get(chair, '/analytics/volunteers').expect(200)).body;
      expect(v.scope).toBe('fellowship');
      expect((await get(ds1, '/analytics/volunteers').expect(200)).body.scope).toBe('department');
    });
  });

  describe('filters and validation', () => {
    it('rejects malformed or abusive filters', async () => {
      const bad = [
        'from=garbage', 'to=garbage', `to=${new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10)}`, `from=${daysAgo(1).toISOString()}&to=${daysAgo(5).toISOString()}`, 'from=2000-01-01&to=2010-01-01',
        'months=0', 'months=37', 'months=abc', 'departmentId=nope', 'fellowshipId=nope', 'periodId=nope', 'activityId=nope',
      ];
      for (const q of bad) {
        await get(sec, `/analytics/overview?${q}`).expect(400);
        await get(sec, `/analytics/membership?${q}`).expect(400);
      }
      await get(sec, "/analytics/participation?from=2020-01-01' OR 1=1--").expect(400);
    });

    it('platform accounts have no analytics access; nobody can escape their own fellowship', async () => {
      await get(admin, '/analytics/membership').expect(403);
      await get(admin, `/analytics/membership?fellowshipId=${fA.id}`).expect(403);
      await get(admin, '/analytics/overview').expect(403);
      // a non-admin supplying another fellowship's id is still confined to their own
      const own = (await get(secB, `/analytics/membership?fellowshipId=${fA.id}`).expect(200)).body;
      expect(own.totals.total).toBe(await prisma.member.count({ where: { fellowship_id: fB.id } }));
      const part = (await get(secB, `/analytics/participation?fellowshipId=${fA.id}`).expect(200)).body;
      expect(part.recentEvents.map((e: any) => e.title)).toEqual(['EB foreign']);
    });
  });

  describe('performance sanity', () => {
    it('aggregates in the database: 40 events x 75 attendees stay fast and the response stays small', async () => {
      const fP = await makeFellowship(prisma, 'AP');
      const secP = await makeUser(prisma, { fellowshipId: fP.id, roles: ['secretary'] });
      const members = await Promise.all(Array.from({ length: 75 }, (_, i) => makeMember(prisma, { fellowshipId: fP.id, name: `Perf ${i}` })));
      const acts = await Promise.all(Array.from({ length: 40 }, (_, i) => makeActivity(prisma, { fellowshipId: fP.id, title: `Perf event ${i}` })));
      for (let i = 0; i < acts.length; i++) await prisma.activity.update({ where: { id: acts[i].id }, data: { date: daysAgo(i + 1) } });
      await prisma.attendance.createMany({ data: acts.flatMap((a) => members.map((m) => ({ activity_id: a.id, member_id: m.id, fellowship_id: fP.id }))) });
      const t0 = Date.now();
      const res = await get(secP, '/analytics/participation').expect(200);
      const ms = Date.now() - t0;
      expect(res.body.totals).toMatchObject({ events: 40, memberLinked: 3000, uniqueAttendees: 75 });
      expect(res.body.recentEvents).toHaveLength(20);
      expect(JSON.stringify(res.body).length).toBeLessThan(20_000);
      expect(ms).toBeLessThan(3000);
      const t1 = Date.now();
      await get(secP, '/analytics/overview').expect(200);
      expect(Date.now() - t1).toBeLessThan(5000);
    });
  });
});
