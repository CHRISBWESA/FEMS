import { BadRequestException } from '@nestjs/common';
import { YouthAgeGroupsService, computeAge } from './youth-age-groups.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';

function makePrismaMock() {
  return {
    ageGroup: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    youthProfile: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
}

function makeAuditMock() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

const FELLOWSHIP_A = 'fellowship-a';

describe('YouthAgeGroupsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: YouthAgeGroupsService;
  const currentUser = { userId: 'u1', roles: ['secretary'], permissions: [], fellowshipId: FELLOWSHIP_A };

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new YouthAgeGroupsService(prisma as any, makeAuditMock() as any, new TenantScopeService());
  });

  it('rejects a range where min_age > max_age', async () => {
    await expect(
      service.create({ name: 'Bad Range', minAge: 10, maxAge: 5 }, currentUser),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.ageGroup.create).not.toHaveBeenCalled();
  });

  it('rejects a range that overlaps an existing active age group in the same fellowship', async () => {
    prisma.ageGroup.findMany.mockResolvedValue([
      { id: 'ag1', fellowship_id: FELLOWSHIP_A, min_age: 6, max_age: 12, is_active: true },
    ]);

    await expect(
      service.create({ name: 'Overlapping', minAge: 10, maxAge: 15 }, currentUser),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.ageGroup.create).not.toHaveBeenCalled();
  });

  it('allows a non-overlapping range', async () => {
    prisma.ageGroup.findMany.mockResolvedValue([
      { id: 'ag1', fellowship_id: FELLOWSHIP_A, min_age: 6, max_age: 12, is_active: true },
    ]);
    prisma.ageGroup.create.mockResolvedValue({ id: 'ag2', name: 'Teens', min_age: 13, max_age: 17 });

    const result = await service.create({ name: 'Teens', minAge: 13, maxAge: 17 }, currentUser);
    expect(result.id).toBe('ag2');
    expect(prisma.ageGroup.create).toHaveBeenCalled();
  });

  it('recalculate updates only participants whose resolved age group changed', async () => {
    prisma.ageGroup.findMany.mockResolvedValue([
      { id: 'ag-children', fellowship_id: FELLOWSHIP_A, min_age: 0, max_age: 9, is_active: true },
      { id: 'ag-teens', fellowship_id: FELLOWSHIP_A, min_age: 10, max_age: 17, is_active: true },
    ]);
    const eightYearOld = new Date();
    eightYearOld.setFullYear(eightYearOld.getFullYear() - 8);
    const fourteenYearOld = new Date();
    fourteenYearOld.setFullYear(fourteenYearOld.getFullYear() - 14);

    prisma.youthProfile.findMany.mockResolvedValue([
      { id: 'y1', date_of_birth: eightYearOld, age_group_id: 'ag-teens' }, // stale, should move to ag-children
      { id: 'y2', date_of_birth: fourteenYearOld, age_group_id: 'ag-teens' }, // already correct
    ]);

    const result = await service.recalculate(currentUser);

    expect(result.updated).toBe(1);
    expect(prisma.youthProfile.update).toHaveBeenCalledWith({
      where: { id: 'y1' },
      data: { age_group_id: 'ag-children' },
    });
    expect(prisma.youthProfile.update).toHaveBeenCalledTimes(1);
  });
});

describe('computeAge', () => {
  it('computes age correctly before and after the birthday has passed this year', () => {
    const today = new Date();
    const tenYearsAgoSameDay = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
    expect(computeAge(tenYearsAgoSameDay)).toBe(10);

    const notYetBirthdayThisYear = new Date(today.getFullYear() - 10, today.getMonth() + 1, today.getDate());
    expect(computeAge(notYetBirthdayThisYear)).toBe(9);
  });
});
