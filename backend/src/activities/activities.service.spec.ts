import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivitiesService, isActivityVisible } from './activities.service';

const fellowshipId = '20000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000001';
const departmentId = '30000000-0000-4000-8000-000000000001';
const secretary = { userId, fellowshipId, roles: ['secretary'], departmentId: null };
const ordinary = { userId: '10000000-0000-4000-8000-000000000002', fellowshipId, roles: ['ordinary_member'], departmentId: null };
const leader = { userId: '10000000-0000-4000-8000-000000000003', fellowshipId, roles: ['department_secretary'], departmentId };

function makeService(overrides: any = {}) {
  const prisma = {
    activity: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: '40000000-0000-4000-8000-000000000001', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    department: { findFirst: jest.fn().mockResolvedValue({ id: departmentId }) },
    fellowship: { findUnique: jest.fn().mockResolvedValue({ status: 'active' }) },
    attendance: { findFirst: jest.fn(), create: jest.fn() },
    ...overrides,
  };
  const tenantScope = {
    resolveFellowshipId: jest.fn().mockReturnValue(fellowshipId),
    assertInScope: jest.fn(),
    scopeWhere: jest.fn((_user, where) => where),
  };
  const service = new ActivitiesService(
    prisma as any,
    { log: jest.fn() } as any,
    { create: jest.fn() } as any,
    tenantScope as any,
  );
  return { service, prisma, tenantScope };
}

const baseActivity = {
  title: 'Service',
  date: new Date(),
  audience_type: 'all_members',
  fellowship_id: fellowshipId,
  department_id: null,
};

describe('activity visibility', () => {
  it('uses the same audience rules for direct detail access', () => {
    expect(isActivityVisible({ ...baseActivity, audience_type: 'specific_group' }, ordinary)).toBe(false);
    expect(isActivityVisible({ ...baseActivity, audience_type: 'leaders' }, leader)).toBe(true);
    expect(isActivityVisible({ ...baseActivity, audience_type: 'department', department_id: departmentId }, leader)).toBe(true);
    expect(isActivityVisible({ ...baseActivity, audience_type: 'department', department_id: 'other' }, leader)).toBe(false);
    expect(isActivityVisible({ ...baseActivity, audience_type: 'department', department_id: departmentId }, { ...leader, departmentId: null })).toBe(false);
  });
});

describe('activity input ownership', () => {
  it('creates only approved fields and derives tenancy from the authenticated account', async () => {
    const { service, prisma } = makeService();
    await service.create({
      title: '  Service  ',
      description: 'Details',
      date: new Date() as any,
      audienceType: 'all_members',
      fellowship_id: 'foreign',
      created_by: 'attacker',
    } as any, secretary);
    expect(prisma.activity.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      title: 'Service',
      fellowship_id: fellowshipId,
      created_by: userId,
    }) });
    const sent = prisma.activity.create.mock.calls[0][0].data;
    expect(sent.id).toBeUndefined();
    expect(sent.attendances).toBeUndefined();
  });

  it('rejects a department outside the authenticated tenant', async () => {
    const { service, prisma } = makeService();
    prisma.department.findFirst.mockResolvedValue(null);
    await expect(service.create({
      title: 'Choir',
      date: new Date() as any,
      audienceType: 'department',
      departmentId,
    }, secretary)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates dates and audience values', async () => {
    const { service } = makeService();
    await expect(service.create({ title: 'Bad', date: 'not-a-date' as any, audienceType: 'all_members' }, secretary)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ title: 'Bad', date: new Date() as any, audienceType: 'unknown' as any }, secretary)).rejects.toBeInstanceOf(BadRequestException);
    const start = new Date('2026-10-02T00:00:00Z');
    await expect(service.create({ title: 'Bad', date: start as any, endDate: new Date('2026-10-01T00:00:00Z') as any, audienceType: 'all_members' }, secretary)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects direct activity detail outside the audience', async () => {
    const { service, prisma } = makeService();
    prisma.activity.findUnique.mockResolvedValue({ id: 'activity', audience_type: 'specific_group', fellowship_id: fellowshipId });
    await expect(service.findOne('40000000-0000-4000-8000-000000000001', ordinary)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
