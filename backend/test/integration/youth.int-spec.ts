import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
} from './harness';

// Phase 13 (Youth & Children) had only mocked unit tests before; this is its first run against a real
// database, exercising the migration, the queries and the authorization chain end to end.
describeDb('Phase 13 - youth & children (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, D1: any, D2: any;
  let sec: any, asst: any, chair: any, treas: any, ds1: any, ds2: any, secB: any;
  let guardian: any, guardianB: any;
  let youthId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'YA');
    fB = await makeFellowship(prisma, 'YB');
    D1 = await makeDepartment(prisma, fA.id, 'YD1');
    D2 = await makeDepartment(prisma, fA.id, 'YD2');
    sec = await makeUser(prisma, { fellowshipId: fA.id, roles: ['secretary'] });
    asst = await makeUser(prisma, { fellowshipId: fA.id, roles: ['assistant_secretary'] });
    chair = await makeUser(prisma, { fellowshipId: fA.id, roles: ['chairperson'] });
    treas = await makeUser(prisma, { fellowshipId: fA.id, roles: ['treasurer'] });
    ds1 = await makeUser(prisma, { fellowshipId: fA.id, roles: ['department_secretary'], departmentId: D1.id });
    ds2 = await makeUser(prisma, { fellowshipId: fA.id, roles: ['department_secretary'], departmentId: D2.id });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    guardian = await makeMember(prisma, { fellowshipId: fA.id });
    guardianB = await makeMember(prisma, { fellowshipId: fB.id });
    await addToDepartment(prisma, guardian.id, D1.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('401 without a token, 403 for finance-only and ordinary roles', async () => {
    await api(app).get('/youth').expect(401);
    await api(app, treas.token).get('/youth').expect(403);
    await api(app, treas.token).get('/youth/age-groups').expect(403);
  });

  it('age groups: create, list (route is not shadowed by /youth/:id), overlap rejected, secretary-only', async () => {
    await api(app, sec.token).post('/youth/age-groups', { name: 'Kids', minAge: 0, maxAge: 9 }).expect(201);
    await api(app, sec.token).post('/youth/age-groups', { name: 'Teens', minAge: 10, maxAge: 17 }).expect(201);
    await api(app, sec.token).post('/youth/age-groups', { name: 'Overlap', minAge: 8, maxAge: 12 }).expect(400);
    await api(app, sec.token).post('/youth/age-groups', { name: 'Bad', minAge: 9, maxAge: 3 }).expect(400);
    await api(app, asst.token).post('/youth/age-groups', { name: 'Nope', minAge: 30, maxAge: 40 }).expect(403);
    const list = await api(app, chair.token).get('/youth/age-groups').expect(200);
    expect(list.body.map((g: any) => g.name).sort()).toEqual(['Kids', 'Teens']);
  });

  it('participants: create resolves the age group; list/detail; privacy stripping by permission', async () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 7);
    const res = await api(app, sec.token)
      .post('/youth', { fullName: 'Little One', dateOfBirth: dob.toISOString().slice(0, 10), gender: 'female', departmentId: D1.id, notes: 'private note' })
      .expect(201);
    youthId = res.body.id;
    expect(res.body.ageGroup.name).toBe('Kids');
    expect(res.body.notes).toBe('private note'); // secretary holds safeguarding_view

    const asAsst = await api(app, asst.token).get(`/youth/${youthId}`).expect(200);
    expect(asAsst.body.dateOfBirth).toBeDefined(); // details_view
    expect(asAsst.body.notes).toBeUndefined(); // no safeguarding_view

    const asChair = await api(app, chair.token).get(`/youth/${youthId}`).expect(200);
    expect(asChair.body.dateOfBirth).toBeUndefined();
    expect(asChair.body.age).toBeUndefined();
    expect(asChair.body.notes).toBeUndefined();

    await api(app, sec.token).post('/youth', { fullName: 'Bad', dateOfBirth: '2999-01-01' }).expect(400);
    await api(app, sec.token).post('/youth', { fullName: '', dateOfBirth: '2015-01-01' }).expect(400);
  });

  it('department scope, cross-tenant and ID tampering', async () => {
    await api(app, ds1.token).get(`/youth/${youthId}`).expect(200);
    await api(app, ds2.token).get(`/youth/${youthId}`).expect(403);
    const list1 = await api(app, ds1.token).get('/youth').expect(200);
    expect(list1.body.map((y: any) => y.id)).toContain(youthId);
    const list2 = await api(app, ds2.token).get('/youth').expect(200);
    expect(list2.body.map((y: any) => y.id)).not.toContain(youthId);
    await api(app, secB.token).get(`/youth/${youthId}`).expect(403);
    const listB = await api(app, secB.token).get(`/youth?fellowshipId=${fA.id}`).expect(200);
    expect(listB.body).toEqual([]);
    await api(app, sec.token).get(`/youth/${randomUUID()}`).expect(404);
  });

  it('guardians: same-fellowship only, permission-gated', async () => {
    await api(app, sec.token).post(`/youth/${youthId}/guardians`, { guardianMemberId: guardianB.id, relationshipType: 'parent' }).expect(403);
    const ok = await api(app, sec.token).post(`/youth/${youthId}/guardians`, { guardianMemberId: guardian.id, relationshipType: 'parent', isPrimary: true }).expect(201);
    await api(app, sec.token).post(`/youth/${youthId}/guardians`, { guardianMemberId: guardian.id, relationshipType: 'parent' }).expect(400);
    const list = await api(app, ds1.token).get(`/youth/${youthId}/guardians`).expect(200); // dept leader holds guardians_view
    expect(list.body).toHaveLength(1);
    await api(app, chair.token).get(`/youth/${youthId}/guardians`).expect(403); // chair lacks guardians_view
    await api(app, ds1.token).post(`/youth/${youthId}/guardians/${ok.body.id}/remove`, {}).expect(403);
  });

  it('attendance reuses the Activity/Attendance tables and is scope/permission checked', async () => {
    const act = await makeActivity(prisma, { fellowshipId: fA.id, departmentId: D1.id });
    await api(app, ds1.token).post(`/youth/${youthId}/attendance`, { activityId: act.id }).expect(201);
    await api(app, ds2.token).post(`/youth/${youthId}/attendance`, { activityId: act.id }).expect(403);
    const otherFellowshipActivity = await makeActivity(prisma, { fellowshipId: fB.id });
    await api(app, sec.token).post(`/youth/${youthId}/attendance`, { activityId: otherFellowshipActivity.id }).expect(403);
    const hist = await api(app, sec.token).get(`/youth/${youthId}/attendance`).expect(200);
    expect(hist.body).toHaveLength(1);
  });

  it('reports summary is aggregate-only and scoped', async () => {
    const s = await api(app, sec.token).get('/youth/reports/summary').expect(200);
    expect(s.body.totalParticipants).toBe(1);
    expect(JSON.stringify(s.body)).not.toContain('Little One');
    const b = await api(app, secB.token).get('/youth/reports/summary').expect(200);
    expect(b.body.totalParticipants).toBe(0);
    await api(app, treas.token).get('/youth/reports/summary').expect(403);
  });

  it('recalculate refreshes assignments and is secretary-only', async () => {
    await api(app, asst.token).post('/youth/age-groups/recalculate', {}).expect(403);
    const res = await api(app, sec.token).post('/youth/age-groups/recalculate', {}).expect(201);
    expect(res.body).toHaveProperty('updated');
  });
});
