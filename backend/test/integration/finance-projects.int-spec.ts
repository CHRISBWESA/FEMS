import { INestApplication } from '@nestjs/common';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

/**
 * Finance, projects and department financial management, end to end over HTTP against real Postgres:
 * the ledger, receipts, allocations, budgets and revisions, money requests and payments, membership
 * fees, transfers, isolation, projects and closure, periods, exports and audit.
 */
jest.setTimeout(300_000);

describeDb('Finance, projects and department finances (real Postgres, HTTP)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let f: any, fB: any;
  let treas: any, sec: any, asst: any, chair: any, asstChair: any, secB: any;
  let dChair: any, dSec: any, oChair: any;
  let dept: any, other: any;
  let m1: any, m2: any, m3: any;
  let central: any, bank: any;
  let projA: any, projB: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const today = () => new Date().toISOString().slice(0, 10);

  async function lead(user: any, departmentId: string, role: string, memberId: string) {
    await prisma.departmentLeader.create({ data: { department_id: departmentId, user_id: user.id, role_in_department: role, active_role: role, fellowship_id: f.id, member_id: memberId } });
  }

  /** Decides the current stage of an approval through the finance inbox. */
  async function decide(u: any, approvalId: string, decision = 'approved', comment?: string, expect = 201) {
    return post(u, `/finance/approvals/${approvalId}/decide`, { decision, comment }).expect(expect);
  }
  async function workflowOf(entityId: string, type: string) {
    return prisma.approval.findFirstOrThrow({ where: { entity_id: entityId, workflow_type: type }, orderBy: { created_at: 'desc' } });
  }
  async function balance(accountId: string) {
    return (await prisma.financialAccount.findUniqueOrThrow({ where: { id: accountId } })).balance.toFixed(2);
  }
  async function approvedProject(by: any, body: object) {
    const p = (await post(by, '/projects', { submit: true, ...body }).expect(201)).body;
    const wf = await workflowOf(p.id, 'project');
    const steps = await prisma.approvalStep.findMany({ where: { approval_id: wf.id }, orderBy: { stage_order: 'asc' } });
    for (const s of steps) {
      if (s.status === 'skipped') continue;
      const who = s.approver_role === 'treasurer' ? treas : s.approver_role === 'secretary' ? (by.id === sec.id ? asst : sec) : (by.id === chair.id ? asstChair : chair);
      await decide(who, wf.id);
    }
    return (await get(by, `/projects/${p.id}`).expect(200)).body;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    f = await makeFellowship(prisma, 'FIN');
    fB = await makeFellowship(prisma, 'FINB');
    treas = await makeUser(prisma, { fellowshipId: f.id, roles: ['treasurer'] });
    sec = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
    asst = await makeUser(prisma, { fellowshipId: f.id, roles: ['assistant_secretary'] });
    chair = await makeUser(prisma, { fellowshipId: f.id, roles: ['chairperson'] });
    asstChair = await makeUser(prisma, { fellowshipId: f.id, roles: ['assistant_chairperson'] });
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    dept = await makeDepartment(prisma, f.id, 'Choir');
    other = await makeDepartment(prisma, f.id, 'Media');
    m1 = await makeMember(prisma, { fellowshipId: f.id, name: 'Asha Member' });
    m2 = await makeMember(prisma, { fellowshipId: f.id, name: 'Baraka Member' });
    m3 = await makeMember(prisma, { fellowshipId: f.id, name: 'Chausiku Member' });
    for (const m of [m1, m2]) await prisma.departmentMember.create({ data: { department_id: dept.id, member_id: m.id } });
    dChair = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_chairperson'] });
    dSec = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_secretary'] });
    oChair = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_chairperson'] });
    await lead(dChair, dept.id, 'department_chairperson', m1.id);
    await lead(dSec, dept.id, 'department_secretary', m2.id);
    await lead(oChair, other.id, 'department_chairperson', m3.id);
  });

  afterAll(async () => { await app?.close(); });

  // ------------------------------------------------------------ accounts, contributions, receipts

  describe('accounts and contributions', () => {
    it('the Treasurer opens accounts; balances come only from the ledger', async () => {
      central = (await post(treas, '/finance/accounts', { name: 'Cash box', accountType: 'cash', openingBalance: 100000 }).expect(201)).body;
      bank = (await post(treas, '/finance/accounts', { name: 'CRDB', accountType: 'bank', reference: '0150-111' }).expect(201)).body;
      expect(central.balance).toBe('100000.00');
      await put(treas, `/finance/accounts/${central.id}`, { balance: 5 }).expect(400);
      await post(sec, '/finance/accounts', { name: 'X', accountType: 'cash' }).expect(403);
      await post(dSec, '/finance/accounts', { name: 'Choir cash', accountType: 'cash', departmentId: dept.id }).expect(403); // the Department Chairperson opens accounts
      const entries = (await get(treas, `/finance/accounts/${central.id}/entries`).expect(200)).body;
      expect(entries.data).toHaveLength(1);
      expect(entries.data[0]).toMatchObject({ entry_type: 'opening_balance', amount: '100000.00' });
    });

    it('1-2. records member, external and anonymous contributions with unique receipts', async () => {
      const a = (await post(treas, '/finance/contributions', { memberId: m1.id, amount: 20000, date: today(), accountId: central.id, paymentMethod: 'cash' }).expect(201)).body;
      const b = (await post(treas, '/finance/contributions', { contributorType: 'external', contributorName: 'Visiting Pastor', amount: 5000, date: today(), accountId: central.id }).expect(201)).body;
      const c = (await post(treas, '/finance/contributions', { contributorType: 'anonymous', contributorName: 'should be dropped', amount: 1000, date: today(), accountId: central.id }).expect(201)).body;
      expect(new Set([a.receipt_number, b.receipt_number, c.receipt_number]).size).toBe(3);
      expect(a.receipt_number).toMatch(/^RCT-\d{4}-\d{5}$/);
      expect(c.contributor_name).toBeNull();
      expect(await balance(central.id)).toBe('126000.00');
      await post(treas, '/finance/contributions', { contributorType: 'external', amount: 10, date: today() }).expect(400); // name required
      await post(treas, '/finance/contributions', { memberId: m1.id, amount: 0, date: today() }).expect(400);

      const receipt = (await get(treas, `/finance/contributions/${c.id}/receipt`).expect(200)).body;
      expect(receipt).toMatchObject({ receiptNumber: c.receipt_number, contributor: 'Anonymous', amount: '1000.00' });
      const pdf = await get(treas, `/finance/contributions/${a.id}/receipt?format=pdf`).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); }).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('the same payment reference can never be recorded twice', async () => {
      const ref = `MP${uniq()}`;
      await post(treas, '/finance/contributions', { memberId: m2.id, amount: 3000, date: today(), paymentMethod: 'mobile_money', paymentReference: ref, accountId: central.id }).expect(201);
      await post(treas, '/finance/contributions', { memberId: m2.id, amount: 3000, date: today(), paymentMethod: 'mobile_money', paymentReference: ref.toLowerCase(), accountId: central.id }).expect(409);
    });
  });

  // ------------------------------------------------------------ projects and allocations

  describe('projects and allocations', () => {
    it('13. a fellowship project goes Treasurer -> Secretary -> Chairperson before it can be funded', async () => {
      const draft = (await post(sec, '/projects', { name: `Hall roof ${uniq()}`, purpose: 'Repair the roof', budgetAmount: 300000, coordinatingDepartmentId: dept.id, fundingSources: [{ sourceType: 'contributions', name: 'Members', expectedAmount: 200000 }] }).expect(201)).body;
      expect(draft.status).toBe('DRAFT');
      expect(draft.scope).toBe('fellowship'); // coordinated by a department, but central money
      await post(treas, '/finance/contributions', { memberId: m1.id, amount: 100, date: today(), allocations: [{ projectId: draft.id, amount: 100 }] }).expect(400); // not approved yet
      const submitted = (await post(sec, `/projects/${draft.id}/submit`).expect(201)).body;
      expect(submitted.status).toBe('PENDING_APPROVAL');
      const wf = await workflowOf(draft.id, 'project');
      await decide(sec, wf.id, 'approved', undefined, 403); // own request / not the stage
      await decide(treas, wf.id);
      await decide(sec, wf.id, 'approved', undefined, 403); // creator cannot decide
      await decide(asst, wf.id);
      await decide(chair, wf.id);
      projA = (await get(sec, `/projects/${draft.id}`).expect(200)).body;
      expect(projA.status).toBe('APPROVED');
      projB = await approvedProject(chair, { name: `Sound system ${uniq()}`, purpose: 'New speakers', budgetAmount: 50000 });
      expect(projB.status).toBe('APPROVED');
    });

    it('3. one contribution split across two projects is counted once', async () => {
      const before = await balance(central.id);
      const c = (await post(treas, '/finance/contributions', { memberId: m1.id, amount: 10000, date: today(), accountId: central.id, allocations: [{ projectId: projA.id, amount: 6000 }, { projectId: projB.id, amount: 3000 }] }).expect(201)).body;
      expect(Number(await balance(central.id)) - Number(before)).toBe(10000);
      const d = (await get(treas, `/finance/contributions/${c.id}`).expect(200)).body;
      expect(d).toMatchObject({ allocatedAmount: '9000.00', unallocatedAmount: '1000.00' });
      await post(treas, '/finance/contributions', { memberId: m1.id, amount: 100, date: today(), allocations: [{ projectId: projA.id, amount: 101 }] }).expect(400);
      // Re-allocating keeps the history.
      await put(treas, `/finance/contributions/${c.id}/allocations`, { allocations: [{ projectId: projA.id, amount: 10000 }], reason: 'Donor asked' }).expect(200);
      const rows = await prisma.contributionAllocation.findMany({ where: { contribution_id: c.id } });
      expect(rows.filter((r) => r.is_active)).toHaveLength(1);
      expect(rows.filter((r) => !r.is_active)).toHaveLength(2);
      const p = (await get(treas, `/projects/${projA.id}`).expect(200)).body;
      expect(p.financials.contributions).toBe('10000.00');
    });
  });

  // ------------------------------------------------------------ budgets, money requests, expenses

  describe('budgets, money requests and expenses', () => {
    let budget: any;

    it('6. a central budget with lines is approved by the Secretary and Chairperson', async () => {
      budget = (await post(treas, '/finance/budgets', { title: 'Operations', fiscalYear: String(new Date().getFullYear()), lines: [{ name: 'Transport', amount: 20000 }, { name: 'Stationery', amount: 5000 }] }).expect(201)).body;
      expect(budget).toMatchObject({ amount: '25000.00', approval_status: 'SUBMITTED' });
      expect(budget.lines).toHaveLength(2);
      const wf = await workflowOf(budget.id, 'budget');
      await decide(treas, wf.id, 'approved', undefined, 403);
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      budget = (await get(treas, `/finance/budgets/${budget.id}`).expect(200)).body;
      expect(budget.approval_status).toBe('FINAL_APPROVED');
    });

    it('15. a revision needs a reason and approval, keeps the old version, and does nothing while pending', async () => {
      const lines = budget.lines.map((l: any) => ({ id: l.id, name: l.name, amount: l.name === 'Transport' ? 30000 : l.approved }));
      await post(treas, `/finance/budgets/${budget.id}/revisions`, { lines }).expect(400);
      const rev = (await post(treas, `/finance/budgets/${budget.id}/revisions`, { lines, reason: 'Fuel prices rose' }).expect(201)).body;
      expect((await get(treas, `/finance/budgets/${budget.id}`).expect(200)).body.amount).toBe('25000.00');
      const wf = await workflowOf(rev.id, 'budget_revision');
      const steps = await prisma.approvalStep.findMany({ where: { approval_id: wf.id }, orderBy: { stage_order: 'asc' } });
      expect(steps[0].status).toBe('skipped'); // prepared by the Treasurer
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      const after = (await get(treas, `/finance/budgets/${budget.id}`).expect(200)).body;
      expect(after).toMatchObject({ amount: '35000.00', version: 2 });
      expect(after.revisions[0]).toMatchObject({ status: 'FINAL_APPROVED', previous_amount: '25000.00' });
    });

    it('7-8. a money request goes Treasurer -> Secretary -> Chairperson, then is paid once as an expense', async () => {
      const line = budget.lines.find((l: any) => l.name === 'Transport');
      const mr = (await post(sec, '/finance/money-requests', { title: 'Trip', amount: 8000, purpose: 'Conference', budgetLineId: line.id, requiredDate: today() }).expect(201)).body;
      expect(mr.request_number).toMatch(/^MR-/);
      const wf = await workflowOf(mr.id, 'money_request');
      await decide(sec, wf.id, 'approved', undefined, 403); // self
      await decide(treas, wf.id);
      await decide(asst, wf.id);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash' }).expect(409); // not final yet
      await decide(chair, wf.id);
      const before = await balance(central.id);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash', accountId: central.id }).expect(201);
      await post(treas, `/finance/money-requests/${mr.id}/release`, { method: 'cash', accountId: central.id }).expect(409);
      expect(Number(before) - Number(await balance(central.id))).toBe(8000);
      const expense = await prisma.expense.findUniqueOrThrow({ where: { money_request_id: mr.id } });
      expect(expense).toMatchObject({ payment_status: 'paid', budget_line_id: line.id });
      const perf = (await get(treas, `/finance/budgets/${budget.id}`).expect(200)).body;
      expect(perf.lines.find((l: any) => l.id === line.id).spent).toBe('8000.00');
    });

    it('8. an approved central expense is not paid until the Treasurer pays it; overdrawing is refused', async () => {
      const e = (await post(treas, '/finance/expenses', { title: 'Printer ink', amount: 4000, date: today(), purpose: 'Office', accountId: bank.id }).expect(201)).body;
      const wf = await workflowOf(e.id, 'expense');
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      let d = (await get(treas, `/finance/expenses/${e.id}`).expect(200)).body;
      expect(d.displayStatus).toBe('approved');
      await post(treas, `/finance/expenses/${e.id}/pay`, { accountId: bank.id }).expect(409); // the bank account is empty
      await post(sec, `/finance/expenses/${e.id}/pay`, { accountId: central.id }).expect(403);
      await post(treas, `/finance/expenses/${e.id}/pay`, { accountId: central.id }).expect(201);
      d = (await get(treas, `/finance/expenses/${e.id}`).expect(200)).body;
      expect(d).toMatchObject({ displayStatus: 'paid', amount_paid: '4000.00' });
      await post(treas, `/finance/expenses/${e.id}/pay`, { accountId: central.id }).expect(409);
    });

    it('an expense already incurred needs evidence and verification before reimbursement', async () => {
      await post(treas, '/finance/expenses', { title: 'Taxi', amount: 500, date: today(), alreadyIncurred: true }).expect(400);
      const e = (await post(treas, '/finance/expenses', { title: 'Taxi', amount: 500, date: today(), alreadyIncurred: true, attachments: [{ url: 'https://res.cloudinary.com/demo/image/upload/v1/receipt.jpg', name: 'receipt.jpg' }] }).expect(201)).body;
      expect(e.displayStatus).toBe('awaiting_verification');
      const wf = await workflowOf(e.id, 'expense');
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      await post(treas, `/finance/expenses/${e.id}/pay`, { accountId: central.id }).expect(409);
      await post(treas, `/finance/expenses/${e.id}/verify`).expect(403); // recorded it
    });
  });

  // ------------------------------------------------------------ department finances

  describe('department finances and isolation', () => {
    let dAccount: any, fee: any;

    it('10. a department opens its own account and records its own money', async () => {
      dAccount = (await post(dChair, '/finance/accounts', { name: 'Choir cash', accountType: 'cash', departmentId: dept.id, openingBalance: 2000 }).expect(201)).body;
      expect(dAccount.scope).toBe('department');
      const c = (await post(dSec, '/finance/contributions', { departmentId: dept.id, memberId: m1.id, amount: 3000, date: today(), accountId: dAccount.id }).expect(201)).body;
      expect(c.department_id).toBe(dept.id);
      expect(await balance(dAccount.id)).toBe('5000.00');
      await post(dSec, '/finance/contributions', { departmentId: dept.id, memberId: m1.id, amount: 3000, date: today(), accountId: central.id }).expect(400); // not their account
    });

    it('12. departments never see each other\'s finances, nor central ones', async () => {
      await get(oChair, `/finance/accounts?departmentId=${dept.id}`).expect(403);
      await get(oChair, `/finance/accounts/${dAccount.id}`).expect(403);
      await get(dChair, `/finance/accounts/${central.id}`).expect(403);
      await post(oChair, '/finance/contributions', { departmentId: dept.id, memberId: m1.id, amount: 10, date: today() }).expect(403);
      const mine = (await get(dChair, '/finance/accounts').expect(200)).body;
      expect(mine.every((a: any) => a.department_id === dept.id)).toBe(true);
      const all = (await get(treas, '/finance/accounts').expect(200)).body;
      expect(all.some((a: any) => a.department_id === dept.id)).toBe(true); // Treasurer oversight
      await get(secB, `/finance/accounts/${central.id}`).expect(404); // another fellowship: indistinguishable from missing
    });

    it('9. membership fees track expected, paid, partial and outstanding', async () => {
      const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 2);
      fee = (await post(dSec, `/finance/departments/${dept.id}/fees`, { name: 'Monthly dues', amount: 1000, frequency: 'monthly', startDate: start.toISOString(), allowPartial: true }).expect(201)).body;
      await post(dSec, `/finance/departments/${dept.id}/fees/${fee.id}/payments`, { memberId: m1.id, amount: 3000, date: today(), accountId: dAccount.id }).expect(201);
      await post(dSec, `/finance/departments/${dept.id}/fees/${fee.id}/payments`, { memberId: m2.id, amount: 500, date: today(), accountId: dAccount.id }).expect(201);
      await post(dSec, `/finance/departments/${dept.id}/fees/${fee.id}/payments`, { memberId: m3.id, amount: 500, date: today(), accountId: dAccount.id }).expect(400); // not a member of this department
      const s = (await get(dChair, `/finance/departments/${dept.id}/fees/${fee.id}/status`).expect(200)).body;
      expect(s.totals).toMatchObject({ periodsDue: 3, expected: '6000.00', paid: '3500.00', outstanding: '2500.00' });
      expect(s.rows.find((r: any) => r.memberId === m1.id)).toMatchObject({ status: 'paid', outstanding: '0.00' });
      expect(s.rows.find((r: any) => r.memberId === m2.id)).toMatchObject({ status: 'partially_paid', overdue: true });
      await get(oChair, `/finance/departments/${dept.id}/fees/${fee.id}/status`).expect(403);
    });

    it('routine department spending is approved by the Department Chairperson; others go to central approval', async () => {
      const dBudget = (await post(dSec, '/finance/budgets', { departmentId: dept.id, title: 'Choir year', fiscalYear: String(new Date().getFullYear()), lines: [{ name: 'Strings', amount: 4000 }] }).expect(201)).body;
      const bwf = await workflowOf(dBudget.id, 'department_budget');
      await decide(treas, bwf.id);
      await decide(sec, bwf.id);
      await decide(chair, bwf.id);
      const line = (await get(dSec, `/finance/budgets/${dBudget.id}`).expect(200)).body.lines[0];
      const routine = (await post(dSec, '/finance/expenses', { scope: 'department', departmentId: dept.id, title: 'Guitar strings', amount: 1500, date: today(), budgetLineId: line.id }).expect(201)).body;
      expect(routine.workflow.type).toBe('department_expense');
      const rwf = await workflowOf(routine.id, 'department_expense');
      await decide(oChair, rwf.id, 'approved', undefined, 403); // another department's chair
      await decide(dChair, rwf.id);
      await post(dSec, `/finance/expenses/${routine.id}/pay`, { accountId: dAccount.id }).expect(201);
      const big = (await post(dSec, '/finance/expenses', { scope: 'department', departmentId: dept.id, title: 'Keyboard', amount: 9000, date: today(), budgetLineId: line.id }).expect(201)).body;
      expect(big.workflow.type).toBe('department_expense_major'); // over the budget line
      const own = (await post(dChair, '/finance/expenses', { scope: 'department', departmentId: dept.id, title: 'Rosin', amount: 100, date: today(), budgetLineId: line.id }).expect(201)).body;
      expect(own.workflow.type).toBe('department_expense_major'); // the Chairperson cannot approve their own
    });

    it('11. transfers: same scope at once; central <-> department needs approval; department <-> department refused', async () => {
      const t1 = (await post(treas, '/finance/transfers', { fromAccountId: central.id, toAccountId: bank.id, amount: 1000, date: today() }).expect(201)).body;
      expect(t1.status).toBe('COMPLETED');
      expect(await balance(bank.id)).toBe('1000.00');
      const oAccount = (await post(oChair, '/finance/accounts', { name: 'Media cash', accountType: 'cash', departmentId: other.id }).expect(201)).body;
      await post(dChair, '/finance/transfers', { fromAccountId: dAccount.id, toAccountId: oAccount.id, amount: 10, date: today() }).expect(403);
      await post(dChair, '/finance/transfers', { fromAccountId: dAccount.id, toAccountId: central.id, amount: 10, date: today() }).expect(403); // only the Treasurer starts cross-scope moves
      const t2 = (await post(treas, '/finance/transfers', { fromAccountId: central.id, toAccountId: dAccount.id, amount: 2500, date: today() }).expect(201)).body;
      expect(t2.status).toBe('PENDING');
      const before = await balance(dAccount.id);
      const wf = await workflowOf(t2.id, 'fund_transfer');
      await decide(sec, wf.id);
      expect(await balance(dAccount.id)).toBe(before);
      await decide(chair, wf.id);
      expect(Number(await balance(dAccount.id)) - Number(before)).toBe(2500);
      const entries = await prisma.ledgerEntry.findMany({ where: { source_id: t2.id } });
      expect(entries.map((e) => e.entry_type).sort()).toEqual(['transfer_in', 'transfer_out']);
      // Transfers are not income in the statement.
      const ie = (await get(treas, '/finance/statements/income-expenditure').expect(200)).body;
      expect(JSON.stringify(ie.rows)).not.toContain('transfer');
    });

    it('16 (department). a department contribution is reversed by its Chairperson, never deleted', async () => {
      const c = (await post(dSec, '/finance/contributions', { departmentId: dept.id, memberId: m2.id, amount: 700, date: today(), accountId: dAccount.id }).expect(201)).body;
      const before = await balance(dAccount.id);
      await post(dSec, `/finance/contributions/${c.id}/reverse`, { reason: 'typo' }).expect(403);
      await post(dChair, `/finance/contributions/${c.id}/reverse`, {}).expect(400);
      await post(dChair, `/finance/contributions/${c.id}/reverse`, { reason: 'Recorded twice' }).expect(201);
      await post(dChair, `/finance/contributions/${c.id}/reverse`, { reason: 'again' }).expect(409);
      expect(Number(before) - Number(await balance(dAccount.id))).toBe(700);
      expect(await prisma.contribution.findUnique({ where: { id: c.id } })).toMatchObject({ status: 'reversed' });
      expect(await prisma.ledgerEntry.count({ where: { source_id: c.id } })).toBe(2);
    });

    it('the transparency summary carries totals only', async () => {
      const s = (await get(dChair, `/finance/departments/${dept.id}/summary`).expect(200)).body;
      expect(s.summary.map((x: any) => x.label)).toContain('Membership fees outstanding');
      expect(JSON.stringify(s)).not.toContain('Asha');
      await get(oChair, `/finance/departments/${dept.id}/summary`).expect(403);
    });
  });

  // ------------------------------------------------------------ closure, periods

  describe('closure, periods, reports and audit', () => {
    it('16. closing a project returns unspent money to the General Fund after Treasurer, Secretary and Chairperson', async () => {
      await post(treas, '/finance/contributions', { memberId: m3.id, amount: 3000, date: today(), accountId: central.id, allocations: [{ projectId: projB.id, amount: 3000 }] }).expect(201);
      const before = (await get(treas, '/finance/general-fund').expect(200)).body;
      await post(oChair, `/projects/${projB.id}/closure`, { finalReport: 'Done' }).expect(403); // not its creator, department or the Secretary
      const req = (await post(chair, `/projects/${projB.id}/closure`, { finalReport: 'Speakers installed', unspentDisposition: 'return_to_general_fund' }).expect(201)).body;
      expect(req.closure_status).toBe('pending');
      const wf = await workflowOf(projB.id, 'project_closure');
      await decide(treas, wf.id);
      await decide(sec, wf.id);
      await decide(asstChair, wf.id);
      const closed = (await get(chair, `/projects/${projB.id}`).expect(200)).body;
      expect(closed.status).toBe('CLOSED');
      expect(closed.financials.unspentFunds).toBe('0.00');
      expect(closed.fundAllocations[0]).toMatchObject({ kind: 'return_to_general_fund', amount: '-3000.00' });
      const after = (await get(treas, '/finance/general-fund').expect(200)).body;
      expect(Number(after.available) - Number(before.available)).toBe(3000); // the earmark ended: the money is general again
    });

    it('17. a closed period refuses records; reopening needs a reason', async () => {
      const start = new Date(Date.UTC(2001, 0, 1)).toISOString();
      const end = new Date(Date.UTC(2001, 11, 31)).toISOString();
      const p = (await post(treas, '/finance/periods', { name: `FY2001-${uniq()}`, startDate: start, endDate: end, periodType: 'year' }).expect(201)).body;
      const closing = (await post(treas, `/finance/periods/${p.id}/close`).expect(201)).body;
      expect(closing).toMatchObject({ is_closed: false, closure_status: 'pending' });
      const wf = await workflowOf(p.id, 'period_close');
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      expect((await prisma.financialPeriod.findUniqueOrThrow({ where: { id: p.id } })).is_closed).toBe(true);
      await post(treas, '/finance/contributions', { memberId: m1.id, amount: 10, date: '2001-06-01' }).expect(400);
      await post(chair, `/finance/periods/${p.id}/reopen`, {}).expect(400);
      await post(chair, `/finance/periods/${p.id}/reopen`, { reason: 'Late bank statement' }).expect(201);
      expect(await prisma.financialPeriod.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ is_closed: false, reopen_reason: 'Late bank statement' });
    });

    it('19. reports export as PDF and Excel; departments only export their own', async () => {
      const keys = (await get(treas, '/finance/statements').expect(200)).body.map((r: any) => r.key);
      expect(keys).toHaveLength(12);
      for (const key of keys.filter((k: string) => k !== 'membership-fees')) {
        await get(treas, `/finance/statements/${key}`).expect(200);
      }
      const bin = (res: any, cb: any) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); };
      const x = await get(treas, '/finance/statements/contributions?format=xlsx').buffer(true).parse(bin).expect(200);
      expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const pdf = await get(treas, '/finance/statements/expenses?format=pdf').buffer(true).parse(bin).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await get(dChair, `/finance/statements/membership-fees?departmentId=${dept.id}`).expect(200);
      await get(oChair, `/finance/statements/contributions?departmentId=${dept.id}`).expect(403);
      await get(dChair, '/finance/statements/audit').expect(403);
      await get(dChair, '/finance/statements/departments').expect(403);
    });

    it('18. every financial action is in the audit history', async () => {
      const audit = (await get(treas, '/finance/statements/audit').expect(200)).body;
      const actions = new Set(audit.rows.map((r: any) => r.action));
      for (const a of ['finance.contribution_create', 'finance.account_create', 'finance.transfer_create', 'finance.expense_paid', 'finance.budget_revision_applied', 'project.closed', 'finance.contribution_reversed']) {
        expect(actions).toContain(a);
      }
    });

    it('20. nobody approves their own request, and a dashboard is scoped', async () => {
      const mr = (await post(dSec, '/finance/money-requests', { departmentId: dept.id, title: 'Robes', amount: 100, purpose: 'Choir' }).expect(201)).body;
      const wf = await workflowOf(mr.id, 'money_request');
      await decide(dSec, wf.id, 'approved', undefined, 403);
      const inbox = (await get(treas, '/finance/approvals').expect(200)).body;
      expect(inbox.some((i: any) => i.approvalId === wf.id)).toBe(true);
      expect((await get(dSec, '/finance/approvals').expect(200)).body.some((i: any) => i.approvalId === wf.id)).toBe(false);
      const dash = (await get(dChair, `/finance/dashboard?departmentId=${dept.id}`).expect(200)).body;
      expect(dash.scope).toBe('department');
      expect(dash.monthly).toHaveLength(12);
      await get(dChair, '/finance/dashboard?departmentId=central').expect(403);
      const cdash = (await get(treas, '/finance/dashboard').expect(200)).body;
      expect(cdash.generalFund).toBeDefined();
    });
  });
});
