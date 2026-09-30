import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { YouthService } from './youth.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';

// No live database is reachable for this checkout (see plan doc / final report), so these are
// unit tests against a mocked PrismaService - real TenantScopeService logic is exercised as-is
// since it has no DB dependency of its own.

function makePrismaMock() {
  return {
    youthProfile: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    youthGuardian: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    ageGroup: {
      findMany: jest.fn(),
    },
    department: {
      findUnique: jest.fn(),
    },
    member: {
      findUnique: jest.fn(),
    },
    activity: {
      findUnique: jest.fn(),
    },
    attendance: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function makeAuditMock() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

function makeNotificationMock() {
  return { create: jest.fn(), createForUsers: jest.fn() };
}

const Y1 = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222222';
const A1 = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';
const FELLOWSHIP_A = 'fellowship-a';
const FELLOWSHIP_B = 'fellowship-b';

describe('YouthService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: YouthService;
  let tenantScope: TenantScopeService;

  beforeEach(() => {
    prisma = makePrismaMock();
    tenantScope = new TenantScopeService();
    service = new YouthService(prisma as any, makeAuditMock() as any, makeNotificationMock() as any, tenantScope);
  });

  describe('tenant isolation', () => {
    it('blocks a non-admin user from reading a participant in a different fellowship', async () => {
      const currentUser = { userId: 'u1', roles: ['secretary'], permissions: [], fellowshipId: FELLOWSHIP_A };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_B,
        department_id: null,
        date_of_birth: new Date('2015-01-01'),
      });

      await expect(service.findOne(Y1, currentUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows a user to read a participant in their own fellowship', async () => {
      const currentUser = { userId: 'u1', roles: ['secretary'], permissions: [], fellowshipId: FELLOWSHIP_A };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_A,
        department_id: null,
        full_name: 'Test Child',
        status: 'active',
        date_of_birth: new Date('2015-01-01'),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.findOne(Y1, currentUser);
      expect(result.id).toBe(Y1);
    });

    it('throws NotFoundException when the record does not exist', async () => {
      const currentUser = { userId: 'u1', roles: ['secretary'], permissions: [], fellowshipId: FELLOWSHIP_A };
      prisma.youthProfile.findUnique.mockResolvedValue(null);
      await expect(service.findOne(MISSING, currentUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('department scope', () => {
    it('blocks a department leader from reading a participant in another department', async () => {
      const currentUser = {
        userId: 'u2',
        roles: ['department_secretary'],
        permissions: [],
        fellowshipId: FELLOWSHIP_A,
        departmentId: 'dept-own',
      };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_A,
        department_id: 'dept-other',
        date_of_birth: new Date('2015-01-01'),
      });

      await expect(service.findOne(Y1, currentUser)).rejects.toThrow(ForbiddenException);
    });

    it('allows a department leader to read a participant in their own department', async () => {
      const currentUser = {
        userId: 'u2',
        roles: ['department_secretary'],
        permissions: [],
        fellowshipId: FELLOWSHIP_A,
        departmentId: 'dept-own',
      };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_A,
        department_id: 'dept-own',
        full_name: 'Test Child',
        status: 'active',
        date_of_birth: new Date('2015-01-01'),
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.findOne(Y1, currentUser);
      expect(result.id).toBe(Y1);
    });

    it('restricts findAll to the department leader\'s own department', async () => {
      const currentUser = {
        userId: 'u2',
        roles: ['department_secretary'],
        permissions: [],
        fellowshipId: FELLOWSHIP_A,
        departmentId: 'dept-own',
      };
      prisma.youthProfile.findMany.mockResolvedValue([]);

      await service.findAll(currentUser);

      expect(prisma.youthProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ department_id: 'dept-own', fellowship_id: FELLOWSHIP_A }),
        }),
      );
    });
  });

  describe('permission-based field stripping', () => {
    const baseProfile = {
      id: Y1,
      fellowship_id: FELLOWSHIP_A,
      department_id: null,
      full_name: 'Test Child',
      status: 'active',
      gender: 'female',
      date_of_birth: new Date('2015-01-01'),
      notes: 'sensitive safeguarding note',
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('hides date of birth, age and gender without youth.details_view', async () => {
      const currentUser = { userId: 'u1', roles: ['chairperson'], permissions: [], fellowshipId: FELLOWSHIP_A };
      prisma.youthProfile.findUnique.mockResolvedValue(baseProfile);

      const result = await service.findOne(Y1, currentUser);
      expect(result.dateOfBirth).toBeUndefined();
      expect(result.age).toBeUndefined();
      expect(result.gender).toBeUndefined();
    });

    it('exposes date of birth and age with youth.details_view', async () => {
      const currentUser = {
        userId: 'u1',
        roles: ['secretary'],
        permissions: [PERMISSIONS.YOUTH_DETAILS_VIEW],
        fellowshipId: FELLOWSHIP_A,
      };
      prisma.youthProfile.findUnique.mockResolvedValue(baseProfile);

      const result = await service.findOne(Y1, currentUser);
      expect(result.dateOfBirth).toBe(baseProfile.date_of_birth);
      expect(typeof result.age).toBe('number');
    });

    it('hides safeguarding notes without youth.safeguarding_view', async () => {
      const currentUser = {
        userId: 'u1',
        roles: ['secretary'],
        permissions: [PERMISSIONS.YOUTH_DETAILS_VIEW],
        fellowshipId: FELLOWSHIP_A,
      };
      prisma.youthProfile.findUnique.mockResolvedValue(baseProfile);

      const result = await service.findOne(Y1, currentUser);
      expect(result.notes).toBeUndefined();
    });

    it('exposes safeguarding notes with youth.safeguarding_view', async () => {
      const currentUser = {
        userId: 'u1',
        roles: ['secretary'],
        permissions: [PERMISSIONS.YOUTH_SAFEGUARDING_VIEW],
        fellowshipId: FELLOWSHIP_A,
      };
      prisma.youthProfile.findUnique.mockResolvedValue(baseProfile);

      const result = await service.findOne(Y1, currentUser);
      expect(result.notes).toBe(baseProfile.notes);
    });
  });

  describe('guardians', () => {
    it('rejects adding a guardian whose fellowship differs from the participant', async () => {
      const currentUser = {
        userId: 'u1',
        roles: ['secretary'],
        permissions: [PERMISSIONS.YOUTH_GUARDIANS_MANAGE],
        fellowshipId: FELLOWSHIP_A,
      };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_A,
        department_id: null,
        date_of_birth: new Date('2015-01-01'),
      });
      prisma.member.findUnique.mockResolvedValue({ id: M1, fellowship_id: FELLOWSHIP_B });

      await expect(
        service.addGuardian(Y1, { guardianMemberId: M1, relationshipType: 'parent' }, currentUser),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.youthGuardian.create).not.toHaveBeenCalled();
    });

    it('requires youth.guardians_manage to add a guardian', async () => {
      const currentUser = { userId: 'u1', roles: ['secretary'], permissions: [], fellowshipId: FELLOWSHIP_A };

      await expect(
        service.addGuardian(Y1, { guardianMemberId: M1, relationshipType: 'parent' }, currentUser),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.youthProfile.findUnique).not.toHaveBeenCalled();
    });

    it('adds a guardian in the same fellowship', async () => {
      const currentUser = {
        userId: 'u1',
        roles: ['secretary'],
        permissions: [PERMISSIONS.YOUTH_GUARDIANS_MANAGE],
        fellowshipId: FELLOWSHIP_A,
      };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_A,
        department_id: null,
        date_of_birth: new Date('2015-01-01'),
      });
      prisma.member.findUnique.mockResolvedValue({ id: M1, fellowship_id: FELLOWSHIP_A });
      prisma.youthGuardian.findUnique.mockResolvedValue(null);
      prisma.youthGuardian.create.mockResolvedValue({ id: 'g1' });

      const result = await service.addGuardian(Y1, { guardianMemberId: M1, relationshipType: 'parent' }, currentUser);

      expect(result.id).toBe('g1');
      expect(prisma.youthGuardian.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ youth_id: Y1, guardian_member_id: M1, fellowship_id: FELLOWSHIP_A }),
        }),
      );
    });
  });

  describe('attendance', () => {
    it('links attendance to youth_profile_id instead of member_id', async () => {
      const currentUser = {
        userId: 'u1',
        roles: ['secretary'],
        permissions: [PERMISSIONS.YOUTH_ATTENDANCE_MANAGE],
        fellowshipId: FELLOWSHIP_A,
      };
      prisma.youthProfile.findUnique.mockResolvedValue({
        id: Y1,
        fellowship_id: FELLOWSHIP_A,
        department_id: null,
        full_name: 'Test Child',
        date_of_birth: new Date('2015-01-01'),
      });
      prisma.activity.findUnique.mockResolvedValue({ id: A1, fellowship_id: FELLOWSHIP_A });
      prisma.attendance.create.mockResolvedValue({ id: 'att1' });

      await service.recordAttendance(Y1, { activityId: A1 }, currentUser);

      expect(prisma.attendance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ youth_profile_id: Y1, activity_id: A1 }),
        }),
      );
      const callArgs = prisma.attendance.create.mock.calls[0][0];
      expect(callArgs.data.member_id).toBeUndefined();
    });

    it('requires youth.attendance_manage to record attendance', async () => {
      const currentUser = { userId: 'u1', roles: ['secretary'], permissions: [], fellowshipId: FELLOWSHIP_A };

      await expect(service.recordAttendance(Y1, { activityId: A1 }, currentUser)).rejects.toThrow(ForbiddenException);
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });
  });
});
