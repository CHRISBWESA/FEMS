import { INestApplication } from '@nestjs/common';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

/**
 * Finance and department financial management, end to end over HTTP against real Postgres:
 * the ledger, receipts, allocations, expenses and payments, membership
 * fees, isolation, exports and audit.
 */
jest.setTimeout(300_000);

describeDb('Finance and department finances (real Postgres, HTTP)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let f: any, fB: any;
  let treas: any, sec: any, asst: any, chair: any, asstChair: any, secB: any;
  let dChair: any, dSec: any, oChair: any;
  let dept: any, other: any;
  let m1: any, m2: any, m3: any;
  let central: any;

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

  describe('contributions', () => {
    it('money goes into the fund\'s default cash account; balances come only from the ledger', async () => {
      await post(treas, '/finance/contributions', { contributorType: 'external', contributorName: 'Opening funds', amount: 100000, date: today() }).expect(201);
      central = await prisma.financialAccount.findUniqueOrThrow({ where: { default_key: `${f.id}:central` } });
      expect(await balance(central.id)).toBe('100000.00');
      for (const url of ['/finance/accounts', '/finance/transfers', '/finance/ledger', '/finance/general-fund']) await get(treas, url).expect(404);
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

  describe('expenses', () => {

    it('8. an approved central expense is not paid until the Treasurer pays it', async () => {
      const e = (await post(treas, '/finance/expenses', { title: 'Printer ink', amount: 4000, date: today(), purpose: 'Office' }).expect(201)).body;
      const wf = await workflowOf(e.id, 'expense');
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      let d = (await get(treas, `/finance/expenses/${e.id}`).expect(200)).body;
      expect(d.displayStatus).toBe('approved');
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

    it('10. a department records its own money into its own default account', async () => {
      const c = (await post(dSec, '/finance/contributions', { departmentId: dept.id, memberId: m1.id, amount: 5000, date: today() }).expect(201)).body;
      expect(c.department_id).toBe(dept.id);
      dAccount = await prisma.financialAccount.findUniqueOrThrow({ where: { default_key: `${f.id}:${dept.id}` } });
      expect(await balance(dAccount.id)).toBe('5000.00');
      await post(dSec, '/finance/contributions', { departmentId: dept.id, memberId: m1.id, amount: 3000, date: today(), accountId: central.id }).expect(400); // not their account
    });

    it('12. a department leader cannot record money for another department', async () => {
      await post(oChair, '/finance/contributions', { departmentId: dept.id, memberId: m1.id, amount: 10, date: today() }).expect(403);
    });

    it('9. membership fees track expected, paid, partial and outstanding', async () => {
      const start = new Date(); start.setUTCMonth(start.getUTCMonth() - 2);
      fee = (await post(dSec, `/finance/departments/${dept.id}/fees`, { name: 'Monthly dues', amount: 1000, frequency: 'monthly', startDate: start.toISOString(), allowPartial: true }).expect(201)).body;
      await post(dSec, `/finance/departments/${dept.id}/fees/${fee.id}/payments`, { memberId: m1.id, amount: 3000, date: today() }).expect(201);
      await post(dSec, `/finance/departments/${dept.id}/fees/${fee.id}/payments`, { memberId: m2.id, amount: 500, date: today() }).expect(201);
      await post(dSec, `/finance/departments/${dept.id}/fees/${fee.id}/payments`, { memberId: m3.id, amount: 500, date: today() }).expect(400); // not a member of this department
      const s = (await get(dChair, `/finance/departments/${dept.id}/fees/${fee.id}/status`).expect(200)).body;
      expect(s.totals).toMatchObject({ periodsDue: 3, expected: '6000.00', paid: '3500.00', outstanding: '2500.00' });
      expect(s.rows.find((r: any) => r.memberId === m1.id)).toMatchObject({ status: 'paid', outstanding: '0.00' });
      expect(s.rows.find((r: any) => r.memberId === m2.id)).toMatchObject({ status: 'partially_paid', overdue: true });
      await get(oChair, `/finance/departments/${dept.id}/fees/${fee.id}/status`).expect(403);
    });

    it('department spending goes to central approval (Treasurer -> Secretary -> Chairperson), then is paid from the department\'s account', async () => {
      const e = (await post(dSec, '/finance/expenses', { scope: 'department', departmentId: dept.id, title: 'Guitar strings', amount: 1500, date: today() }).expect(201)).body;
      expect(e.workflow.type).toBe('department_expense_major');
      const wf = await workflowOf(e.id, 'department_expense_major');
      await decide(oChair, wf.id, 'approved', undefined, 403); // another department's chair
      await decide(dSec, wf.id, 'approved', undefined, 403); // the recorder
      await decide(treas, wf.id);
      await decide(sec, wf.id);
      await decide(chair, wf.id);
      const before = await balance(dAccount.id);
      await post(dSec, `/finance/expenses/${e.id}/pay`, {}).expect(201);
      expect(Number(before) - Number(await balance(dAccount.id))).toBe(1500);
    });

    it('16 (department). a department contribution is reversed by its Chairperson, never deleted', async () => {
      const c = (await post(dSec, '/finance/contributions', { departmentId: dept.id, memberId: m2.id, amount: 700, date: today() }).expect(201)).body;
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

  // ------------------------------------------------------------ closure, reports

  describe('reports and audit', () => {
    it('19. reports export as PDF and Excel; departments only export their own', async () => {
      const keys = (await get(treas, '/finance/statements').expect(200)).body.map((r: any) => r.key);
      expect(keys).toHaveLength(8);
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
      for (const a of ['finance.contribution_create', 'finance.expense_paid', 'finance.contribution_reversed']) {
        expect(actions).toContain(a);
      }
    });

    it('20. nobody approves their own request, and a dashboard is scoped', async () => {
      const mr = (await post(dSec, '/finance/expenses', { scope: 'department', departmentId: dept.id, title: 'Robes', amount: 100, date: today() }).expect(201)).body;
      const wf = await workflowOf(mr.id, 'department_expense_major');
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
