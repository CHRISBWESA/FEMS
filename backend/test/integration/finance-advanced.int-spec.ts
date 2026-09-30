import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

describeDb('Phase 15 - advanced finance: validation, scope, campaigns, periods, pledges, income, reports (real Postgres)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, D1: any, D2: any;
  let sec: any, asst: any, chair: any, treas: any, ds1: any, ds2: any, ord: any, gl: any, sec2: any;
  let secB: any, treasB: any;
  let m1: any, m2: any, mB: any, memberUserOrd: any;

  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const get = (u: any, url: string) => api(app, u.token).get(url);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'AA');
    fB = await makeFellowship(prisma, 'AB');
    D1 = await makeDepartment(prisma, fA.id, 'AD1');
    D2 = await makeDepartment(prisma, fA.id, 'AD2');
    const mk = (roles: string[], departmentId?: string) => makeUser(prisma, { fellowshipId: fA.id, roles, departmentId });
    sec = await mk(['secretary']);
    sec2 = await mk(['secretary']);
    asst = await mk(['assistant_secretary']);
    chair = await mk(['chairperson']);
    treas = await mk(['treasurer']);
    ds1 = await mk(['department_secretary'], D1.id);
    ds2 = await mk(['department_secretary'], D2.id);
    gl = await mk(['gender_leader']);
    ord = await mk(['ordinary_member']);
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    treasB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['treasurer'] });
    memberUserOrd = ord;
    m1 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Giver One', userId: ord.id });
    m2 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Giver Two' });
    mB = await makeMember(prisma, { fellowshipId: fB.id, name: 'Foreign' });
  });

  afterAll(async () => {
    await app?.close();
  });

  const contribution = (extra: object = {}) =>
    post(treas, '/finance/contributions', { memberId: m1.id, amount: 100, contributionType: 'tithe', date: '2026-09-01', ...extra });

  describe('input validation and tenant-safe references', () => {
    it('rejects bad amounts, dates, text and ids with 400 (never 500)', async () => {
      for (const amount of [0, -5, 'abc', null, 12.345, 1e12, {}, [] as any]) {
        await contribution({ amount }).expect(400);
      }
      await contribution({ date: '2999-01-01' }).expect(400);
      await contribution({ date: 'garbage' }).expect(400);
      await contribution({ date: undefined }).expect(400);
      await contribution({ contributionType: '' }).expect(400);
      await contribution({ contributionType: 'x'.repeat(51) }).expect(400);
      await contribution({ memberId: 'not-a-uuid' }).expect(400);
      await contribution({ memberId: undefined }).expect(400);
      await contribution({ notes: 'n'.repeat(501) }).expect(400);
      await post(treas, '/finance/expenses', { title: '', amount: 1, date: '2026-09-01' }).expect(400);
      await post(treas, '/finance/budgets', { title: 'B', amount: 1, fiscalYear: 'next year' }).expect(400);
      await post(sec, '/finance/money-requests', { title: 'x', amount: 1 }).expect(400); // purpose required
      await post(treas, '/finance/money-requests', { title: 'x', amount: 1, purpose: 'y' }).expect(403); // the Treasurer cannot raise requests
    });

    it('a member/department/campaign/category/receipt from ANOTHER fellowship is refused (indistinguishable from missing)', async () => {
      await contribution({ memberId: mB.id }).expect(404);
      await contribution({ memberId: randomUUID() }).expect(404);
      const deptB = await makeDepartment(prisma, fB.id, 'ADB');
      await post(treas, '/finance/expenses', { title: 'x', amount: 1, date: '2026-09-01', departmentId: deptB.id }).expect(404);
      const catB = (await post(treasB, '/finance/categories', { kind: 'contribution', name: `catB-${uniq()}` }).expect(201)).body;
      await contribution({ categoryId: catB.id }).expect(400);
      const campB = (await post(treasB, '/finance/campaigns', { name: `campB-${uniq()}`, startDate: '2026-01-01' }).expect(201)).body;
      await contribution({ campaignId: campB.id }).expect(400);
      const docB = await prisma.documentEntity.create({ data: { title: 'r', filename: 'r.pdf', stored_filename: 'x', file_size: 1, mime_type: 'application/pdf', uploaded_by: randomUUID(), fellowship_id: fB.id } });
      await contribution({ receiptDocumentId: docB.id }).expect(400);
    });

    it('a public-website document can never be attached as a receipt; an internal one can', async () => {
      const web = await prisma.documentEntity.create({ data: { title: 'w', filename: 'w.pdf', stored_filename: 'x', file_size: 1, mime_type: 'application/pdf', uploaded_by: randomUUID(), fellowship_id: fA.id, is_website_content: true } });
      await contribution({ receiptDocumentId: web.id }).expect(400);
      const internal = await prisma.documentEntity.create({ data: { title: 'r', filename: 'r.pdf', stored_filename: 'x', file_size: 1, mime_type: 'application/pdf', uploaded_by: randomUUID(), fellowship_id: fA.id } });
      const ok = await contribution({ receiptDocumentId: internal.id }).expect(201);
      expect(ok.body.receipt_document_id).toBe(internal.id);
    });

    it('mass assignment is impossible: injected id/tenant/status fields are ignored', async () => {
      const forcedId = randomUUID();
      const res = await contribution({ id: forcedId, fellowship_id: fB.id, fellowshipId: fB.id, approval_status: 'DRAFT', recorded_by: randomUUID(), member_id: m2.id }).expect(201);
      expect(res.body.id).not.toBe(forcedId);
      expect(res.body.fellowship_id).toBe(fA.id);
      expect(res.body.approval_status).toBe('FINAL_APPROVED');
      expect(res.body.recorded_by).toBe(treas.id);
      expect(res.body.member_id).toBe(m1.id);
    });

    it('only Treasurer/Secretary record money; nobody else can', async () => {
      for (const u of [asst, chair, ds1, ord, gl]) await post(u, '/finance/contributions', { memberId: m1.id, amount: 1, contributionType: 't', date: '2026-09-01' }).expect(403);
      await post(secB, '/finance/contributions', { memberId: m1.id, amount: 1, contributionType: 't', date: '2026-09-01' }).expect(404); // B's secretary cannot even see A's member
    });
  });

  describe('visibility and privacy', () => {
    let d1Request: any, d2Request: any;
    beforeAll(async () => {
      d1Request = (await post(ds1, '/finance/money-requests', { title: 'D1 tent', amount: 50, purpose: 'p' }).expect(201)).body;
      d2Request = (await post(ds2, '/finance/money-requests', { title: 'D2 tent', amount: 60, purpose: 'p' }).expect(201)).body;
      await post(treas, '/finance/expenses', { title: 'D1 exp', amount: 5, date: '2026-09-01', departmentId: D1.id }).expect(201);
      await post(treas, '/finance/expenses', { title: 'D2 exp', amount: 6, date: '2026-09-01', departmentId: D2.id }).expect(201);
    });

    it('department leaders see only their own department\'s requests/expenses and NO member giving', async () => {
      const mine = await get(ds1, '/finance/money-requests').expect(200);
      expect(mine.body.map((r: any) => r.id)).toContain(d1Request.id);
      expect(mine.body.map((r: any) => r.id)).not.toContain(d2Request.id);
      const exp = await get(ds1, '/finance/expenses').expect(200);
      expect(exp.body.every((e: any) => e.department_id === D1.id)).toBe(true);
      await get(ds1, '/finance/contributions').expect(403);
      await get(ds1, '/finance/income').expect(403);
      await get(ds1, '/finance/campaigns').expect(403);
      await get(ds1, '/finance/pledges').expect(403);
      await get(ds1, `/finance/members/${m1.id}/statement`).expect(403);
    });

    it('a department leader cannot widen scope with ?departmentId or ?fellowshipId', async () => {
      const res = await get(ds1, `/finance/expenses?departmentId=${D2.id}&fellowshipId=${fB.id}`).expect(200);
      expect(res.body.every((e: any) => e.department_id === D1.id)).toBe(true);
    });

    it('ordinary members and gender leaders see no finance lists', async () => {
      for (const u of [ord, gl]) {
        for (const path of ['contributions', 'expenses', 'budgets', 'money-requests', 'income', 'campaigns', 'periods', 'categories', 'pledges']) {
          await get(u, `/finance/${path}`).expect(403);
        }
        await get(u, '/finance/reports/summary').expect(403);
      }
    });

    it('tenant isolation on lists: another fellowship\'s treasurer sees none of these, and ?fellowshipId= cannot cross over', async () => {
      const b = await get(treasB, '/finance/contributions').expect(200);
      expect(b.body.every((c: any) => c.fellowship_id === fB.id)).toBe(true);
      const crossed = await get(treasB, `/finance/contributions?fellowshipId=${fA.id}`).expect(200);
      expect(crossed.body.every((c: any) => c.fellowship_id === fB.id)).toBe(true);
      const mrB = await get(treasB, '/finance/money-requests').expect(200);
      expect(mrB.body.map((r: any) => r.id)).not.toContain(d1Request.id);
      await get(treas, '/finance/contributions?fellowshipId=nope').expect(200); // ignored for non-admins (as elsewhere)
    });

    it('pagination and filters are validated', async () => {
      const page = await get(treas, '/finance/contributions?limit=1').expect(200);
      expect(page.body).toHaveLength(1);
      expect(Number(page.headers['x-total-count'])).toBeGreaterThan(1);
      await get(treas, '/finance/contributions?limit=0').expect(400);
      await get(treas, '/finance/contributions?limit=99999').expect(400);
      await get(treas, '/finance/contributions?page=-1').expect(400);
      await get(treas, '/finance/contributions?memberId=nope').expect(400);
      await get(treas, '/finance/contributions?from=garbage').expect(400);
    });
  });

  describe('categories, campaigns, income', () => {
    let cat: any, incomeCat: any, campaign: any;

    it('categories are per fellowship and per kind; only Treasurer/Secretary manage them', async () => {
      cat = (await post(treas, '/finance/categories', { kind: 'contribution', name: `Tithes ${uniq()}` }).expect(201)).body;
      incomeCat = (await post(sec, '/finance/categories', { kind: 'income', name: `Grants ${uniq()}` }).expect(201)).body;
      await post(treas, '/finance/categories', { kind: 'contribution', name: cat.name }).expect(400);
      await post(treas, '/finance/categories', { kind: 'nonsense', name: 'x' }).expect(400);
      await post(asst, '/finance/categories', { kind: 'income', name: 'nope' }).expect(403);
      await post(chair, '/finance/categories', { kind: 'income', name: 'nope' }).expect(403);
      await put(treas, `/finance/categories/${cat.id}`, { name: cat.name + ' v2' }).expect(200);
      await put(secB, `/finance/categories/${cat.id}`, { name: 'hijack' }).expect(403);
      await put(treas, '/finance/categories/not-a-uuid', { name: 'x' }).expect(404);
      const list = await get(chair, '/finance/categories').expect(200);
      expect(list.body.map((c: any) => c.id)).toContain(cat.id);
      const other = await get(treasB, '/finance/categories').expect(200);
      expect(other.body.map((c: any) => c.id)).not.toContain(cat.id);
    });

    it('a category must match the record kind', async () => {
      await contribution({ categoryId: incomeCat.id }).expect(400); // income category on a contribution
      await contribution({ categoryId: cat.id }).expect(201);
      await put(treas, `/finance/categories/${cat.id}`, { isActive: false }).expect(200);
      await contribution({ categoryId: cat.id }).expect(400); // inactive
      await put(treas, `/finance/categories/${cat.id}`, { isActive: true }).expect(200);
    });

    it('campaigns track raised amounts; closed campaigns accept no new contributions', async () => {
      campaign = (await post(treas, '/finance/campaigns', { name: `Building ${uniq()}`, targetAmount: 1000, startDate: '2026-01-01' }).expect(201)).body;
      await post(treas, '/finance/campaigns', { name: campaign.name, startDate: '2026-01-01' }).expect(400);
      await post(treas, '/finance/campaigns', { name: 'x', startDate: '2026-05-01', endDate: '2026-01-01' }).expect(400);
      await post(chair, '/finance/campaigns', { name: 'nope', startDate: '2026-01-01' }).expect(403);
      await post(ds1, '/finance/campaigns', { name: 'nope', startDate: '2026-01-01' }).expect(403);
      await contribution({ campaignId: campaign.id, amount: 250 }).expect(201);
      await contribution({ campaignId: campaign.id, memberId: m2.id, amount: 250 }).expect(201);
      await post(treas, '/finance/income', { title: 'Gala', amount: 100, date: '2026-09-02', campaignId: campaign.id }).expect(201);
      const got = (await get(chair, `/finance/campaigns/${campaign.id}`).expect(200)).body;
      expect(got.progress).toMatchObject({ raised: '600', contributions: '500', otherIncome: '100', contributionCount: 2, contributorCount: 2, percentOfTarget: 60 });
      await put(treas, `/finance/campaigns/${campaign.id}`, { status: 'closed' }).expect(200);
      await contribution({ campaignId: campaign.id }).expect(400);
      await get(secB, `/finance/campaigns/${campaign.id}`).expect(403);
      await get(treas, '/finance/campaigns/not-a-uuid').expect(404);
    });

    it('income records validate, need permission, and appear in listings', async () => {
      const ok = await post(sec, '/finance/income', { title: 'Grant', amount: 1200, date: '2026-09-02', source: 'Diocese', categoryId: incomeCat.id }).expect(201);
      expect(ok.body.fellowship_id).toBe(fA.id);
      await post(treas, '/finance/income', { title: 'x', amount: -1, date: '2026-09-02' }).expect(400);
      await post(treas, '/finance/income', { title: 'x', amount: 1, date: '2026-09-02', categoryId: cat.id }).expect(400); // contribution category
      for (const u of [asst, chair, ds1, ord]) await post(u, '/finance/income', { title: 'x', amount: 1, date: '2026-09-02' }).expect(403);
      const list = await get(chair, '/finance/income').expect(200);
      expect(list.body.map((r: any) => r.id)).toContain(ok.body.id);
      const otherFellowship = await get(treasB, '/finance/income').expect(200);
      expect(otherFellowship.body.map((r: any) => r.id)).not.toContain(ok.body.id);
    });
  });

  describe('financial periods lock records', () => {
    it('a closed period rejects new records and edit requests dated inside it; reopening is a senior action', async () => {
      const p = (await post(treas, '/finance/periods', { name: `Q1 ${uniq()}`, startDate: '2025-01-01', endDate: '2025-03-31' }).expect(201)).body;
      await post(treas, '/finance/periods', { name: 'overlap', startDate: '2025-03-01', endDate: '2025-04-30' }).expect(400);
      await post(treas, '/finance/periods', { name: 'bad', startDate: '2025-06-01', endDate: '2025-05-01' }).expect(400);
      const before = (await contribution({ date: '2025-02-10' }).expect(201)).body;
      await post(treas, `/finance/periods/${p.id}/close`).expect(201);
      await post(treas, `/finance/periods/${p.id}/close`).expect(409); // already closed
      await contribution({ date: '2025-02-11' }).expect(400);
      await post(treas, '/finance/income', { title: 'x', amount: 1, date: '2025-02-11' }).expect(400);
      await post(treas, '/finance/expenses', { title: 'x', amount: 1, date: '2025-02-11' }).expect(400);
      await post(treas, `/finance/contributions/${before.id}/edit-request`, { amount: 5, reason: 'r' }).expect(400);
      await post(treas, `/finance/contributions/${before.id}/delete-request`, { reason: 'r' }).expect(400);
      await contribution({ date: '2025-04-15' }).expect(201); // outside the period is fine
      await post(treas, `/finance/periods/${p.id}/reopen`, { reason: 'x' }).expect(403);
      await post(sec, `/finance/periods/${p.id}/reopen`, {}).expect(400); // reason required
      await post(chair, `/finance/periods/${p.id}/reopen`, { reason: 'Correction agreed at committee' }).expect(201);
      await contribution({ date: '2025-02-12' }).expect(201);
      await post(secB, `/finance/periods/${p.id}/close`).expect(403);
      await post(asst, `/finance/periods/${p.id}/close`).expect(403);
    });
  });

  describe('pledges (commitments, never auto-recorded money)', () => {
    it('tracks expected vs received without creating contributions', async () => {
      const start = new Date();
      start.setUTCMonth(start.getUTCMonth() - 3);
      const startStr = start.toISOString().slice(0, 10);
      const pledgeMember = await makeMember(prisma, { fellowshipId: fA.id, name: 'Pledger' });
      const pledge = (await post(treas, '/finance/pledges', { memberId: pledgeMember.id, amount: 100, frequency: 'monthly', startDate: startStr }).expect(201)).body;
      const before = await prisma.contribution.count({ where: { member_id: pledgeMember.id } });
      await post(treas, '/finance/contributions', { memberId: pledgeMember.id, amount: 100, contributionType: 'pledge', date: new Date().toISOString().slice(0, 10) }).expect(201);
      const f = (await get(chair, `/finance/pledges/${pledge.id}/fulfillment`).expect(200)).body;
      expect(f.expectedInstallments).toBe(4);
      expect(f.expectedAmount).toBe('400');
      expect(f.receivedAmount).toBe('100');
      expect(f.balance).toBe('300');
      expect(await prisma.contribution.count({ where: { member_id: pledgeMember.id } })).toBe(before + 1); // only the one we recorded
    });

    it('validation, permissions and tenant isolation', async () => {
      const ok = { memberId: m1.id, amount: 10, frequency: 'weekly', startDate: '2026-01-01' };
      await post(treas, '/finance/pledges', { ...ok, frequency: 'daily' }).expect(400);
      await post(treas, '/finance/pledges', { ...ok, amount: 0 }).expect(400);
      await post(treas, '/finance/pledges', { ...ok, memberId: mB.id }).expect(404);
      await post(treas, '/finance/pledges', { ...ok, endDate: '2025-01-01' }).expect(400);
      await post(asst, '/finance/pledges', ok).expect(403);
      await post(ord, '/finance/pledges', ok).expect(403);
      const p = (await post(sec, '/finance/pledges', ok).expect(201)).body;
      await get(treasB, `/finance/pledges/${p.id}/fulfillment`).expect(403);
      await get(treas, '/finance/pledges/not-a-uuid/fulfillment').expect(404);
      await put(treas, `/finance/pledges/${p.id}`, { isActive: false }).expect(200);
      await put(treasB, `/finance/pledges/${p.id}`, { isActive: false }).expect(403);
    });
  });

  describe('reports', () => {
    it('fellowship summary: totals are correct and unapproved expenses are NOT counted as spending', async () => {
      const marker = uniq();
      const fx = await makeFellowship(prisma, 'RPT');
      const t = await makeUser(prisma, { fellowshipId: fx.id, roles: ['treasurer'] });
      const s = await makeUser(prisma, { fellowshipId: fx.id, roles: ['secretary'] });
      const c = await makeUser(prisma, { fellowshipId: fx.id, roles: ['chairperson'] });
      const dx = await makeDepartment(prisma, fx.id, `RD-${marker}`);
      const mem = await makeMember(prisma, { fellowshipId: fx.id });
      const today = new Date().toISOString().slice(0, 10);
      const year = String(new Date().getUTCFullYear());
      const P = (u: any, url: string, body: object) => api(app, u.token).post(url, body);
      await P(t, '/finance/contributions', { memberId: mem.id, amount: 300, contributionType: 'tithe', date: today }).expect(201);
      await P(t, '/finance/contributions', { memberId: mem.id, amount: 200, contributionType: 'offering', date: today }).expect(201);
      await P(t, '/finance/income', { title: 'Grant', amount: 1000, date: today }).expect(201);
      const approved = (await P(t, '/finance/expenses', { title: 'A', amount: 400, date: today, departmentId: dx.id }).expect(201)).body;
      await P(s, `/finance/expenses/${approved.id}/approve`, { decision: 'approved' }).expect(201);
      await P(c, `/finance/expenses/${approved.id}/approve`, { decision: 'approved' }).expect(201);
      await P(t, '/finance/expenses', { title: 'Pending', amount: 999, date: today, departmentId: dx.id }).expect(201); // never approved
      const budget = (await P(t, '/finance/budgets', { title: 'Dept', amount: 1000, fiscalYear: year, departmentId: dx.id }).expect(201)).body;
      await P(s, `/finance/budgets/${budget.id}/approve`, { decision: 'approved' }).expect(201);
      await P(c, `/finance/budgets/${budget.id}/approve`, { decision: 'approved' }).expect(201);

      const r = (await api(app, c.token).get('/finance/reports/summary').expect(200)).body;
      expect(r.scope).toBe('fellowship');
      expect(r.contributions).toMatchObject({ total: '500', count: 2 });
      expect(r.contributions.byType.map((x: any) => [x.type, x.total]).sort()).toEqual([['offering', '200'], ['tithe', '300']]);
      expect(r.income.total).toBe('1000');
      expect(r.expenses).toMatchObject({ approvedTotal: '400', approvedCount: 1, pendingApprovalCount: 1 });
      expect(r.operatingPosition).toMatchObject({ contributionsAndIncome: '1500', approvedExpenses: '400', net: '1100' });
      expect(r.budgetVsActual.find((b: any) => b.departmentId === dx.id)).toMatchObject({ budgeted: '1000', spent: '400', remaining: '600' });
      expect(r.contributions.monthly.length).toBe(1);
      expect(JSON.stringify(r)).not.toContain(mem.full_name); // aggregate only: no member names
    });

    it('department leaders get a department-scoped report with no contribution/income data; others are refused', async () => {
      const r = (await get(ds1, '/finance/reports/summary').expect(200)).body;
      expect(r.scope).toBe('department');
      expect(r.contributions).toBeUndefined();
      expect(r.income).toBeUndefined();
      expect(r.operatingPosition).toBeUndefined();
      expect(r.expenses.byDepartment.every((d: any) => d.departmentId === D1.id)).toBe(true);
      const wide = (await get(ds1, `/finance/reports/summary?departmentId=${D2.id}`).expect(200)).body;
      expect(wide.expenses.byDepartment.every((d: any) => d.departmentId === D1.id)).toBe(true);
      for (const u of [ord, gl]) await get(u, '/finance/reports/summary').expect(403);
    });

    it('another fellowship\'s report contains none of these figures; ?fellowshipId cannot cross over', async () => {
      const b = (await get(treasB, '/finance/reports/summary').expect(200)).body;
      expect(b.contributions.count).toBe(0);
      const crossed = (await get(treasB, `/finance/reports/summary?fellowshipId=${fA.id}`).expect(200)).body;
      expect(crossed.contributions.count).toBe(0);
    });

    it('validates the reporting window', async () => {
      await get(treas, '/finance/reports/summary?from=2026-09-01&to=2026-01-01').expect(400);
      await get(treas, '/finance/reports/summary?from=garbage').expect(400);
      await get(treas, '/finance/reports/summary?from=2010-01-01&to=2026-01-01').expect(400); // > 5 years
      await get(treas, '/finance/reports/summary?departmentId=nope').expect(400);
    });
  });

  describe('member statements and self-service', () => {
    it('finance viewers can read an individual statement (audited); nobody else can', async () => {
      await contribution({ memberId: m2.id, amount: 77, date: '2026-09-05' }).expect(201);
      const st = (await get(treas, `/finance/members/${m2.id}/statement`).expect(200)).body;
      expect(st.member.fullName).toBe('Giver Two');
      expect(Number(st.total)).toBeGreaterThanOrEqual(77);
      expect(await prisma.auditLog.count({ where: { entity_id: m2.id, action: 'finance.member_statement_view' } })).toBeGreaterThan(0);
      await get(chair, `/finance/members/${m2.id}/statement`).expect(200);
      for (const u of [ds1, ord, gl]) await get(u, `/finance/members/${m2.id}/statement`).expect(403);
      await get(secB, `/finance/members/${m2.id}/statement`).expect(403);
      await get(treas, '/finance/members/not-a-uuid/statement').expect(404);
      await get(treas, `/finance/members/${randomUUID()}/statement`).expect(404);
    });

    it('a member sees ONLY their own giving (and nobody else\'s)', async () => {
      await contribution({ memberId: m1.id, amount: 11, date: '2026-09-06', notes: 'mine' }).expect(201);
      const mine = (await get(memberUserOrd, '/finance/my-contributions').expect(200)).body;
      expect(mine.member.id).toBe(m1.id);
      expect(mine.contributions.every((c: any) => c.amount !== undefined)).toBe(true);
      const ids = new Set((await prisma.contribution.findMany({ where: { member_id: m1.id }, select: { id: true } })).map((c) => c.id));
      expect(mine.contributions.every((c: any) => ids.has(c.id))).toBe(true);
      expect(JSON.stringify(mine)).not.toContain('Giver Two');
      await get(gl, '/finance/my-contributions').expect(404); // no linked member record
      await api(app).get('/finance/my-contributions').expect(401);
    });
  });
});
