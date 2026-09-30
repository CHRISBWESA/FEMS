// Rate limiting needs its own spec file: the limits are read when the modules load, and every other suite lifts
// them so it can run at speed. Set BEFORE anything imports the application.
process.env.AUTH_RATE_LIMIT_MAX = '5';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
process.env.PUBLIC_RATE_LIMIT_MAX = '4';
process.env.PUBLIC_RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '40';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

import { INestApplication } from '@nestjs/common';
import { api, createTestApp, describeDb, getPrisma, makeActivity, makeFellowship, makeUser } from './harness';

describeDb('Phase 22 - rate limiting (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('sign-in is limited per client: the 6th attempt inside the window is refused (429), whatever the credentials', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await api(app).post('/auth/login', { email: `nobody${i}@test.local`, password: 'wrong-password-123' })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
  });

  it('token refresh and password reset share the tight limit', async () => {
    // the login budget above is per route; refresh has its own counter
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await api(app).post('/auth/refresh', { refreshToken: 'not-a-token' })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true); // malformed token: 401, no longer a 500
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
  });

  it('the public check-in link is limited', async () => {
    const f = await makeFellowship(prisma, 'TH');
    const a = await makeActivity(prisma, { fellowshipId: f.id });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await api(app).post('/activities/attendance', { activityId: a.id, memberName: `Visitor ${i}` })).status);
    expect(codes.slice(0, 4).every((c) => c === 201)).toBe(true);
    expect(codes.slice(4).every((c) => c === 429)).toBe(true);
  });

  it('the global limit applies to authenticated traffic too', async () => {
    const f = await makeFellowship(prisma, 'TG');
    const u = await makeUser(prisma, { fellowshipId: f.id, roles: ['ordinary_member'] });
    let limited = 0;
    for (let i = 0; i < 60; i++) if ((await api(app, u.token).get('/profile')).status === 429) limited++;
    expect(limited).toBeGreaterThan(10);
  });
});
