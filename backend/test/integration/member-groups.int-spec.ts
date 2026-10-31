import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  api,
  createTestApp,
  describeDb,
  getPrisma,
  makeFellowship,
  makeMember,
  makeUser,
  uniq,
} from './harness';

describeDb(
  'Member groups: creation, membership and male/female leadership (real Postgres, HTTP)',
  () => {
    let app: INestApplication;
    let prisma: ReturnType<typeof getPrisma>;
    let fA: any, fB: any;
    let sec: any, asst: any, chair: any, treas: any, ord: any, admin: any, secB: any;
    let male1: any,
      male2: any,
      female1: any,
      female2: any,
      other: any,
      unknown: any,
      outsider: any,
      memberB: any;

    beforeAll(async () => {
      app = await createTestApp();
      prisma = getPrisma(app);
      fA = await makeFellowship(prisma, 'GA');
      fB = await makeFellowship(prisma, 'GB');
      sec = await makeUser(prisma, { fellowshipId: fA.id, roles: ['secretary'] });
      asst = await makeUser(prisma, { fellowshipId: fA.id, roles: ['assistant_secretary'] });
      chair = await makeUser(prisma, { fellowshipId: fA.id, roles: ['chairperson'] });
      treas = await makeUser(prisma, { fellowshipId: fA.id, roles: ['treasurer'] });
      ord = await makeUser(prisma, { fellowshipId: fA.id, roles: ['ordinary_member'] });
      admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
      secB = await makeUser(prisma, { fellowshipId: fB.id, roles: ['secretary'] });

      male1 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Male One', gender: 'male' });
      male2 = await makeMember(prisma, { fellowshipId: fA.id, name: 'Male Two', gender: 'Male' }); // stored capitalised
      female1 = await makeMember(prisma, {
        fellowshipId: fA.id,
        name: 'Female One',
        gender: 'female',
      });
      female2 = await makeMember(prisma, {
        fellowshipId: fA.id,
        name: 'Female Two',
        gender: 'female',
      });
      other = await makeMember(prisma, { fellowshipId: fA.id, name: 'Other One', gender: 'other' });
      unknown = await makeMember(prisma, { fellowshipId: fA.id, name: 'No Gender', gender: null });
      outsider = await makeMember(prisma, {
        fellowshipId: fA.id,
        name: 'Not In Group',
        gender: 'male',
      });
      memberB = await makeMember(prisma, {
        fellowshipId: fB.id,
        name: 'Other Fellowship',
        gender: 'female',
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    async function newGroup(token = sec.token) {
      const res = await api(app, token)
        .post('/member-groups', { name: `Cell ${uniq()}`, description: 'Tuesday cell' })
        .expect(201);
      return res.body.id as string;
    }

    describe('creation and editing', () => {
      it('the secretary creates, views and edits a group', async () => {
        const name = `Alpha ${uniq()}`;
        const created = await api(app, sec.token)
          .post('/member-groups', { name: `  ${name}  `, description: 'First' })
          .expect(201);
        expect(created.body).toMatchObject({ name, description: 'First', isActive: true });

        const list = await api(app, sec.token).get('/member-groups').expect(200);
        expect(list.body.find((g: any) => g.id === created.body.id)).toMatchObject({
          memberCount: 0,
          maleLeader: null,
          femaleLeader: null,
        });

        const edited = await api(app, sec.token)
          .put(`/member-groups/${created.body.id}`, { name: `${name} Renamed`, description: '' })
          .expect(200);
        expect(edited.body).toMatchObject({ name: `${name} Renamed`, description: null });

        const detail = await api(app, sec.token)
          .get(`/member-groups/${created.body.id}`)
          .expect(200);
        expect(detail.body).toMatchObject({ memberCount: 0, members: [] });
        expect(new Date(detail.body.createdAt).getTime()).toBeGreaterThan(0);
      });

      it('prevents duplicate names in the same fellowship, ignoring case, but allows them across fellowships', async () => {
        const name = `Dup ${uniq()}`;
        const first = await api(app, sec.token).post('/member-groups', { name }).expect(201);
        await api(app, sec.token).post('/member-groups', { name }).expect(400);
        await api(app, sec.token).post('/member-groups', { name: name.toUpperCase() }).expect(400);
        await api(app, secB.token).post('/member-groups', { name }).expect(201);

        const second = await api(app, sec.token)
          .post('/member-groups', { name: `${name} b` })
          .expect(201);
        await api(app, sec.token)
          .put(`/member-groups/${second.body.id}`, { name: name.toLowerCase() })
          .expect(400);
        // Saving a group under its own name is not a clash.
        await api(app, sec.token).put(`/member-groups/${first.body.id}`, { name }).expect(200);
      });

      it('validates the name and description', async () => {
        await api(app, sec.token).post('/member-groups', {}).expect(400);
        await api(app, sec.token).post('/member-groups', { name: '   ' }).expect(400);
        await api(app, sec.token)
          .post('/member-groups', { name: 'x'.repeat(81) })
          .expect(400);
        await api(app, sec.token)
          .post('/member-groups', { name: `D ${uniq()}`, description: 'y'.repeat(301) })
          .expect(400);
      });
    });

    describe('membership', () => {
      it('adds several members at once, never duplicates, and rejects members of another fellowship', async () => {
        const id = await newGroup();
        const res = await api(app, sec.token)
          .post(`/member-groups/${id}/members`, {
            memberIds: [male1.id, female1.id, male1.id, memberB.id],
          })
          .expect(201);
        expect(res.body).toEqual({ added: 2, alreadyMember: 0, rejected: [memberB.id] });

        const again = await api(app, sec.token)
          .post(`/member-groups/${id}/members`, { memberIds: [male1.id, female2.id] })
          .expect(201);
        expect(again.body).toMatchObject({ added: 1, alreadyMember: 1 });

        const rows = await prisma.memberGroupMember.count({ where: { group_id: id } });
        expect(rows).toBe(3);
        // The member records themselves are untouched: no new member was created.
        expect(
          await prisma.member.count({ where: { id: { in: [male1.id, female1.id, female2.id] } } }),
        ).toBe(3);
      });

      it('the member list can be filtered by recorded gender when picking members', async () => {
        const res = await api(app, sec.token).get('/members?gender=male&limit=100').expect(200);
        const ids = res.body.data.map((m: any) => m.id);
        expect(ids).toEqual(expect.arrayContaining([male1.id, male2.id]));
        expect(ids).not.toContain(female1.id);
        await api(app, sec.token).get('/members?gender=robot').expect(400);
      });

      it('lets a member belong to several groups', async () => {
        const g1 = await newGroup();
        const g2 = await newGroup();
        await api(app, sec.token)
          .post(`/member-groups/${g1}/members`, { memberIds: [female2.id] })
          .expect(201);
        await api(app, sec.token)
          .post(`/member-groups/${g2}/members`, { memberIds: [female2.id] })
          .expect(201);
        expect(
          await prisma.memberGroupMember.count({
            where: { member_id: female2.id, group_id: { in: [g1, g2] } },
          }),
        ).toBe(2);
      });

      it('removes a member, and reports a member that is not in the group', async () => {
        const id = await newGroup();
        await api(app, sec.token)
          .post(`/member-groups/${id}/members`, { memberIds: [male1.id] })
          .expect(201);
        await api(app, sec.token)
          .post(`/member-groups/${id}/members/${male1.id}/remove`)
          .expect(201);
        await api(app, sec.token)
          .post(`/member-groups/${id}/members/${male1.id}/remove`)
          .expect(404);
        await api(app, sec.token)
          .post(`/member-groups/${id}/members/not-a-uuid/remove`)
          .expect(404);
      });
    });

    describe('leadership', () => {
      let id: string;
      beforeAll(async () => {
        id = await newGroup();
        await api(app, sec.token)
          .post(`/member-groups/${id}/members`, {
            memberIds: [male1.id, male2.id, female1.id, female2.id, other.id, unknown.id],
          })
          .expect(201);
      });

      it('appoints one male and one female leader from the group members', async () => {
        const res = await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, {
            maleLeaderId: male1.id,
            femaleLeaderId: female1.id,
          })
          .expect(200);
        expect(res.body.maleLeader).toMatchObject({ memberId: male1.id, fullName: 'Male One' });
        expect(res.body.femaleLeader).toMatchObject({ memberId: female1.id });
        expect(res.body.members.find((m: any) => m.memberId === male1.id).leaderRole).toBe(
          'male_leader',
        );

        const list = await api(app, sec.token).get('/member-groups').expect(200);
        expect(list.body.find((g: any) => g.id === id)).toMatchObject({
          maleLeader: { memberId: male1.id },
          femaleLeader: { memberId: female1.id },
        });
      });

      it('enforces gender: only male members lead as male, only female members as female', async () => {
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: female2.id })
          .expect(400);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { femaleLeaderId: male2.id })
          .expect(400);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: other.id })
          .expect(400);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { femaleLeaderId: unknown.id })
          .expect(400);
        // Recorded gender is compared case-insensitively and is never modified.
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: male2.id })
          .expect(200);
        expect((await prisma.member.findUnique({ where: { id: male2.id } }))?.gender).toBe('Male');
        // A failed request changes nothing: female1 is still the female leader.
        const detail = await api(app, sec.token).get(`/member-groups/${id}`).expect(200);
        expect(detail.body.femaleLeader.memberId).toBe(female1.id);
      });

      it('requires the leader to already be a member of the group', async () => {
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: outsider.id })
          .expect(400);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { femaleLeaderId: memberB.id })
          .expect(400);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: randomUUID() })
          .expect(400);
      });

      it('validates the request body', async () => {
        await api(app, sec.token).put(`/member-groups/${id}/leaders`, {}).expect(400);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: 'nope' })
          .expect(400);
      });

      it('replaces a leader, keeping exactly one per role', async () => {
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: male1.id })
          .expect(200);
        const res = await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: male2.id })
          .expect(200);
        expect(res.body.maleLeader.memberId).toBe(male2.id);
        expect(
          await prisma.memberGroupMember.count({
            where: { group_id: id, leader_role: 'male_leader' },
          }),
        ).toBe(1);
        expect(res.body.members.find((m: any) => m.memberId === male1.id).leaderRole).toBeNull();
      });

      it('the database itself refuses a second holder of the same role', async () => {
        await expect(
          prisma.memberGroupMember.updateMany({
            where: { group_id: id, member_id: male1.id },
            data: { leader_role: 'male_leader' },
          }),
        ).rejects.toThrow();
        await expect(
          prisma.memberGroupMember.updateMany({
            where: { group_id: id, member_id: male1.id },
            data: { leader_role: 'boss' },
          }),
        ).rejects.toThrow();
      });

      it('clears a leader with null', async () => {
        const res = await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { femaleLeaderId: null })
          .expect(200);
        expect(res.body.femaleLeader).toBeNull();
        expect(res.body.maleLeader.memberId).toBe(male2.id);
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { femaleLeaderId: female1.id })
          .expect(200);
      });

      it('removing a leader from the group clears their leadership', async () => {
        await api(app, sec.token)
          .put(`/member-groups/${id}/leaders`, { femaleLeaderId: female2.id })
          .expect(200);
        const removed = await api(app, sec.token)
          .post(`/member-groups/${id}/members/${female2.id}/remove`)
          .expect(201);
        expect(removed.body.message).toMatch(/leadership was cleared/);
        const detail = await api(app, sec.token).get(`/member-groups/${id}`).expect(200);
        expect(detail.body.femaleLeader).toBeNull();
        // Adding them back does not silently restore the role.
        await api(app, sec.token)
          .post(`/member-groups/${id}/members`, { memberIds: [female2.id] })
          .expect(201);
        expect(
          (await api(app, sec.token).get(`/member-groups/${id}`).expect(200)).body.femaleLeader,
        ).toBeNull();
      });

      it("changing a leader's recorded gender clears the leadership that no longer matches", async () => {
        const g = await newGroup();
        const m = await makeMember(prisma, {
          fellowshipId: fA.id,
          name: `Switch ${uniq()}`,
          gender: 'male',
        });
        await api(app, sec.token)
          .post(`/member-groups/${g}/members`, { memberIds: [m.id] })
          .expect(201);
        await api(app, sec.token)
          .put(`/member-groups/${g}/leaders`, { maleLeaderId: m.id })
          .expect(200);
        await api(app, sec.token).put(`/members/${m.id}`, { gender: 'female' }).expect(200);
        const detail = await api(app, sec.token).get(`/member-groups/${g}`).expect(200);
        expect(detail.body.maleLeader).toBeNull();
        expect(detail.body.members[0].memberId).toBe(m.id); // still a member, just not a leader
        const audit = await prisma.auditLog.findFirst({
          where: { action: 'member_group.leader_cleared', entity_id: g },
        });
        expect(audit).toBeTruthy();
      });

      it('writes audit entries for leadership changes', async () => {
        const entries = await prisma.auditLog.count({
          where: { action: 'member_group.leaders_set', entity_id: id },
        });
        expect(entries).toBeGreaterThan(0);
      });
    });

    describe('deleting a group', () => {
      it('removes the group and its memberships, keeps member records, and keeps a recycle-bin copy', async () => {
        const name = `Year ${uniq()}`;
        const g = (await api(app, sec.token).post('/member-groups', { name }).expect(201)).body.id;
        const keep = await newGroup();
        await api(app, sec.token)
          .post(`/member-groups/${g}/members`, { memberIds: [male1.id, female1.id] })
          .expect(201);
        await api(app, sec.token)
          .post(`/member-groups/${keep}/members`, { memberIds: [male1.id] })
          .expect(201);
        await api(app, sec.token)
          .put(`/member-groups/${g}/leaders`, { maleLeaderId: male1.id })
          .expect(200);

        await api(app, chair.token).delete(`/member-groups/${g}`).expect(403);
        await api(app, secB.token).delete(`/member-groups/${g}`).expect(403);
        await api(app, admin.token).delete(`/member-groups/${g}`).expect(403);

        const res = await api(app, sec.token).delete(`/member-groups/${g}`).expect(200);
        expect(res.body.removedMemberships).toBe(2);
        await api(app, sec.token).get(`/member-groups/${g}`).expect(404);
        await api(app, sec.token).delete(`/member-groups/${g}`).expect(404);

        expect(await prisma.memberGroupMember.count({ where: { group_id: g } })).toBe(0);
        expect(await prisma.memberGroupMember.count({ where: { group_id: keep } })).toBe(1);
        expect(await prisma.member.count({ where: { id: { in: [male1.id, female1.id] } } })).toBe(
          2,
        );

        const copy = await prisma.deletedRecord.findFirst({
          where: { original_collection: 'member_group', original_record_id: g },
        });
        expect(copy?.fellowship_id).toBe(fA.id);
        expect((copy?.original_data as any).members).toHaveLength(2);
        const bin = await api(app, sec.token).get('/recycle-bin').expect(200);
        expect(bin.body.some((r: any) => r.original_record_id === g)).toBe(true);

        // A new group can reuse the name.
        await api(app, sec.token).post('/member-groups', { name }).expect(201);
      });
    });

    describe('permissions are enforced by the server', () => {
      let id: string;
      beforeAll(async () => {
        id = await newGroup();
        await api(app, sec.token)
          .post(`/member-groups/${id}/members`, { memberIds: [male1.id] })
          .expect(201);
      });

      it('the assistant secretary may manage groups, including leaders', async () => {
        await api(app, asst.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: male1.id })
          .expect(200);
      });

      it('chairpersons may view but not change groups', async () => {
        await api(app, chair.token).get(`/member-groups/${id}`).expect(200);
        await api(app, chair.token)
          .post('/member-groups', { name: `C ${uniq()}` })
          .expect(403);
        await api(app, chair.token).put(`/member-groups/${id}`, { name: 'x' }).expect(403);
        await api(app, chair.token)
          .post(`/member-groups/${id}/members`, { memberIds: [female1.id] })
          .expect(403);
        await api(app, chair.token)
          .post(`/member-groups/${id}/members/${male1.id}/remove`)
          .expect(403);
        await api(app, chair.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: null })
          .expect(403);
      });

      it('other fellowship roles, other fellowships and the platform admin cannot touch the group', async () => {
        for (const u of [treas, ord]) {
          await api(app, u.token).get(`/member-groups/${id}`).expect(403);
          await api(app, u.token)
            .put(`/member-groups/${id}/leaders`, { maleLeaderId: null })
            .expect(403);
        }
        await api(app, secB.token).get(`/member-groups/${id}`).expect(403);
        await api(app, secB.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: null })
          .expect(403);
        await api(app, admin.token)
          .put(`/member-groups/${id}/leaders`, { maleLeaderId: null })
          .expect(403);
        await api(app).put(`/member-groups/${id}/leaders`, { maleLeaderId: null }).expect(401);
        // Nothing above changed the leader.
        const detail = await api(app, sec.token).get(`/member-groups/${id}`).expect(200);
        expect(detail.body.maleLeader.memberId).toBe(male1.id);
      });
    });
  },
);
