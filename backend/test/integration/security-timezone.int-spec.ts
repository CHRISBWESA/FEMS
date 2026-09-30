import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { api, createTestApp, describeDb, getPrisma, makeFellowship, uniq } from './harness';

// The database session time zone must not change what the application does. Raw SQL (now(), a JS Date compared with a
// `timestamp` column) uses the session zone while Prisma stores UTC wall-clock values; before this was handled the account
// lock-out lasted 3 hours longer than intended on a Nairobi-time database and expired immediately on a New-York-time one.
describeDb('Phase 22 - database time zone independence (real Postgres, full HTTP stack)', () => {
  const base = process.env.TEST_DATABASE_URL as string;
  const withOptions = (tz: string) => `${base}${base.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c TimeZone=${tz}`)}`;
  const original = process.env.DATABASE_URL;
  let app: INestApplication;

  const makeAccount = async (prisma: ReturnType<typeof getPrisma>, password: string) => {
    const f = await makeFellowship(prisma, 'TZ');
    const email = `tz${uniq()}@test.local`;
    const user = await prisma.user.create({
      data: { email, password_hash: await bcrypt.hash(password, 4), first_name: 'Zone', last_name: 'Tester', roles: ['secretary'], fellowship_id: f.id, must_change_password: false },
    });
    return { email, id: user.id };
  };
  const shortHashLogin = (email: string, password: string) => api(app).post('/auth/login', { email, password });

  afterEach(async () => {
    await app?.close();
    process.env.DATABASE_URL = original;
    delete process.env.DATABASE_FORCE_UTC_SESSION;
  });

  it('by default the application forces a UTC session, whatever the database is configured with', async () => {
    process.env.DATABASE_URL = base; // no options in the URL at all
    app = await createTestApp();
    const rows: any[] = await (getPrisma(app) as any).$queryRawUnsafe('SHOW TimeZone');
    expect(rows[0].TimeZone).toMatch(/^(UTC|Etc\/UTC)$/);
  });

  it('a session the operator sets on purpose is respected (and this is what the next test relies on)', async () => {
    process.env.DATABASE_URL = withOptions('America/New_York');
    app = await createTestApp();
    const rows: any[] = await (getPrisma(app) as any).$queryRawUnsafe('SHOW TimeZone');
    expect(rows[0].TimeZone).toBe('America/New_York');
  });

  for (const tz of ['America/New_York', 'Africa/Nairobi', 'Pacific/Auckland']) {
    it(`the lock-out lasts about 15 minutes on a database whose session time zone is ${tz}`, async () => {
      process.env.DATABASE_URL = withOptions(tz);
      app = await createTestApp();
      const prisma = getPrisma(app);
      const password = 'Correct-Horse-Battery-9';
      const { email, id } = await makeAccount(prisma, password);

      for (let i = 0; i < 8; i++) expect((await shortHashLogin(email, `wrong-password-${i}`)).status).toBe(401);
      // locked: even the right password is refused, exactly like a wrong one
      expect((await shortHashLogin(email, password)).status).toBe(401);

      const row = await prisma.user.findUnique({ where: { id } });
      const minutesLeft = (row!.locked_until!.getTime() - Date.now()) / 60000;
      expect(minutesLeft).toBeGreaterThan(13.5);
      expect(minutesLeft).toBeLessThan(15.5);
      expect(row!.failed_login_count).toBe(8);

      // ...and it ends: rewind the lock, the right password works and the counters reset
      await prisma.user.update({ where: { id }, data: { locked_until: new Date(Date.now() - 1000) } });
      expect((await shortHashLogin(email, password)).status).toBe(201);
      const after = await prisma.user.findUnique({ where: { id } });
      expect(after!.failed_login_count).toBe(0);
      expect(after!.locked_until).toBeNull();
    }, 120000);
  }

  it('the failure window is 15 minutes, not 15 minutes plus or minus the zone offset', async () => {
    process.env.DATABASE_URL = withOptions('America/New_York');
    app = await createTestApp();
    const prisma = getPrisma(app);
    const { email, id } = await makeAccount(prisma, 'Correct-Horse-Battery-9');
    await shortHashLogin(email, 'wrong-password-1');
    await shortHashLogin(email, 'wrong-password-2');
    expect((await prisma.user.findUnique({ where: { id } }))!.failed_login_count).toBe(2);
    // the last failure recorded just now must be "now" in UTC terms (within a few seconds), not shifted by hours
    const last = (await prisma.user.findUnique({ where: { id } }))!.last_failed_login_at!;
    expect(Math.abs(last.getTime() - Date.now())).toBeLessThan(10000);
    // a failure older than 15 minutes starts a new count
    await prisma.user.update({ where: { id }, data: { last_failed_login_at: new Date(Date.now() - 16 * 60000) } });
    await shortHashLogin(email, 'wrong-password-3');
    expect((await prisma.user.findUnique({ where: { id } }))!.failed_login_count).toBe(1);
  }, 120000);
});
