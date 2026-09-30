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

  async function newMoneyRequest(requester = ds1, extra: object = {}) {
    const res = await post(requester, '/finance/money-requests', { title: `Req ${Math.random()}`, amount: 500, purpose: 'camp', ...extra }).expect(201);
    return res.body;
  }
  const status = async (id: string) => (await prisma.moneyRequest.findUnique({ where: { id } }))!.approval_status;

  async function fullyApprove(id: string, requester = ds1) {
    const stage0 = requester === sec ? asst : sec;
    await post(stage0, `/finance/money-requests/${id}/approve`, { decision: 'approved' }).expect(201);
    await post(chair, `/finance/money-requests/${id}/approve`, { decision: 'approved' }).expect(201);
    await post(treas, `/finance/money-requests/${id}/approve`, { decision: 'approved' }).expect(201);
  }

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
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('regression: the previously-broken create endpoints now work', () => {
    it('creates a contribution, expense, budget and money request with the payloads the UI sends', async () => {
      const c = await post(treas, '/finance/contributions', { memberId: member.id, amount: 100, contributionType: 'tithe', date: '2026-09-01' }).expect(201);
      expect(c.body.contribution_type).toBe('tithe');
      expect(c.body.fellowship_id).toBe(fA.id);
      const e = await post(treas, '/finance/expenses', { title: 'Chairs', amount: 250.5, date: '2026-09-01', purpose: 'church chairs' }).expect(201);
      expect(e.body.approval_status).toBe('SUBMITTED');
      expect(e.body.approval_workflow_id).toBeTruthy(); // used to be missing from the response
      const b = await post(treas, '/finance/budgets', { title: 'Youth 2026', amount: 1000, fiscalYear: '2026', departmentId: D1.id }).expect(201);
      expect(b.body.fiscal_year).toBe('2026');
      await newMoneyRequest();
    });
  });

  describe('money request chain: Secretary -> Chairperson -> Treasurer', () => {
    it('one approval never makes a request FINAL_APPROVED (was a critical bypass)', async () => {
      const mr = await newMoneyRequest();
      expect(mr.approval_status).toBe('SUBMITTED');
      await post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
      expect(await status(mr.id)).toBe('UNDER_REVIEW');
      await post(chair, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
      expect(await status(mr.id)).toBe('UNDER_REVIEW');
      await post(treas, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
      expect(await status(mr.id)).toBe('FINAL_APPROVED');
    });

    it('stages must be approved in order by the right role', async () => {
      const mr = await newMoneyRequest();
      await post(treas, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403);
      await post(chair, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403);
      expect(await status(mr.id)).toBe('SUBMITTED');
    });

    it('roles outside the chain cannot approve', async () => {
      const mr = await newMoneyRequest();
      for (const u of [ord, ds2, dc1, ds1]) {
        const res = await post(u, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' });
        expect([400, 403]).toContain(res.status);
      }
      expect(await status(mr.id)).toBe('SUBMITTED');
    });

    it('the requester can never approve their own request', async () => {
      const mr = await newMoneyRequest(sec); // a Secretary raises it
      await post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403);
      await post(sec2, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
    });

    it('one person cannot approve two stages of the same request (three different people are required)', async () => {
      const mr = await newMoneyRequest();
      await post(dual, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
      await post(dual, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403);
      expect(await status(mr.id)).toBe('UNDER_REVIEW');
    });

    it('rejection ends the chain; only the requester can resubmit; then the chain restarts', async () => {
      const mr = await newMoneyRequest();
      await post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'rejected', comment: 'Too high' }).expect(201);
      expect(await status(mr.id)).toBe('REJECTED');
      await post(chair, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403); // rejected requests can't be approved
      await post(sec, `/finance/money-requests/${mr.id}/resubmit`).expect(403); // not the requester
      await post(ds1, `/finance/money-requests/${mr.id}/resubmit`).expect(201);
      expect(await status(mr.id)).toBe('RESUBMITTED');
      await post(asst, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
      expect(await status(mr.id)).toBe('UNDER_REVIEW');
    });

    it('department leaders can only request money for their own department', async () => {
      await post(ds1, '/finance/money-requests', { title: 'x', amount: 5, purpose: 'y', departmentId: D2.id }).expect(403);
      const mr = await newMoneyRequest(ds1, { departmentId: D1.id });
      expect(mr.department_id).toBe(D1.id);
      const noDept = await newMoneyRequest(ds1);
      expect(noDept.department_id).toBe(D1.id); // forced to their own department
    });

    it('cross-tenant, garbage ids and bad decisions', async () => {
      const mr = await newMoneyRequest();
      await post(secB, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403);
      await post(chairB, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(403);
      await post(sec, '/finance/money-requests/not-a-uuid/approve', { decision: 'approved' }).expect(404);
      await post(sec, `/finance/money-requests/${randomUUID()}/approve`, { decision: 'approved' }).expect(404);
      await post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'maybe' }).expect(400);
      await post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved', comment: 'x'.repeat(501) }).expect(400);
    });

    it('the generic /approvals/:id/decide route cannot bypass the chain (same checks, same entity sync)', async () => {
      const mr = await newMoneyRequest();
      // The generic route is role-gated, so an ordinary member is refused at the door (403) and never reaches the
      // workflow engine - the chain cannot be bypassed from a different entry point.
      await post(ord, `/approvals/${mr.approval_workflow_id}/decide`, { decision: 'approved' }).expect(403);
      await post(sec, `/approvals/${mr.approval_workflow_id}/decide`, { decision: 'approved' }).expect(201);
      expect(await status(mr.id)).toBe('UNDER_REVIEW'); // entity status is kept in sync by the engine
      await post(sec, '/approvals/not-a-uuid/decide', { decision: 'approved' }).expect(404);
    });

    it('pending approvals are now listed for the people who must act (endpoint used to be admin-only)', async () => {
      const mr = await newMoneyRequest();
      const res = await get(sec, '/approvals').expect(200);
      expect(res.body.map((a: any) => a.entity_id)).toContain(mr.id);
      await get(ord, '/approvals').expect(403);
    });

    it('approvers are notified (with neutral text) when a request needs them', async () => {
      const mr = await newMoneyRequest(ds1, { title: 'SECRET-TITLE-XYZ' });
      const n = await prisma.notification.findMany({ where: { recipient_user_id: sec.id, entity_id: mr.id } });
      expect(n.length).toBeGreaterThan(0);
      expect(JSON.stringify(n)).not.toContain('SECRET-TITLE-XYZ');
    });
  });

  describe('release (payout) of an approved money request', () => {
    it('cannot be released before the whole chain has approved', async () => {
      const mr = await newMoneyRequest();
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(409);
      await post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }).expect(201);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(409);
      expect(await prisma.moneyRequestRelease.count({ where: { money_request_id: mr.id } })).toBe(0);
    });

    it('only the Treasurer can release, exactly once, never above the approved amount', async () => {
      const mr = await newMoneyRequest();
      await fullyApprove(mr.id);
      for (const u of [sec, asst, chair, ds1, ord, secB]) {
        await post(u, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(403);
      }
      await post(treasB, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(403); // other fellowship
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'crypto' }).expect(400);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash', amount: 500.01 }).expect(409);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash', amount: 0 }).expect(400);
      const ok = await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'bank_transfer', reference: 'TXN-1', amount: 450 }).expect(201);
      expect(ok.body.amount).toBe('450');
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(409); // duplicate release
      expect(await prisma.moneyRequestRelease.count({ where: { money_request_id: mr.id } })).toBe(1);
      await post(treas, '/finance/money-requests/not-a-uuid/release', { method: 'cash' }).expect(404);
    });

    it('the release is visible on the request and audited', async () => {
      const mr = await newMoneyRequest();
      await fullyApprove(mr.id);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(201);
      const list = await get(treas, '/finance/money-requests').expect(200);
      expect(list.body.find((r: any) => r.id === mr.id).release.method).toBe('cash');
      expect(await prisma.auditLog.count({ where: { entity_id: mr.id, action: 'finance.money_request_release' } })).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('two simultaneous releases: exactly one succeeds, the other gets 409, one row exists', async () => {
      const mr = await newMoneyRequest();
      await fullyApprove(mr.id);
      const results = await Promise.all([
        post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }),
        post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }),
        post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await prisma.moneyRequestRelease.count({ where: { money_request_id: mr.id } })).toBe(1);
    });

    it('two simultaneous approvals of the same stage: exactly one wins', async () => {
      const mr = await newMoneyRequest();
      const results = await Promise.all([
        post(sec, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }),
        post(sec2, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }),
        post(asst, `/finance/money-requests/${mr.id}/approve`, { decision: 'approved' }),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status !== 201).every((r) => [403, 409].includes(r.status))).toBe(true);
      const steps = await prisma.approvalStep.findMany({ where: { approval_id: mr.approval_workflow_id }, orderBy: { stage_order: 'asc' } });
      expect(steps.filter((s) => s.status === 'approved')).toHaveLength(1); // never two approved stages from one round
      expect(await status(mr.id)).toBe('UNDER_REVIEW');
    });
  });

  describe('expenses and budgets share the same protections', () => {
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

    it('a budget follows the same chain', async () => {
      const b = (await post(treas, '/finance/budgets', { title: 'B1', amount: 5000, fiscalYear: '2026' }).expect(201)).body;
      await post(asst, `/finance/budgets/${b.id}/approve`, { decision: 'approved' }).expect(201);
      expect((await prisma.budget.findUnique({ where: { id: b.id } }))!.approval_status).toBe('UNDER_REVIEW');
      await post(chair, `/finance/budgets/${b.id}/approve`, { decision: 'approved' }).expect(201);
      expect((await prisma.budget.findUnique({ where: { id: b.id } }))!.approval_status).toBe('FINAL_APPROVED');
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

    it('an approved delete moves the row to the recycle bin and removes it', async () => {
      const id = await newContribution(40);
      const req = await post(treas, `/finance/contributions/${id}/delete-request`, { reason: 'duplicate entry' }).expect(201);
      await post(sec2, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect(await prisma.contribution.findUnique({ where: { id } })).not.toBeNull();
      await post(chair, `/approvals/${req.body.id}/decide`, { decision: 'approved' }).expect(201);
      expect(await prisma.contribution.findUnique({ where: { id } })).toBeNull();
      const bin = await prisma.deletedRecord.findFirst({ where: { original_record_id: id } });
      expect(bin?.original_collection).toBe('contributions');
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
