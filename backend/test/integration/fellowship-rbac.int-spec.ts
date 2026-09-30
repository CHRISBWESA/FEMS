import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, makeUser, uniq } from './harness';

/**
 * Onboarding and role assignment, under the model the fellowship asked for.
 *
 *   Fellowship Administrator = system/account administration
 *   Chairperson / Secretary / Treasurer = organizational leadership
 *
 * The three rules these tests exist to hold in place:
 *
 *   1. Onboarding creates ONE account. Not six seats named after the offices.
 *   2. A Secretary may NOT appoint a Treasurer, Secretary or Chairperson.
 *   3. Holding a role never implies the power to appoint that role, and the check is on the server.
 *
 * Every assertion is on the DATABASE or the HTTP status, never on the frontend: a browser check would prove nothing
 * about whether a person can POST the request themselves.
 */
describeDb('Fellowship accounts - one administrator, and appointing officers is a separate power', () => {
  let app: NestExpressApplication;
  let prisma: ReturnType<typeof getPrisma>;

  let f: any;
  let platformAdmin: any;
  let fellowshipAdmin: any, secretary: any, treasurer: any, member: any;

  // Accepting an invitation is throttled at 5/minute, which is the right limit in production and the wrong one
  // here: this suite accepts several invitations and would throttle itself. Each test therefore presents as its own
  // client address, so what is measured is the authorization rule rather than the rate limiter.
  let ipCounter = 0;
  const nextIp = () => `198.18.${Math.floor((ipCounter += 1) / 250) % 250}.${(ipCounter % 250) + 1}`;
  const asPublic = () => api(app, undefined, nextIp());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    f = await makeFellowship(prisma, 'RBAC');
    platformAdmin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    fellowshipAdmin = await makeUser(prisma, { fellowshipId: f.id, roles: ['fellowship_admin'] });
    secretary = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
    treasurer = await makeUser(prisma, { fellowshipId: f.id, roles: ['treasurer'] });
    member = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A target account to re-role, with a linked member record as every user requires. */
  const makeTarget = async (roles: string[] = ['ordinary_member']) => {
    const u = await makeUser(prisma, { fellowshipId: f.id, roles });
    return u;
  };

  describe('onboarding creates exactly one account', () => {
    it('creates only the fellowship administrator, and no offices', async () => {
      const before = await prisma.user.count({ where: { fellowship_id: { not: null } } });
      const res = await api(app, platformAdmin.token).post('/platform/onboarding', {
        name: `New Church ${uniq()}`,
        administrator: {
          email: `founder-${uniq()}@test.local`,
          firstName: 'Ada',
          lastName: 'Founder',
        },
      });
      expect(res.status).toBe(201);

      // ONE new user. The old behaviour created six, three of which were named after offices nobody held.
      const after = await prisma.user.count({ where: { fellowship_id: { not: null } } });
      expect(after - before).toBe(1);

      // And that one is the system administrator, not a Secretary.
      const created = await prisma.user.findUnique({
        where: { id: res.body.administrator.id },
        select: { roles: true, email: true },
      });
      expect(created!.roles).toContain('fellowship_admin');
      expect(created!.roles).not.toContain('secretary');
      expect(created!.roles.join(',')).not.toMatch(/owner/i);
    });

    it('creates no account named after a fellowship office', async () => {
      // The specific harm: a new fellowship opened with a "Treasurer" who did not exist.
      const res = await api(app, platformAdmin.token).post('/platform/onboarding', {
        name: `Second Church ${uniq()}`,
        administrator: { email: `f2-${uniq()}@test.local`, firstName: 'Bo', lastName: 'Second' },
      });
      expect(res.status).toBe(201);

      const newId = res.body.fellowship.id;
      const users = await prisma.user.findMany({
        where: { fellowship_id: newId },
        select: { first_name: true, last_name: true, roles: true },
      });
      expect(users).toHaveLength(1);
      for (const u of users) {
        const name = `${u.first_name} ${u.last_name}`.trim();
        for (const office of ['Secretary', 'Treasurer', 'Chairperson', 'IT Administrator', 'Assistant']) {
          expect(name).not.toBe(office);
        }
      }
    });

    it('tells the caller which offices to fill, without creating them', async () => {
      const res = await api(app, platformAdmin.token).post('/platform/onboarding', {
        name: `Third Church ${uniq()}`,
        administrator: { email: `f3-${uniq()}@test.local`, firstName: 'Cy', lastName: 'Third' },
      });
      expect(res.status).toBe(201);
      expect(res.body.officesToFill.length).toBeGreaterThan(0);
      expect((res.body as any).accounts).toBeUndefined();
    });
  });

  describe('a Secretary may not appoint the fellowship\'s officers', () => {
    it('is refused a Treasurer, and the database is unchanged', async () => {
      const target = await makeTarget();
      const res = await api(app, secretary.token).put(`/users/${target.id}/roles`, { roles: ['treasurer'] });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/fellowship administrator/i);

      // The status is not the whole assertion: a 403 that still wrote would pass the check above.
      const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
      expect(after!.roles).toEqual(['ordinary_member']);
    });

    it('is refused a Secretary and a Chairperson too', async () => {
      for (const role of ['secretary', 'chairperson', 'assistant_secretary', 'assistant_chairperson']) {
        const target = await makeTarget();
        const res = await api(app, secretary.token).put(`/users/${target.id}/roles`, { roles: [role] });
        expect([403]).toContain(res.status);
        const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
        expect(after!.roles).toEqual(['ordinary_member']);
      }
    });

    it('is refused a mixed list that contains one officer role', async () => {
      // Granting the ordinary half of a mixed request would be a way around the rule.
      const target = await makeTarget();
      const res = await api(app, secretary.token).put(`/users/${target.id}/roles`, {
        roles: ['ordinary_member', 'treasurer'],
      });
      expect([403]).toContain(res.status);
      const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
      expect(after!.roles).toEqual(['ordinary_member']);
    });

    it('is refused creating a NEW account that already holds an officer role', async () => {
      // The create route has the same rule; otherwise the prohibition would be a speed bump.
      const m = await prisma.member.create({
        data: {
          member_code: `T${uniq()}`,
          full_name: 'New Treasurer',
          fellowship_id: f.id,
          created_by: fellowshipAdmin.id,
          expected_graduation_year: 2035,
          expected_graduation_month: 6,
        },
      });
      const res = await api(app, secretary.token).post('/users', {
        email: `newtreasurer-${uniq()}@test.local`,
        password: 'Sturdy-Passphrase-42',
        firstName: 'New',
        lastName: 'Treasurer',
        memberId: m.id,
        roles: ['treasurer'],
      });
      expect([403]).toContain(res.status);
      expect(await prisma.user.count({ where: { email: { contains: 'newtreasurer-' } } })).toBe(0);
    });

    it('may still appoint ordinary members and department leaders', async () => {
      const target = await makeTarget();
      const res = await api(app, secretary.token).put(`/users/${target.id}/roles`, { roles: ['ordinary_member', 'gender_leader'] });
      expect(res.status).toBe(200);
      const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
      expect(after!.roles.sort()).toEqual(['gender_leader', 'ordinary_member']);
    });
  });

  describe('holding a role does not grant the power to appoint it', () => {
    it('a Treasurer cannot appoint a Treasurer, despite approving money', async () => {
      // The rule in one test: approving expenses and appointing officers are different powers.
      const target = await makeTarget();
      const res = await api(app, treasurer.token).put(`/users/${target.id}/roles`, { roles: ['treasurer'] });
      expect([403]).toContain(res.status);
      const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
      expect(after!.roles).toEqual(['ordinary_member']);
    });

    it('a Treasurer cannot appoint a Secretary, and cannot appoint an ordinary member either', async () => {
      // A Treasurer holds no `user.role_assign` at all, so even the ordinary grant is closed to them.
      for (const role of ['secretary', 'ordinary_member']) {
        const target = await makeTarget();
        const res = await api(app, treasurer.token).put(`/users/${target.id}/roles`, { roles: [role] });
        expect([403]).toContain(res.status);
      }
    });

    it('an ordinary member cannot appoint anybody', async () => {
      const target = await makeTarget();
      for (const role of ['ordinary_member', 'treasurer']) {
        const res = await api(app, member.token).put(`/users/${target.id}/roles`, { roles: [role] });
        expect([403]).toContain(res.status);
      }
    });

    it('the fellowship administrator CAN appoint every office', async () => {
      for (const role of ['treasurer', 'secretary', 'chairperson', 'assistant_chairperson', 'assistant_secretary']) {
        const target = await makeTarget();
        const res = await api(app, fellowshipAdmin.token).put(`/users/${target.id}/roles`, { roles: [role] });
        expect(res.status).toBe(200);
        const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
        expect(after!.roles).toEqual([role]);
      }
    });

    it('a platform administrator may manage a tenant, because that is an explicit permission of its own', async () => {
      // `PLATFORM_TENANTS_MANAGE` exists so the platform can fix a tenant's accounts. Rule 5 is about a TENANT role
      // not implying the power to appoint it - not about locking the platform out of the tenants it administers.
      const target = await makeTarget();
      const res = await api(app, platformAdmin.token).put(`/users/${target.id}/roles`, { roles: ['treasurer'] });
      expect(res.status).toBe(200);
      const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
      expect(after!.roles).toEqual(['treasurer']);
    });

    it('but a platform administrator still cannot hand out a platform role through this route', async () => {
      // True of everybody here, including the platform: platform accounts are administered separately.
      const target = await makeTarget();
      for (const role of ['admin', 'platform_support']) {
        const res = await api(app, platformAdmin.token).put(`/users/${target.id}/roles`, { roles: [role] });
        expect([403]).toContain(res.status);
      }
      const after = await prisma.user.findUnique({ where: { id: target.id }, select: { roles: true } });
      expect(after!.roles).toEqual(['ordinary_member']);
    });
  });

  describe('inviting the people who hold the offices', () => {
    it('the fellowship administrator invites a Treasurer, and the invitation carries the role', async () => {
      const res = await api(app, fellowshipAdmin.token).post('/invitations', {
        email: `treasurer-${uniq()}@test.local`,
        firstName: 'Tay',
        lastName: 'Treasurer',
        roles: ['treasurer'],
      });
      expect(res.status).toBe(201);
      expect(res.body.roles).toEqual(['treasurer']);
      // A usable token, returned once, and no e-mail claimed to have been sent.
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.length).toBeGreaterThan(30);
      expect(res.body.note).toMatch(/no e-mail was sent/i);
    });

    it('creates NO account at invite time', async () => {
      const email = `pending-${uniq()}@test.local`;
      const before = await prisma.user.count();
      const res = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Pen', lastName: 'Ding', roles: ['treasurer'],
      });
      expect(res.status).toBe(201);
      // The point of an invitation: a half-configured fellowship holds no usable credentials.
      expect(await prisma.user.count()).toBe(before);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('the Secretary is refused an officer invitation', async () => {
      const res = await api(app, secretary.token).post('/invitations', {
        email: `sec-treasurer-${uniq()}@test.local`,
        firstName: 'Sec', lastName: 'Treasurer',
        roles: ['treasurer'],
      });
      expect([403]).toContain(res.status);
    });

    it('an accepted invitation creates one account with exactly the invited role', async () => {
      const email = `accept-${uniq()}@test.local`;
      const invited = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'App', lastName: 'Ointed', roles: ['treasurer'],
      });
      expect(invited.status).toBe(201);

      const accept = await asPublic().post(`/invitations/accept/${invited.body.token}`, {
        password: 'Sturdy-Passphrase-42',
      });
      expect(accept.status).toBe(201);

      const created = await prisma.user.findUnique({ where: { email }, select: { roles: true, must_change_password: true } });
      expect(created!.roles).toEqual(['treasurer']);
      // The person chose this password, so it is not a temporary one to be changed.
      expect(created!.must_change_password).toBe(false);
    });

    it('the token is single use: a second acceptance is refused', async () => {
      const email = `once-${uniq()}@test.local`;
      const invited = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'One', lastName: 'Time', roles: ['treasurer'],
      });
      expect((await asPublic().post(`/invitations/accept/${invited.body.token}`, { password: 'Sturdy-Passphrase-42' })).status).toBe(201);

      const again = await asPublic().post(`/invitations/accept/${invited.body.token}`, { password: 'Sturdy-Passphrase-42' });
      expect([400]).toContain(again.status);
      // One token, one account - never two.
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it('a wrong token is refused, and reveals nothing', async () => {
      const res = await asPublic().post('/invitations/accept/not-a-real-token-value-here', { password: 'Sturdy-Passphrase-42' });
      expect([404]).toContain(res.status);
    });

    it('a weak password is refused at acceptance, exactly as anywhere else', async () => {
      const email = `weak-${uniq()}@test.local`;
      const invited = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Weak', lastName: 'Password', roles: ['treasurer'],
      });
      const res = await asPublic().post(`/invitations/accept/${invited.body.token}`, { password: 'password' });
      expect([400]).toContain(res.status);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('stops working once the inviter is no longer an administrator of the fellowship', async () => {
      // The authority behind an invitation can be withdrawn while the link is still in an inbox. Re-checking at the
      // moment of the grant is what stops a stale promise from creating a Treasurer.
      const email = `stale-${uniq()}@test.local`;
      const invited = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Stale', lastName: 'Inviter', roles: ['treasurer'],
      });
      expect(invited.status).toBe(201);

      // The inviter loses the appointment power. Wrapped in try/finally so a failure here cannot leave the
      // shared fellowship_admin downgraded and cascade into the tests that follow.
      try {
        await prisma.user.update({
          where: { id: fellowshipAdmin.id },
          data: { roles: ['ordinary_member'], permissions: [] },
        });

        const res = await asPublic().post(`/invitations/accept/${invited.body.token}`, { password: 'Sturdy-Passphrase-42' });
        expect([400]).toContain(res.status);
        expect(await prisma.user.count({ where: { email } })).toBe(0);
      } finally {
        await prisma.user.update({
          where: { id: fellowshipAdmin.id },
          data: { roles: ['fellowship_admin'], permissions: [] },
        });
      }
    });

    it('a withdrawn invitation cannot be accepted', async () => {
      const email = `revoked-${uniq()}@test.local`;
      const invited = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Re', lastName: 'Voked', roles: ['treasurer'],
      });
      const revoke = await api(app, fellowshipAdmin.token).post(`/invitations/${invited.body.id}/revoke`);
      expect(revoke.status).toBe(201);

      const res = await asPublic().post(`/invitations/accept/${invited.body.token}`, { password: 'Sturdy-Passphrase-42' });
      expect([400]).toContain(res.status);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('a second pending invitation for the same address is refused', async () => {
      const email = `dup-${uniq()}@test.local`;
      const first = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Dup', lastName: 'Licate', roles: ['treasurer'],
      });
      expect(first.status).toBe(201);
      const second = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Dup', lastName: 'Licate', roles: ['secretary'],
      });
      expect([400]).toContain(second.status);
      expect(second.body.message).toMatch(/already a pending invitation/i);
    });

    it('invitations never cross fellowships', async () => {
      const other = await makeFellowship(prisma, 'OTHER');
      const otherAdmin = await makeUser(prisma, { fellowshipId: other.id, roles: ['fellowship_admin'] });
      const email = `cross-${uniq()}@test.local`;
      const invited = await api(app, fellowshipAdmin.token).post('/invitations', {
        email, firstName: 'Cross', lastName: 'Tenant', roles: ['treasurer'],
      });

      // Another fellowship's administrator cannot revoke or list it.
      const revoke = await api(app, otherAdmin.token).post(`/invitations/${invited.body.id}/revoke`);
      expect([403, 404]).toContain(revoke.status);

      const listed = await api(app, otherAdmin.token).get('/invitations');
      expect(JSON.stringify(listed.body)).not.toContain(email);
    });

    it('an invitation needs authentication to create', async () => {
      const res = await api(app).post('/invitations', {
        email: `nope-${uniq()}@test.local`, firstName: 'No', lastName: 'Auth', roles: ['treasurer'],
      });
      expect([401]).toContain(res.status);
    });
  });

  describe('the role table itself', () => {
    const { ROLE_DEFINITIONS, ROLES, GOVERNANCE_ROLES, permissionsForRoles } =
      require('../../src/shared/authorization/roles') as typeof import('../../src/shared/authorization/roles');

    it('defines a fellowship_admin role distinct from every fellowship office', () => {
      const admin = ROLE_DEFINITIONS.find((r) => r.name === ROLES.FELLOWSHIP_ADMIN);
      expect(admin).toBeDefined();
      for (const office of [ROLES.SECRETARY, ROLES.TREASURER, ROLES.CHAIRPERSON, ROLES.IT_ADMIN]) {
        expect(admin!.name).not.toBe(office);
      }
    });

    it('never calls any role "owner"', () => {
      expect(ROLE_DEFINITIONS.map((r) => r.name).join(',')).not.toMatch(/owner/i);
    });

    it('derives permissions from roles, so a new role is enforced the moment it is defined', () => {
      // The check above uses `permissionsForRoles` rather than reading the user's stored column, so a stale
      // permissions array cannot widen anybody's authority.
      const secretary = permissionsForRoles([ROLES.SECRETARY]);
      const admin = permissionsForRoles([ROLES.FELLOWSHIP_ADMIN]);
      expect(secretary).toContain('user.role_assign');
      expect(secretary).not.toContain('user.role_assign_governance');
      expect(admin).toContain('user.role_assign_governance');
    });

    it('treats the five offices as the governance set', () => {
      expect(GOVERNANCE_ROLES.has(ROLES.TREASURER)).toBe(true);
      expect(GOVERNANCE_ROLES.has(ROLES.SECRETARY)).toBe(true);
      expect(GOVERNANCE_ROLES.has(ROLES.CHAIRPERSON)).toBe(true);
      // And not the system administrator, who administers the officers rather than being one.
      expect(GOVERNANCE_ROLES.has(ROLES.FELLOWSHIP_ADMIN)).toBe(false);
    });
  });
});
