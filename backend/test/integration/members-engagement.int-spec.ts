import { INestApplication } from '@nestjs/common';
import {
  addToDepartment,
  api,
  createTestApp,
  describeDb,
  getPrisma,
  makeActivity,
  makeDepartment,
  makeFellowship,
  makeMember,
  makeUser,
  tokenFor,
  uniq,
} from './harness';
import { randomUUID } from 'crypto';

describeDb('Phase 14 - member engagement (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;

  let fA: any, fB: any, D1: any, D2: any;
  let sec: any, asst: any, chair: any, treas: any, ds1: any, dc1: any, ds2: any, gl: any, ord: any, secB: any, admin: any;
  let m1: any, m2: any, m3: any, mB: any;
  let aG: any, aD1: any;
  const skillTag = `skill${uniq()}`;
  const interestTag = `interest${uniq()}`;
  const serviceTag = `serve${uniq()}`;
  let groupId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);

    fA = await makeFellowship(prisma, 'A');
    fB = await makeFellowship(prisma, 'B');
    D1 = await makeDepartment(prisma, fA.id, 'D1');
    D2 = await makeDepartment(prisma, fA.id, 'D2');

    sec = await makeUser(prisma, { fellowshipId: fA.id, roles: ['secretary'] });
    asst = await makeUser(prisma, { fellowshipId: fA.id, roles: ['assistant_secretary'] });
    chair = await makeUser(prisma, { fellowshipId: fA.id, roles: ['chairperson'] });
    treas = await makeUser(prisma, { fellowshipId: fA.id, roles: ['treasurer'] });
    ds1 = await makeUser(prisma, { fellowshipId: fA.id, roles: ['department_secretary'], departmentId: D1.id });
    dc1 = await makeUser(prisma, { fellowshipId: fA.id, roles: ['department_chairperson'], departmentId: D1.id });
    ds2 = await makeUser(prisma, { fellowshipId: fA.id, roles: ['department_secretary'], departmentId: D2.id });
    gl = await makeUser(prisma, { fellowshipId: fA.id, roles: ['gender_leader'] });
    ord = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });

    m1 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Member One' });
    m2 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Member Two' });
    m3 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Member Three' });
    mB = await makeMember(prisma, { fellowshipId: fB.id, name: 'Member B' });
    await addToDepartment(prisma, m1.id, D1.id);
    await addToDepartment(prisma, m2.id, D2.id);

    aG = await makeActivity(prisma, { fellowshipId: fA.id });
    aD1 = await makeActivity(prisma, { fellowshipId: fA.id, departmentId: D1.id });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('authentication', () => {
    it('401 without a token', async () => {
      await api(app).get(`/members/${m1.id}/profile`).expect(401);
      await api(app).get('/members/reports/summary').expect(401);
      await api(app).get('/member-groups').expect(401);
      await api(app).post(`/activities/${aG.id}/attendance/members`, { memberIds: [m1.id] }).expect(401);
    });
    it('401 with a garbage token', async () => {
      await api(app, 'not-a-jwt').get(`/members/${m1.id}/profile`).expect(401);
    });
    it('401 for a correctly-signed token whose user does not exist', async () => {
      const ghost = tokenFor({ id: randomUUID(), email: 'ghost@test.local', roles: ['secretary'] });
      await api(app, ghost).get(`/members/${m1.id}/profile`).expect(401);
    });
  });

  describe('role gate and permission boundaries', () => {
    it('roles without member permissions are refused (403)', async () => {
      for (const u of [treas, ord, gl, chair]) {
        await api(app, u.token).get(`/members/${m1.id}/profile`).expect(403);
      }
      for (const u of [treas, ord]) {
        await api(app, u.token).get('/members/reports/summary').expect(403);
        await api(app, u.token).get('/member-groups').expect(403);
      }
      await api(app, ds1.token).get(`/members/${m1.id}/history`).expect(403);
      await api(app, chair.token).get(`/members/${m1.id}/history`).expect(403);
    });
    it('chairperson gets oversight-only access', async () => {
      await api(app, chair.token).get('/members/reports/summary').expect(200);
      await api(app, chair.token).get('/member-groups').expect(200);
      await api(app, chair.token).post('/member-groups', { name: 'nope' }).expect(403);
    });
  });

  describe('profile: privacy, validation, scope', () => {
    it('secretary writes a profile; tags are normalized and emergency contact stored', async () => {
      const res = await api(app, sec.token)
        .put(`/members/${m1.id}/profile`, {
          skills: [` ${skillTag.toUpperCase()} `, 'MEDIA', skillTag],
          interests: ['Football'],
          serviceInterests: [serviceTag],
          occupation: 'Teacher',
          membershipDate: '2020-01-15',
          preferredChannels: ['email', 'SMS'],
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '+254 700 111 222',
          emergencyContactRelationship: 'Sister',
        })
        .expect(200);
      expect(res.body.skills).toEqual([skillTag, 'media']);
      expect(res.body.preferredChannels).toEqual(['email', 'sms']);
      expect(res.body.emergencyContact.name).toBe('Jane Doe');
    });

    it('secretary and assistant can read emergency contact; department leader cannot see it', async () => {
      const s = await api(app, sec.token).get(`/members/${m1.id}/profile`).expect(200);
      expect(s.body.emergencyContact.phone).toBe('+254 700 111 222');
      const a = await api(app, asst.token).get(`/members/${m1.id}/profile`).expect(200);
      expect(a.body.emergencyContact).toBeDefined();
      const d = await api(app, ds1.token).get(`/members/${m1.id}/profile`).expect(200);
      expect(d.body.emergencyContact).toBeUndefined();
      expect(d.body.occupation).toBe('Teacher');
      expect(JSON.stringify(d.body)).not.toContain('Jane Doe');
    });

    it('assistant cannot edit emergency fields (403) but can edit tags', async () => {
      await api(app, asst.token).put(`/members/${m1.id}/profile`, { emergencyContactName: 'Hacker' }).expect(403);
      await api(app, asst.token).put(`/members/${m1.id}/profile`, { interests: ['football', 'chess'] }).expect(200);
      const s = await api(app, sec.token).get(`/members/${m1.id}/profile`).expect(200);
      expect(s.body.emergencyContact.name).toBe('Jane Doe');
    });

    it('department leaders cannot edit profiles at all', async () => {
      await api(app, ds1.token).put(`/members/${m1.id}/profile`, { skills: ['x'] }).expect(403);
    });

    it('department scope: only members actively in the leader\'s own department', async () => {
      await api(app, ds1.token).get(`/members/${m1.id}/profile`).expect(200);
      await api(app, ds1.token).get(`/members/${m2.id}/profile`).expect(403); // other department
      await api(app, ds1.token).get(`/members/${m3.id}/profile`).expect(403); // no department
      await api(app, ds2.token).get(`/members/${m1.id}/profile`).expect(403);
    });

    it('a member who has LEFT the department is no longer visible to its leader', async () => {
      const left = await makeMember(prisma, { fellowshipId: fA.id });
      const dm = await addToDepartment(prisma, left.id, D1.id);
      await api(app, ds1.token).get(`/members/${left.id}/profile`).expect(200);
      await prisma.departmentMember.update({ where: { id: dm.id }, data: { removed: true, removed_at: new Date() } });
      await api(app, ds1.token).get(`/members/${left.id}/profile`).expect(403);
    });

    it('cross-tenant and ID tampering are blocked', async () => {
      await api(app, sec.token).get(`/members/${mB.id}/profile`).expect(403);
      await api(app, secB.token).get(`/members/${m1.id}/profile`).expect(403);
      await api(app, sec.token).put(`/members/${mB.id}/profile`, { skills: ['x'] }).expect(403);
      await api(app, sec.token).get('/members/not-a-uuid/profile').expect(404);
      await api(app, sec.token).get(`/members/${randomUUID()}/profile`).expect(404);
      await api(app, sec.token).get('/members/not-a-uuid/history').expect(404);
      await api(app, sec.token).get('/members/not-a-uuid/engagement').expect(404);
    });

    it('validation errors are 400, never 500', async () => {
      const put = (body: object) => api(app, sec.token).put(`/members/${m3.id}/profile`, body);
      await put({}).expect(400);
      await put({ preferredChannels: ['pigeon'] }).expect(400);
      await put({ skills: 'not-an-array' }).expect(400);
      await put({ skills: Array.from({ length: 31 }, (_, i) => `t${i}`) }).expect(400);
      await put({ skills: ['x'.repeat(51)] }).expect(400);
      await put({ membershipDate: '2999-01-01' }).expect(400);
      await put({ membershipDate: 'garbage' }).expect(400);
      await put({ emergencyContactPhone: 'abc' }).expect(400);
      await put({ occupation: 'y'.repeat(121) }).expect(400);
    });

    it('the platform admin cannot read member profiles (Phase 19: admin is outside the fellowship)', async () => {
      await api(app, admin.token).get(`/members/${m1.id}/profile`).expect(403);
    });
  });

  describe('audit metadata never carries emergency-contact values', () => {
    it('profile edit and emergency read are audited without leaking values', async () => {
      const edits = await prisma.auditLog.findMany({ where: { entity_id: m1.id, action: 'member.profile_edit' } });
      expect(edits.length).toBeGreaterThan(0);
      const blob = JSON.stringify(edits);
      expect(blob).not.toContain('Jane Doe');
      expect(blob).not.toContain('+254');
      expect(blob).not.toContain('Sister');
      expect(edits.some((e: any) => (e.new_value as any)?.emergencyContactChanged === true)).toBe(true);

      const views = await prisma.auditLog.findMany({ where: { entity_id: m1.id, action: 'member.emergency_view' } });
      expect(views.length).toBeGreaterThan(0);
      expect(JSON.stringify(views)).not.toContain('Jane Doe');
    });
  });

  describe('membership history', () => {
    let created: any;

    it('registration writes a "registered" event in the same transaction', async () => {
      const res = await api(app, sec.token)
        .post('/members', { fullName: `Hist ${uniq()}`, gender: 'male', expectedGraduationYear: 2035, expectedGraduationMonth: 6 })
        .expect(201);
      created = res.body;
      const rows = await prisma.membershipHistory.findMany({ where: { member_id: created.id } });
      expect(rows.map((r: any) => r.event_type)).toEqual(['registered']);
      expect(rows[0].fellowship_id).toBe(fA.id);
      expect(rows[0].recorded_by).toBe(sec.id);
    });

    it('status changes are recorded with from/to/reason; no-ops and invalid values are not', async () => {
      await api(app, sec.token).put(`/members/${created.id}/status`, { status: 'inactive', reason: 'Moved away' }).expect(200);
      await api(app, sec.token).put(`/members/${created.id}/status`, { status: 'inactive' }).expect(200); // no-op
      await api(app, sec.token).put(`/members/${created.id}/status`, { status: 'archived' }).expect(400);
      await api(app, sec.token).put(`/members/${created.id}/status`, { status: 'active', reason: 'x'.repeat(501) }).expect(400);
      const res = await api(app, sec.token).get(`/members/${created.id}/history`).expect(200);
      expect(res.body.map((r: any) => r.eventType).sort()).toEqual(['registered', 'status_changed']);
      const change = res.body.find((r: any) => r.eventType === 'status_changed');
      expect(change).toMatchObject({ fromStatus: 'active', toStatus: 'inactive', reason: 'Moved away' });
      expect(change.recordedBy.id).toBe(sec.id);
    });

    it('only the Secretary changes status (assistant is refused, nothing recorded)', async () => {
      await api(app, asst.token).put(`/members/${created.id}/status`, { status: 'active' }).expect(403);
      const n = await prisma.membershipHistory.count({ where: { member_id: created.id } });
      expect(n).toBe(2);
    });

    it('history is visible to secretary/assistant only and tenant-scoped', async () => {
      await api(app, asst.token).get(`/members/${created.id}/history`).expect(200);
      await api(app, ds1.token).get(`/members/${created.id}/history`).expect(403);
      await api(app, secB.token).get(`/members/${created.id}/history`).expect(403);
    });

    it('adding to a department records department_joined', async () => {
      await api(app, sec.token).post(`/members/${m3.id}/departments/${D1.id}`, {}).expect(201);
      const rows = await prisma.membershipHistory.findMany({ where: { member_id: m3.id, event_type: 'department_joined' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].department_id).toBe(D1.id);
    });

    it('an approved department transfer moves the member AND records department_transferred', async () => {
      const mT = await makeMember(prisma, { fellowshipId: fA.id });
      await addToDepartment(prisma, mT.id, D1.id);
      const req = await api(app, sec.token)
        .post('/departments/transfers', { memberId: mT.id, fromDepartmentId: D1.id, toDepartmentId: D2.id, reason: 'Relocating' })
        .expect(201);
      const approvalId = req.body.approvalId;
      await api(app, dc1.token).post(`/approvals/${approvalId}/decide`, { decision: 'approved' }).expect(201);
      await api(app, dc1.token).post(`/approvals/${approvalId}/decide`, { decision: 'approved' }).expect(201);
      await api(app, sec.token).post(`/approvals/${approvalId}/decide`, { decision: 'approved' }).expect(201);

      const memberships = await prisma.departmentMember.findMany({ where: { member_id: mT.id } });
      expect(memberships.find((d: any) => d.department_id === D1.id)?.removed).toBe(true);
      expect(memberships.find((d: any) => d.department_id === D2.id)?.removed).toBe(false);

      const hist = await api(app, sec.token).get(`/members/${mT.id}/history`).expect(200);
      const ev = hist.body.find((r: any) => r.eventType === 'department_transferred');
      expect(ev.department.id).toBe(D1.id);
      expect(ev.relatedDepartment.id).toBe(D2.id);
      expect(ev.reason).toBe('Relocating');
    });

    it('an approved removal records department_removed', async () => {
      const mR = await makeMember(prisma, { fellowshipId: fA.id });
      await addToDepartment(prisma, mR.id, D1.id);
      const req = await api(app, ds1.token)
        .post(`/departments/${D1.id}/members/${mR.id}/remove`, { reason: 'Inactive for a year' })
        .expect(201);
      await api(app, ds1.token).post(`/approvals/${req.body.approvalId}/decide`, { decision: 'approved' }).expect(201);
      await api(app, dc1.token).post(`/approvals/${req.body.approvalId}/decide`, { decision: 'approved' }).expect(201);
      const rows = await prisma.membershipHistory.findMany({ where: { member_id: mR.id, event_type: 'department_removed' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].reason).toBe('Inactive for a year');
    });
  });

  describe('member groups', () => {
    it('assistant creates a group; duplicates and bad input are 400; tenant is taken from the token, not the body', async () => {
      const name = `Cell ${uniq()}`;
      const res = await api(app, asst.token).post('/member-groups', { name, fellowshipId: fB.id }).expect(201);
      groupId = res.body.id;
      const row = await prisma.memberGroup.findUnique({ where: { id: groupId } });
      expect(row?.fellowship_id).toBe(fA.id); // body fellowshipId ignored for non-admin
      await api(app, asst.token).post('/member-groups', { name }).expect(400);
      await api(app, asst.token).post('/member-groups', {}).expect(400);
      await api(app, asst.token).post('/member-groups', { name: 'n'.repeat(81) }).expect(400);
      // same name is fine in another fellowship
      await api(app, secB.token).post('/member-groups', { name }).expect(201);
    });

    it('adds members of the same fellowship only; foreign ids are rejected, not probed', async () => {
      const res = await api(app, asst.token).post(`/member-groups/${groupId}/members`, { memberIds: [m1.id, m2.id, mB.id] }).expect(201);
      expect(res.body.added).toBe(2);
      expect(res.body.rejected).toEqual([mB.id]);
      const again = await api(app, asst.token).post(`/member-groups/${groupId}/members`, { memberIds: [m1.id, m2.id] }).expect(201);
      expect(again.body).toMatchObject({ added: 0, alreadyMember: 2 });
      await api(app, asst.token).post(`/member-groups/${groupId}/members`, { memberIds: [] }).expect(400);
      await api(app, asst.token).post(`/member-groups/${groupId}/members`, { memberIds: ['nope'] }).expect(400);
      await api(app, asst.token).post(`/member-groups/${groupId}/members`, {}).expect(400);
    });

    it('cross-tenant and ID tampering on groups', async () => {
      await api(app, secB.token).get(`/member-groups/${groupId}`).expect(403);
      await api(app, secB.token).post(`/member-groups/${groupId}/members`, { memberIds: [mB.id] }).expect(403);
      await api(app, secB.token).put(`/member-groups/${groupId}`, { name: 'hijack' }).expect(403);
      await api(app, asst.token).get('/member-groups/not-a-uuid').expect(404);
      await api(app, asst.token).get(`/member-groups/${randomUUID()}`).expect(404);
      const list = await api(app, secB.token).get('/member-groups?fellowshipId=' + fA.id).expect(200);
      expect(list.body.every((g: any) => g.id !== groupId)).toBe(true);
    });

    it('lists, shows and removes members', async () => {
      const g = await api(app, chair.token).get(`/member-groups/${groupId}`).expect(200);
      expect(g.body.members.map((m: any) => m.memberId).sort()).toEqual([m1.id, m2.id].sort());
      await api(app, asst.token).post(`/member-groups/${groupId}/members/${m2.id}/remove`, {}).expect(201);
      await api(app, asst.token).post(`/member-groups/${groupId}/members/${m2.id}/remove`, {}).expect(404);
    });
  });

  describe('member-linked attendance', () => {
    it('records attendance for members of the same fellowship, skipping duplicates', async () => {
      const res = await api(app, sec.token).post(`/activities/${aG.id}/attendance/members`, { memberIds: [m1.id, m2.id, mB.id] }).expect(201);
      expect(res.body).toMatchObject({ recorded: 2, alreadyRecorded: 0 });
      expect(res.body.rejected).toEqual([mB.id]);
      const again = await api(app, asst.token).post(`/activities/${aG.id}/attendance/members`, { memberIds: [m1.id, m2.id] }).expect(201);
      expect(again.body).toMatchObject({ recorded: 0, alreadyRecorded: 2 });
      expect(await prisma.attendance.count({ where: { activity_id: aG.id, member_id: m1.id } })).toBe(1);
    });

    it('is authorization-gated and tenant-scoped', async () => {
      const body = { memberIds: [m1.id] };
      await api(app, ds1.token).post(`/activities/${aG.id}/attendance/members`, body).expect(403);
      await api(app, chair.token).post(`/activities/${aG.id}/attendance/members`, body).expect(403);
      await api(app, ord.token).post(`/activities/${aG.id}/attendance/members`, body).expect(403);
      await api(app, secB.token).post(`/activities/${aG.id}/attendance/members`, body).expect(403);
      await api(app, sec.token).post(`/activities/${randomUUID()}/attendance/members`, body).expect(404);
      await api(app, sec.token).post('/activities/not-a-uuid/attendance/members', body).expect(404);
      await api(app, sec.token).post(`/activities/${aG.id}/attendance/members`, { memberIds: [] }).expect(400);
      await api(app, sec.token).post(`/activities/${aG.id}/attendance/members`, { memberIds: ['x'] }).expect(400);
    });

    it('the PUBLIC attendance endpoint ignores a client-supplied memberId (cannot forge attendance)', async () => {
      await api(app)
        .post('/activities/attendance', { activityId: aG.id, memberName: 'Walk In', memberId: m3.id })
        .expect(201);
      expect(await prisma.attendance.count({ where: { activity_id: aG.id, member_id: m3.id } })).toBe(0);
      const walkIn = await prisma.attendance.findFirst({ where: { activity_id: aG.id, recorded_by_name: 'Walk In' } });
      expect(walkIn?.member_id).toBeNull();
    });
  });

  describe('search and filters (GET /members)', () => {
    beforeAll(async () => {
      await api(app, sec.token).put(`/members/${m2.id}/profile`, { skills: [skillTag, 'other'] }).expect(200);
      await api(app, sec.token).put(`/members/${m3.id}/profile`, { interests: [interestTag] }).expect(200);
    });
    const ids = (res: any) => res.body.data.map((m: any) => m.id).sort();

    it('filters by skills (case-insensitive), interests and service interests', async () => {
      const bySkill = await api(app, sec.token).get(`/members?skills=${skillTag.toUpperCase()}`).expect(200);
      expect(ids(bySkill)).toEqual([m1.id, m2.id].sort());
      const byInterest = await api(app, sec.token).get(`/members?interests=${interestTag}`).expect(200);
      expect(ids(byInterest)).toEqual([m3.id]);
      const byService = await api(app, sec.token).get(`/members?serviceInterests=${serviceTag}`).expect(200);
      expect(ids(byService)).toEqual([m1.id]);
    });

    it('free-text search is NOT widened to profile fields', async () => {
      const res = await api(app, sec.token).get(`/members?search=${skillTag}`).expect(200);
      expect(res.body.total).toBe(0);
    });

    it('department leader results stay inside their department', async () => {
      const res = await api(app, ds1.token).get(`/members?skills=${skillTag}`).expect(200);
      expect(ids(res)).toEqual([m1.id]);
      const other = await api(app, ds2.token).get(`/members?skills=${skillTag}`).expect(200);
      expect(ids(other)).toEqual([m2.id]);
    });

    it('using a filter without its permission is 403, never silently ignored', async () => {
      await api(app, chair.token).get(`/members?skills=${skillTag}`).expect(403);
      await api(app, gl.token).get(`/members?interests=x`).expect(403);
      await api(app, chair.token).get('/members?attendedWithinDays=30').expect(403);
      await api(app, ds1.token).get(`/members?groupId=${groupId}`).expect(403);
      await api(app, ord.token).get('/members').expect(403);
      await api(app, treas.token).get('/members').expect(403);
    });

    it('filters by membership period (profile date, falling back to registration date)', async () => {
      const old = await api(app, sec.token).get(`/members?skills=${skillTag}&joinedFrom=2020-01-01&joinedTo=2020-12-31`).expect(200);
      expect(ids(old)).toEqual([m1.id]);
      const recent = await api(app, sec.token).get(`/members?skills=${skillTag}&joinedFrom=2026-01-01`).expect(200);
      expect(ids(recent)).toEqual([m2.id]);
      await api(app, sec.token).get('/members?joinedFrom=garbage').expect(400);
    });

    it('filters by group', async () => {
      const res = await api(app, chair.token).get(`/members?groupId=${groupId}`).expect(200);
      expect(ids(res)).toEqual([m1.id]); // m2 was removed from the group above
      await api(app, sec.token).get('/members?groupId=nope').expect(400);
    });

    it('filters by attendance (attended / not attended within N days)', async () => {
      const attended = await api(app, sec.token).get(`/members?skills=${skillTag}&attendedWithinDays=30`).expect(200);
      expect(ids(attended)).toEqual([m1.id, m2.id].sort());
      const m4 = await makeMember(prisma, { fellowshipId: fA.id });
      await api(app, sec.token).put(`/members/${m4.id}/profile`, { skills: [skillTag] }).expect(200);
      const never = await api(app, sec.token).get(`/members?skills=${skillTag}&notAttendedWithinDays=30`).expect(200);
      expect(ids(never)).toEqual([m4.id]);
      for (const bad of ['abc', '0', '9999', '1.5']) {
        await api(app, sec.token).get(`/members?attendedWithinDays=${bad}`).expect(400);
      }
    });

    it('a department leader\'s attendance filter only counts THEIR department\'s activities', async () => {
      // m1 attended aG (no department) but not aD1 -> ds1 must NOT match m1 yet.
      const before = await api(app, ds1.token).get(`/members?skills=${skillTag}&attendedWithinDays=30`).expect(200);
      expect(ids(before)).toEqual([]);
      await api(app, sec.token).post(`/activities/${aD1.id}/attendance/members`, { memberIds: [m1.id] }).expect(201);
      const after = await api(app, ds1.token).get(`/members?skills=${skillTag}&attendedWithinDays=30`).expect(200);
      expect(ids(after)).toEqual([m1.id]);
    });

    it('list rows never carry occupation or emergency contact; profile tags only for permitted roles', async () => {
      const s = await api(app, sec.token).get('/members?limit=100').expect(200);
      const blob = JSON.stringify(s.body);
      expect(blob).not.toContain('emergency_contact');
      expect(blob).not.toContain('Jane Doe');
      expect(blob).not.toContain('Teacher');
      expect(s.body.data.find((m: any) => m.id === m1.id).profile.skills).toContain(skillTag);
      for (const u of [chair, gl]) {
        const res = await api(app, u.token).get('/members?limit=100').expect(200);
        expect(res.body.data.every((m: any) => m.profile === undefined)).toBe(true);
      }
    });

    it('pagination still works', async () => {
      const res = await api(app, sec.token).get('/members?page=1&limit=2').expect(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.total).toBeGreaterThan(2);
    });
  });

  describe('engagement indicators', () => {
    it('shows facts for an authorized viewer', async () => {
      const g = await prisma.youthProfile.create({
        data: { full_name: 'Kid', date_of_birth: new Date('2018-01-01'), fellowship_id: fA.id, created_by: randomUUID() },
      });
      await prisma.youthGuardian.create({
        data: { youth_id: g.id, guardian_member_id: m1.id, relationship_type: 'parent', fellowship_id: fA.id, created_by: randomUUID() },
      });
      const res = await api(app, sec.token).get(`/members/${m1.id}/engagement`).expect(200);
      expect(res.body.attendance.scope).toBe('fellowship');
      expect(res.body.attendance.activitiesAttended).toBe(2); // aG + aD1
      expect(res.body.attendance.lastAttendedAt).not.toBeNull();
      expect(res.body.departments.map((d: any) => d.departmentId)).toContain(D1.id);
      expect(res.body.groups.map((x: any) => x.groupId)).toContain(groupId);
      expect(res.body.serviceInterests).toContain(serviceTag);
      expect(res.body.youth).toEqual({ guardianOfCount: 1, isYouthParticipant: false });
    });

    it('duplicate attendance rows never inflate the numbers', async () => {
      await prisma.attendance.create({
        data: { activity_id: aG.id, member_id: m1.id, fellowship_id: fA.id, recorded_by_name: 'dup' },
      });
      const res = await api(app, sec.token).get(`/members/${m1.id}/engagement`).expect(200);
      expect(res.body.attendance.activitiesAttended).toBe(2);
    });

    it('department leaders see only department-scoped facts (no groups, no youth, no other departments)', async () => {
      const res = await api(app, ds1.token).get(`/members/${m1.id}/engagement`).expect(200);
      expect(res.body.attendance.scope).toBe('department');
      expect(res.body.attendance.activitiesAttended).toBe(1); // only aD1
      expect(res.body.groups).toBeNull();
      expect(res.body.youth).toBeNull();
      expect(res.body.departments.every((d: any) => d.departmentId === D1.id)).toBe(true);
    });

    it('authorization, scope and input validation', async () => {
      await api(app, chair.token).get(`/members/${m1.id}/engagement`).expect(403);
      await api(app, ord.token).get(`/members/${m1.id}/engagement`).expect(403);
      await api(app, ds1.token).get(`/members/${m2.id}/engagement`).expect(403);
      await api(app, secB.token).get(`/members/${m1.id}/engagement`).expect(403);
      await api(app, sec.token).get(`/members/${m1.id}/engagement?days=0`).expect(400);
      await api(app, sec.token).get(`/members/${m1.id}/engagement?days=abc`).expect(400);
    });
  });

  describe('aggregate reports', () => {
    it('fellowship-wide summary for the secretary', async () => {
      const res = await api(app, sec.token).get('/members/reports/summary').expect(200);
      expect(res.body.scope).toBe('fellowship');
      expect(res.body.totals.total).toBeGreaterThanOrEqual(4);
      expect(res.body.membershipGrowth).toHaveLength(12);
      expect(res.body.membershipGrowth[11].registered).toBeGreaterThanOrEqual(1);
      expect(res.body.topTags.skills.find((t: any) => t.tag === skillTag).count).toBeGreaterThanOrEqual(2);
      expect(res.body.participation.dataQuality.linkedToMember).toBeGreaterThanOrEqual(2);
      expect(res.body.participation.dataQuality.nameOnly).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(res.body)).not.toContain('Member One'); // aggregate: no names
    });

    it('chairperson gets aggregates without profile-derived tags', async () => {
      const res = await api(app, chair.token).get('/members/reports/summary').expect(200);
      expect(res.body.topTags).toBeNull();
    });

    it('department leader summary is limited to their department', async () => {
      const res = await api(app, ds1.token).get('/members/reports/summary').expect(200);
      expect(res.body.scope).toBe('department');
      const inD1 = await prisma.departmentMember.count({ where: { department_id: D1.id, removed: false } });
      expect(res.body.totals.total).toBe(inD1);
      expect(res.body.departmentDistribution.departments.every((d: any) => d.departmentId === D1.id)).toBe(true);
    });

    it('another fellowship never sees these members, and ?fellowshipId= cannot be used to cross over', async () => {
      const b = await api(app, secB.token).get('/members/reports/summary').expect(200);
      expect(b.body.totals.total).toBe(1);
      const tamper = await api(app, sec.token).get(`/members/reports/summary?fellowshipId=${fB.id}`).expect(200);
      expect(tamper.body.totals.total).toBeGreaterThanOrEqual(4); // still fellowship A's data
      const reverse = await api(app, secB.token).get(`/members/reports/summary?fellowshipId=${fA.id}`).expect(200);
      expect(reverse.body.totals.total).toBe(1);
    });

    it('validates the window parameters', async () => {
      await api(app, sec.token).get('/members/reports/summary?months=0').expect(400);
      await api(app, sec.token).get('/members/reports/summary?months=99').expect(400);
      await api(app, sec.token).get('/members/reports/summary?days=abc').expect(400);
    });
  });
});
