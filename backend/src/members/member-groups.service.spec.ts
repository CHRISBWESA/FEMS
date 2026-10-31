import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  MemberGroupsService,
  clearMismatchedGroupLeadership,
  leaderGenderOf,
} from './member-groups.service';
import { MemberAccessService } from './member-access.service';
import { TenantScopeService } from '../shared/tenant/tenant-scope.service';
import { PERMISSIONS } from '../shared/authorization/permissions';
import { ROLES, permissionsForRoles } from '../shared/authorization/roles';

/**
 * A small in-memory stand-in for the three tables the service uses. It honours the two unique indexes that matter
 * here - (group_id, member_id) and (group_id, leader_role) - by throwing the same P2002 error Postgres would.
 */
function fakePrisma() {
  const groups: any[] = [];
  const memberships: any[] = [];
  const members: any[] = [];
  const deleted: any[] = [];

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
  const matchStr = (v: any, f: any) => {
    if (f === undefined) return true;
    if (f === null || typeof f !== 'object') return v === f;
    if ('equals' in f)
      return f.mode === 'insensitive'
        ? String(v).toLowerCase() === String(f.equals).toLowerCase()
        : v === f.equals;
    if ('in' in f) return f.in.includes(v);
    let ok = true;
    if ('not' in f) ok = ok && v !== f.not;
    if ('notIn' in f) ok = ok && !f.notIn.includes(v);
    return ok;
  };
  const matches = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, f]) => matchStr(row[k], f));
  const checkLeaderUnique = () => {
    const seen = new Set<string>();
    for (const m of memberships) {
      if (!m.leader_role) continue;
      if (!['male_leader', 'female_leader'].includes(m.leader_role))
        throw new Error('check constraint');
      const key = `${m.group_id}|${m.leader_role}`;
      if (seen.has(key)) throw p2002();
      seen.add(key);
    }
  };
  const withMember = (m: any) => ({ ...m, member: members.find((x) => x.id === m.member_id) });

  const memberGroupMember = {
    findMany: async ({ where }: any) =>
      memberships.filter((m) => matches(m, where)).map(withMember),
    findUnique: async ({ where }: any) => {
      const k = where.group_id_member_id;
      return (
        memberships.find((m) => m.group_id === k.group_id && m.member_id === k.member_id) ?? null
      );
    },
    count: async ({ where }: any) => memberships.filter((m) => matches(m, where)).length,
    createMany: async ({ data }: any) => {
      for (const d of data) {
        if (memberships.some((m) => m.group_id === d.group_id && m.member_id === d.member_id))
          continue;
        memberships.push({ id: randomUUID(), joined_at: new Date(), leader_role: null, ...d });
      }
      return { count: data.length };
    },
    deleteMany: async ({ where }: any) => {
      const before = memberships.length;
      for (let i = memberships.length - 1; i >= 0; i--)
        if (matches(memberships[i], where)) memberships.splice(i, 1);
      return { count: before - memberships.length };
    },
    updateMany: async ({ where, data }: any) => {
      const hit = memberships.filter((m) => matches(m, where));
      const snapshot = hit.map((m) => ({ ...m }));
      hit.forEach((m) => Object.assign(m, data));
      try {
        checkLeaderUnique();
      } catch (e) {
        hit.forEach((m, i) => Object.assign(m, snapshot[i]));
        throw e;
      }
      return { count: hit.length };
    },
  };

  const prisma: any = {
    memberGroup: {
      findUnique: async ({ where }: any) => groups.find((g) => g.id === where.id) ?? null,
      findFirst: async ({ where }: any) => groups.find((g) => matches(g, where)) ?? null,
      findMany: async ({ where }: any) =>
        groups
          .filter((g) => matches(g, where))
          .map((g) => {
            const rows = memberships.filter((m) => m.group_id === g.id);
            return {
              ...g,
              _count: { members: rows.length },
              members: rows.filter((m) => m.leader_role).map(withMember),
            };
          }),
      create: async ({ data }: any) => {
        if (groups.some((g) => g.fellowship_id === data.fellowship_id && g.name === data.name))
          throw p2002();
        const g = { id: randomUUID(), created_at: new Date(), updated_at: new Date(), ...data };
        groups.push(g);
        return g;
      },
      update: async ({ where, data }: any) => {
        const g = groups.find((x) => x.id === where.id);
        Object.assign(g, data, { updated_at: new Date() });
        return g;
      },
      // Mirrors the ON DELETE CASCADE from memberships to their group.
      delete: async ({ where }: any) => {
        const i = groups.findIndex((x) => x.id === where.id);
        const [g] = groups.splice(i, 1);
        for (let j = memberships.length - 1; j >= 0; j--)
          if (memberships[j].group_id === where.id) memberships.splice(j, 1);
        return g;
      },
    },
    memberGroupMember,
    member: { findMany: async ({ where }: any) => members.filter((m) => matches(m, where)) },
    deletedRecord: {
      create: async ({ data }: any) => {
        deleted.push(data);
        return data;
      },
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, groups, memberships, members, deleted };
}

const F1 = randomUUID();
const F2 = randomUUID();
const secretary = {
  userId: randomUUID(),
  roles: [ROLES.SECRETARY],
  fellowshipId: F1,
  permissions: permissionsForRoles([ROLES.SECRETARY]),
};
const chair = {
  userId: randomUUID(),
  roles: [ROLES.CHAIRPERSON],
  fellowshipId: F1,
  permissions: permissionsForRoles([ROLES.CHAIRPERSON]),
};
const otherSecretary = { ...secretary, userId: randomUUID(), fellowshipId: F2 };

function setup() {
  const db = fakePrisma();
  const audit = { log: jest.fn() };
  const scope = new TenantScopeService();
  const service = new MemberGroupsService(
    db.prisma,
    audit as any,
    scope,
    new MemberAccessService(db.prisma, scope),
  );
  const person = (full_name: string, gender: string | null, fellowship_id = F1) => {
    const m = {
      id: randomUUID(),
      full_name,
      member_code: `C-${full_name}`,
      membership_status: 'active',
      gender,
      fellowship_id,
    };
    db.members.push(m);
    return m;
  };
  return { ...db, audit, service, person };
}

describe('leaderGenderOf', () => {
  it('reads the recorded gender without guessing', () => {
    expect(leaderGenderOf('male')).toBe('male');
    expect(leaderGenderOf(' Female ')).toBe('female');
    expect(leaderGenderOf('MALE')).toBe('male');
    for (const v of ['other', '', null, undefined, 'm', 'f', 42])
      expect(leaderGenderOf(v)).toBeNull();
  });
});

describe('role registry for groups', () => {
  it('only the secretary and assistant secretary may manage groups; chairpersons may view', () => {
    const managers = [ROLES.SECRETARY, ROLES.ASSISTANT_SECRETARY];
    for (const role of Object.values(ROLES)) {
      const perms = permissionsForRoles([role]);
      expect(perms.includes(PERMISSIONS.MEMBER_GROUPS_MANAGE)).toBe(managers.includes(role as any));
    }
    expect(permissionsForRoles([ROLES.CHAIRPERSON])).toContain(PERMISSIONS.MEMBER_GROUPS_VIEW);
  });
});

describe('MemberGroupsService', () => {
  it('creates and edits a group, and blocks duplicate names case-insensitively within a fellowship', async () => {
    const { service, audit } = setup();
    const g = await service.create({ name: '  Youth   Cell ' }, secretary);
    expect(g.name).toBe('Youth Cell');
    await expect(service.create({ name: 'youth cell' }, secretary)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create({ name: 'Youth Cell' }, otherSecretary)).resolves.toBeTruthy();

    const other = await service.create({ name: 'Choir' }, secretary);
    await expect(
      service.update(other.id, { name: 'YOUTH CELL' }, secretary),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(g.id, { name: 'Youth Cell', description: 'Fridays' }, secretary),
    ).resolves.toMatchObject({ description: 'Fridays' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member_group.edit' }),
    );
  });

  it('turns a concurrent duplicate (database unique violation) into a clean conflict', async () => {
    const { service, prisma } = setup();
    await service.create({ name: 'Race' }, secretary);
    prisma.memberGroup.findFirst = async () => null; // the pre-check lost the race
    await expect(service.create({ name: 'Race' }, secretary)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('validates names and descriptions', async () => {
    const { service } = setup();
    for (const name of [undefined, '', '   ', 5, 'x'.repeat(81)]) {
      await expect(service.create({ name } as any, secretary)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    await expect(
      service.create({ name: 'ok', description: 'y'.repeat(301) }, secretary),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds members in bulk without duplicates and rejects other fellowships', async () => {
    const { service, person, memberships } = setup();
    const g = await service.create({ name: 'G' }, secretary);
    const a = person('A', 'male');
    const b = person('B', 'female');
    const outside = person('X', 'male', F2);
    const res = await service.addMembers(g.id, [a.id, b.id, a.id, outside.id], secretary);
    expect(res).toEqual({ added: 2, alreadyMember: 0, rejected: [outside.id] });
    expect((await service.addMembers(g.id, [a.id], secretary)).alreadyMember).toBe(1);
    expect(memberships.filter((m) => m.group_id === g.id)).toHaveLength(2);
  });

  describe('leaders', () => {
    async function groupWithMembers() {
      const ctx = setup();
      const g = await ctx.service.create({ name: 'Leaders' }, secretary);
      const men = [ctx.person('M1', 'male'), ctx.person('M2', 'Male')];
      const women = [ctx.person('W1', 'female'), ctx.person('W2', 'FEMALE')];
      const other = ctx.person('O', 'other');
      const blank = ctx.person('N', null);
      const outsider = ctx.person('Out', 'male');
      await ctx.service.addMembers(
        g.id,
        [...men, ...women, other, blank].map((m) => m.id),
        secretary,
      );
      return { ...ctx, g, men, women, other, blank, outsider };
    }

    it('appoints a male and a female leader from the group', async () => {
      const { service, g, men, women } = await groupWithMembers();
      const res = await service.setLeaders(
        g.id,
        { maleLeaderId: men[0].id, femaleLeaderId: women[0].id },
        secretary,
      );
      expect(res.maleLeader.memberId).toBe(men[0].id);
      expect(res.femaleLeader.memberId).toBe(women[0].id);
      const list = await service.findAll(secretary);
      expect(list[0].maleLeader.memberId).toBe(men[0].id);
    });

    it('rejects a leader whose recorded gender does not match the role', async () => {
      const { service, g, men, women, other, blank, members } = await groupWithMembers();
      await expect(
        service.setLeaders(g.id, { maleLeaderId: women[0].id }, secretary),
      ).rejects.toThrow(/not recorded as male/);
      await expect(
        service.setLeaders(g.id, { femaleLeaderId: men[0].id }, secretary),
      ).rejects.toThrow(/not recorded as female/);
      await expect(
        service.setLeaders(g.id, { maleLeaderId: other.id }, secretary),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setLeaders(g.id, { femaleLeaderId: blank.id }, secretary),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Case differences in the stored value are accepted, and the stored value is left as it was.
      await service.setLeaders(
        g.id,
        { maleLeaderId: men[1].id, femaleLeaderId: women[1].id },
        secretary,
      );
      expect(members.find((m) => m.id === men[1].id)?.gender).toBe('Male');
    });

    it('rejects a leader who is not a member of the group, and changes nothing when one half is invalid', async () => {
      const { service, g, men, women, outsider } = await groupWithMembers();
      await service.setLeaders(g.id, { maleLeaderId: men[0].id }, secretary);
      await expect(
        service.setLeaders(g.id, { maleLeaderId: outsider.id }, secretary),
      ).rejects.toThrow(/must already be a member/);
      await expect(
        service.setLeaders(g.id, { maleLeaderId: men[1].id, femaleLeaderId: men[0].id }, secretary),
      ).rejects.toBeInstanceOf(BadRequestException);
      const now = await service.findOne(g.id, secretary);
      expect(now.maleLeader.memberId).toBe(men[0].id);
      expect(now.femaleLeader).toBeNull();
      void women;
    });

    it('replaces a leader so each role has exactly one holder, and clears with null', async () => {
      const { service, g, men, women, memberships } = await groupWithMembers();
      await service.setLeaders(
        g.id,
        { maleLeaderId: men[0].id, femaleLeaderId: women[0].id },
        secretary,
      );
      await service.setLeaders(g.id, { maleLeaderId: men[1].id }, secretary);
      expect(
        memberships
          .filter((m) => m.group_id === g.id && m.leader_role === 'male_leader')
          .map((m) => m.member_id),
      ).toEqual([men[1].id]);
      const cleared = await service.setLeaders(g.id, { femaleLeaderId: null }, secretary);
      expect(cleared.femaleLeader).toBeNull();
      expect(cleared.maleLeader.memberId).toBe(men[1].id);
    });

    it('validates the body', async () => {
      const { service, g, men } = await groupWithMembers();
      await expect(service.setLeaders(g.id, {}, secretary)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.setLeaders(g.id, null as any, secretary)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.setLeaders(g.id, { maleLeaderId: 'nope' }, secretary),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setLeaders(g.id, { maleLeaderId: men[0].id, femaleLeaderId: men[0].id }, secretary),
      ).rejects.toThrow(/both/);
      await expect(
        service.setLeaders('not-a-uuid', { maleLeaderId: null }, secretary),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('removing a leader from the group clears the leadership', async () => {
      const { service, g, women, audit } = await groupWithMembers();
      await service.setLeaders(g.id, { femaleLeaderId: women[0].id }, secretary);
      const res = await service.removeMember(g.id, women[0].id, secretary);
      expect(res.message).toMatch(/leadership was cleared/);
      expect((await service.findOne(g.id, secretary)).femaleLeader).toBeNull();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'member_group.member_remove',
          oldValue: { memberId: women[0].id, leaderRole: 'female_leader' },
        }),
      );
    });

    it('clears leadership that no longer matches after a gender change, keeping the membership', async () => {
      const { service, prisma, g, men, members, memberships } = await groupWithMembers();
      await service.setLeaders(g.id, { maleLeaderId: men[0].id }, secretary);
      members.find((m) => m.id === men[0].id)!.gender = 'female';
      const cleared = await clearMismatchedGroupLeadership(prisma, men[0].id, 'female');
      expect(cleared.map((c) => ({ group_id: c.group_id, leader_role: c.leader_role }))).toEqual([
        { group_id: g.id, leader_role: 'male_leader' },
      ]);
      expect(memberships.find((m) => m.member_id === men[0].id)).toMatchObject({
        leader_role: null,
      });
      // Nothing to clear when the gender still matches.
      await service.setLeaders(g.id, { maleLeaderId: men[1].id }, secretary);
      expect(await clearMismatchedGroupLeadership(prisma, men[1].id, 'male')).toEqual([]);
    });

    it('enforces permissions and fellowship scope on the server', async () => {
      const { service, g, men } = await groupWithMembers();
      await expect(
        service.setLeaders(g.id, { maleLeaderId: men[0].id }, chair),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.addMembers(g.id, [men[0].id], chair)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.removeMember(g.id, men[0].id, chair)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.create({ name: 'No' }, chair)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.findOne(g.id, chair)).resolves.toBeTruthy();
      await expect(
        service.setLeaders(g.id, { maleLeaderId: men[0].id }, otherSecretary),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.findOne(g.id, otherSecretary)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.remove(g.id, chair)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.remove(g.id, otherSecretary)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deleting a group', () => {
    it('deletes the group and its memberships, keeps the members, and saves a copy to the recycle bin', async () => {
      const { service, person, groups, memberships, members, deleted, audit } = setup();
      const g = await service.create({ name: '2026 Cell' }, secretary);
      const keep = await service.create({ name: '2027 Cell' }, secretary);
      const m = person('Lead', 'male');
      const w = person('Lady', 'female');
      await service.addMembers(g.id, [m.id, w.id], secretary);
      await service.addMembers(keep.id, [m.id], secretary);
      await service.setLeaders(g.id, { maleLeaderId: m.id }, secretary);

      const res = await service.remove(g.id, secretary);
      expect(res).toEqual({ message: 'Group "2026 Cell" deleted', removedMemberships: 2 });
      expect(groups.map((x) => x.id)).toEqual([keep.id]);
      expect(memberships.filter((x) => x.group_id === g.id)).toHaveLength(0);
      expect(memberships.filter((x) => x.group_id === keep.id)).toHaveLength(1); // other groups untouched
      expect(members).toHaveLength(2); // member records untouched

      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({
        original_collection: 'member_group',
        original_record_id: g.id,
        fellowship_id: F1,
      });
      expect(deleted[0].original_data.group.name).toBe('2026 Cell');
      expect(deleted[0].original_data.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ member_id: m.id, leader_role: 'male_leader' }),
        ]),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'member_group.delete', entityId: g.id }),
      );

      // The name is free again for next year's group.
      await expect(service.create({ name: '2026 Cell' }, secretary)).resolves.toBeTruthy();
      await expect(service.remove(g.id, secretary)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove('nope', secretary)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes nothing if the recycle-bin copy cannot be written', async () => {
      const { service, prisma, groups } = setup();
      const g = await service.create({ name: 'Safe' }, secretary);
      prisma.$transaction = async () => {
        throw new Error('database unavailable');
      };
      await expect(service.remove(g.id, secretary)).rejects.toThrow('database unavailable');
      expect(groups).toHaveLength(1);
    });
  });
});
