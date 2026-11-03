import { INestApplication } from '@nestjs/common';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser, uniq } from './harness';

/**
 * Resource management end to end over HTTP against real Postgres: ownership classes, registration, assignment,
 * transfers, booking, borrowing and returns, maintenance with Finance, incidents and disposal, consumable stock,
 * isolation, reports and audit history.
 */
jest.setTimeout(300_000);

describeDb('Resource management (real Postgres, HTTP)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let f: any, fB: any;
  let treas: any, sec: any, chair: any, asstChair: any, treasB: any, ord: any;
  let dChair: any, dSec: any, oChair: any, oSec: any;
  let dept: any, other: any;
  let m1: any, m2: any;
  let projector: any, guitar: any, paper: any, chairs: any;

  const get = (u: any, url: string) => api(app, u.token).get(url);
  const post = (u: any, url: string, body: object = {}) => api(app, u.token).post(url, body);
  const put = (u: any, url: string, body: object = {}) => api(app, u.token).put(url, body);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
  const asset = async (id: string) => prisma.asset.findUniqueOrThrow({ where: { id } });
  const decide = (u: any, approvalId: string, expect = 201) => post(u, `/finance/approvals/${approvalId}/decide`, { decision: 'approved' }).expect(expect);
  const wf = (entityId: string) => prisma.approval.findFirstOrThrow({ where: { entity_id: entityId }, orderBy: { created_at: 'desc' } });

  async function lead(user: any, departmentId: string, role: string, memberId: string) {
    await prisma.departmentLeader.create({ data: { department_id: departmentId, user_id: user.id, role_in_department: role, active_role: role, fellowship_id: f.id, member_id: memberId } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    f = await makeFellowship(prisma, 'INV');
    fB = await makeFellowship(prisma, 'INVB');
    treas = await makeUser(prisma, { fellowshipId: f.id, roles: ['treasurer'] });
    sec = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
    chair = await makeUser(prisma, { fellowshipId: f.id, roles: ['chairperson'] });
    asstChair = await makeUser(prisma, { fellowshipId: f.id, roles: ['assistant_chairperson'] });
    treasB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['treasurer'] });
    ord = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
    dept = await makeDepartment(prisma, f.id, 'Choir');
    other = await makeDepartment(prisma, f.id, 'Media');
    m1 = await makeMember(prisma, { fellowshipId: f.id, name: 'Juma Leader' });
    m2 = await makeMember(prisma, { fellowshipId: f.id, name: 'Neema Leader' });
    const m3 = await makeMember(prisma, { fellowshipId: f.id, name: 'Other Chair' });
    const m4 = await makeMember(prisma, { fellowshipId: f.id, name: 'Other Sec' });
    dChair = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_chairperson'] });
    dSec = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_secretary'] });
    oChair = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_chairperson'] });
    oSec = await makeUser(prisma, { fellowshipId: f.id, roles: ['department_secretary'] });
    await lead(dChair, dept.id, 'department_chairperson', m1.id);
    await lead(dSec, dept.id, 'department_secretary', m2.id);
    await lead(oChair, other.id, 'department_chairperson', m3.id);
    await lead(oSec, other.id, 'department_secretary', m4.id);
    await post(treas, '/inventory/categories/defaults').expect(201);
  });

  afterAll(async () => { await app?.close(); });

  describe('registration and ownership', () => {
    it('1. the Treasurer registers fellowship-owned resources with unique numbers; others cannot', async () => {
      projector = (await post(treas, '/inventory/assets', { name: 'Epson projector', ownershipType: 'fellowship', acquisitionCost: 900000, serialNumber: 'EP-1', condition: 'excellent' }).expect(201)).body;
      expect(projector).toMatchObject({ ownership_type: 'fellowship', owning_department_id: null, isOwned: true });
      expect(projector.asset_tag).toMatch(/^AST-\d{4}-\d{5}$/);
      chairs = (await post(treas, '/inventory/assets', { name: 'Plastic chairs', ownershipType: 'fellowship', quantity: 50 }).expect(201)).body;
      expect(chairs.asset_tag).not.toBe(projector.asset_tag);
      await post(sec, '/inventory/assets', { name: 'x', ownershipType: 'fellowship' }).expect(403); // Secretary views, does not edit
      await post(dChair, '/inventory/assets', { name: 'x', ownershipType: 'fellowship' }).expect(403);
      await post(ord, '/inventory/assets', { name: 'x' }).expect(403);
    });

    it('2. a department registers its own resources independently', async () => {
      guitar = (await post(dSec, '/inventory/assets', { name: 'Bass guitar', ownershipType: 'department', departmentId: dept.id, acquisitionCost: 400000 }).expect(201)).body;
      expect(guitar).toMatchObject({ ownership_type: 'department', owning_department_id: dept.id });
      await post(oSec, '/inventory/assets', { name: 'x', ownershipType: 'department', departmentId: dept.id }).expect(403); // another department
      await post(treas, '/inventory/assets', { name: 'x', ownershipType: 'department', departmentId: dept.id }).expect(403); // Treasurer does not register for departments
    });

    it('3. donated resources record the donor and estimated value, never cash', async () => {
      const d = (await post(dChair, '/inventory/assets', { name: 'Keyboard', ownershipType: 'donated', departmentId: dept.id, donorName: 'Mama Asha', donationDate: day(-2), estimatedValue: 250000 }).expect(201)).body;
      expect(d).toMatchObject({ ownership_type: 'donated', donor_name: 'Mama Asha', estimated_value: '250000.00', acquisition_method: 'donation' });
      await post(treas, '/inventory/assets', { name: 'Gift', ownershipType: 'donated', acquisitionCost: 10 }).expect(400);
      expect(await prisma.ledgerEntry.count({ where: { fellowship_id: f.id } })).toBe(0); // no money recorded
    });

    it('4. borrowed external resources track the owner and return date, and are never owned', async () => {
      const b = (await post(treas, '/inventory/assets', { name: 'Borrowed tent', ownershipType: 'borrowed', externalOwnerName: 'St Paul Parish', borrowedOn: day(-1), expectedReturnDate: day(5), conditionReceived: 'good' }).expect(201)).body;
      expect(b).toMatchObject({ isOwned: false, external_owner_name: 'St Paul Parish' });
      await post(treas, '/inventory/assets', { name: 'x', ownershipType: 'borrowed', borrowedOn: day(-1), expectedReturnDate: day(1) }).expect(400); // owner required
      const report = (await get(treas, '/inventory/reports/ownership').expect(200)).body;
      expect(report.summary.find((s: any) => s.label.startsWith('Borrowed')).value).toBe('1');
      await post(treas, `/inventory/assets/${b.id}/return-to-owner`, { conditionReturned: 'good' }).expect(201);
      expect((await asset(b.id)).actual_return_date).not.toBeNull();
    });

    it('5. ownership follows the money: a centrally funded purchase cannot be registered as a department\'s', async () => {
      // Fund the fellowship's default cash account first, so the purchase can be paid.
      const m = await makeMember(prisma, { fellowshipId: f.id, name: 'Giver' });
      await post(treas, '/finance/contributions', { memberId: m.id, amount: 100000, date: day(0) }).expect(201);
      const e = (await post(treas, '/finance/expenses', { title: 'Laptop', amount: 50000, date: day(0) }).expect(201)).body;
      const w = await wf(e.id);
      await decide(sec, w.id);
      await decide(chair, w.id);
      await post(treas, `/finance/expenses/${e.id}/pay`, {}).expect(201);
      await post(dSec, '/inventory/assets', { name: 'Laptop', ownershipType: 'department', departmentId: dept.id, acquisitionExpenseId: e.id }).expect(400);
      const laptop = (await post(treas, '/inventory/assets', { name: 'Laptop', ownershipType: 'fellowship', acquisitionExpenseId: e.id }).expect(201)).body;
      expect(laptop).toMatchObject({ acquisition_expense_id: e.id, acquisition_cost: '50000.00' });
      expect(laptop.finance.purchase.expense_number).toBe(e.expense_number);
      // 20. no second expense was created by registering it
      expect(await prisma.expense.count({ where: { fellowship_id: f.id, title: 'Laptop' } })).toBe(1);
    });
  });

  describe('isolation, assignment and transfers', () => {
    it('18-19. departments see only their own; the Treasurer sees everything but cannot edit a department\'s resource', async () => {
      const mine = (await get(dSec, '/inventory/assets').expect(200)).body.data;
      expect(mine.every((a: any) => a.owning_department_id === dept.id || a.assigned_department_id === dept.id)).toBe(true);
      await get(oChair, `/inventory/assets/${guitar.id}`).expect(403);
      await put(oSec, `/inventory/assets/${guitar.id}`, { name: 'Mine now' }).expect(403);
      await get(dSec, `/inventory/assets/${projector.id}`).expect(403); // fellowship asset not assigned to them
      const all = (await get(treas, '/inventory/assets').expect(200)).body.data;
      expect(all.some((a: any) => a.id === guitar.id)).toBe(true);
      await put(treas, `/inventory/assets/${guitar.id}`, { name: 'Renamed' }).expect(403);
      await put(dSec, `/inventory/assets/${guitar.id}`, { ownershipType: 'fellowship' }).expect(400); // never silently
      await get(treasB, `/inventory/assets/${projector.id}`).expect(404);
      await get(ord, '/inventory/assets').expect(403);
    });

    it('6. assigning a fellowship resource to a department keeps fellowship ownership', async () => {
      await post(treas, `/inventory/assets/${projector.id}/assign`, { departmentId: dept.id, responsibleMemberId: m1.id, condition: 'excellent' }).expect(201);
      const a = await asset(projector.id);
      expect(a).toMatchObject({ ownership_type: 'fellowship', owning_department_id: null, assigned_department_id: dept.id, status: 'assigned' });
      await get(dSec, `/inventory/assets/${projector.id}`).expect(200);
      await post(treas, `/inventory/assets/${projector.id}/assign`, { departmentId: other.id }).expect(409);
      await post(treas, `/inventory/assets/${guitar.id}/assign`, { departmentId: other.id }).expect(403); // not the Treasurer's to assign
      const n = await prisma.notification.count({ where: { recipient_user_id: dChair.id, event_type: 'resource_assigned' } });
      expect(n).toBe(1);
    });

    it('7-8. ownership transfers need authorization; unauthorized ones are refused', async () => {
      await post(oChair, `/inventory/assets/${guitar.id}/transfer`, { kind: 'ownership', toOwnership: 'department', toDepartmentId: other.id, reason: 'take it' }).expect(403);
      const t = (await post(dSec, `/inventory/assets/${guitar.id}/transfer`, { kind: 'ownership', toOwnership: 'department', toDepartmentId: other.id, reason: 'Media needs it more' }).expect(201)).body;
      expect(t.status).toBe('PENDING');
      expect((await asset(guitar.id)).owning_department_id).toBe(dept.id); // nothing changes yet
      const w = await wf(t.id);
      await decide(oChair, w.id, 403); // not the owning department's chair
      await decide(dChair, w.id);
      expect((await asset(guitar.id)).owning_department_id).toBe(dept.id);
      await decide(treas, w.id);
      const after = await asset(guitar.id);
      expect(after).toMatchObject({ owning_department_id: other.id, ownership_type: 'department' });
      const hist = await prisma.assetHistory.findMany({ where: { asset_id: guitar.id, event_type: 'ownership_transferred' } });
      expect(hist).toHaveLength(1);
      // a plain location move is immediate and recorded
      const loc = (await post(treas, '/inventory/locations', { name: `Store ${uniq()}` }).expect(201)).body;
      const mv = (await post(oSec, `/inventory/assets/${guitar.id}/transfer`, { kind: 'location', toLocationId: loc.id, reason: 'Storage' }).expect(201)).body;
      expect(mv.status).toBe('COMPLETED');
    });
  });

  describe('booking, borrowing and returns', () => {
    let r1: any;
    it('9. bookings respect availability; nobody approves their own request', async () => {
      r1 = (await post(oSec, '/inventory/requests', { assetId: chairs.id, departmentId: other.id, quantity: 40, purpose: 'Media night', neededFrom: day(1), neededUntil: day(2) }).expect(201)).body;
      const r2 = (await post(dSec, '/inventory/requests', { assetId: chairs.id, departmentId: dept.id, quantity: 20, purpose: 'Choir rehearsal', neededFrom: day(1.5), neededUntil: day(3) }).expect(201)).body;
      await post(dSec, `/inventory/requests/${r1.id}/decide`, { decision: 'approved' }).expect(403);
      await post(treas, `/inventory/requests/${r1.id}/decide`, { decision: 'approved' }).expect(201);
      await post(treas, `/inventory/requests/${r2.id}/decide`, { decision: 'approved' }).expect(409); // 40 + 20 > 50 on day 2
      await post(treas, `/inventory/requests/${r2.id}/decide`, { decision: 'rejected' }).expect(400); // a reason is required
      await post(treas, `/inventory/requests/${r2.id}/decide`, { decision: 'rejected', comment: 'Fully booked' }).expect(201);
      await post(oSec, '/inventory/requests', { assetId: guitar.id, departmentId: dept.id, purpose: 'x', neededFrom: day(1), neededUntil: day(2) }).expect(403);
    });

    it('10. handover and partial returns; the same items cannot be issued twice', async () => {
      await post(treas, `/inventory/requests/${r1.id}/issue`, { condition: 'good' }).expect(201);
      await post(treas, `/inventory/requests/${r1.id}/issue`).expect(409);
      await post(treas, `/inventory/requests/${r1.id}/return`, { quantity: 30, condition: 'good' }).expect(201);
      let r = await prisma.resourceRequest.findUniqueOrThrow({ where: { id: r1.id } });
      expect(r).toMatchObject({ status: 'PARTIALLY_RETURNED', quantity_returned: 30 });
      await post(treas, `/inventory/requests/${r1.id}/return`, { quantity: 11 }).expect(400);
      await post(treas, `/inventory/requests/${r1.id}/return`, { quantity: 10, condition: 'good' }).expect(201);
      r = await prisma.resourceRequest.findUniqueOrThrow({ where: { id: r1.id } });
      expect(r.status).toBe('RETURNED');
      expect((await asset(chairs.id)).status).toBe('available');
    });

    it('11-12. overdue returns are reminded; a damaged return opens a damage case', async () => {
      const r = (await post(dSec, '/inventory/requests', { assetId: projector.id, departmentId: dept.id, purpose: 'Concert', neededFrom: day(-3), neededUntil: day(-1) }).expect(201)).body;
      await post(treas, `/inventory/requests/${r.id}/decide`, { decision: 'approved' }).expect(201);
      await post(treas, `/inventory/requests/${r.id}/issue`).expect(201);
      expect((await asset(projector.id)).status).toBe('borrowed');
      const sent = (await post(treas, '/inventory/reminders/run').expect(201)).body;
      expect(sent.overdue).toBeGreaterThanOrEqual(1);
      expect(await prisma.notification.count({ where: { recipient_user_id: dSec.id, event_type: 'resource_overdue' } })).toBe(1);
      await post(treas, '/inventory/reminders/run').expect(201);
      expect(await prisma.notification.count({ where: { recipient_user_id: dSec.id, event_type: 'resource_overdue' } })).toBe(1); // once a day
      await post(treas, `/inventory/requests/${r.id}/return`, { condition: 'damaged' }).expect(400); // describe it
      await post(treas, `/inventory/requests/${r.id}/return`, { condition: 'damaged', notes: 'Lens cracked' }).expect(201);
      const inc = await prisma.assetIncident.findFirstOrThrow({ where: { asset_id: projector.id, incident_type: 'damaged' } });
      expect(inc.description).toBe('Lens cracked');
      expect((await asset(projector.id)).condition).toBe('damaged');
    });
  });

  describe('maintenance, disposal and stock', () => {
    it('13. a repair is reported, approved with one Finance expense, carried out and completed', async () => {
      const m = (await post(dSec, `/inventory/assets/${projector.id}/maintenance`, { description: 'Replace lens', estimatedCost: 80000 }).expect(201)).body;
      expect(m.status).toBe('reported');
      await post(dChair, `/inventory/maintenance/${m.id}/review`, { decision: 'approved' }).expect(403); // the fellowship's asset
      const rv = (await post(treas, `/inventory/maintenance/${m.id}/review`, { decision: 'approved', technician: 'Optics Ltd', createExpense: true }).expect(201)).body;
      expect(rv.expense_id).toBeTruthy();
      const e = await prisma.expense.findUniqueOrThrow({ where: { id: rv.expense_id } });
      expect(e).toMatchObject({ title: expect.stringContaining('Repair'), approval_status: 'SUBMITTED' }); // follows Finance approval
      await post(treas, `/inventory/maintenance/${m.id}/link-expense`, { expenseId: e.id }).expect(409); // never twice
      await post(treas, `/inventory/maintenance/${m.id}/start`).expect(201);
      expect((await asset(projector.id)).status).toBe('in_maintenance');
      await post(treas, `/inventory/maintenance/${m.id}/complete`, { actualCost: 75000, conditionAfter: 'good' }).expect(201);
      const a = await asset(projector.id);
      expect(a).toMatchObject({ status: 'assigned', condition: 'good' }); // back with the department it is assigned to
      expect(await prisma.notification.count({ where: { recipient_user_id: dSec.id, event_type: 'maintenance_completed' } })).toBe(1);
    });

    it('14. disposal: a department\'s Chairperson then the Treasurer; the asset is kept as history', async () => {
      const old = (await post(dSec, '/inventory/assets', { name: 'Old amplifier', ownershipType: 'department', departmentId: dept.id }).expect(201)).body;
      const inc = (await post(dSec, `/inventory/assets/${old.id}/disposal`, { proposedAction: 'dispose', description: 'Beyond repair', disposalMethod: 'scrap' }).expect(201)).body;
      expect(inc.status).toBe('PENDING_APPROVAL');
      const w = await wf(inc.id);
      await decide(dSec, w.id, 403);
      await decide(dChair, w.id);
      await decide(treas, w.id);
      const a = await asset(old.id);
      expect(a).toMatchObject({ status: 'disposed', disposal_method: 'scrap' });
      expect(await prisma.assetHistory.count({ where: { asset_id: old.id, event_type: 'disposed' } })).toBe(1);
      await put(dSec, `/inventory/assets/${old.id}`, { name: 'x' }).expect(409);
      // a fellowship disposal needs the Secretary and the Chairperson
      const box = (await post(treas, '/inventory/assets', { name: 'Broken table', ownershipType: 'fellowship' }).expect(201)).body;
      const inc2 = (await post(treas, `/inventory/assets/${box.id}/disposal`, { proposedAction: 'write_off', description: 'Missing after event' }).expect(201)).body;
      const w2 = await wf(inc2.id);
      await decide(treas, w2.id, 403);
      await decide(sec, w2.id);
      await decide(chair, w2.id);
      expect((await asset(box.id)).status).toBe('lost');
    });

    it('15-17. stock received and issued; never more than held; low stock is notified', async () => {
      paper = (await post(dSec, '/inventory/assets', { name: 'A4 paper', ownershipType: 'department', departmentId: dept.id, isConsumable: true, quantity: 10, unit: 'ream', reorderLevel: 4 }).expect(201)).body;
      await post(dSec, `/inventory/assets/${paper.id}/stock/receive`, { quantity: 5, reference: 'DN-1' }).expect(201);
      expect((await asset(paper.id)).quantity).toBe(15);
      await post(dSec, `/inventory/assets/${paper.id}/stock/issue`, { quantity: 16 }).expect(409);
      await post(dSec, `/inventory/assets/${paper.id}/stock/issue`, { quantity: 11, memberId: m1.id }).expect(201);
      expect((await asset(paper.id)).quantity).toBe(4);
      expect(await prisma.notification.count({ where: { recipient_user_id: dChair.id, event_type: 'low_stock' } })).toBe(1);
      await post(dSec, `/inventory/assets/${paper.id}/stock/adjust`, { quantity: -1 }).expect(400); // reason required
      await post(dSec, `/inventory/assets/${paper.id}/stock/adjust`, { quantity: -1, reason: 'Stock-take' }).expect(201);
      await post(oSec, `/inventory/assets/${paper.id}/stock/issue`, { quantity: 1 }).expect(403);
      const moves = (await get(dSec, `/inventory/assets/${paper.id}/stock`).expect(200)).body;
      expect(moves.map((m: any) => m.kind).sort()).toEqual(['adjusted', 'issued', 'received', 'received']);
      await post(dSec, `/inventory/assets/${paper.id}/stock/transfer`, { quantity: 1, toDepartmentId: other.id }).expect(403); // not department to department
    });
  });

  describe('reports and audit', () => {
    it('21. reports export as PDF and Excel; departments export only their own', async () => {
      const keys = (await get(treas, '/inventory/reports').expect(200)).body.map((r: any) => r.key);
      expect(keys).toHaveLength(14);
      for (const k of keys) await get(treas, `/inventory/reports/${k}`).expect(200);
      const bin = (res: any, cb: any) => { const ch: Buffer[] = []; res.on('data', (d: Buffer) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); };
      const x = await get(treas, '/inventory/reports/central-inventory?format=xlsx').buffer(true).parse(bin).expect(200);
      expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      const p = await get(dSec, `/inventory/reports/department-inventory?departmentId=${dept.id}&format=pdf`).buffer(true).parse(bin).expect(200);
      expect((p.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await get(dSec, '/inventory/reports/central-inventory').expect(403);
      await get(dSec, `/inventory/reports/department-inventory?departmentId=${other.id}`).expect(403);
      const label = await get(treas, `/inventory/assets/${projector.id}/label`).buffer(true).parse(bin).expect(200);
      expect((label.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('22. the history and audit trail are complete', async () => {
      await post(oSec, `/inventory/assets/${paper.id}/incidents`, { incidentType: 'damaged', description: 'x' }).expect(403); // not theirs
      await post(dSec, `/inventory/assets/${paper.id}/incidents`, { incidentType: 'damaged', description: 'Water damage in the store' }).expect(201);
      const d =(await get(treas, `/inventory/assets/${projector.id}`).expect(200)).body;
      const events = d.history.map((h: any) => h.event_type);
      for (const e of ['created', 'assigned', 'request_approved', 'handed_over', 'returned', 'incident_reported', 'maintenance_reported', 'maintenance_approved', 'maintenance_started', 'maintenance_completed']) expect(events).toContain(e);
      expect(d.finance.repairs).toHaveLength(1);
      const audit = await prisma.auditLog.findMany({ where: { fellowship_id: f.id, action: { startsWith: 'resources.' } }, select: { action: true } });
      const actions = new Set(audit.map((a) => a.action));
      for (const a of ['resources.register', 'resources.assign', 'resources.ownership_transferred', 'resources.disposed', 'resources.written_off', 'resources.incident_reported']) expect(actions).toContain(a);
      const dash = (await get(treas, '/inventory/dashboard').expect(200)).body;
      expect(dash.cards.fellowshipOwned).toBeGreaterThan(0);
      expect(dash.departments.find((x: any) => x.id === dept.id).assigned).toBe(1);
      const ddash = (await get(dSec, `/inventory/dashboard?departmentId=${dept.id}`).expect(200)).body;
      expect(ddash.departments).toHaveLength(0);
    });
  });
});
