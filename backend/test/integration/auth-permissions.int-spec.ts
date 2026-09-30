import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, uniq } from './harness';

// Regression: the login response/JWT used to advertise the stale users.permissions DB column (frozen at
// user-creation time) and the login response body had no permissions at all, so the UI's hasPermission()
// disagreed with what the API enforces (and threw right after login).
describeDb('auth - permissions advertised to the client', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('login returns role-derived permissions in the body and the token, ignoring a stale DB column', async () => {
    const prisma = getPrisma(app);
    const f = await makeFellowship(prisma, 'Auth');
    const email = `login${uniq()}@test.local`;
    await prisma.user.create({
      data: {
        email,
        password_hash: await bcrypt.hash('Correct-Horse-9', 4),
        first_name: 'Log',
        last_name: 'In',
        roles: ['secretary'],
        permissions: [], // stale: does not include any permission added after the user was created
        fellowship_id: f.id,
      },
    });

    const res = await api(app).post('/auth/login', { email, password: 'Correct-Horse-9' }).expect(201);
    expect(res.body.user.permissions).toEqual(expect.arrayContaining(['member.profile_view', 'youth.view', 'activity.attendance']));

    const payload: any = jwt.decode(res.body.accessToken);
    expect(payload.permissions).toEqual(expect.arrayContaining(['member.profile_view']));

    // A treasurer must NOT be advertised member/youth permissions.
    const email2 = `treas${uniq()}@test.local`;
    await prisma.user.create({
      data: {
        email: email2,
        password_hash: await bcrypt.hash('Correct-Horse-9', 4),
        first_name: 'T',
        last_name: 'R',
        roles: ['treasurer'],
        permissions: ['member.profile_view', 'youth.view'], // tampered/stale column must not be trusted
        fellowship_id: f.id,
      },
    });
    const res2 = await api(app).post('/auth/login', { email: email2, password: 'Correct-Horse-9' }).expect(201);
    expect(res2.body.user.permissions).not.toContain('member.profile_view');
    expect(res2.body.user.permissions).not.toContain('youth.view');
    expect(res2.body.user.permissions).toContain('finance.view');
  });

  it('wrong password is 401 and reveals nothing', async () => {
    const res = await api(app).post('/auth/login', { email: 'nobody@test.local', password: 'x' }).expect(401);
    expect(JSON.stringify(res.body)).not.toContain('permissions');
  });
});
