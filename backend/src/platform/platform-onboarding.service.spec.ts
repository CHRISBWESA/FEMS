import { ConflictException } from '@nestjs/common';
import { PlatformOnboardingService, FELLOWSHIP_LEADERSHIP_ROLES } from './platform-onboarding.service';

// Onboarding hashes six accounts at bcrypt cost 12, which is roughly 300ms each and would push a single test past
// Jest's five-second timeout. Producing a real hash is bcrypt's contract, not this service's, so it is stubbed
// here - while still emitting the same `$2b$12$...` shape the "never stored in clear" assertion checks for.
jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `$2b$12$${'k'.repeat(47)}${Buffer.from(value).toString('hex').slice(0, 5)}`),
}));

const ACTOR = { userId: '10000000-0000-4000-8000-0000000000aa', permissions: ['platform.onboard'] };

/**
 * A stand-in for Prisma that records the accounts created inside the transaction. `user.create` is keyed on email
 * so the uniqueness guard the service relies on behaves the way the database's `@unique` would.
 */
function makeService(options: { takenSubdomains?: string[]; takenEmails?: string[] } = {}) {
  const takenSubdomains = new Set(options.takenSubdomains ?? []);
  const takenEmails = new Set(options.takenEmails ?? []);
  const createdUsers: any[] = [];
  let fellowshipSeq = 0;

  const tx = {
    fellowship: {
      create: jest.fn(async ({ data }: any) => ({ id: `f${++fellowshipSeq}`, ...data })),
    },
    fellowshipModuleSetting: { createMany: jest.fn(async () => ({ count: 0 })) },
    member: {
      create: jest.fn(async ({ data }: any) => ({ id: `m${createdUsers.length + 1}`, ...data })),
      update: jest.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => (takenEmails.has(where.email) ? { id: 'existing' } : null)),
      create: jest.fn(async ({ data }: any) => {
        takenEmails.add(data.email);
        const row = { id: `u${createdUsers.length + 1}`, ...data };
        createdUsers.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    fellowship: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async ({ where }: any) => (takenSubdomains.has(where.subdomain) ? { id: 'other' } : null)),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new PlatformOnboardingService(prisma as any, audit as any);
  return { service, prisma, tx, createdUsers, audit };
}

const ADMIN = { email: 'grace@gracefellowship.org', firstName: 'Grace', lastName: 'Mwangi' };

describe('a new fellowship gets ONE account: its system administrator', () => {
  it('creates exactly one user, and no placeholder offices', async () => {
    // This is the assertion that matters most. The old behaviour minted six accounts named after the offices, so
    // a fresh fellowship opened with a "Treasurer" who did not exist, holding a guessed e-mail address, and already
    // six of its user quota spent.
    const { service, createdUsers } = makeService();
    const out = await service.onboard(ACTOR, { name: 'Grace Fellowship', administrator: ADMIN });

    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0].email).toBe('grace@gracefellowship.org');
    expect(createdUsers[0].is_active).toBe(true);
    expect(createdUsers[0].must_change_password).toBe(true);
    expect(createdUsers[0].password_hash).toEqual(expect.stringMatching(/^\$2[aby]\$/)); // bcrypt, never clear text

    // No `accounts` array at all, so a caller cannot go looking for seats that should not exist.
    expect((out as any).accounts).toBeUndefined();
    expect((out as any).outstandingRoles).toBeUndefined();
  });

  it('offers every office as a role, and never as a hard-coded count of six', () => {
    // Rule 4: FEMS is configurable. The offices are a data list, so adding one is a data change, and nothing
    // anywhere claims a fellowship has exactly six.
    expect(FELLOWSHIP_LEADERSHIP_ROLES.length).toBeGreaterThan(0);
    expect(FELLOWSHIP_LEADERSHIP_ROLES.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(true);
    // Offices are not accounts: nothing in the list carries an e-mail address to pre-create.
    expect(JSON.stringify(FELLOWSHIP_LEADERSHIP_ROLES)).not.toMatch(/example\.com|@/);
  });

  it('makes that person the FELLOWSHIP ADMINISTRATOR, not a Secretary and never an "Owner"', async () => {
    const { service, createdUsers } = makeService();
    const out = await service.onboard(ACTOR, { name: 'Grace Fellowship', administrator: ADMIN });

    const roles = createdUsers[0].roles;
    expect(roles).toContain('fellowship_admin');
    // The key distinction: system administration is not a fellowship office, so no office is assumed.
    expect(roles).not.toContain('secretary');
    expect(roles).not.toContain('chairperson');
    expect(roles).not.toContain('treasurer');
    expect(roles.join(',')).not.toMatch(/owner/i);
    expect(out.administrator.email).toBe('grace@gracefellowship.org');
    expect(out.administrator.isPlaceholder).toBe(false);
  });

  it('always grants the system-administrator role, even if the requester asked for something else', async () => {
    // A fellowship with no one able to appoint its officers would be unrecoverable short of a platform operator.
    const { service, createdUsers } = makeService();
    await service.onboard(ACTOR, {
      name: 'Grace Fellowship',
      administrator: { ...ADMIN, roles: ['secretary'] },
    });
    const roles = createdUsers[0].roles;
    expect(roles).toContain('fellowship_admin');
    // The requested office is kept alongside it rather than replaced: the two compose.
    expect(roles).toContain('secretary');
  });

  it('returns the offices to fill, as a list of roles rather than as accounts', async () => {
    const { service } = makeService();
    const out = await service.onboard(ACTOR, { name: 'Grace Fellowship', administrator: ADMIN });

    expect(out.officesToFill.length).toBeGreaterThan(0);
    // A working fellowship cannot do without a Secretary or a Treasurer, so those two are marked.
    const required = out.officesToFill.filter((o) => o.required).map((o) => o.label);
    expect(required).toEqual(expect.arrayContaining(['Secretary', 'Treasurer']));
    // The others are offered, not demanded: a congregation may have no Assistant Chairperson at all.
    expect(out.officesToFill.filter((o) => !o.required).length).toBeGreaterThan(0);
  });

  it('does not create a user for any office, whatever roles the applicant already holds', async () => {
    const { service, createdUsers } = makeService();
    await service.onboard(ACTOR, {
      name: 'Grace Fellowship',
      administrator: { ...ADMIN, roles: ['secretary', 'treasurer', 'it_admin'] },
    });
    // One person, one account, whatever offices they say they hold.
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0].roles.sort()).toEqual(['fellowship_admin', 'it_admin', 'secretary', 'treasurer']);
  });

  it('stores the subdomain on the fellowship so the public host can resolve it', async () => {
    const { service, tx } = makeService();
    await service.onboard(ACTOR, { name: 'Bethel Worship Centre', administrator: ADMIN });
    expect(tx.fellowship.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subdomain: 'bethel-worship-centre' }) }),
    );
  });

  it('falls back to a suffix when the derived subdomain is taken', async () => {
    const { service } = makeService({ takenSubdomains: ['grace-fellowship'] });
    const out = await service.onboard(ACTOR, { name: 'Grace Fellowship', administrator: ADMIN });
    expect(out.fellowship.subdomain).toMatch(/^grace-fellowship-[a-z0-9]{4}$/);
  });

  it('refuses a duplicate fellowship name before creating anything', async () => {
    const { service, prisma } = makeService();
    prisma.fellowship.findFirst.mockResolvedValueOnce({ id: 'other' });
    await expect(service.onboard(ACTOR, { name: 'Grace Fellowship', administrator: ADMIN }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a platform role on the administrator', async () => {
    const { service } = makeService();
    await expect(service.onboard(ACTOR, { name: 'Grace Fellowship', administrator: { ...ADMIN, roles: ['admin'] } }))
      .rejects.toThrow(/tenant roles/i);
  });

  it('adds a single extra system administrator without minting any offices', async () => {
    // `addAdministrator` is the recovery path, so it must not silently create unappointed accounts.
    const { service, createdUsers } = makeService();
    const prisma = (service as any).prisma;
    prisma.fellowship.findUnique = jest.fn(async () => ({ id: 'f1' }));
    await service.addAdministrator(
      { userId: ACTOR.userId, permissions: ['platform.tenants_manage'] },
      '10000000-0000-4000-8000-0000000000bb',
      ADMIN,
    );
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0].roles).toEqual(['fellowship_admin']);
  });
});

describe('the fellowship administrator is a system role, not a fellowship office', () => {
  const { ROLE_DEFINITIONS, ROLES, GOVERNANCE_ROLES } =
    require('../shared/authorization/roles') as typeof import('../shared/authorization/roles');

  it('may appoint office holders, and the Secretary may not', () => {
    // The whole security model in two assertions: the ability to appoint a Treasurer is its own permission, and it
    // is held by the system administrator rather than by the Secretary.
    const admin = ROLE_DEFINITIONS.find((r) => r.name === ROLES.FELLOWSHIP_ADMIN)!;
    const secretary = ROLE_DEFINITIONS.find((r) => r.name === ROLES.SECRETARY)!;
    expect(admin.permissions).toContain('user.role_assign_governance');
    expect(secretary.permissions).not.toContain('user.role_assign_governance');
  });

  it('still lets the Secretary appoint ordinary members and department leaders', () => {
    const secretary = ROLE_DEFINITIONS.find((r) => r.name === ROLES.SECRETARY)!;
    expect(secretary.permissions).toContain('user.role_assign');
  });

  it('does not make the system administrator a finance or records office', () => {
    // The distinction the model asks for: configuring the account is not approving money or signing records.
    const admin = ROLE_DEFINITIONS.find((r) => r.name === ROLES.FELLOWSHIP_ADMIN)!;
    expect(admin.permissions).not.toContain('finance.view');
    expect(admin.permissions).not.toContain('finance.expense_approve');
    expect(admin.permissions).not.toContain('report.final_approve');
    expect(admin.permissions).not.toContain('member.register');
  });

  it('lists the five offices that need elevated authorisation', () => {
    expect(Array.from(GOVERNANCE_ROLES).sort()).toEqual(
      ['assistant_chairperson', 'assistant_secretary', 'chairperson', 'secretary', 'treasurer'],
    );
  });

  it('never names an "owner" role anywhere in the table', () => {
    expect(ROLE_DEFINITIONS.map((r) => r.name).join(',')).not.toMatch(/owner/i);
  });
});

describe('the IT administrator is a content manager, not an administrator', () => {
  it('holds only the three content permissions', () => {
    // Importing the real role table here (rather than re-listing the strings) is the point: this test fails the
    // moment somebody re-adds a member, finance or user permission to the role.
    const { ROLE_DEFINITIONS, ROLES } = require('../shared/authorization/roles') as typeof import('../shared/authorization/roles');
    const itAdmin = ROLE_DEFINITIONS.find((r) => r.name === ROLES.IT_ADMIN);
    expect(itAdmin!.permissions.sort()).toEqual([
      'it.content_delete_approve', 'it.content_edit', 'it.content_publish_approve',
    ]);
  });

  it('no longer inherits the Secretary\'s operational permissions', () => {
    const { ROLE_DEFINITIONS, ROLES } = require('../shared/authorization/roles') as typeof import('../shared/authorization/roles');
    const itAdmin = ROLE_DEFINITIONS.find((r) => r.name === ROLES.IT_ADMIN)!;
    const secretary = ROLE_DEFINITIONS.find((r) => r.name === ROLES.SECRETARY)!;
    // If these ever meet again, the two roles have silently merged back into one.
    expect(itAdmin.permissions.filter((p) => secretary.permissions.includes(p))).toEqual([]);
  });
});
