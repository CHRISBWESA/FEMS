import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, makeMember, makeUser, uniq } from './harness';

/**
 * Departments management module, end to end over HTTP against real Postgres:
 * Secretary administration, leader appointment and account provisioning, the leader workspace, and the
 * activity / report / financial approval chains.
 */
// Long flows over a remote database: allow for network latency.
jest.setTimeout(300_000);

describeDb('Departments management module (real Postgres, HTTP)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any;
  let sec: any, chair: any, treas: any, secB: any, admin: any, asst: any;
  const STRONG = 'Correct-Horse-Battery-9';

  let dept: any, otherDept: any;
  let chairMember: any, secMember: any, replacement: any, plain: any, female: any, foreign: any, noEmail: any;
  let chairToken: string, secToken: string;

  const http = () => request(app.getHttpServer());

  async function login(email: string, password: string) {
    const res = await http().post('/api/v1/auth/login').set('X-Forwarded-For', `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`).send({ email, password });
    return res;
  }

  /** Signs in with the initial password and changes it, as a newly appointed leader must. */
  async function firstLogin(email: string): Promise<string> {
    const res = await login(email, '123456');
    expect(res.status).toBe(201);
    const changed = await http()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .send({ oldPassword: '123456', newPassword: STRONG })
      .expect(201);
    return changed.body.accessToken;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'DA');
    fB = await makeFellowship(prisma, 'DB');
    sec = await makeUser(prisma, { fellowshipId: fA.id, roles: ['secretary'] });
    asst = await makeUser(prisma, { fellowshipId: fA.id, roles: ['assistant_secretary'] });
    chair = await makeUser(prisma, { fellowshipId: fA.id, roles: ['chairperson'] });
    treas = await makeUser(prisma, { fellowshipId: fA.id, roles: ['treasurer'] });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    const tag = uniq();
    chairMember = await makeMember(prisma, { fellowshipId: fA.id, name: 'Chair Person', gender: 'male', email: `chair${tag}@test.local` });
    secMember = await makeMember(prisma, { fellowshipId: fA.id, name: 'Sec Retary', gender: 'female', email: `sec${tag}@test.local` });
    replacement = await makeMember(prisma, { fellowshipId: fA.id, name: 'New Chair', gender: 'male', email: `new${tag}@test.local` });
    plain = await makeMember(prisma, { fellowshipId: fA.id, name: 'Plain Member', gender: 'male' });
    female = await makeMember(prisma, { fellowshipId: fA.id, name: 'Female Member', gender: 'female' });
    noEmail = await makeMember(prisma, { fellowshipId: fA.id, name: 'No Email', gender: 'male' });
    foreign = await makeMember(prisma, { fellowshipId: fB.id, name: 'Foreign', gender: 'female', email: `foreign${tag}@test.local` });
  });

  afterAll(async () => {
    await app?.close();
  });

  // ------------------------------------------------------------ 1-2 departments

  describe('department administration', () => {
    it('the Secretary creates departments, and duplicate names are refused (any case)', async () => {
      const name = `Choir ${uniq()}`;
      const res = await api(app, sec.token).post('/department-admin/departments', { name, description: 'Sings' }).expect(201);
      dept = res.body;
      expect(dept).toMatchObject({ name, description: 'Sings', isActive: true, memberCount: 0, chairperson: null, secretary: null });
      await api(app, sec.token).post('/department-admin/departments', { name: name.toUpperCase() }).expect(400);
      // Another fellowship may use the same name.
      await api(app, secB.token).post('/department-admin/departments', { name }).expect(201);
      otherDept = (await api(app, sec.token).post('/department-admin/departments', { name: `Word ${uniq()}` }).expect(201)).body;
      await api(app, sec.token).put(`/department-admin/departments/${otherDept.id}`, { name: name.toLowerCase() }).expect(400);
    });

    it('adds the ten standard departments once', async () => {
      const first = await api(app, sec.token).post('/department-admin/departments/standard').expect(201);
      expect(first.body.created).toHaveLength(10);
      const again = await api(app, sec.token).post('/department-admin/departments/standard').expect(201);
      expect(again.body.created).toHaveLength(0);
    });

    it('edits, deactivates and reactivates a department, writing audit entries', async () => {
      await api(app, sec.token).put(`/department-admin/departments/${otherDept.id}`, { description: 'Bible study', isActive: false }).expect(200);
      await api(app, sec.token).put(`/department-admin/departments/${otherDept.id}`, { isActive: true }).expect(200);
      const actions = (await prisma.auditLog.findMany({ where: { entity_id: otherDept.id }, select: { action: true } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['department.create', 'department.deactivate', 'department.activate']));
    });

    it('only the Fellowship Secretary may administer departments', async () => {
      for (const u of [chair, treas, admin]) {
        await api(app, u.token).post('/department-admin/departments', { name: `X ${uniq()}` }).expect(403);
        await api(app, u.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: chairMember.id, role: 'department_chairperson' }).expect(403);
      }
      // Another fellowship's Secretary cannot see or touch this one's departments.
      await api(app, secB.token).get(`/department-admin/departments/${dept.id}`).expect(404);
      await api(app, secB.token).put(`/department-admin/departments/${dept.id}`, { name: 'hijack' }).expect(404);
    });
  });

  // ------------------------------------------------------------ 3-7 leadership

  describe('leadership and accounts', () => {
    it('appoints both leaders from registered members and provisions their accounts', async () => {
      const a = await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: chairMember.id, role: 'department_chairperson' }).expect(201);
      expect(a.body.account).toMatchObject({ created: true, initialPassword: '123456' });
      expect(a.body.department.chairperson).toMatchObject({ memberId: chairMember.id });
      const b = await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: secMember.id, role: 'department_secretary' }).expect(201);
      expect(b.body.department.secretary).toMatchObject({ memberId: secMember.id });

      const account = await prisma.user.findFirst({ where: { email: chairMember.email } });
      expect(account).toMatchObject({ must_change_password: true, roles: ['department_chairperson'], fellowship_id: fA.id });
      expect(account!.password_hash).not.toContain('123456');
      expect((await prisma.member.findUnique({ where: { id: chairMember.id } }))!.user_id).toBe(account!.id);
      // The leader is also a member of the department.
      expect(await prisma.departmentMember.count({ where: { department_id: dept.id, member_id: chairMember.id, removed: false } })).toBe(1);
    });

    it('refuses invalid appointments', async () => {
      await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: secMember.id, role: 'department_chairperson' }).expect(400); // same person, both offices
      await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: foreign.id, role: 'department_secretary' }).expect(400); // other fellowship
      await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: noEmail.id, role: 'department_secretary' }).expect(400); // no e-mail for login
      await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: plain.id, role: 'boss' }).expect(400);
      expect(await prisma.user.count({ where: { email: foreign.email } })).toBe(0);
    });

    it('a new leader must change the initial password before doing anything', async () => {
      const res = await login(chairMember.email, '123456');
      expect(res.status).toBe(201);
      expect(res.body.user.mustChangePassword).toBe(true);
      // Until the password is changed the server refuses everything else.
      const blocked = await http().get('/api/v1/department-workspace/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(403);
      expect(blocked.body.code ?? blocked.body.message).toBeTruthy();
      // The new password must meet the policy; "123456" again is refused.
      await http().post('/api/v1/auth/change-password').set('Authorization', `Bearer ${res.body.accessToken}`).send({ oldPassword: '123456', newPassword: '1234567' }).expect(400);
      chairToken = await firstLogin(chairMember.email);
      secToken = await firstLogin(secMember.email);
      const me = await http().get('/api/v1/department-workspace/me').set('Authorization', `Bearer ${chairToken}`).expect(200);
      expect(me.body.departments).toEqual([expect.objectContaining({ departmentId: dept.id, role: 'department_chairperson' })]);
      expect((await prisma.user.findFirst({ where: { email: chairMember.email } }))!.must_change_password).toBe(false);
    });
  });

  // ------------------------------------------------------------ 8-13 members

  describe('department members', () => {
    const asChair = () => api(app, chairToken);

    it('adds existing members, never twice, and refuses members of another fellowship', async () => {
      const before = await prisma.member.count({ where: { fellowship_id: fA.id } });
      const res = await asChair().post(`/department-workspace/${dept.id}/members`, { memberIds: [plain.id, female.id, plain.id, foreign.id] }).expect(201);
      expect(res.body).toEqual({ added: 2, alreadyMember: 0, rejected: [foreign.id] });
      const again = await asChair().post(`/department-workspace/${dept.id}/members`, { memberIds: [plain.id] }).expect(201);
      expect(again.body).toMatchObject({ added: 0, alreadyMember: 1 });
      expect(await prisma.member.count({ where: { fellowship_id: fA.id } })).toBe(before);
    });

    it('lists, searches, filters and reports gender statistics', async () => {
      const list = await asChair().get(`/department-workspace/${dept.id}/members?gender=female`).expect(200);
      expect(list.body.data.map((m: any) => m.id)).toEqual(expect.arrayContaining([female.id, secMember.id]));
      expect(list.body.data.map((m: any) => m.id)).not.toContain(plain.id);
      const search = await asChair().get(`/department-workspace/${dept.id}/members?search=Plain`).expect(200);
      expect(search.body.data.map((m: any) => m.id)).toEqual([plain.id]);
      const stats = await asChair().get(`/department-workspace/${dept.id}/members/stats`).expect(200);
      expect(stats.body).toMatchObject({ total: 4, male: 2, female: 2 });
      const candidates = await asChair().get(`/department-workspace/${dept.id}/members/candidates?search=Plain`).expect(200);
      expect(candidates.body.data[0]).toMatchObject({ id: plain.id, inDepartment: true });
    });

    it('a member can belong to several departments, and removal touches only one membership', async () => {
      await prisma.departmentMember.create({ data: { department_id: otherDept.id, member_id: plain.id } });
      await asChair().post(`/department-workspace/${dept.id}/members/${plain.id}/remove`, { reason: 'moved' }).expect(201);
      expect(await prisma.member.findUnique({ where: { id: plain.id } })).toBeTruthy();
      expect(await prisma.departmentMember.count({ where: { department_id: otherDept.id, member_id: plain.id, removed: false } })).toBe(1);
      expect(await prisma.departmentMember.count({ where: { department_id: dept.id, member_id: plain.id, removed: false } })).toBe(0);
      // Re-adding reactivates the same row instead of creating a duplicate.
      await asChair().post(`/department-workspace/${dept.id}/members`, { memberIds: [plain.id] }).expect(201);
      expect(await prisma.departmentMember.count({ where: { department_id: dept.id, member_id: plain.id } })).toBe(1);
      // A current leader cannot be removed from the department.
      await asChair().post(`/department-workspace/${dept.id}/members/${secMember.id}/remove`, {}).expect(400);
    });

    it('exports the member list as CSV', async () => {
      const res = await asChair().get(`/department-workspace/${dept.id}/members/export`).expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Plain Member');
      expect(res.text).not.toContain('Foreign');
    });

    it('leaders cannot reach other departments, other fellowships, or administration', async () => {
      await asChair().get(`/department-workspace/${otherDept.id}/members`).expect(403);
      await asChair().get(`/department-workspace/not-a-uuid/members`).expect(404);
      await asChair().post('/department-admin/departments', { name: `Nope ${uniq()}` }).expect(403);
      await asChair().post(`/department-admin/departments/${dept.id}/leaders`, { memberId: plain.id, role: 'department_secretary' }).expect(403);
      await asChair().get('/department-reviews/pending').expect(403);
      // Ordinary fellowship staff cannot use the leader workspace either.
      await api(app, sec.token).get(`/department-workspace/${dept.id}/members`).expect(403);
    });

    it('notifies the co-leader about membership changes, but not the person who acted', async () => {
      const secAccount = await prisma.user.findFirst({ where: { email: secMember.email } });
      const chairAccount = await prisma.user.findFirst({ where: { email: chairMember.email } });
      expect(await prisma.notification.count({ where: { recipient_user_id: secAccount!.id, event_type: 'department_members_added' } })).toBeGreaterThan(0);
      expect(await prisma.notification.count({ where: { recipient_user_id: chairAccount!.id, event_type: 'department_members_added' } })).toBe(0);
    });
  });

  // ------------------------------------------------------------ 14-16 activities

  describe('activities and their approval', () => {
    let activityId: string;

    it('a leader drafts, edits and submits an activity; it is hidden from fellowship lists until approved', async () => {
      const draft = await api(app, chairToken).post(`/department-workspace/${dept.id}/activities`, {
        title: 'Choir retreat', description: 'Weekend', objectives: 'Practice', venue: 'Hall',
        date: new Date(Date.now() - 3600_000).toISOString(), endDate: new Date().toISOString(),
      }).expect(201);
      activityId = draft.body.id;
      expect(draft.body.status).toBe('DRAFT');
      await api(app, secToken).put(`/department-workspace/${dept.id}/activities/${activityId}`, { venue: 'Chapel' }).expect(200);
      const submitted = await api(app, secToken).post(`/department-workspace/${dept.id}/activities/${activityId}/submit`).expect(201);
      expect(submitted.body.status).toBe('PENDING_SECRETARY');
      await api(app, secToken).put(`/department-workspace/${dept.id}/activities/${activityId}`, { venue: 'x' }).expect(400);

      const list = await api(app, sec.token).get('/activities').expect(200);
      expect((Array.isArray(list.body) ? list.body : list.body.data).map((a: any) => a.id)).not.toContain(activityId);
      await api(app, sec.token).get(`/activities/${activityId}`).expect(404);
    });

    it('the Chairperson cannot approve before the Secretary', async () => {
      const pending = await api(app, chair.token).get('/department-reviews/pending?kind=activity').expect(200);
      expect(pending.body.map((p: any) => p.id)).not.toContain(activityId);
      await api(app, chair.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'approved' }).expect(403);
      await api(app, treas.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'approved' }).expect(403);
    });

    it('returned for revision, revised, resubmitted, then approved by Secretary and Chairperson', async () => {
      await api(app, sec.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'returned' }).expect(400); // a comment is required
      await api(app, sec.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'returned', comment: 'Add the budget' }).expect(201);
      const returned = await api(app, chairToken).get(`/department-workspace/${dept.id}/activities/${activityId}`).expect(200);
      expect(returned.body.status).toBe('RETURNED');
      expect(returned.body.history.map((h: any) => h.action)).toEqual(['submitted', 'returned']);
      expect(returned.body.history[1].comment).toBe('Add the budget');

      await api(app, chairToken).put(`/department-workspace/${dept.id}/activities/${activityId}`, { supportingInfo: 'Budget attached' }).expect(200);
      await api(app, chairToken).post(`/department-workspace/${dept.id}/activities/${activityId}/submit`).expect(201);

      const s = await api(app, sec.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'approved', comment: 'ok' }).expect(201);
      expect(s.body.status).toBe('PENDING_CHAIRPERSON');
      await api(app, sec.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'approved' }).expect(403); // not the Secretary's stage any more
      const c = await api(app, chair.token).post(`/department-reviews/activity/${activityId}/decide`, { decision: 'approved' }).expect(201);
      expect(c.body.status).toBe('APPROVED');

      const final = await api(app, chairToken).get(`/department-workspace/${dept.id}/activities/${activityId}`).expect(200);
      // The first review round is still in the history after the resubmission.
      expect(final.body.history.map((h: any) => h.action)).toEqual(['submitted', 'returned', 'resubmitted', 'approved', 'approved']);
      await api(app, sec.token).get(`/activities/${activityId}`).expect(200);
      await api(app, chairToken).post(`/department-workspace/${dept.id}/activities/${activityId}/complete`).expect(201);
    });

    it('a rejected activity is final', async () => {
      const a = await api(app, chairToken).post(`/department-workspace/${dept.id}/activities`, { title: 'Bad idea', date: new Date(Date.now() + 86400_000).toISOString(), submit: true }).expect(201);
      await api(app, sec.token).post(`/department-reviews/activity/${a.body.id}/decide`, { decision: 'rejected', comment: 'No' }).expect(201);
      await api(app, chairToken).post(`/department-workspace/${dept.id}/activities/${a.body.id}/submit`).expect(400);
      const leaders = await prisma.notification.count({ where: { entity_id: a.body.id, event_type: 'department_activity_rejected' } });
      expect(leaders).toBe(2);
    });
  });

  // ------------------------------------------------------------ 17-18 reports

  describe('activity reports', () => {
    let reportId: string;
    it('submits a report for an approved activity, keeping every version', async () => {
      const act = await prisma.activity.findFirst({ where: { department_id: dept.id, status: 'COMPLETED' } });
      const r = await api(app, secToken).post(`/department-workspace/${dept.id}/reports`, {
        activityId: act!.id, description: 'It went well', participants: 25, achievements: 'Learnt 3 songs', submit: true,
      }).expect(201);
      reportId = r.body.id;
      expect(r.body).toMatchObject({ activityTitle: 'Choir retreat', participants: 25, version: 1 });
      expect(r.body.status).toBe('SUBMITTED');

      // A report cannot point at another department's activity.
      const foreignAct = await prisma.activity.create({ data: { title: 'x', date: new Date(), audience_type: 'department', department_id: otherDept.id, fellowship_id: fA.id, created_by: sec.id } });
      await api(app, secToken).post(`/department-workspace/${dept.id}/reports`, { activityId: foreignAct.id, description: 'x' }).expect(400);
    });

    it('is reviewed by the Secretary then the Chairperson, with a revision in between', async () => {
      await api(app, sec.token).post(`/department-reviews/report/${reportId}/decide`, { decision: 'returned', comment: 'Add challenges' }).expect(201);
      await api(app, chairToken).put(`/department-workspace/${dept.id}/reports/${reportId}`, { challenges: 'Transport' }).expect(200);
      const resub = await api(app, chairToken).post(`/department-workspace/${dept.id}/reports/${reportId}/submit`).expect(201);
      expect(resub.body.version).toBe(2);
      expect(resub.body.submissions.map((s: any) => s.version)).toEqual([2, 1]);
      await api(app, sec.token).post(`/department-reviews/report/${reportId}/decide`, { decision: 'approved' }).expect(201);
      const done = await api(app, chair.token).post(`/department-reviews/report/${reportId}/decide`, { decision: 'approved' }).expect(201);
      expect(done.body.status).toBe('FINAL_APPROVED');
      const all = await api(app, chair.token).get('/department-reviews/report').expect(200);
      expect(all.body.data.map((x: any) => x.id)).toContain(reportId);
    });
  });

  // ------------------------------------------------------------ 19-23 financial requests

  describe('financial requests', () => {
    const body = (title: string) => ({
      title, justification: 'Needed for the retreat', expenseBreakdown: [{ item: 'Bus', quantity: 2, unitCost: 150 }, { item: 'Water', quantity: 10, unitCost: '2.50' }],
    });

    it('is created in the Finance module with the total of its breakdown', async () => {
      const r = await api(app, chairToken).post(`/department-workspace/${dept.id}/financial-requests`, body('Retreat transport')).expect(201);
      expect(r.body).toMatchObject({ amount: '325', currentStage: 'treasurer' });
      const row = await prisma.moneyRequest.findUnique({ where: { id: r.body.id } });
      expect(row).toMatchObject({ department_id: dept.id, fellowship_id: fA.id });
      await api(app, chairToken).post(`/department-workspace/${dept.id}/financial-requests`, { ...body('Wrong'), amount: 999 }).expect(400);
      // Treasurer -> Secretary -> Chairperson: nobody may skip ahead.
      await api(app, sec.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'approved' }).expect(403);
      await api(app, chair.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'approved' }).expect(403);
      const t = await api(app, treas.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect(t.body.currentStage).toBe('secretary');
      await api(app, chair.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'approved' }).expect(403);
      const s = await api(app, asst.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect(s.body.currentStage).toBe('chairperson');
      const c = await api(app, chair.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect(c.body.status).toBe('FINAL_APPROVED');
      expect(await prisma.notification.count({ where: { recipient_user_id: treas.id, entity_id: r.body.id, event_type: 'department_finance_release' } })).toBe(1);
      // The Treasurer's view only covers financial requests.
      await api(app, treas.token).get('/department-reviews/report').expect(403);
    });

    it('a rejection stops the request', async () => {
      const r = await api(app, chairToken).post(`/department-workspace/${dept.id}/financial-requests`, body('Too much')).expect(201);
      await api(app, treas.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'rejected', comment: 'No funds' }).expect(201);
      await api(app, chairToken).post(`/department-workspace/${dept.id}/financial-requests/${r.body.id}/resubmit`, body('Again')).expect(400);
      expect((await prisma.moneyRequest.findUnique({ where: { id: r.body.id } }))!.approval_status).toBe('REJECTED');
    });

    it('a returned request is revised and starts again at the Treasurer', async () => {
      const r = await api(app, secToken).post(`/department-workspace/${dept.id}/financial-requests`, body('Revise me')).expect(201);
      await api(app, treas.token).post(`/department-reviews/financial/${r.body.id}/decide`, { decision: 'returned', comment: 'Split the costs' }).expect(201);
      const again = await api(app, chairToken).post(`/department-workspace/${dept.id}/financial-requests/${r.body.id}/resubmit`, { ...body('Revised'), expenseBreakdown: [{ item: 'Bus', quantity: 1, unitCost: 100 }] }).expect(201);
      expect(again.body).toMatchObject({ amount: '100', currentStage: 'treasurer', title: 'Revised' });
      expect(again.body.history.map((h: any) => h.action)).toEqual(['submitted', 'returned', 'resubmitted']);
    });

    it('leaders only see their own department’s requests', async () => {
      const list = await api(app, chairToken).get(`/department-workspace/${dept.id}/financial-requests`).expect(200);
      expect(list.body.data.every((x: any) => x.departmentId === dept.id)).toBe(true);
      await api(app, chairToken).get(`/department-workspace/${otherDept.id}/financial-requests`).expect(403);
    });
  });

  // ------------------------------------------------------------ 24 announcements

  describe('announcements', () => {
    it('reach only the targeted departments, and leaders cannot publish', async () => {
      const targeted = await api(app, sec.token).post('/department-admin/announcements', { title: 'Choir only', content: 'Practice moved', departmentIds: [dept.id], publish: true }).expect(201);
      const other = await api(app, sec.token).post('/department-admin/announcements', { title: 'Word only', content: 'x', departmentIds: [otherDept.id], publish: true }).expect(201);
      const all = await api(app, sec.token).post('/department-admin/announcements', { title: 'Everyone', content: 'y', targetAll: true, publish: true }).expect(201);
      const draft = await api(app, sec.token).post('/department-admin/announcements', { title: 'Draft', content: 'z', targetAll: true }).expect(201);
      const seen = (await api(app, chairToken).get(`/department-workspace/${dept.id}/announcements`).expect(200)).body.data.map((a: any) => a.id);
      expect(seen).toEqual(expect.arrayContaining([targeted.body.id, all.body.id]));
      expect(seen).not.toContain(other.body.id);
      expect(seen).not.toContain(draft.body.id);
      await api(app, chairToken).post('/department-admin/announcements', { title: 'Mine', content: 'x', targetAll: true }).expect(403);
      await api(app, secB.token).post('/department-admin/announcements', { title: 'x', content: 'x', departmentIds: [dept.id] }).expect(400);
      const chairAccount = await prisma.user.findFirst({ where: { email: chairMember.email } });
      expect(await prisma.notification.count({ where: { recipient_user_id: chairAccount!.id, entity_id: targeted.body.id } })).toBe(1);
    });
  });

  // ------------------------------------------------------------ 25 reports & dashboard

  describe('dashboard and exports', () => {
    it('the dashboard is built from real records', async () => {
      const d = await api(app, chairToken).get(`/department-workspace/${dept.id}/dashboard`).expect(200);
      expect(d.body.department.id).toBe(dept.id);
      expect(d.body.stats.total).toBe(await prisma.departmentMember.count({ where: { department_id: dept.id, removed: false } }));
      expect(d.body.chairperson.memberId).toBe(chairMember.id);
      expect(d.body.recentAnnouncements.length).toBeGreaterThan(0);
    });

    it('exports activities, reports and financial requests as CSV, filtered by date', async () => {
      const acts = await api(app, chairToken).get(`/department-workspace/${dept.id}/activities/export`).expect(200);
      expect(acts.text).toContain('Choir retreat');
      const reps = await api(app, chairToken).get(`/department-workspace/${dept.id}/reports/export?status=FINAL_APPROVED`).expect(200);
      expect(reps.text).toContain('Choir retreat');
      const fin = await api(app, chairToken).get(`/department-workspace/${dept.id}/financial-requests/export?from=2000-01-01&to=2000-01-02`).expect(200);
      expect(fin.text.split('\r\n')).toHaveLength(1); // header only
      const analytics = await api(app, chairToken).get(`/department-workspace/${dept.id}/analytics`).expect(200);
      expect(analytics.body.financialRequests.FINAL_APPROVED.count).toBe(1);
    });

    it('refuses uploads of disallowed file types', async () => {
      await http()
        .post(`/api/v1/department-workspace/${dept.id}/uploads`)
        .set('Authorization', `Bearer ${chairToken}`)
        .attach('file', Buffer.from('MZ fake exe'), { filename: 'evil.exe', contentType: 'application/x-msdownload' })
        .expect(400);
      await http()
        .post(`/api/v1/department-workspace/${dept.id}/uploads`)
        .set('Authorization', `Bearer ${chairToken}`)
        .attach('file', Buffer.from('not really a pdf'), { filename: 'x.pdf', contentType: 'application/pdf' })
        .expect(400);
    });
  });

  // ------------------------------------------------------------ 6-7 replacement (last: it changes who leads)

  describe('replacing a leader', () => {
    it('moves access to the new leader at once and keeps all department records', async () => {
      const counts = async () => ({
        activities: await prisma.activity.count({ where: { department_id: dept.id } }),
        reports: await prisma.report.count({ where: { department_id: dept.id } }),
        requests: await prisma.moneyRequest.count({ where: { department_id: dept.id } }),
        members: await prisma.departmentMember.count({ where: { department_id: dept.id, removed: false } }),
        approvals: await prisma.approval.count({ where: { fellowship_id: fA.id } }),
      });
      const before = await counts();
      const oldAccount = await prisma.user.findFirst({ where: { email: chairMember.email } });

      const res = await api(app, sec.token).post(`/department-admin/departments/${dept.id}/leaders`, { memberId: replacement.id, role: 'department_chairperson' }).expect(201);
      expect(res.body.department.chairperson.memberId).toBe(replacement.id);

      // The previous chairperson's session stops working for the department immediately.
      await http().get(`/api/v1/department-workspace/${dept.id}/dashboard`).set('Authorization', `Bearer ${chairToken}`).expect(401);
      const after = await prisma.user.findUnique({ where: { id: oldAccount!.id } });
      expect(after).toMatchObject({ is_active: false, roles: ['ordinary_member'] });
      expect(after!.password_hash).toBe(oldAccount!.password_hash); // not reset

      const newToken = await firstLogin(replacement.email);
      await http().get(`/api/v1/department-workspace/${dept.id}/dashboard`).set('Authorization', `Bearer ${newToken}`).expect(200);
      expect(await counts()).toEqual({ ...before, members: before.members + 1 }); // the new leader joined the department

      const history = (await http().get(`/api/v1/department-workspace/${dept.id}/leadership`).set('Authorization', `Bearer ${newToken}`).expect(200)).body.history;
      const old = history.find((h: any) => h.memberId === chairMember.id);
      expect(old).toMatchObject({ current: false, endReason: 'replaced' });
      expect(old.endedBy).toBeTruthy();
      expect(await prisma.auditLog.count({ where: { action: 'department.leader_replace', entity_id: dept.id } })).toBe(1);
      expect(await prisma.notification.count({ where: { recipient_user_id: oldAccount!.id, event_type: 'department_leader_replaced' } })).toBe(1);
    });

    it('re-appointing an existing account reuses it and keeps its password', async () => {
      const acct = await prisma.user.findFirst({ where: { email: chairMember.email } });
      const res = await api(app, sec.token).post(`/department-admin/departments/${otherDept.id}/leaders`, { memberId: chairMember.id, role: 'department_secretary' }).expect(201);
      expect(res.body.account).toMatchObject({ created: false, userId: acct!.id });
      expect(res.body.account.initialPassword).toBeUndefined();
      expect(await prisma.user.count({ where: { email: chairMember.email } })).toBe(1);
      const back = await login(chairMember.email, STRONG);
      expect(back.status).toBe(201);
      const me = await http().get('/api/v1/department-workspace/me').set('Authorization', `Bearer ${back.body.accessToken}`).expect(200);
      expect(me.body.departments.map((d: any) => d.departmentId)).toEqual([otherDept.id]);
    });
  });
});
