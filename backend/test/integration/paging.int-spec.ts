import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { api, createTestApp, describeDb, getPrisma, makeActivity, makeFellowship, makeUser, uniq } from './harness';

describeDb('Phase 22 - bounded lists (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let f: any, other: any, sec: any, otherSec: any;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    f = await makeFellowship(prisma, 'PG');
    other = await makeFellowship(prisma, 'PGO');
    sec = await makeUser(prisma, { fellowshipId: f.id, roles: ['secretary'] });
    otherSec = await makeUser(prisma, { fellowshipId: other.id, roles: ['secretary'] });
    for (let i = 0; i < 25; i++) await prisma.activity.create({ data: { title: `Event ${String(i).padStart(2, '0')}`, date: new Date(Date.UTC(2026, 0, 1 + i)), audience_type: 'all_members', fellowship_id: f.id, created_by: randomUUID() } });
    await makeActivity(prisma, { fellowshipId: other.id, title: 'Someone else' });
    for (let i = 0; i < 12; i++) await prisma.youthProfile.create({ data: { fellowship_id: f.id, full_name: `Youth ${String.fromCharCode(65 + i)}${uniq()}`, date_of_birth: new Date('2012-05-05'), created_by: sec.id } });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('a short list is returned whole, as a plain array, with its total in X-Total-Count', async () => {
    const r = await api(app, sec.token).get('/activities');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(25);
    expect(r.headers['x-total-count']).toBe('25');
    expect(r.body[0].title).toBe('Event 24'); // newest first, as before
    expect(JSON.stringify(r.body)).not.toContain('Someone else');
  });

  it('?limit and ?page walk through the list without gaps or repeats', async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = await api(app, sec.token).get(`/activities?limit=10&page=${page}`);
      expect(r.status).toBe(200);
      expect(r.headers['x-total-count']).toBe('25');
      seen.push(...r.body.map((a: any) => a.title));
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect((await api(app, sec.token).get('/activities?limit=10&page=4')).body).toEqual([]);
  });

  it('nonsense and oversized values fall back to safe ones instead of failing', async () => {
    for (const q of ['limit=abc', 'limit=-3', 'limit=0', 'page=zzz', 'page=-1', 'limit=99999999']) {
      const r = await api(app, sec.token).get(`/activities?${q}`);
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(25);
    }
    expect((await api(app, sec.token).get('/activities?page=99999999999&limit=1000')).status).toBe(200); // no integer overflow
  });

  it('the same for youth records and department reports, and each caller only ever sees their own fellowship', async () => {
    const y = await api(app, sec.token).get('/youth?limit=5&page=3');
    expect(y.status).toBe(200);
    expect(y.body).toHaveLength(2);
    expect(y.headers['x-total-count']).toBe('12');
    const all = await api(app, sec.token).get('/youth');
    expect(all.body).toHaveLength(12);
    const names = all.body.map((p: any) => p.full_name ?? p.fullName);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b))); // still alphabetical
    expect((await api(app, otherSec.token).get('/youth')).headers['x-total-count']).toBe('0');
    const rp = await api(app, sec.token).get('/reports?limit=5');
    expect(rp.status).toBe(200);
    expect(rp.headers['x-total-count']).toBeDefined();
  });
});
