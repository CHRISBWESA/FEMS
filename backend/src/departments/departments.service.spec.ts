import { BadRequestException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

const user = { userId: '10000000-0000-4000-8000-000000000001', fellowshipId: '20000000-0000-4000-8000-000000000001', roles: ['secretary'] };

function makeService() {
  const prisma = {
    department: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    member: { findUnique: jest.fn() },
    departmentMember: { findFirst: jest.fn() },
  };
  const tenantScope = { resolveFellowshipId: jest.fn().mockReturnValue(user.fellowshipId), assertInScope: jest.fn() };
  const service = new DepartmentsService(
    prisma as any,
    { createWorkflow: jest.fn(), submit: jest.fn() } as any,
    { log: jest.fn() } as any,
    { create: jest.fn() } as any,
    tenantScope as any,
  );
  return { service, prisma, tenantScope };
}

describe('department input boundaries', () => {
  it('rejects null and non-object bodies as client errors', async () => {
    const { service, prisma } = makeService();
    await expect(service.create(null as any, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('30000000-0000-4000-8000-000000000001', null as any, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.requestRemoval('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', null as any, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.department.create).not.toHaveBeenCalled();
    expect(prisma.department.update).not.toHaveBeenCalled();
  });
});
