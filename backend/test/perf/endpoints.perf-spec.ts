/**
 * Endpoint timing benchmark (not part of the normal test run).
 *
 * Seeds one realistic fellowship, then calls the endpoints the main pages load and prints, for each one, the
 * server time and the number of database queries it ran (both read from the Server-Timing header).
 *
 *   TEST_DATABASE_URL=postgresql://.../fems_scratch npm run perf:endpoints
 *
 * Uses the same safety guard as the integration tests: the database name must contain "test" or "scratch".
 */
import { randomUUID } from 'crypto';
import { api, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeUser, uniq, type TestApp } from '../integration/harness';

jest.setTimeout(600_000);

// The requests each page sends when it opens, as the browser sends them. "(before)" rows are the request set the
// page used before the performance work, so both versions can be timed on the same code.
const PAGES: Record<string, string[]> = {
  'app start (before)': ['/profile', '/profile', '/notifications/unread-count'],
  'app start': ['/profile', '/notifications/unread-count'],
  'dashboard (before)': ['/dashboard', '/profile'],
  dashboard: ['/dashboard'],
  members: ['/members?page=1&limit=25', '/members/reports/summary', '/departments'],
  'member groups': ['/member-groups'],
  departments: ['/departments'],
  'leadership (before)': ['/leadership/appointments?tab=current&page=1&limit=25', '/leadership/positions', '/leadership/appointments?tab=current&status=active&limit=200', '/leadership/appointments?tab=current&status=suspended&limit=1', '/leadership/appointments?tab=history&limit=1', '/leadership/scopes'],
  leadership: ['/leadership/appointments?tab=current&page=1&limit=25', '/leadership/positions', '/leadership/summary', '/leadership/scopes'],
  finance: ['/finance/categories', '/projects', '/finance/settings', '/finance/fundable-projects'],
  resources: ['/inventory/dashboard'],
  notifications: ['/notifications'],
};

function timing(header: string | undefined) {
  const app = /app;dur=(\d+)/.exec(header ?? '');
  const db = /db;dur=(\d+);desc="(\d+) queries"/.exec(header ?? '');
  return { app: app ? Number(app[1]) : NaN, dbMs: db ? Number(db[1]) : 0, queries: db ? Number(db[2]) : 0 };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describeDb('endpoint timings', () => {
  let app: TestApp;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    try {
      await seed();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('seeding failed', e);
      throw e;
    }
  });

  async function seed() {
    app = await createTestApp();
    const prisma = getPrisma(app);
    const f = await makeFellowship(prisma, 'Perf');
    const depts = await Promise.all([1, 2, 3, 4, 5].map((i) => makeDepartment(prisma, f.id, `PerfDept${i}`)));
    const now = Date.now();
    await prisma.member.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        member_code: `P${uniq()}${i}`,
        full_name: `Perf Member ${i}`,
        membership_status: i % 10 === 0 ? 'inactive' : 'active',
        expected_graduation_year: 2030,
        expected_graduation_month: 6,
        gender: i % 2 ? 'male' : 'female',
        created_by: randomUUID(),
        fellowship_id: f.id,
        created_at: new Date(now - i * 86_400_000),
      })) as any,
    });
    const members = await prisma.member.findMany({ where: { fellowship_id: f.id }, select: { id: true } });
    await prisma.departmentMember.createMany({ data: members.map((m, i) => ({ member_id: m.id, department_id: depts[i % depts.length].id })) });
    for (const role of ['secretary', 'treasurer', 'chairperson']) {
      tokens[role] = (await makeUser(prisma, { fellowshipId: f.id, roles: [role] })).token;
    }
  }

  afterAll(async () => {
    await (app as any)?.close?.();
  });

  it('prints per-endpoint server time and query counts', async () => {
    const rows: string[] = [];
    for (const [page, urls] of Object.entries(PAGES)) {
      const role = page === 'finance' || page === 'resources' ? 'treasurer' : 'secretary';
      if (page.endsWith('(before)')) continue; // its endpoints are timed in the other rows
      for (const url of new Set(urls)) {
        const samples: ReturnType<typeof timing>[] = [];
        let status = 0;
        for (let i = 0; i < 3; i++) {
          const res = await api(app, tokens[role]).get(url);
          status = res.status;
          samples.push(timing(res.headers['server-timing']));
        }
        rows.push(`${page.padEnd(14)} ${url.padEnd(44)} ${String(status).padEnd(4)} ${String(median(samples.map((s) => s.app))).padStart(6)}ms  ${String(median(samples.map((s) => s.queries))).padStart(4)} queries  ${String(median(samples.map((s) => s.dbMs))).padStart(6)}ms db`);
      }
    }
    // A page fires its requests together: this is what the person actually waits for.
    const bursts: string[] = [];
    for (const [page, urls] of Object.entries(PAGES)) {
      const role = page === 'finance' || page === 'resources' ? 'treasurer' : 'secretary';
      // Median of 3 page loads, after one warm-up load.
      await Promise.all(urls.map((u) => api(app, tokens[role]).get(u)));
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        await Promise.all(urls.map((u) => api(app, tokens[role]).get(u)));
        times.push(Date.now() - t0);
      }
      bursts.push(`${page.padEnd(20)} ${String(urls.length).padStart(2)} requests  ${String(median(times)).padStart(6)}ms`);
    }
    // eslint-disable-next-line no-console
    console.log(`\nPER ENDPOINT (median of 3)\n${rows.join('\n')}\n\nPAGE LOAD (a page's requests sent together, median of 3)\n${bursts.join('\n')}\n`);
  });
});
