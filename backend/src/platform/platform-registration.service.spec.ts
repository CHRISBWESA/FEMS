import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FellowshipRegistrationService } from './platform-registration.service';

const PERMS = ['platform.tenants_view', 'platform.tenants_manage', 'platform.onboard'];
const admin = { userId: 'admin-1', permissions: PERMS, roles: ['admin'] };

function makeService(overrides: any = {}) {
  const rows: any[] = [];
  const prisma: any = {
    fellowshipRegistration: {
      create: jest.fn(async ({ data }: any) => { const row = { id: 'reg-1', ...data }; rows.push(row); return row; }),
      findFirst: jest.fn(async () => overrides.existingPending ?? null),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? overrides.unique ?? null),
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
      groupBy: jest.fn(async () => []),
      // The claim (updateMany) flips pending -> approved; once claimed, findUnique must return the row.
      updateMany: jest.fn(async ({ where }: any) => {
        if (where.status === 'pending' && (overrides.flipCount ?? 1) === 0) return { count: 0 };
        if (overrides.claimThenFind !== false) { const r = rows.find((x) => x.id === where.id); if (r) r.status = 'approved'; }
        return { count: overrides.flipCount ?? 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id) ?? (overrides.unique ?? { id: where.id });
        Object.assign(r, data);
        return r;
      }),
    },
    saasPlan: { findMany: jest.fn(async () => overrides.plans ?? []) },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const onboarding = { onboard: jest.fn(async () => overrides.onboard ?? { fellowship: { id: 'fel-1', name: 'New Fellowship', status: 'active' }, administrator: { id: 'u1', email: 'a@b.c', temporaryPassword: 'tmp-secret' }, note: 'shown once' }) };
  const subscriptions = { assign: jest.fn(async () => ({ subscription: { id: 's1' } })) };
  const svc = new FellowshipRegistrationService(prisma as any, audit as any, onboarding as any, subscriptions as any);
  return { svc, prisma, audit, onboarding, subscriptions, rows };
}

const good = {
  fellowshipName: 'Grace Fellowship Church',
  contactFirstName: 'Grace',
  contactLastName: 'Mwangi',
  email: 'Grace@Example.ORG',
};

describe('public signup submission', () => {
  it('stores a request and does not create any account', async () => {
    const { svc, prisma, audit } = makeService();
    const out = await svc.submit({ ...good });
    expect(out.received).toBe(true);
    expect(prisma.fellowshipRegistration.create).toHaveBeenCalledTimes(1);
    // The e-mail is normalised, and nothing but the request row is written.
    expect(prisma.fellowshipRegistration.create.mock.calls[0][0].data.email).toBe('grace@example.org');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.registration_submit', userId: null }));
  });

  it('never reveals that an address is already pending', async () => {
    const first = await makeService().svc.submit({ ...good });
    const again = await makeService({ existingPending: { id: 'reg-1' } });
    const second = await again.svc.submit({ ...good });
    expect(second).toEqual(first);
    expect(again.prisma.fellowshipRegistration.create).not.toHaveBeenCalled();
  });

  it('rejects incomplete or invalid input', async () => {
    const { svc } = makeService();
    await expect(svc.submit({ ...good, fellowshipName: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.submit({ ...good, fellowshipName: 'x' })).rejects.toThrow(/at least 2 characters/);
    await expect(svc.submit({ ...good, email: 'not-an-email' })).rejects.toThrow(/valid e-mail/);
    await expect(svc.submit({ ...good, contactFirstName: '' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.submit({ ...good, contactLastName: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps an unknown plan code rather than failing the request', async () => {
    const { svc, prisma } = makeService();
    await svc.submit({ ...good, requestedPlanCode: 'retired-plan' });
    expect(prisma.fellowshipRegistration.create.mock.calls[0][0].data.requested_plan_code).toBe('retired-plan');
  });

  it('offers only active plans on the public endpoint', async () => {
    const { svc } = makeService({ plans: [{ id: 'p1', code: 'standard', name: 'Standard', description: null, trial_days: 14 }] });
    await expect(svc.publicPlans()).resolves.toEqual([{ code: 'standard', name: 'Standard', description: null, trialDays: 14 }]);
  });
});

describe('reviewing requests', () => {
  it('requires the platform permission to list', async () => {
    const { svc } = makeService();
    await expect(svc.list({ userId: 'x', permissions: [] })).rejects.toThrow(/permission/);
  });

  it('rejects an unknown filter status', async () => {
    const { svc } = makeService();
    await expect(svc.list(admin, { status: 'nonsense' })).rejects.toThrow(/pending, approved or rejected/);
  });

  it('404s on a request that does not exist', async () => {
    const { svc } = makeService();
    await expect(svc.approve(admin, '11111111-1111-1111-1111-111111111111', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an id that is not a uuid', async () => {
    const { svc } = makeService();
    await expect(svc.reject(admin, 'nope', { note: 'because reasons' })).rejects.toThrow(/must be a valid id/);
  });
});

describe('approving a request', () => {
  const id = '22222222-2222-2222-2222-222222222222';
  const pending = {
    id, fellowship_name: 'Grace Fellowship Church', location: 'Nairobi', description: null,
    contact_first_name: 'Grace', contact_last_name: 'Mwangi', email: 'grace@example.org',
    phone: null, requested_plan_code: 'standard', reason: null, status: 'pending',
  };

  it('runs onboarding, links the fellowship and returns the one-time password', async () => {
    const { svc, prisma, onboarding } = makeService({ unique: pending, upsert: true });
    const out = await svc.approve(admin, id, { note: 'verified by phone' });
    expect(onboarding.onboard).toHaveBeenCalledWith(admin, expect.objectContaining({
      name: 'Grace Fellowship Church',
      administrator: expect.objectContaining({ email: 'grace@example.org', firstName: 'Grace' }),
    }));
    expect(out.administrator.temporaryPassword).toBe('tmp-secret');
    expect(out.registration.status).toBe('approved');
    // The claim happens first, then the link is written once onboarding has produced a fellowship.
    expect(prisma.fellowshipRegistration.updateMany.mock.calls[0][0]).toMatchObject({ where: { id, status: 'pending' } });
    expect(prisma.fellowshipRegistration.update).toHaveBeenCalledWith({
      where: { id },
      data: expect.objectContaining({ created_fellowship_id: 'fel-1' }),
    });
  });

  it('claims the request before onboarding, so two approvals cannot both create a fellowship', async () => {
    const { svc, onboarding, prisma } = makeService({ unique: pending, upsert: true });
    await svc.approve(admin, id, {});
    const claimedBeforeOnboarding = prisma.fellowshipRegistration.updateMany.mock.invocationCallOrder[0];
    expect(claimedBeforeOnboarding).toBeLessThan(onboarding.onboard.mock.invocationCallOrder[0]);
  });

  it('releases the claim and re-queues the request when onboarding fails', async () => {
    const { svc, onboarding, prisma } = makeService({ unique: pending, upsert: true });
    onboarding.onboard.mockRejectedValueOnce(new ConflictException('A fellowship with this name already exists.'));
    await expect(svc.approve(admin, id, {})).rejects.toBeInstanceOf(ConflictException);
    // Put back to pending so it is not stranded as "approved" with no fellowship behind it.
    expect(prisma.fellowshipRegistration.updateMany).toHaveBeenLastCalledWith({
      where: { id, created_fellowship_id: null },
      data: { status: 'pending', reviewed_by: null, reviewed_at: null, decision_note: null },
    });
  });

  it('assigns the requested plan when one is chosen', async () => {
    const { svc, subscriptions } = makeService({ unique: pending, upsert: true, plans: [{ id: 'p1', code: 'standard', name: 'Standard', description: null, trial_days: 14 }] });
    const out = await svc.approve(admin, id, { planCode: 'standard', startTrial: true });
    expect(subscriptions.assign).toHaveBeenCalledWith(admin, 'fel-1', { planId: 'p1', startTrial: true });
    expect(out.subscription).toEqual({ subscription: { id: 's1' } });
  });

  it('reports when the fellowship is created but the plan could not be attached', async () => {
    const { svc, subscriptions } = makeService({ unique: pending, upsert: true, plans: [{ id: 'p1', code: 'standard', name: 'Standard', description: null, trial_days: 0 }] });
    subscriptions.assign.mockRejectedValueOnce(new Error('plan is no longer offered'));
    const out = await svc.approve(admin, id, { planCode: 'standard' });
    expect(out.fellowship.id).toBe('fel-1');
    expect(out.subscriptionNote).toMatch(/plan could not be assigned/);
  });

  it('flags an unanswered plan request instead of silently ignoring it', async () => {
    const { svc, subscriptions } = makeService({ unique: pending, upsert: true });
    const out = await svc.approve(admin, id, {});
    expect(subscriptions.assign).not.toHaveBeenCalled();
    expect(out.subscriptionNote).toMatch(/asked about "standard"/);
  });

  it('rejects a plan code that does not exist', async () => {
    const { svc } = makeService({ unique: pending, upsert: true, plans: [] });
    await expect(svc.approve(admin, id, { planCode: 'ghost' })).rejects.toThrow(/existing plan/);
  });

  it('will not let two administrators approve the same request', async () => {
    const { svc, onboarding } = makeService({ unique: pending, flipCount: 0 });
    await expect(svc.approve(admin, id, {})).rejects.toBeInstanceOf(ConflictException);
    // Refused before anything was created.
    expect(onboarding.onboard).not.toHaveBeenCalled();
  });
});

describe('rejecting a request', () => {
  const id = '33333333-3333-3333-3333-333333333333';

  it('requires a reason', async () => {
    const { svc } = makeService();
    await expect(svc.reject(admin, id, { note: 'no' })).rejects.toThrow(/at least 5 characters/);
    await expect(svc.reject(admin, id, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records the reason and flips the status', async () => {
    const { svc, prisma } = makeService();
    const out = await svc.reject(admin, id, { note: 'Not a registered fellowship.' });
    expect(out.status).toBe('rejected');
    expect(prisma.fellowshipRegistration.updateMany).toHaveBeenCalledWith({
      where: { id, status: 'pending' },
      data: expect.objectContaining({ status: 'rejected', decision_note: 'Not a registered fellowship.' }),
    });
  });

  it('needs tenants_manage, not onboard', async () => {
    const { svc } = makeService();
    await expect(svc.reject({ userId: 'x', permissions: ['platform.onboard'] }, id, { note: 'a valid reason' }))
      .rejects.toThrow(/permission/);
  });

  it('will not reject an already decided request', async () => {
    const { svc } = makeService({ flipCount: 0 });
    await expect(svc.reject(admin, id, { note: 'a valid reason' })).rejects.toBeInstanceOf(ConflictException);
  });
});
