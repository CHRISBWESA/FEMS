import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController, DiagnosticsService } from './health.controller';

function controller(database: 'ok' | 'error') {
  const prisma = {
    $queryRaw: database === 'ok'
      ? jest.fn().mockResolvedValue([{ '?column?': 1 }])
      : jest.fn().mockRejectedValue(new Error('database unavailable')),
  };
  return new HealthController(prisma as any, new DiagnosticsService(prisma as any));
}

describe('health probes', () => {
  it('reports process liveness without touching the database', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const probe = new HealthController(prisma as any, new DiagnosticsService(prisma as any));
    expect(probe.live()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports database readiness without exposing the error', async () => {
    await expect(controller('ok').ready()).resolves.toEqual({ status: 'ok', database: 'ok' });
    await expect(controller('ok').check()).resolves.toEqual({ status: 'ok', database: 'ok' });
    await expect(controller('error').ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller('error').check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
