import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { addToDepartment, api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

describeDb('Phase 16 - resources & asset management (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let fA: any, fB: any, D1: any, D2: any, DB: any;
  let sec: any, asst: any, chair: any, treas: any, ds1: any, dc1: any, ds2: any, ord: any, gl: any, secB: any;
  let m1: any, m2: any, m3: any, mB: any;
  let catA: any, locA: any, locA2: any;

  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const get = (u: any, url: string) => api(app, u.token).get(url);
  const mkAsset = async (extra: object = {}, by = asst) =>
    (await post(by, '/resources/assets', { name: `Asset ${uniq()}`, ...extra }).expect(201)).body;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    fA = await makeFellowship(prisma, 'RA');
    fB = await makeFellowship(prisma, 'RB');
    D1 = await makeDepartment(prisma, fA.id, 'RD1');
    D2 = await makeDepartment(prisma, fA.id, 'RD2');
    DB = await makeDepartment(prisma, fB.id, 'RDB');
    const mk = (roles: string[], departmentId?: string) => makeUser(prisma, { fellowshipId: fA.id, roles, departmentId });
    sec = await mk(['secretary']);
    asst = await mk(['assistant_secretary']);
    chair = await mk(['chairperson']);
    treas = await mk(['treasurer']);
    ds1 = await mk(['department_secretary'], D1.id);
    dc1 = await mk(['department_chairperson'], D1.id);
    ds2 = await mk(['department_secretary'], D2.id);
    ord = await mk(['ordinary_member']);
    gl = await mk(['gender_leader']);
    secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });
    m1 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Borrower One', userId: ord.id });
    m2 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Borrower Two' });
    m3 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Nodept' });
    mB = await makeMember(prisma, { fellowshipId: fB.id, name: 'Foreign' });
    await addToDepartment(prisma, m1.id, D1.id);
    await addToDepartment(prisma, m2.id, D2.id);
    catA = (await post(asst, '/resources/categories', { name: `Audio ${uniq()}` }).expect(201)).body;
    locA = (await post(asst, '/resources/locations', { name: `Store ${uniq()}` }).expect(201)).body;
    locA2 = (await post(sec, '/resources/locations', { name: `Hall ${uniq()}` }).expect(201)).body;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('authentication, permissions and roles', () => {
    it('401 without a token', async () => {
      await api(app).get('/resources/assets').expect(401);
      await api(app).get('/resources/my-loans').expect(401);
    });
    it('ordinary members and gender leaders cannot see the asset register', async () => {
      for (const u of [ord, gl]) {
        await get(u, '/resources/assets').expect(403);
        await get(u, '/resources/categories').expect(403);
        await get(u, '/resources/reports/summary').expect(403);
      }
    });
    it('viewers (chair, treasurer) can read but not write; only Secretary/Assistant operate', async () => {
      for (const u of [chair, treas]) {
        await get(u, '/resources/assets').expect(200);
        await post(u, '/resources/assets', { name: 'nope' }).expect(403);
        await post(u, '/resources/categories', { name: 'nope' }).expect(403);
      }
      await post(ds1, '/resources/assets', { name: 'nope' }).expect(403);
    });
  });

  describe('catalog (categories / locations)', () => {
    it('rejects duplicates and bad input; is tenant-scoped; garbage ids are 404', async () => {
      await post(asst, '/resources/categories', { name: catA.name }).expect(400);
      await post(asst, '/resources/categories', {}).expect(400);
      await post(asst, '/resources/locations', { name: 'x'.repeat(101) }).expect(400);
      await put(asst, `/resources/categories/${catA.id}`, { name: catA.name + ' v2' }).expect(200);
      await put(secB, `/resources/categories/${catA.id}`, { name: 'hijack' }).expect(403);
      await put(asst, '/resources/categories/not-a-uuid', { name: 'x' }).expect(404);
      const other = await get(secB, '/resources/categories').expect(200);
      expect(other.body.map((c: any) => c.id)).not.toContain(catA.id);
      await post(secB, '/resources/categories', { name: catA.name + ' v2' }).expect(201); // same name is fine in another fellowship
    });
  });

  describe('asset creation and validation', () => {
    it('creates an asset with a generated unique tag, a history entry and an audit row', async () => {
      const a = await mkAsset({ categoryId: catA.id, locationId: locA.id, serialNumber: 'SN-1', condition: 'new', acquisitionCost: 1250.5, acquisitionDate: '2025-01-10', owningDepartmentId: D1.id, custodianMemberId: m1.id });
      expect(a.asset_tag).toMatch(/^AST-[A-Z2-9]{6}$/);
      expect(a.status).toBe('available');
      expect(a.fellowship_id).toBe(fA.id);
      const tags = new Set([a.asset_tag]);
      for (let i = 0; i < 5; i++) tags.add((await mkAsset()).asset_tag);
      expect(tags.size).toBe(6);
      const hist = await get(asst, `/resources/assets/${a.id}/history`).expect(200);
      expect(hist.body[0]).toMatchObject({ eventType: 'created', toValue: 'new' });
      expect(await prisma.auditLog.count({ where: { entity_id: a.id, action: 'resources.asset_create' } })).toBe(1);
    });

    it('validates input (400) and refuses references from another fellowship', async () => {
      const bad = (body: object) => post(asst, '/resources/assets', { name: 'X', ...body });
      await post(asst, '/resources/assets', {}).expect(400);
      await bad({ condition: 'mint' }).expect(400);
      await bad({ quantity: 0 }).expect(400);
      await bad({ quantity: 1.5 }).expect(400);
      await bad({ acquisitionCost: -1 }).expect(400);
      await bad({ acquisitionDate: '2999-01-01' }).expect(400);
      await bad({ reorderLevel: 3 }).expect(400); // consumables only
      await bad({ categoryId: 'nope' }).expect(400);
      const catB = (await post(secB, '/resources/categories', { name: `catB-${uniq()}` }).expect(201)).body;
      await bad({ categoryId: catB.id }).expect(400);
      await bad({ owningDepartmentId: DB.id }).expect(404);
      await bad({ custodianMemberId: mB.id }).expect(404);
      await bad({ acquisitionExpenseId: randomUUID() }).expect(400);
      // mass assignment: tenant/status/tag/created_by are never taken from the body
      const a = (await bad({ fellowship_id: fB.id, fellowshipId: fB.id, status: 'retired', asset_tag: 'HACKED', created_by: randomUUID() }).expect(201)).body;
      expect(a.fellowship_id).toBe(fA.id);
      expect(a.status).toBe('available');
      expect(a.asset_tag).not.toBe('HACKED');
    });

    it('acquisition cost can be linked to an existing Expense of the same fellowship', async () => {
      const exp = await prisma.expense.create({ data: { title: 'Speaker', amount: 500, date: new Date(), recorded_by: randomUUID(), fellowship_id: fA.id } });
      const a = await mkAsset({ acquisitionExpenseId: exp.id, acquisitionCost: 500 });
      expect(a.acquisition_expense_id).toBe(exp.id);
    });
  });

  describe('department scope, cost privacy and tampering', () => {
    let d1Asset: any, d2Asset: any, bAsset: any;
    beforeAll(async () => {
      d1Asset = await mkAsset({ name: `D1 mixer ${uniq()}`, owningDepartmentId: D1.id, acquisitionCost: 300 });
      d2Asset = await mkAsset({ name: `D2 drum ${uniq()}`, owningDepartmentId: D2.id, acquisitionCost: 400 });
      bAsset = (await post(secB, '/resources/assets', { name: 'B thing' }).expect(201)).body;
    });

    it('department leaders see only assets owned by their department; filters cannot widen that', async () => {
      const mine = await get(ds1, '/resources/assets').expect(200);
      expect(mine.body.map((a: any) => a.id)).toContain(d1Asset.id);
      expect(mine.body.map((a: any) => a.id)).not.toContain(d2Asset.id);
      expect(mine.body.every((a: any) => a.owning_department_id === D1.id)).toBe(true);
      const tampered = await get(ds1, `/resources/assets?departmentId=${D2.id}&fellowshipId=${fB.id}`).expect(200);
      expect(tampered.body.every((a: any) => a.owning_department_id === D1.id)).toBe(true);
      await get(ds1, `/resources/assets/${d2Asset.id}`).expect(403);
      await get(ds1, `/resources/assets/${d2Asset.id}/history`).expect(403);
      await get(ds2, `/resources/assets/${d1Asset.id}`).expect(403);
      await get(dc1, `/resources/assets/${d1Asset.id}`).expect(200); // same department
    });

    it('acquisition cost is hidden from anyone without resources.cost_view', async () => {
      const asLeader = (await get(ds1, `/resources/assets/${d1Asset.id}`).expect(200)).body;
      expect(asLeader).not.toHaveProperty('acquisition_cost');
      expect(asLeader).not.toHaveProperty('acquisition_expense_id');
      const asTreasurer = (await get(treas, `/resources/assets/${d1Asset.id}`).expect(200)).body;
      expect(asTreasurer.acquisition_cost).toBe('300');
      const listLeader = await get(ds1, '/resources/assets').expect(200);
      expect(JSON.stringify(listLeader.body)).not.toContain('acquisition_cost');
    });

    it('department leaders cannot write, transfer, retire or schedule maintenance', async () => {
      await put(ds1, `/resources/assets/${d1Asset.id}`, { name: 'x' }).expect(403);
      await post(ds1, `/resources/assets/${d1Asset.id}/transfer`, { toDepartmentId: D2.id }).expect(403);
      await post(ds1, `/resources/assets/${d1Asset.id}/retire`, { reason: 'x' }).expect(403);
      await post(ds1, `/resources/assets/${d1Asset.id}/maintenance`, { type: 'repair', scheduledFor: '2026-10-01', description: 'x' }).expect(403);
      await post(ds1, '/resources/reminders/run').expect(403);
    });

    it('cross-tenant and garbage ids on every asset route', async () => {
      const ids = [bAsset.id];
      for (const id of ids) {
        await get(sec, `/resources/assets/${id}`).expect(403);
        await put(sec, `/resources/assets/${id}`, { name: 'x' }).expect(403);
        await post(sec, `/resources/assets/${id}/transfer`, { toLocationId: null }).expect(403);
        await post(sec, `/resources/assets/${id}/check-out`, { memberId: m1.id }).expect(403);
        await post(sec, `/resources/assets/${id}/retire`, { reason: 'x' }).expect(403);
        await get(sec, `/resources/assets/${id}/documents`).expect(403);
      }
      for (const path of ['', '/history', '/documents', '/loans', '/maintenance']) {
        await get(sec, `/resources/assets/not-a-uuid${path}`).expect(404);
        await get(sec, `/resources/assets/${randomUUID()}${path}`).expect(404);
      }
      await post(sec, '/resources/maintenance/not-a-uuid/start').expect(404);
      await get(secB, `/resources/assets/${d1Asset.id}`).expect(403);
    });

    it('search and list filters work and are validated', async () => {
      const byTag = await get(asst, `/resources/assets?q=${d1Asset.asset_tag.slice(0, 7)}`).expect(200);
      expect(byTag.body.map((a: any) => a.id)).toContain(d1Asset.id);
      await get(asst, '/resources/assets?condition=mint').expect(400);
      await get(asst, '/resources/assets?categoryId=nope').expect(400);
      await get(asst, '/resources/assets?limit=0').expect(400);
      const paged = await get(asst, '/resources/assets?limit=2').expect(200);
      expect(paged.body.length).toBeLessThanOrEqual(2);
      expect(Number(paged.headers['x-total-count'])).toBeGreaterThan(2);
    });
  });

  describe('transfer', () => {
    it('moves department / location / custodian with history; refuses foreign targets and invalid states', async () => {
      const a = await mkAsset({ owningDepartmentId: D1.id, locationId: locA.id });
      const t = await post(asst, `/resources/assets/${a.id}/transfer`, { toDepartmentId: D2.id, toLocationId: locA2.id, toCustodianMemberId: m2.id, reason: 'Reorganised' }).expect(201);
      expect(t.body.owning_department_id).toBe(D2.id);
      expect(t.body.location_id).toBe(locA2.id);
      expect(t.body.custodian_member_id).toBe(m2.id);
      const hist = (await get(asst, `/resources/assets/${a.id}/history`).expect(200)).body;
      expect(hist[0]).toMatchObject({ eventType: 'transferred', toDepartment: D2.name, note: 'Reorganised' });
      await post(asst, `/resources/assets/${a.id}/transfer`, {}).expect(400);
      await post(asst, `/resources/assets/${a.id}/transfer`, { toDepartmentId: DB.id }).expect(404);
      await post(asst, `/resources/assets/${a.id}/transfer`, { toCustodianMemberId: mB.id }).expect(404);
      await post(asst, `/resources/assets/${a.id}/transfer`, { toLocationId: randomUUID() }).expect(400);
      const cleared = await post(asst, `/resources/assets/${a.id}/transfer`, { toCustodianMemberId: null }).expect(201);
      expect(cleared.body.custodian_member_id).toBeNull();
      await post(chair, `/resources/assets/${a.id}/transfer`, { toDepartmentId: D1.id }).expect(403);
    });

    it('cannot transfer an asset that is on loan', async () => {
      const a = await mkAsset({ owningDepartmentId: D1.id });
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(201);
      await post(asst, `/resources/assets/${a.id}/transfer`, { toDepartmentId: D2.id }).expect(409);
    });
  });

  describe('check-out / check-in', () => {
    it('full cycle: one open loan at a time, condition tracked, history + notification (neutral text)', async () => {
      const a = await mkAsset({ name: `Projector ${uniq()}`, owningDepartmentId: D1.id });
      const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const loan = (await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id, dueDate: due, notes: 'Sunday service' }).expect(201)).body;
      expect(loan.condition_out).toBe('good');
      expect((await get(asst, `/resources/assets/${a.id}`).expect(200)).body).toMatchObject({ status: 'checked_out', openLoan: { id: loan.id } });
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m2.id }).expect(409);
      const n = await prisma.notification.findMany({ where: { recipient_user_id: ord.id, entity_id: a.id } });
      expect(n.length).toBe(1);
      expect(JSON.stringify(n)).not.toContain(a.name);
      const back = (await post(asst, `/resources/assets/${a.id}/check-in`, { condition: 'fair', notes: 'scratched' }).expect(201)).body;
      expect(back.condition_in).toBe('fair');
      await post(asst, `/resources/assets/${a.id}/check-in`, {}).expect(409); // already in
      const after = (await get(asst, `/resources/assets/${a.id}`).expect(200)).body;
      expect(after).toMatchObject({ status: 'available', condition: 'fair', openLoan: null });
      const types = (await get(asst, `/resources/assets/${a.id}/history`).expect(200)).body.map((h: any) => h.eventType);
      expect(types).toEqual(expect.arrayContaining(['checked_out', 'checked_in', 'condition_changed']));
    });

    it('validation and references', async () => {
      const a = await mkAsset();
      await post(asst, `/resources/assets/${a.id}/check-out`, {}).expect(400);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: 'nope' }).expect(400);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: mB.id }).expect(404);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id, dueDate: '2020-01-01' }).expect(400);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id, conditionOut: 'shiny' }).expect(400);
      await post(chair, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(403);
      await post(treas, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(403);
      const consumable = await mkAsset({ isConsumable: true, quantity: 5 });
      await post(asst, `/resources/assets/${consumable.id}/check-out`, { memberId: m1.id }).expect(400);
    });

    it('department leaders lend only their own department\'s assets to their own department\'s members', async () => {
      const a = await mkAsset({ owningDepartmentId: D1.id });
      await post(ds1, `/resources/assets/${a.id}/check-out`, { memberId: m2.id }).expect(403); // D2 member
      await post(ds1, `/resources/assets/${a.id}/check-out`, { memberId: m3.id }).expect(403); // no department
      await post(ds2, `/resources/assets/${a.id}/check-out`, { memberId: m2.id }).expect(403); // not their asset
      await post(ds1, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(201);
      await post(ds2, `/resources/assets/${a.id}/check-in`, {}).expect(403);
      await post(ds1, `/resources/assets/${a.id}/check-in`, {}).expect(201);
      const other = await mkAsset({ owningDepartmentId: D2.id });
      await post(ds1, `/resources/assets/${other.id}/check-out`, { memberId: m1.id }).expect(403);
    });

    it('concurrency: simultaneous check-outs - exactly one wins, one open loan exists', async () => {
      const a = await mkAsset();
      const results = await Promise.all([
        post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }),
        post(sec, `/resources/assets/${a.id}/check-out`, { memberId: m2.id }),
        post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m3.id }),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await prisma.assetLoan.count({ where: { asset_id: a.id, checked_in_at: null } })).toBe(1);
      const ins = await Promise.all([post(asst, `/resources/assets/${a.id}/check-in`, {}), post(sec, `/resources/assets/${a.id}/check-in`, {})]);
      expect(ins.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it('members see only their own loans', async () => {
      const a = await mkAsset({ name: `Mine ${uniq()}` });
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(201);
      const other = await mkAsset({ name: `Theirs ${uniq()}` });
      await post(asst, `/resources/assets/${other.id}/check-out`, { memberId: m2.id }).expect(201);
      const mine = (await get(ord, '/resources/my-loans').expect(200)).body;
      expect(mine.map((l: any) => l.asset.id)).toContain(a.id);
      expect(mine.map((l: any) => l.asset.id)).not.toContain(other.id);
      await get(gl, '/resources/my-loans').expect(404); // no linked member
    });
  });

  describe('maintenance', () => {
    it('schedule -> start -> complete restores availability, updates condition, and hides cost from non-cost viewers', async () => {
      const a = await mkAsset({ owningDepartmentId: D1.id, condition: 'poor' });
      const m = (await post(asst, `/resources/assets/${a.id}/maintenance`, { type: 'repair', scheduledFor: '2026-10-01', description: 'Replace cable', performedBy: 'Local tech' }).expect(201)).body;
      await post(asst, `/resources/maintenance/${m.id}/start`).expect(201);
      expect((await get(asst, `/resources/assets/${a.id}`).expect(200)).body.status).toBe('in_maintenance');
      await post(asst, `/resources/maintenance/${m.id}/start`).expect(409);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(409); // unavailable while in maintenance
      await post(ds1, `/resources/maintenance/${m.id}/complete`, { cost: 10 }).expect(403);
      const done = (await post(asst, `/resources/maintenance/${m.id}/complete`, { cost: 45.5, conditionAfter: 'good' }).expect(201)).body;
      expect(done.status).toBe('completed');
      expect((await get(asst, `/resources/assets/${a.id}`).expect(200)).body).toMatchObject({ status: 'available', condition: 'good' });
      await post(asst, `/resources/maintenance/${m.id}/complete`, {}).expect(409);
      const leaderView = (await get(ds1, `/resources/assets/${a.id}/maintenance`).expect(200)).body;
      expect(leaderView[0]).not.toHaveProperty('cost');
      const treasView = (await get(treas, `/resources/assets/${a.id}/maintenance`).expect(200)).body;
      expect(treasView[0].cost).toBe('45.5');
    });

    it('a failed start rolls back completely: an asset on loan stays on loan and the job stays scheduled', async () => {
      const a = await mkAsset();
      const m = (await post(asst, `/resources/assets/${a.id}/maintenance`, { type: 'inspection', scheduledFor: '2026-10-05', description: 'Annual' }).expect(201)).body;
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(201);
      await post(asst, `/resources/maintenance/${m.id}/start`).expect(409);
      expect((await prisma.assetMaintenance.findUnique({ where: { id: m.id } }))!.status).toBe('scheduled');
      expect((await prisma.asset.findUnique({ where: { id: a.id } }))!.status).toBe('checked_out');
    });

    it('cancel returns an in-progress asset to service; validation; concurrent starts', async () => {
      const a = await mkAsset();
      const bad = (b: object) => post(asst, `/resources/assets/${a.id}/maintenance`, b);
      await bad({ type: 'wash', scheduledFor: '2026-10-01', description: 'x' }).expect(400);
      await bad({ type: 'repair', scheduledFor: 'garbage', description: 'x' }).expect(400);
      await bad({ type: 'repair', scheduledFor: '2026-10-01' }).expect(400);
      const m = (await bad({ type: 'repair', scheduledFor: '2026-10-01', description: 'Fix' }).expect(201)).body;
      const starts = await Promise.all([post(asst, `/resources/maintenance/${m.id}/start`), post(sec, `/resources/maintenance/${m.id}/start`)]);
      expect(starts.filter((r) => r.status === 201)).toHaveLength(1);
      await post(sec, `/resources/maintenance/${m.id}/cancel`).expect(201);
      expect((await prisma.asset.findUnique({ where: { id: a.id } }))!.status).toBe('available');
      await post(sec, `/resources/maintenance/${m.id}/cancel`).expect(409);
    });

    it('the work list supports overdue filtering and is department-scoped for leaders', async () => {
      const own = await mkAsset({ owningDepartmentId: D1.id });
      const foreign = await mkAsset({ owningDepartmentId: D2.id });
      await prisma.assetMaintenance.create({ data: { fellowship_id: fA.id, asset_id: own.id, type: 'repair', scheduled_for: new Date(Date.now() - 5 * 86400000), description: 'old', created_by: sec.id } });
      await prisma.assetMaintenance.create({ data: { fellowship_id: fA.id, asset_id: foreign.id, type: 'repair', scheduled_for: new Date(Date.now() - 5 * 86400000), description: 'old', created_by: sec.id } });
      const wide = (await get(asst, '/resources/maintenance?overdue=true').expect(200)).body;
      expect(wide.map((r: any) => r.asset.id)).toEqual(expect.arrayContaining([own.id, foreign.id]));
      const leader = (await get(ds1, '/resources/maintenance?overdue=true').expect(200)).body;
      expect(leader.map((r: any) => r.asset.id)).toContain(own.id);
      expect(leader.map((r: any) => r.asset.id)).not.toContain(foreign.id);
      await get(asst, '/resources/maintenance?status=weird').expect(400);
    });
  });

  describe('retirement', () => {
    it('only the Secretary retires; reason required; not while on loan; final', async () => {
      const a = await mkAsset();
      await post(asst, `/resources/assets/${a.id}/retire`, { reason: 'old' }).expect(403);
      await post(sec, `/resources/assets/${a.id}/retire`, {}).expect(400);
      await post(sec, `/resources/assets/${a.id}/retire`, { reason: 'x', outcome: 'stolen' }).expect(400);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(201);
      await post(sec, `/resources/assets/${a.id}/retire`, { reason: 'old' }).expect(409);
      await post(asst, `/resources/assets/${a.id}/check-in`, {}).expect(201);
      const m = (await post(asst, `/resources/assets/${a.id}/maintenance`, { type: 'repair', scheduledFor: '2026-10-01', description: 'pending' }).expect(201)).body;
      const r = (await post(sec, `/resources/assets/${a.id}/retire`, { reason: 'Beyond repair', outcome: 'lost' }).expect(201)).body;
      expect(r).toMatchObject({ status: 'lost', retired_reason: 'Beyond repair' });
      expect((await prisma.assetMaintenance.findUnique({ where: { id: m.id } }))!.status).toBe('cancelled'); // open work is cancelled
      await post(sec, `/resources/assets/${a.id}/retire`, { reason: 'again' }).expect(409);
      await put(asst, `/resources/assets/${a.id}`, { name: 'x' }).expect(409);
      await post(asst, `/resources/assets/${a.id}/check-out`, { memberId: m1.id }).expect(409);
      await post(asst, `/resources/assets/${a.id}/transfer`, { toLocationId: locA.id }).expect(409);
      await post(asst, `/resources/assets/${a.id}/maintenance`, { type: 'repair', scheduledFor: '2026-10-01', description: 'x' }).expect(409);
    });
  });

  describe('consumable stock', () => {
    it('adjusts quantity safely (never negative, race-safe) and reports low stock', async () => {
      const s = await mkAsset({ name: `Paper ${uniq()}`, isConsumable: true, quantity: 10, reorderLevel: 5, owningDepartmentId: D1.id });
      await post(asst, `/resources/assets/${s.id}/adjust-quantity`, { delta: -3, reason: 'used' }).expect(201);
      await post(asst, `/resources/assets/${s.id}/adjust-quantity`, { delta: -8, reason: 'too many' }).expect(409);
      await post(asst, `/resources/assets/${s.id}/adjust-quantity`, { delta: 0, reason: 'x' }).expect(400);
      await post(asst, `/resources/assets/${s.id}/adjust-quantity`, { delta: 1.5, reason: 'x' }).expect(400);
      await post(asst, `/resources/assets/${s.id}/adjust-quantity`, { delta: -1 }).expect(400); // reason required
      await post(chair, `/resources/assets/${s.id}/adjust-quantity`, { delta: 1, reason: 'x' }).expect(403);
      expect((await prisma.asset.findUnique({ where: { id: s.id } }))!.quantity).toBe(7);
      const race = await Promise.all([
        post(asst, `/resources/assets/${s.id}/adjust-quantity`, { delta: -6, reason: 'a' }),
        post(sec, `/resources/assets/${s.id}/adjust-quantity`, { delta: -6, reason: 'b' }),
      ]);
      expect(race.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await prisma.asset.findUnique({ where: { id: s.id } }))!.quantity).toBe(1);
      const report = (await get(asst, '/resources/reports/summary').expect(200)).body;
      expect(report.lowStock.map((x: any) => x.id)).toContain(s.id);
      const leader = (await get(ds1, '/resources/reports/summary').expect(200)).body;
      expect(leader.lowStock.map((x: any) => x.id)).toContain(s.id);
      const plain = await mkAsset();
      await post(asst, `/resources/assets/${plain.id}/adjust-quantity`, { delta: 1, reason: 'x' }).expect(400);
    });
  });

  describe('documents (reused document store)', () => {
    it('attaches same-fellowship internal documents only, exposes metadata only, and is permission-gated', async () => {
      const a = await mkAsset({ owningDepartmentId: D1.id });
      const doc = await prisma.documentEntity.create({ data: { title: 'Warranty', filename: 'w.pdf', stored_filename: 'SECRET-STORAGE-NAME', file_size: 5, mime_type: 'application/pdf', uploaded_by: randomUUID(), fellowship_id: fA.id } });
      const web = await prisma.documentEntity.create({ data: { title: 'Public', filename: 'p.pdf', stored_filename: 'x', file_size: 5, mime_type: 'application/pdf', uploaded_by: randomUUID(), fellowship_id: fA.id, is_website_content: true } });
      const foreign = await prisma.documentEntity.create({ data: { title: 'Foreign', filename: 'f.pdf', stored_filename: 'x', file_size: 5, mime_type: 'application/pdf', uploaded_by: randomUUID(), fellowship_id: fB.id } });
      await post(asst, `/resources/assets/${a.id}/documents`, { documentId: web.id }).expect(400);
      await post(asst, `/resources/assets/${a.id}/documents`, { documentId: foreign.id }).expect(400);
      await post(asst, `/resources/assets/${a.id}/documents`, { documentId: 'nope' }).expect(400);
      await post(ds1, `/resources/assets/${a.id}/documents`, { documentId: doc.id }).expect(403);
      await post(chair, `/resources/assets/${a.id}/documents`, { documentId: doc.id }).expect(403);
      const link = (await post(asst, `/resources/assets/${a.id}/documents`, { documentId: doc.id, label: 'Warranty card' }).expect(201)).body;
      await post(asst, `/resources/assets/${a.id}/documents`, { documentId: doc.id }).expect(409);
      const list = await get(ds1, `/resources/assets/${a.id}/documents`).expect(200); // the owning department's leader can see it
      expect(list.body[0].document.title).toBe('Warranty');
      expect(JSON.stringify(list.body)).not.toContain('SECRET-STORAGE-NAME');
      await post(asst, `/resources/assets/${a.id}/documents/${link.id}/remove`).expect(201);
      await post(asst, `/resources/assets/${a.id}/documents/${link.id}/remove`).expect(404);
      await post(asst, `/resources/assets/${a.id}/documents/not-a-uuid/remove`).expect(404);
    });
  });

  describe('history is append-only', () => {
    it('there is no route to edit or delete history', async () => {
      const a = await mkAsset();
      const h = (await get(asst, `/resources/assets/${a.id}/history`).expect(200)).body[0];
      await put(sec, `/resources/assets/${a.id}/history/${h.id}`, { note: 'rewrite' }).expect(404);
      await api(app, sec.token).post(`/resources/assets/${a.id}/history/${h.id}/remove`, {}).expect(404);
      expect(await prisma.assetHistory.count({ where: { asset_id: a.id } })).toBe(1);
    });
  });

  describe('reports and reminders', () => {
    it('summary aggregates correctly, scopes to the caller, and hides value from non-cost viewers', async () => {
      const fx = await makeFellowship(prisma, 'RRPT');
      const s = await makeUser(prisma, { fellowshipId: fx.id, roles: ['secretary'] });
      const dx = await makeDepartment(prisma, fx.id, 'RRD');
      const dl = await makeUser(prisma, { fellowshipId: fx.id, roles: ['department_secretary'], departmentId: dx.id });
      const P = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
      const a1 = (await P(s, '/resources/assets', { name: 'A1', condition: 'good', acquisitionCost: 100, owningDepartmentId: dx.id }).expect(201)).body;
      await P(s, '/resources/assets', { name: 'A2', condition: 'poor', acquisitionCost: 50 }).expect(201);
      const retired = (await P(s, '/resources/assets', { name: 'A3', acquisitionCost: 999 }).expect(201)).body;
      await P(s, `/resources/assets/${retired.id}/retire`, { reason: 'gone' }).expect(201);
      const member = await makeMember(prisma, { fellowshipId: fx.id });
      await addToDepartment(prisma, member.id, dx.id);
      await P(s, `/resources/assets/${a1.id}/check-out`, { memberId: member.id }).expect(201);
      const r = (await api(app, s.token).get('/resources/reports/summary').expect(200)).body;
      expect(r.scope).toBe('fellowship');
      expect(r.totals).toMatchObject({ available: 1, checked_out: 1, retired: 1 });
      expect(r.acquisitionValue).toBe('150'); // retired asset excluded
      expect(r.loans).toMatchObject({ open: 1, overdue: 0 });
      expect(r.movement).toMatchObject({ checked_out: 1, retired: 1 });
      expect(r.byCondition.map((c: any) => [c.condition, c.count]).sort()).toEqual([['good', 1], ['poor', 1]]);
      const leader = (await api(app, dl.token).get('/resources/reports/summary').expect(200)).body;
      expect(leader.scope).toBe('department');
      expect(leader.acquisitionValue).toBeNull();
      expect(leader.totals).toMatchObject({ checked_out: 1 });
      expect(leader.byDepartment.every((d: any) => d.departmentId === dx.id)).toBe(true);
      // another fellowship sees none of this, even when it asks for it
      const other = (await get(secB, `/resources/reports/summary?fellowshipId=${fx.id}`).expect(200)).body;
      expect(other.totals.checked_out ?? 0).toBe(0);
    });

    it('validates the report window', async () => {
      await get(asst, '/resources/reports/summary?from=2026-09-01&to=2026-01-01').expect(400);
      await get(asst, '/resources/reports/summary?from=garbage').expect(400);
      await get(asst, '/resources/reports/summary?from=2010-01-01&to=2026-01-01').expect(400);
      await get(asst, '/resources/reports/summary?fellowshipId=nope').expect(400);
    });

    it('reminders notify overdue borrowers once per day, with neutral text, and need permission', async () => {
      const a = await mkAsset({ name: `Overdue thing ${uniq()}` });
      await prisma.assetLoan.create({ data: { fellowship_id: fA.id, asset_id: a.id, member_id: m1.id, due_date: new Date(Date.now() - 3 * 86400000), condition_out: 'good', checked_out_by: sec.id } });
      await prisma.asset.update({ where: { id: a.id }, data: { status: 'checked_out' } });
      await post(chair, '/resources/reminders/run').expect(403);
      await post(ds1, '/resources/reminders/run').expect(403);
      const first = (await post(asst, '/resources/reminders/run').expect(201)).body;
      expect(first.loanReminders).toBeGreaterThanOrEqual(1);
      const notes = await prisma.notification.findMany({ where: { recipient_user_id: ord.id, entity_id: a.id, event_type: 'resource_overdue' } });
      expect(notes).toHaveLength(1);
      expect(JSON.stringify(notes)).not.toContain(a.name);
      await post(asst, '/resources/reminders/run').expect(201);
      expect(await prisma.notification.count({ where: { recipient_user_id: ord.id, entity_id: a.id, event_type: 'resource_overdue' } })).toBe(1);
    });
  });
});
