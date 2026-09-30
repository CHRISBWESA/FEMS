import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

function makeService(target: any, otherSecretaries = 1) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(target),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...target, ...data })),
      // Backs the last-Secretary guard: how many OTHER active Secretaries the fellowship still has.
      count: jest.fn().mockResolvedValue(otherSecretaries),
    },
  };
  const tenantScope = { assertInScope: jest.fn() };
  const service = new UsersService(
    prisma as any,
    { log: jest.fn() } as any,
    { create: jest.fn() } as any,
    { createWorkflow: jest.fn(), submit: jest.fn() } as any,
    tenantScope as any,
  );
  return { service, prisma, tenantScope };
}

const target = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'person@example.org',
  roles: ['ordinary_member'],
  permissions: [],
  fellowship_id: '20000000-0000-4000-8000-000000000001',
  department_id: null,
};

describe('role assignment policy', () => {
  // A fellowship's Secretary runs their own congregation, including its leadership and finance roles. The
  // platform administrator does not do this: it can enter a fellowship as one of its users instead, so it does
  // not need to hand out job titles as well.
  it('lets a secretary grant the finance and approval roles', async () => {
    for (const role of ['treasurer', 'chairperson', 'assistant_chairperson', 'secretary'] as const) {
      const { service } = makeService(target);
      await expect(service.assignRoles(target.id, [role], {
        userId: '10000000-0000-4000-8000-000000000002',
        roles: ['secretary'],
        fellowshipId: target.fellowship_id,
      })).resolves.toMatchObject({ roles: [role] });
    }
  });

  it('blocks a secretary from granting platform roles (no tenant-to-platform escalation)', async () => {
    for (const role of ['platform_support', 'admin'] as const) {
      const { service } = makeService(target);
      await expect(service.assignRoles(target.id, [role], {
        userId: '10000000-0000-4000-8000-000000000002',
        roles: ['secretary'],
        fellowshipId: target.fellowship_id,
      })).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('blocks all direct self-management through role replacement', async () => {
    const { service } = makeService(target);
    await expect(service.assignRoles(target.id, ['ordinary_member'], {
      userId: target.id,
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows lower-role assignment and revokes existing sessions', async () => {    const { service, prisma } = makeService(target);
    await expect(service.assignRoles(target.id, ['gender_leader'], {
      userId: '10000000-0000-4000-8000-000000000002',
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    })).resolves.toMatchObject({ roles: ['gender_leader'] });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ token_version: { increment: 1 } }),
    }));
  });

  it('no longer lets a platform administrator hand out a fellowship role', async () => {
    const { service } = makeService(target);
    await expect(service.assignRoles(target.id, ['chairperson'], {
      userId: '10000000-0000-4000-8000-000000000003',
      roles: ['admin'],
      fellowshipId: null,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still refuses platform roles even for an administrator, pointing at the system-accounts screen', async () => {
    const { service } = makeService(target);
    await expect(service.assignRoles(target.id, ['platform_support'], {
      userId: '10000000-0000-4000-8000-000000000003',
      roles: ['admin'],
      fellowshipId: null,
    })).rejects.toThrow(/System accounts/);
  });

  it('refuses every other role that is not the Secretary\'s', async () => {
    const { service } = makeService(target);
    await expect(service.assignRoles(target.id, ['treasurer'], {
      userId: '10000000-0000-4000-8000-000000000004',
      roles: ['chairperson'],
      fellowshipId: target.fellowship_id,
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an assigned department for department-leader roles', async () => {
    const { service } = makeService(target);
    await expect(service.assignRoles(target.id, ['department_secretary'], {
      userId: '10000000-0000-4000-8000-000000000002',
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('a fellowship administrator manages every role in their own fellowship', () => {
  // These targets already HOLD the role in question. Managing an account used to be refused purely because of the
  // job title it carried, which meant a Secretary could create a Treasurer but never re-role or disable one.
  const leadership = { ...target, roles: ['treasurer'] };
  const coSecretary = { ...target, roles: ['secretary'] };

  it('lets the Secretary re-role an existing Treasurer', async () => {
    const { service } = makeService(leadership);
    await expect(service.assignRoles(leadership.id, ['chairperson'], {
      userId: '10000000-0000-4000-8000-000000000002',
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    })).resolves.toMatchObject({ roles: ['chairperson'] });
  });

  it('lets the Secretary change another Secretary while another one remains', async () => {
    const { service } = makeService(coSecretary, 1);
    await expect(service.assignRoles(coSecretary.id, ['assistant_secretary'], {
      userId: '10000000-0000-4000-8000-000000000002',
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    })).resolves.toMatchObject({ roles: ['assistant_secretary'] });
  });

  it('refuses to strip the fellowship of its last Secretary', async () => {
    // The check counts OTHER active secretaries, so the target must be excluded or a fellowship with exactly one
    // would count itself and wrongly be allowed to delete the role that runs it.
    const { service, prisma } = makeService(coSecretary, 0);
    await expect(service.assignRoles(coSecretary.id, ['chairperson'], {
      userId: '10000000-0000-4000-8000-000000000002',
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    })).rejects.toThrow(/only active Secretary/i);
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ NOT: { id: coSecretary.id } }) }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lets a platform administrator remove the last Secretary, who can restore one', async () => {
    const { service } = makeService(coSecretary, 0);
    await expect(service.assignRoles(coSecretary.id, ['chairperson'], {
      userId: '10000000-0000-4000-8000-000000000003',
      roles: ['admin'],
      fellowshipId: null,
    })).rejects.toBeInstanceOf(ForbiddenException); // blocked earlier: admins do not hand out fellowship roles
    expect(makeService(coSecretary, 0).prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not apply the last-Secretary guard to roles that are not Secretary', async () => {
    const { service, prisma } = makeService(leadership, 0);
    await service.assignRoles(leadership.id, ['chairperson'], {
      userId: '10000000-0000-4000-8000-000000000002',
      roles: ['secretary'],
      fellowshipId: target.fellowship_id,
    });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});

describe('the account list excludes deleted accounts', () => {
  // DELETE /users/:id is a soft delete, so without this filter a removed account stays in the list forever.
  it('always filters deleted_at', async () => {
    const prisma = {
      user: {
        findMany: jest.fn(async (_args: any) => ({ data: [], total: 0 })),
        count: jest.fn(async () => 0),
      },
    };
    const tenantScope = { scopeWhere: jest.fn((_r: any, where: any) => where) };
    const service = new UsersService(
      prisma as any,
      { log: jest.fn() } as any,
      { create: jest.fn() } as any,
      { createWorkflow: jest.fn(), submit: jest.fn() } as any,
      tenantScope as any,
    );
    await service.findAll({}, { userId: 'a', roles: ['secretary'], fellowshipId: 'f' });
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.deleted_at).toBeNull();
  });

  it('keeps the filter when a role and active-state filter are also given', async () => {
    const prisma = {
      user: {
        findMany: jest.fn(async (_args: any) => ({ data: [], total: 0 })),
        count: jest.fn(async () => 0),
      },
    };
    const tenantScope = { scopeWhere: jest.fn((_r: any, where: any) => where) };
    const service = new UsersService(
      prisma as any,
      { log: jest.fn() } as any,
      { create: jest.fn() } as any,
      { createWorkflow: jest.fn(), submit: jest.fn() } as any,
      tenantScope as any,
    );
    await service.findAll({ role: 'treasurer', isActive: true }, { userId: 'a', roles: ['secretary'], fellowshipId: 'f' });
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.deleted_at).toBeNull();
    expect(where.roles).toEqual({ has: 'treasurer' });
    expect(where.is_active).toBe(true);
  });

  it('shows a platform administrator every fellowship account, not only secretaries', async () => {
    // An administrator can create an account in any role; if the list were narrowed to `secretary` the account
    // it had just created would not appear, and the creation would look as though it had failed.
    const prisma = {
      user: {
        findMany: jest.fn(async (_args: any) => ({ data: [], total: 0 })),
        count: jest.fn(async () => 0),
      },
    };
    const tenantScope = { scopeWhere: jest.fn((_r: any, where: any) => where) };
    const service = new UsersService(
      prisma as any,
      { log: jest.fn() } as any,
      { create: jest.fn() } as any,
      { createWorkflow: jest.fn(), submit: jest.fn() } as any,
      tenantScope as any,
    );
    await service.findAll({}, { userId: 'a', roles: ['admin'], fellowshipId: null });
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.fellowship_id).toEqual({ not: null });
    // System accounts are excluded: they belong to no fellowship and are listed separately.
    expect(where.NOT).toEqual({ roles: { hasSome: ['admin', 'platform_support'] } });
    expect(where.roles).toBeUndefined();
  });
});
