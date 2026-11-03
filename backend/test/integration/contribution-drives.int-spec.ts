import { INestApplication } from '@nestjs/common';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

/**
 * Contribution Drives end to end: create a drive (central and department), record member and typed-name pledges and
 * cash inside it, check totals and what each contributor still owes, the drive's expenses, closing, and isolation.
 */
jest.setTimeout(300_000);

describeDb('Contribution Drives (real Postgres, HTTP)', () => {
  let app: INestApplication;
  let prisma: any;
  let f: any, fB: any, dept: any, other: any;
  let treas: any, sec: any, chair: any, ord: any, dSec: any, oChair: any, treasB: any;
  let m1: any, m2: any;
  const today = () => new Date().toISOString().slice(0, 10);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const get = (u: any, url: string) => api(app, u.token).get(url);
  async function lead(user: any, departmentId: string, role: string, memberId: string) {
    await prisma.departmentLeader.create({ data: { department_id: departmentId, user_id: user.id, role_in_department: role, active_role: role, fellowship_id: f.id, member_id: memberId } });
  }
  const decide = (u: any, id: string, expect = 201) => post(u, `/finance/approvals/${id}/decide`, { decision: 'approved' }).expect(expect);
  const workflowOf = (entityId: string, type: string) => prisma.approval.findFirstOrThrow({ where: { entity_id: entityId, workflow_type: type }, orderBy: { created_at: 'desc' } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    f = await makeFellowship(prisma, 'DRV');
    fB = await makeFellowship(prisma, 'DRVB');
    const mk = (roles: string[], fellowshipId = f.id) => makeUser(prisma, { fellowshipId, roles });
    treas = await mk(['treasurer']);
    sec = await mk(['secretary']);
    chair = await mk(['chairperson']);
    ord = await mk(['ordinary_member']);
    treasB = await mk(['treasurer'], fB.id);
    dept = await makeDepartment(prisma, f.id, 'Youth');
    other = await makeDepartment(prisma, f.id, 'Choir');
    m1 = await makeMember(prisma, { fellowshipId: f.id, name: 'Asha Giver' });
    m2 = await makeMember(prisma, { fellowshipId: f.id, name: 'Baraka Giver' });
    dSec = await mk(['department_secretary']);
    oChair = await mk(['department_chairperson']);
    await lead(dSec, dept.id, 'department_secretary', m1.id);
    await lead(oChair, other.id, 'department_chairperson', m2.id);
  });

  afterAll(async () => { await app?.close(); });

  let drive: any;

  it('the Treasurer or Secretary creates a central drive with a target; others cannot', async () => {
    drive = (await post(treas, '/finance/drives', { name: `Outreach ${uniq()}`, kind: 'outreach', target: 10000, startDate: today() }).expect(201)).body;
    expect(drive).toMatchObject({ kind: 'outreach', target: '10000.00', status: 'active', totals: { collected: '0.00', pledged: '0.00', balance: '0.00', progressPercent: 0 } });
    await post(sec, '/finance/drives', { name: `Membership ${uniq()}`, kind: 'membership' }).expect(201);
    await post(chair, '/finance/drives', { name: 'nope' }).expect(403);
    await post(ord, '/finance/drives', { name: 'nope' }).expect(403);
    await post(treas, '/finance/drives', { name: drive.name }).expect(409);
    await post(treas, '/finance/drives', { name: 'x', kind: 'party' }).expect(400);
    await post(treas, '/finance/drives', { name: 'x', startDate: '2026-05-01', endDate: '2026-01-01' }).expect(400);
  });

  it('records member and typed-name pledges and cash; each contributor shows pledged, paid and owed', async () => {
    await post(treas, `/finance/drives/${drive.id}/pledges`, { memberId: m1.id, amount: 3000 }).expect(201);
    const typedPledge = (await post(treas, `/finance/drives/${drive.id}/pledges`, { contributorName: 'Mzee  Juma', amount: 1000 }).expect(201)).body;
    expect(typedPledge.key).toBe('n:mzee juma');
    const cash = (await post(treas, `/finance/drives/${drive.id}/payments`, { memberId: m1.id, amount: 1200, date: today(), paymentMethod: 'cash' }).expect(201)).body;
    expect(cash.receipt_number).toMatch(/^RCT-/);
    expect(cash.campaign_id).toBe(drive.id);
    await post(treas, `/finance/drives/${drive.id}/payments`, { contributorName: 'mzee juma', amount: 1500, date: today() }).expect(201); // overpays
    await post(treas, `/finance/drives/${drive.id}/payments`, { memberId: m2.id, amount: 500, date: today() }).expect(201); // cash, no pledge
    await post(treas, `/finance/drives/${drive.id}/pledges`, {}).expect(400); // nobody named
    await post(treas, `/finance/drives/${drive.id}/pledges`, { memberId: m1.id, amount: 0 }).expect(400);

    const d = (await get(chair, `/finance/drives/${drive.id}`).expect(200)).body;
    expect(d.totals).toMatchObject({ collected: '3200.00', pledged: '4000.00', payments: 3, progressPercent: 32, remaining: '6800.00' });
    const by = (name: string) => d.contributors.find((c: any) => c.name === name);
    expect(by('Asha Giver')).toMatchObject({ pledged: '3000.00', paid: '1200.00', owed: '1800.00' });
    expect(by('Mzee Juma')).toMatchObject({ pledged: '1000.00', paid: '1500.00', owed: '0.00', memberId: null });
    expect(by('Baraka Giver')).toMatchObject({ pledged: '0.00', paid: '500.00', owed: '0.00' });

    const one = (await get(treas, `/finance/drives/${drive.id}/contributors/${encodeURIComponent(by('Asha Giver').key)}`).expect(200)).body;
    expect(one.pledges).toHaveLength(1);
    expect(one.payments).toHaveLength(1);
    expect(one.contributor.owed).toBe('1800.00');
    await get(treas, `/finance/drives/${drive.id}/contributors/x:nope`).expect(404);
    // The cash is an ordinary contribution: it is in the ledger and in the reports.
    expect(await prisma.ledgerEntry.count({ where: { source_id: cash.id } })).toBe(1);
  });

  it('a drive\'s expense goes through approval and counts against its balance once paid', async () => {
    const e = (await post(treas, '/finance/expenses', { title: 'Transport', amount: 700, date: today(), campaignId: drive.id }).expect(201)).body;
    let d = (await get(treas, `/finance/drives/${drive.id}`).expect(200)).body;
    expect(d.expenses.map((x: any) => x.id)).toContain(e.id);
    expect(d.totals).toMatchObject({ expensesPaid: '0.00', expensesPending: '700.00' });
    const wf = await workflowOf(e.id, 'expense');
    await decide(sec, wf.id);
    await decide(chair, wf.id);
    await post(treas, `/finance/expenses/${e.id}/pay`, {}).expect(201);
    d = (await get(treas, `/finance/drives/${drive.id}`).expect(200)).body;
    expect(d.totals).toMatchObject({ expensesPaid: '700.00', expensesPending: '0.00', balance: '2500.00' });
  });

  it('a closed drive accepts no new pledges or cash, and can be reopened', async () => {
    await put(treas, `/finance/drives/${drive.id}`, { status: 'closed' }).expect(200);
    await post(treas, `/finance/drives/${drive.id}/pledges`, { memberId: m1.id, amount: 10 }).expect(409);
    await post(treas, `/finance/drives/${drive.id}/payments`, { memberId: m1.id, amount: 10, date: today() }).expect(409);
    await post(treas, '/finance/contributions', { memberId: m1.id, amount: 10, date: today(), campaignId: drive.id }).expect(409);
    expect((await get(treas, '/finance/drives?status=closed').expect(200)).body.map((x: any) => x.id)).toContain(drive.id);
    await put(treas, `/finance/drives/${drive.id}`, { status: 'active' }).expect(200);
  });

  it('a department runs its own drives; other departments and other fellowships cannot see or record', async () => {
    const dd = (await post(dSec, '/finance/drives', { name: `Youth camp ${uniq()}`, kind: 'event', target: 2000, departmentId: dept.id }).expect(201)).body;
    expect(dd.departmentId).toBe(dept.id);
    await post(dSec, '/finance/drives', { name: 'central from a department' }).expect(403);
    await post(dSec, `/finance/drives/${dd.id}/payments`, { memberId: m1.id, amount: 300, date: today() }).expect(201);
    expect((await get(dSec, `/finance/drives?departmentId=${dept.id}`).expect(200)).body.map((x: any) => x.id)).toEqual([dd.id]);
    await get(dSec, `/finance/drives/${drive.id}`).expect(403); // central drive
    await get(oChair, `/finance/drives/${dd.id}`).expect(403); // another department
    await post(oChair, `/finance/drives/${dd.id}/payments`, { memberId: m2.id, amount: 1, date: today() }).expect(403);
    await post(treas, '/finance/contributions', { memberId: m1.id, amount: 5, date: today(), campaignId: dd.id }).expect(400); // central money into a department drive
    await get(treasB, `/finance/drives/${drive.id}`).expect(404);
    expect((await get(treasB, '/finance/drives').expect(200)).body.map((x: any) => x.id)).not.toContain(drive.id);
    await get(treas, '/finance/drives/not-a-uuid').expect(404);
  });

  it('the Treasurer can find members to pick as contributors: name and number only, own fellowship only', async () => {
    const found = (await get(treas, '/finance/member-search?search=Asha').expect(200)).body;
    expect(found).toEqual([expect.objectContaining({ id: m1.id, fullName: 'Asha Giver' })]);
    expect(Object.keys(found[0]).sort()).toEqual(['fullName', 'id', 'memberCode']);
    expect((await get(treasB, '/finance/member-search?search=Asha').expect(200)).body).toEqual([]);
    await get(ord, '/finance/member-search?search=Asha').expect(403);
    await get(dSec, '/finance/member-search?search=Asha').expect(403); // department leaders use their department's members
  });
});
