import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { api, createTestApp, describeDb, getPrisma, makeActivity, makeDepartment, makeFellowship, makeMember, makeUser } from './harness';

const DAY = 86_400_000;

describeDb('Phase 21 - offline attendance sync (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any;
  let sec: any, asst: any, chair: any, treas: any, ds: any, ord: any, secB: any, admin: any;
  let m1: any, m2: any, m3: any, mB: any;
  let act: any, actB: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const op = (memberId: string, extra: object = {}) => ({ opId: randomUUID(), memberId, ...extra });
  const rows = (activityId: string) => prisma.attendance.findMany({ where: { activity_id: activityId, member_id: { not: null } } });
  const syncTo = (u: any, activityId: string, ops: object[]) => post(u, `/activities/${activityId}/attendance/sync`, { ops });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'OA');
    fB = await makeFellowship(prisma, 'OB');
    const D = await makeDepartment(prisma, fA.id, 'OD');
    const mk = (roles: string[], f = fA, dept?: string) => makeUser(prisma, { fellowshipId: f.id, roles, departmentId: dept });
    sec = await mk(['secretary']); asst = await mk(['assistant_secretary']); chair = await mk(['chairperson']); treas = await mk(['treasurer']);
    ds = await mk(['department_secretary'], fA, D.id); ord = await mk(['ordinary_member']); secB = await mk(['secretary'], fB);
    admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    m1 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Anna Offline' });
    m2 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Ben Offline' });
    m3 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Cleo Offline' });
    mB = await makeMember(prisma, { fellowshipId: fB.id, name: 'Foreign Person' });
    await prisma.member.update({ where: { id: m1.id }, data: { phone: '0700-private', email: 'anna@private.test' } });
    act = await makeActivity(prisma, { fellowshipId: fA.id, title: 'Sunday service' });
    actB = await makeActivity(prisma, { fellowshipId: fB.id, title: 'Foreign service' });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('access', () => {
    it('401 without a token; only roles holding activity.attendance may use either endpoint', async () => {
      await api(app).get(`/activities/${act.id}/attendance/roster`).expect(401);
      await api(app).post(`/activities/${act.id}/attendance/sync`, { ops: [op(m1.id)] }).expect(401);
      for (const u of [chair, treas, ds, ord, admin]) {
        await get(u, `/activities/${act.id}/attendance/roster`).expect(403);
        await syncTo(u, act.id, [op(m1.id)]).expect(403);
      }
      expect(await rows(act.id)).toHaveLength(0);
      await get(sec, `/activities/${act.id}/attendance/roster`).expect(200);
      await get(asst, `/activities/${act.id}/attendance/roster`).expect(200);
    });

    it('another fellowship\'s activity is off limits; garbage and unknown ids are 404', async () => {
      await get(secB, `/activities/${act.id}/attendance/roster`).expect(403);
      await syncTo(secB, act.id, [op(mB.id)]).expect(403);
      await get(sec, `/activities/${actB.id}/attendance/roster`).expect(403);
      await syncTo(sec, actB.id, [op(m1.id)]).expect(403);
      for (const id of ['nope', randomUUID()]) {
        await get(sec, `/activities/${id}/attendance/roster`).expect(404);
        await syncTo(sec, id, [op(m1.id)]).expect(404);
      }
      expect(await rows(actB.id)).toHaveLength(0);
    });
  });

  describe('roster download', () => {
    it('gives a device only id + name + code of its own fellowship\'s members, and who is already in', async () => {
      await prisma.attendance.create({ data: { activity_id: act.id, member_id: m3.id, recorded_by_name: 'Cleo Offline', fellowship_id: fA.id } });
      const r = (await get(sec, `/activities/${act.id}/attendance/roster`).expect(200)).body;
      expect(r.activity).toMatchObject({ id: act.id, title: 'Sunday service' });
      expect(r.members.map((m: any) => m.fullName)).toEqual(expect.arrayContaining(['Anna Offline', 'Ben Offline', 'Cleo Offline']));
      expect(r.members.some((m: any) => m.fullName === 'Foreign Person')).toBe(false);
      expect(Object.keys(r.members[0]).sort()).toEqual(['fullName', 'id', 'memberCode']);
      expect(JSON.stringify(r)).not.toMatch(/0700-private|anna@private|gender|phone|email|status/i);
      expect(r.recorded).toEqual([m3.id]);
      expect(r.truncated).toBe(false);
      const audit = await prisma.auditLog.findFirst({ where: { entity_id: act.id, action: 'activity.attendance_roster_download', user_id: sec.id } });
      expect(audit).not.toBeNull();
      expect(JSON.stringify(audit)).not.toContain('Anna');
    });
  });

  describe('sync', () => {
    it('applies each operation once, however often the same batch arrives', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      const batch = [op(m1.id), op(m2.id)];
      const first = (await syncTo(sec, a.id, batch).expect(201)).body;
      expect(first.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
      expect(first.summary).toEqual({ applied: 2, duplicate: 0, already_recorded: 0, rejected: 0 });
      expect(await rows(a.id)).toHaveLength(2);
      for (let i = 0; i < 3; i++) {
        const again = (await syncTo(sec, a.id, batch).expect(201)).body;
        expect(again.results.map((r: any) => r.status)).toEqual(['duplicate', 'duplicate']);
        expect(again.results[0].previous).toBe('applied');
      }
      expect(await rows(a.id)).toHaveLength(2);
      expect(await prisma.attendanceSyncOp.count({ where: { activity_id: a.id } })).toBe(2);
    });

    it('recognises members already recorded (by anyone, any way), rejects unknown or foreign ones, and dedupes inside a batch', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      await prisma.attendance.create({ data: { activity_id: a.id, member_id: m1.id, fellowship_id: fA.id, recorded_by_name: 'x' } });
      const dup = op(m2.id);
      const res = (await syncTo(sec, a.id, [op(m1.id), dup, dup, op(mB.id), op(randomUUID()), op(m3.id)]).expect(201)).body;
      expect(res.results.map((r: any) => r.status)).toEqual(['already_recorded', 'applied', 'duplicate', 'rejected', 'rejected', 'applied']);
      expect(res.results[3].reason).toBe('member_not_found'); // a foreign member is indistinguishable from an unknown one
      expect(res.results[4].reason).toBe('member_not_found');
      expect((await rows(a.id)).map((r) => r.member_id).sort()).toEqual([m1.id, m2.id, m3.id].sort());
      // a rejected operation is final: replaying it returns the same verdict rather than "trying again"
      const replay = (await syncTo(sec, a.id, [{ opId: res.results[3].opId, memberId: mB.id }]).expect(201)).body;
      expect(replay.results[0]).toMatchObject({ status: 'duplicate', previous: 'rejected' });
    });

    it('two devices/users recording the same member: exactly one attendance row', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      const r = await Promise.all([syncTo(sec, a.id, [op(m1.id)]), syncTo(asst, a.id, [op(m1.id)]), syncTo(sec, a.id, [op(m1.id)])]);
      expect(r.every((x) => x.status === 201)).toBe(true);
      const statuses = r.map((x) => x.body.results[0].status).sort();
      expect(statuses).toEqual(['already_recorded', 'already_recorded', 'applied']);
      expect(await rows(a.id)).toHaveLength(1);
    });

    it('two simultaneous deliveries of the same batch: each operation applied once', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      const batch = [op(m1.id), op(m2.id), op(m3.id)];
      const r = await Promise.all([syncTo(sec, a.id, batch), syncTo(sec, a.id, batch)]);
      expect(r.every((x) => x.status === 201)).toBe(true);
      const all = r.flatMap((x) => x.body.results.map((y: any) => y.status));
      expect(all.filter((s: string) => s === 'applied')).toHaveLength(3);
      expect(all.filter((s: string) => s === 'duplicate')).toHaveLength(3);
      expect(await rows(a.id)).toHaveLength(3);
    });

    it('an operation id is scoped to the user who created it', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      const shared = op(m1.id);
      await syncTo(sec, a.id, [shared]).expect(201);
      // another user replaying the same id is a different operation: it is judged on its own merits
      const other = (await syncTo(asst, a.id, [shared]).expect(201)).body;
      expect(other.results[0].status).toBe('already_recorded');
      expect(await prisma.attendanceSyncOp.count({ where: { op_id: shared.opId } })).toBe(2);
    });

    it('uses the device\'s time for old check-ins, but never a stale or future one', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      const three = new Date(Date.now() - 3 * DAY);
      const before = Date.now();
      await syncTo(sec, a.id, [op(m1.id, { at: three.toISOString() }), op(m2.id, { at: new Date(Date.now() - 30 * DAY).toISOString() }), op(m3.id, { at: new Date(Date.now() + DAY).toISOString() })]).expect(201);
      const byMember = new Map((await rows(a.id)).map((r) => [r.member_id, r.recorded_at.getTime()]));
      expect(byMember.get(m1.id)).toBe(three.getTime());
      expect(byMember.get(m2.id)!).toBeGreaterThanOrEqual(before - 1000); // older than 14 days -> now
      expect(byMember.get(m3.id)!).toBeGreaterThanOrEqual(before - 1000); // in the future -> now
      expect(byMember.get(m3.id)!).toBeLessThan(Date.now() + 5000);
    });

    it('validates the request', async () => {
      const bad = (body: any) => post(sec, `/activities/${act.id}/attendance/sync`, body).expect(400);
      await bad({});
      await bad({ ops: [] });
      await bad({ ops: 'nope' });
      await bad({ ops: Array.from({ length: 201 }, () => op(m1.id)) });
      await bad({ ops: [{ opId: 'x', memberId: m1.id }] });
      await bad({ ops: [{ opId: randomUUID(), memberId: 'x' }] });
      await bad({ ops: [{ opId: randomUUID() }] });
      await bad({ ops: [{ opId: randomUUID(), memberId: m1.id, at: 'yesterday' }] });
      await bad({ ops: [null] });
      const ok = await syncTo(sec, act.id, Array.from({ length: 200 }, () => op(randomUUID()))).expect(201); // 200 is allowed
      expect(ok.body.summary.rejected).toBe(200);
    });
  });

  describe('re-authorisation at sync time', () => {
    it('a permission revoked while the device was offline stops the sync; nothing is recorded', async () => {
      const u = await makeUser(prisma, { fellowshipId: fA.id, roles: ['secretary'] });
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      await syncTo(u, a.id, [op(m1.id)]).expect(201);
      await prisma.user.update({ where: { id: u.id }, data: { roles: ['ordinary_member'] } }); // demoted while offline
      await syncTo(u, a.id, [op(m2.id)]).expect(403);
      await get(u, `/activities/${a.id}/attendance/roster`).expect(403);
      expect(await rows(a.id)).toHaveLength(1);
    });

    it('a deactivated account, or a suspended fellowship, cannot sync', async () => {
      const t = await makeFellowship(prisma, 'OS');
      const u = await makeUser(prisma, { fellowshipId: t.id, roles: ['secretary'] });
      const mem = await makeMember(prisma, { fellowshipId: t.id });
      const a = await makeActivity(prisma, { fellowshipId: t.id });
      await syncTo(u, a.id, [op(mem.id)]).expect(201);
      await prisma.fellowship.update({ where: { id: t.id }, data: { status: 'suspended', is_active: false } });
      await syncTo(u, a.id, [op(mem.id)]).expect(403);
      await prisma.fellowship.update({ where: { id: t.id }, data: { status: 'active', is_active: true } });
      await prisma.user.update({ where: { id: u.id }, data: { is_active: false } });
      await syncTo(u, a.id, [op(mem.id)]).expect(401);
    });

    it('a deleted activity is a clear 404 for the device', async () => {
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      await prisma.activity.delete({ where: { id: a.id } });
      await syncTo(sec, a.id, [op(m1.id)]).expect(404);
    });
  });

  describe('privacy of the ledger and the audit trail', () => {
    it('the idempotency ledger holds no personal data, and audit entries carry only counts', async () => {
      const cols = await prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name = 'attendance_sync_ops'`;
      expect(cols.map((c) => c.column_name).sort()).toEqual(['activity_id', 'created_at', 'id', 'member_id', 'op_id', 'result', 'user_id']);
      const a = await makeActivity(prisma, { fellowshipId: fA.id });
      await syncTo(sec, a.id, [op(m1.id), op(mB.id)]).expect(201);
      const audit = await prisma.auditLog.findFirst({ where: { entity_id: a.id, action: 'activity.attendance_sync' } });
      expect(audit!.new_value).toEqual({ applied: 1, duplicate: 0, already_recorded: 0, rejected: 1 });
      expect(audit!.fellowship_id).toBe(fA.id);
    });
  });
});
