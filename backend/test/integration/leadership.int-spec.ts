import { INestApplication } from '@nestjs/common';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

/**
 * Leadership management end to end over HTTP against real Postgres: appointment of registered members, automatic
 * member details, replacement into history, reappointment, write-through to accounts / departments / groups,
 * reconciliation of changes made in other screens, permissions, duplicate prevention, search, filters and exports.
 */
jest.setTimeout(300_000);

describeDb('Leadership management (real Postgres, HTTP)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let f: any, fB: any, admin: any, sec: any, chair: any, ord: any;
  let u1: any, u2: any, m1: any, m2: any, m3: any, m4: any, foreign: any;
  let dept: any, group: any;
  const pos: Record<string, any> = {};
  let firstTreasurerAppt: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const current = async (u = admin, q = '') => (await get(u, `/leadership/appointments?tab=current${q}`).expect(200)).body.data;
  const history = async (u = admin, q = '') => (await get(u, `/leadership/appointments?tab=history${q}`).expect(200)).body.data;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    f = await makeFellowship(prisma, 'LDR');
    fB = await makeFellowship(prisma, 'LDRB');
    admin = await makeUser(prisma, { fellowshipId: f.id, roles: ['fellowship_admin'] });
    sec = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
    chair = await makeUser(prisma, { fellowshipId: f.id, roles: ['chairperson'] });
    ord = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
    u1 = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
    u2 = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
    const t = uniq();
    m1 = await makeMember(prisma, { fellowshipId: f.id, name: 'Amani Treasurer', userId: u1.id, gender: 'male', email: `m1${t}@test.local` });
    await prisma.member.update({ where: { id: m1.id }, data: { phone: '0712000001' } });
    m2 = await makeMember(prisma, { fellowshipId: f.id, name: 'Baraka Next', userId: u2.id, gender: 'male', email: `m2${t}@test.local` });
    m3 = await makeMember(prisma, { fellowshipId: f.id, name: 'Chiku Dept', gender: 'female', email: `m3${t}@test.local` });
    m4 = await makeMember(prisma, { fellowshipId: f.id, name: 'Dora Group', gender: 'female' });
    foreign = await makeMember(prisma, { fellowshipId: fB.id, name: 'Foreign One' });
    dept = await makeDepartment(prisma, f.id, 'Ushers');
    group = await prisma.memberGroup.create({ data: { fellowship_id: f.id, name: `Year 1 ${t}`, created_by: sec.id } });
    await prisma.memberGroupMember.create({ data: { group_id: group.id, member_id: m4.id, fellowship_id: f.id } });
    for (const p of (await get(admin, '/leadership/positions').expect(200)).body) pos[p.key] = p;
  });

  afterAll(async () => { await app?.close(); });

  it('lists the built-in FEMS positions', () => {
    for (const k of ['chairperson', 'secretary', 'treasurer', 'department_chairperson', 'department_secretary', 'group_male_leader', 'group_female_leader']) expect(pos[k]).toBeDefined();
  });

  it('1-3. appoints a registered member; their details come from the member record; it is current', async () => {
    const r = (await post(admin, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m1.id, termStart: '2026-01-01', termEnd: '2027-12-31' }).expect(201)).body.appointment;
    firstTreasurerAppt = r;
    expect(r.member).toMatchObject({ fullName: 'Amani Treasurer', registrationNumber: m1.member_code, gender: 'male', phone: '0712000001', email: m1.email });
    expect(r).toMatchObject({ status: 'active', level: 'fellowship' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).roles).toContain('treasurer'); // takes effect in FEMS
    expect((await current()).some((a: any) => a.id === r.id)).toBe(true);
  });

  it('8. only authorised administrators appoint; unregistered members, bad dates and duplicates are refused', async () => {
    await post(sec, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m2.id }).expect(403); // fellowship officers: the Fellowship Administrator
    await post(ord, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m2.id }).expect(403);
    await post(chair, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m2.id }).expect(403);
    await post(admin, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: foreign.id }).expect(400);
    await post(admin, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m2.id, termStart: '2026-05-01', termEnd: '2026-04-01' }).expect(400);
    await post(admin, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m1.id }).expect(409); // already holds it
    await post(admin, '/leadership/appointments', { positionId: pos.chairperson.id, memberId: m4.id }).expect(400); // no login yet
  });

  it('4-5. replacing a leader ends the old appointment as replaced and moves it to the history', async () => {
    await post(admin, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m2.id }).expect(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u1.id } })).roles).not.toContain('treasurer');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u2.id } })).roles).toContain('treasurer');
    const now = await current(admin, `&positionId=${pos.treasurer.id}`);
    expect(now).toHaveLength(1);
    expect(now[0].member.fullName).toBe('Baraka Next');
    const old = (await history()).find((a: any) => a.id === firstTreasurerAppt.id);
    expect(old).toMatchObject({ status: 'former', endReason: 'replaced' });
  });

  it('6. reappointing a former leader creates a new appointment and leaves the old one unchanged', async () => {
    const before = await prisma.leadershipAppointment.findUniqueOrThrow({ where: { id: firstTreasurerAppt.id } });
    const again = (await post(admin, '/leadership/appointments', { positionId: pos.treasurer.id, memberId: m1.id }).expect(201)).body.appointment;
    expect(again.id).not.toBe(firstTreasurerAppt.id);
    const after = await prisma.leadershipAppointment.findUniqueOrThrow({ where: { id: firstTreasurerAppt.id } });
    expect(after).toEqual(before);
    const profile = (await get(admin, `/leadership/members/${m1.id}`).expect(200)).body;
    expect(profile.appointments.filter((a: any) => a.position.key === 'treasurer')).toHaveLength(2);
  });

  it('7. department and group appointments take effect in their modules; changes made there come back', async () => {
    await post(admin, '/leadership/appointments', { positionId: pos.department_chairperson.id, memberId: m3.id, departmentId: dept.id }).expect(403); // the Secretary's job
    const d = (await post(sec, '/leadership/appointments', { positionId: pos.department_chairperson.id, memberId: m3.id, departmentId: dept.id }).expect(201)).body;
    expect(d.appointment.departmentName).toBe(dept.name);
    const dl = await prisma.departmentLeader.findFirstOrThrow({ where: { department_id: dept.id, active_role: 'department_chairperson' } });
    expect(dl.member_id).toBe(m3.id); // the department now shows this leader
    // Vacated on the Departments screen: the directory follows.
    await post(sec, `/department-admin/departments/${dept.id}/leaders/department_chairperson/vacate`, { reason: 'moved away' }).expect(201);
    expect((await current(sec, `&departmentId=${dept.id}`))).toHaveLength(0);
    expect((await history(sec, `&departmentId=${dept.id}`))[0].member.fullName).toBe('Chiku Dept');

    await post(sec, '/leadership/appointments', { positionId: pos.group_male_leader.id, memberId: m4.id, groupId: group.id }).expect(400); // gender rule
    await post(sec, '/leadership/appointments', { positionId: pos.group_female_leader.id, memberId: m4.id, groupId: group.id }).expect(201);
    expect((await prisma.memberGroupMember.findFirstOrThrow({ where: { group_id: group.id, member_id: m4.id } })).leader_role).toBe('female_leader');
    await post(sec, '/leadership/appointments', { positionId: pos.group_female_leader.id, memberId: m4.id, groupId: group.id }).expect(409);

    // A role removed on the Users screen ends the appointment here too.
    const u = await prisma.user.findUniqueOrThrow({ where: { id: u1.id } });
    await prisma.user.update({ where: { id: u1.id }, data: { roles: u.roles.filter((r) => r !== 'treasurer') } });
    expect((await current(admin, `&positionId=${pos.treasurer.id}`))).toHaveLength(0);
  });

  it('ending, suspending and reinstating; configured positions; history is never deleted', async () => {
    const custom = (await post(sec, '/leadership/positions', { name: `Prayer Coordinator ${uniq()}`, level: 'fellowship' }).expect(201)).body;
    await post(ord, '/leadership/positions', { name: 'x', level: 'fellowship' }).expect(403);
    const a = (await post(sec, '/leadership/appointments', { positionId: custom.id, memberId: m4.id }).expect(201)).body.appointment;
    await post(sec, `/leadership/appointments/${a.id}/suspend`, {}).expect(400); // reason required
    await post(sec, `/leadership/appointments/${a.id}/suspend`, { reason: 'Under review' }).expect(201);
    expect((await current(sec)).find((x: any) => x.id === a.id).status).toBe('suspended');
    await post(sec, `/leadership/appointments/${a.id}/reinstate`).expect(201);
    await post(sec, `/leadership/appointments/${a.id}/end`, { reason: 'replaced' }).expect(400);
    await post(sec, `/leadership/appointments/${a.id}/end`, { reason: 'other' }).expect(400); // say why
    await post(sec, `/leadership/appointments/${a.id}/end`, { reason: 'term_completed', endDate: '2020-01-01' }).expect(400); // before the term
    await post(sec, `/leadership/appointments/${a.id}/end`, { reason: 'term_completed' }).expect(201);
    await post(sec, `/leadership/appointments/${a.id}/end`, { reason: 'resigned' }).expect(409);
    const fem = (await current(sec)).find((x: any) => x.position.key === 'group_female_leader');
    await post(sec, `/leadership/appointments/${fem.id}/end`, { reason: 'resigned' }).expect(201);
    expect((await prisma.memberGroupMember.findFirstOrThrow({ where: { group_id: group.id, member_id: m4.id } })).leader_role).toBeNull();
    expect(await prisma.leadershipAppointment.count({ where: { fellowship_id: f.id } })).toBe(6); // 3 treasurer, 1 department, 1 group, 1 configured: none deleted
    const actions = new Set((await prisma.auditLog.findMany({ where: { user_id: { in: [admin.id, sec.id] }, action: { startsWith: 'leadership.' } } })).map((x) => x.action));
    for (const x of ['leadership.appoint', 'leadership.replace', 'leadership.end', 'leadership.suspend', 'leadership.reinstate', 'leadership.position_create']) expect(actions).toContain(x);
  });

  it('9. search, filters and exports; other fellowships and ordinary members see nothing', async () => {
    const byCode = await history(admin, `&search=${m1.member_code}`);
    expect(byCode.every((a: any) => a.member.registrationNumber === m1.member_code)).toBe(true);
    expect(byCode.length).toBeGreaterThan(0);
    expect((await history(admin, '&search=Amani')).length).toBeGreaterThan(0);
    expect(await history(admin, '&year=1999')).toHaveLength(0);
    expect((await history(admin, `&year=${new Date().getFullYear()}`)).length).toBeGreaterThan(0);
    const bin = (res: any, cb: any) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); };
    const pdf = await get(admin, '/leadership/export?tab=history&format=pdf').buffer(true).parse(bin).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const xl = await get(admin, '/leadership/export?tab=current&format=xlsx').buffer(true).parse(bin).expect(200);
    expect((xl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await get(ord, '/leadership/appointments').expect(403);
    const other = await makeUser(prisma, { fellowshipId: fB.id, roles: ['fellowship_admin'] });
    expect((await get(other, '/leadership/appointments?tab=history').expect(200)).body.data).toHaveLength(0);
    await get(other, `/leadership/appointments/${firstTreasurerAppt.id}`).expect(404);
  });
});
