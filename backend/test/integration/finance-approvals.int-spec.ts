import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  api,
  createTestApp,
  describeDb,
  getPrisma,
  makeDepartment,
  makeFellowship,
  makeMember,
  makeUser,
} from './harness';

describeDb('Phase 15 - finance approval chain, release, concurrency, edit/delete (real Postgres)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, D1: any, D2: any;
  let sec: any, sec2: any, asst: any, chair: any, treas: any, ds1: any, dc1: any, ds2: any, ord: any, dual: any;
  let secB: any, chairB: any, treasB: any;
  let member: any;

  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const get = (u: any, url: string) => api(app, u.token).get(url);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'FA');
    fB = await makeFellowship(prisma, 'FB');
    D1 = await makeDepartment(prisma, fA.id, 'FD1');
    D2 = await makeDepartment(prisma, fA.id, 'FD2');
    const mk = (roles: string[], departmentId?: string) => makeUser(prisma, { fellowshipId: fA.id, roles, departmentId });
    sec = await mk(['secretary']);
    sec2 = await mk(['secretary']);
    asst = await mk(['assistant_secretary']);
    chair = await mk(['chairperson']);
    treas = await mk(['treasurer']);
    ds1 = await mk(['department_secretary'], D1.id);
    dc1 = await mk(['department_chairperson'], D1.id);
    ds2 = await mk(['department_secretary'], D2.id);
    ord = await mk(['ordinary_member']);
    dual = await mk(['secretary', 'chairperson']);
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    chairB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['chairperson'] });
    treasB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['treasurer'] });
    member = await makeMember(prisma, { fellowshipId: fA.id });
    // Payments leave a real account, which cannot be overdrawn: put money in the default cash account first.
    await api(app, treas.token).post('/finance/contributions', { memberId: member.id, amount: 1000000, date: '2026-09-01' }).expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('regression: the previously-broken create endpoints now work', () => {
    it('creates a contribution and an expense with the payloads the UI sends', async () => {
      const c = await post(treas, '/finance/contributions', { memberId: member.id, amount: 100, contributionType: 'tithe', date: '2026-09-01' }).expect(201);
      expect(c.body.contribution_type).toBe('tithe');
      expect(c.body.fellowship_id).toBe(fA.id);
      const e = await post(treas, '/finance/expenses', { title: 'Chairs', amount: 250.5, date: '2026-09-01', purpose: 'church chairs' }).expect(201);
      expect(e.body.approval_status).toBe('SUBMITTED');
      expect(e.body.approval_workflow_id).toBeTruthy(); // used to be missing from the response
    });
  });

  describe('expenses are protected by the approval chain', () => {
    it('an expense is FINAL_APPROVED only after Secretary AND Chairperson; the recorder cannot approve', async () => {
      const e = (await post(treas, '/finance/expenses', { title: 'Tent', amount: 300, date: '2026-09-02', purpose: 'camp' }).expect(201)).body;
      await post(sec, `/finance/expenses/${e.id}/approve`, { decision: 'approved' }).expect(201);
      expect((await prisma.expense.findUnique({ where: { id: e.id } }))!.approval_status).toBe('UNDER_REVIEW');
      await post(treas, `/finance/expenses/${e.id}/approve`, { decision: 'approved' }).expect(403);
      await post(chair, `/finance/expenses/${e.id}/approve`, { decision: 'approved' }).expect(201);
      expect((await prisma.expense.findUnique({ where: { id: e.id } }))!.approval_status).toBe('FINAL_APPROVED');
    });

    it('a secretary who recorded the expense cannot approve it', async () => {
      const e = (await post(sec, '/finance/expenses', { title: 'Self', amount: 10, date: '2026-09-02', purpose: 'x' }).expect(201)).body;
      await post(sec, `/finance/expenses/${e.id}/approve`, { decision: 'approved' }).expect(403);
    });
  });

  describe('edit / delete requests now really change data - but only after final approval', () => {
    let contributionId: string;
    const newContribution = async (amount = 100) =>
      (await post(treas, '/finance/contributions', { memberId: member.id, amount, contributionType: 'offering', date: '2026-09-03' }).expect(201)).body.id as string;

    it('an approved edit is applied atomically; before that nothing changes', async () => {
      contributionId = await newContribution(100);
      const req = await post(treas, `/finance/contributions/${contributionId}/edit-request`, { amount: 175.5, reason: 'typo' }).expect(201);
      expect((await prisma.contribution.findUnique({ where: { id: contributionId } }))!.amount.toString()).toBe('100');
      await post(treas, `/finance/contributions/${contributionId}/edit-request`, { amount: 1, reason: 'dup' }).expect(409); // one pending request at a time
      await post(sec, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect((await prisma.contribution.findUnique({ where: { id: contributionId } }))!.amount.toString()).toBe('100'); // still pending stage 2
      await post(chair, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect((await prisma.contribution.findUnique({ where: { id: contributionId } }))!.amount.toString()).toBe('175.5');
      expect(await prisma.auditLog.count({ where: { entity_id: contributionId, action: 'finance.contribution_edit_applied' } })).toBe(1);
    });

    it('a rejected edit changes nothing', async () => {
      const id = await newContribution(80);
      const req = await post(treas, `/finance/contributions/${id}/edit-request`, { amount: 8000, reason: 'oops' }).expect(201);
      await post(sec, `/approvals/${req.body.id}/decide`, { decision: 'rejected' }).expect(201);
      expect((await prisma.contribution.findUnique({ where: { id } }))!.amount.toString()).toBe('80');
    });

    it('edit requests only accept whitelisted fields and valid values', async () => {
      const id = await newContribution(60);
      const bad = (body: object) => post(treas, `/finance/contributions/${id}/edit-request`, { reason: 'r', ...body });
      await bad({}).expect(400);
      await bad({ fellowship_id: fB.id, member_id: randomUUID(), approval_status: 'FINAL_APPROVED' }).expect(400); // nothing editable supplied
      await bad({ amount: -5 }).expect(400);
      await bad({ amount: 'abc' }).expect(400);
      await post(treas, `/finance/contributions/${id}/edit-request`, { amount: 5 }).expect(400); // reason required
      await post(ord, `/finance/contributions/${id}/edit-request`, { amount: 5, reason: 'x' }).expect(403);
      await post(secB, `/finance/contributions/${id}/edit-request`, { amount: 5, reason: 'x' }).expect(403);
    });

    it('an approved delete reverses the contribution in the ledger and keeps the record', async () => {
      const id = await newContribution(40);
      const req = await post(treas, `/finance/contributions/${id}/delete-request`, { reason: 'duplicate entry' }).expect(201);
      await post(sec2, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect((await prisma.contribution.findUnique({ where: { id } }))!.status).toBe('active');
      await post(chair, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      const after = await prisma.contribution.findUnique({ where: { id } });
      expect(after).toMatchObject({ status: 'reversed', reversal_reason: 'duplicate entry' }); // never deleted
      const entries = await prisma.ledgerEntry.findMany({ where: { source_id: id }, orderBy: { created_at: 'asc' } });
      expect(entries.map((e) => [e.entry_type, e.amount.toFixed(2)])).toEqual([['contribution', '40.00'], ['reversal', '-40.00']]);
      expect(await prisma.deletedRecord.findFirst({ where: { original_record_id: id } })).toBeNull();
    });

    it('the requester cannot approve their own edit; the same person cannot approve both stages', async () => {
      const id = await newContribution(30);
      const req = await post(sec, `/finance/contributions/${id}/edit-request`, { amount: 31, reason: 'r' }).expect(201);
      await post(sec, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(403); // own request
      await post(dual, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      await post(dual, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(403);
    });

    it('an expense edit request applies to the expense only after approval', async () => {
      const e = (await post(treas, '/finance/expenses', { title: 'Old title', amount: 20, date: '2026-09-04', purpose: 'p' }).expect(201)).body;
      const req = await post(treas, `/finance/expenses/${e.id}/edit-request`, { title: 'New title', reason: 'rename' }).expect(201);
      await post(sec, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      await post(chair, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      const after = await prisma.expense.findUnique({ where: { id: e.id } });
      expect(after!.title).toBe('New title');
      expect(after!.approval_status).toBe('SUBMITTED'); // the edit workflow must NOT overwrite the expense's own approval status
    });
  });
});
