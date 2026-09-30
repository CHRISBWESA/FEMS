import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ItContentService } from './it-content.service';

const fellowshipId = '20000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000001';
const chairId = '10000000-0000-4000-8000-000000000002';
const departmentId = '30000000-0000-4000-8000-000000000001';

function makeService() {
  const prisma = {
    announcement: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'announcement', ...data })),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    department: { findFirst: jest.fn().mockResolvedValue({ id: departmentId }) },
  };
  const tenantScope = {
    scopeWhere: jest.fn().mockReturnValue({ fellowship_id: fellowshipId }),
    assertInScope: jest.fn(),
  };
  const service = new ItContentService(
    prisma as any,
    { createWorkflow: jest.fn(), submit: jest.fn(), getWorkflowForUser: jest.fn(), decide: jest.fn() } as any,
    { log: jest.fn() } as any,
    { create: jest.fn() } as any,
    tenantScope as any,
  );
  return { service, prisma, tenantScope };
}

describe('announcement tenant and approval controls', () => {
  it('derives tenant and creator from the authenticated secretary', async () => {
    const { service, prisma } = makeService();
    await service.createAnnouncement({
      title: 'Notice',
      content: 'Details',
      audienceType: 'all_members',
      fellowship_id: 'foreign',
      created_by: 'attacker',
      status: 'FINAL_APPROVED',
    } as any, { userId, fellowshipId, roles: ['secretary'] });
    expect(prisma.announcement.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      fellowship_id: fellowshipId,
      created_by: userId,
      status: 'DRAFT',
    }) });
  });

  it('rejects a foreign or unnecessary department reference', async () => {
    const { service, prisma } = makeService();
    prisma.department.findFirst.mockResolvedValue(null);
    await expect(service.createAnnouncement({
      title: 'Notice',
      content: 'Details',
      audienceType: 'department',
      departmentId,
    }, { userId, fellowshipId, roles: ['secretary'] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createAnnouncement({
      title: 'Notice',
      content: 'Details',
      audienceType: 'all_members',
      departmentId,
    }, { userId, fellowshipId, roles: ['secretary'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses document deletion requests instead of creating an approval that cannot delete anything', async () => {
    const { service } = makeService();
    await expect(service.requestDelete('60000000-0000-4000-8000-000000000001', { userId, fellowshipId, roles: ['secretary'] })).rejects.toMatchObject({ status: 409 });
  });

  it('allows only a different chair to publish a pending same-tenant announcement', async () => {
    const { service, prisma, tenantScope } = makeService();
    const pending = {
      id: '50000000-0000-4000-8000-000000000001',
      fellowship_id: fellowshipId,
      created_by: userId,
      status: 'DRAFT',
    };
    prisma.announcement.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: 'FINAL_APPROVED' });
    await expect(service.approveAnnouncement(
      '50000000-0000-4000-8000-000000000001',
      'approved',
      '',
      { userId, fellowshipId, roles: ['secretary', 'chairperson'] },
    )).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approveAnnouncement(
      '50000000-0000-4000-8000-000000000001',
      'approved',
      '',
      { userId: chairId, fellowshipId, roles: ['chairperson'] },
    )).resolves.toMatchObject({ status: 'FINAL_APPROVED' });
    expect(tenantScope.assertInScope).toHaveBeenCalled();
  });
});
