import { ConflictException } from '@nestjs/common';
import { BackupsService } from './backups.service';

const admin = { userId: '10000000-0000-4000-8000-000000000001', roles: ['admin'] };

describe('backup service honesty', () => {
  it('never records a successful backup when no dump was taken', async () => {
    const prisma = { backup: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() } };
    const service = new BackupsService(prisma as any);
    await expect(service.createManual(admin)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.restore('backup', admin, { confirmSafetyBackup: true })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.backup.create).not.toHaveBeenCalled();
  });
});
