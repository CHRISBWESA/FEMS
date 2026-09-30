import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { addToDepartment, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser } from './harness';
import { Seeded, seedEverything } from './seed-all';
import { fuzzableRoutes, harvestKeys, ID_LABEL, LEAK, listRoutes, paramNames, randomIds, semiValid } from './fuzz-util';

// Phase 22 - request fuzzing. The other sweeps attack with foreign IDs. This one attacks with foreign SHAPES: every
// route is called with wrong types, nulls, oversized values, NUL bytes, prototype-pollution keys, query-string arrays and
// half-valid bodies that carry real IDs (so the request gets past the 404 and into the business logic). The rule is
// simple: nothing a client sends may produce a 5xx or leak an internal, and nothing may hang.
describeDb('Phase 22 - request fuzzing of every route (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let F: any, D: any;
  let seeded: Seeded[];
  const who: Record<string, any> = {};

  const KEYS = harvestKeys();
  const realId = (label: string) => seeded.find((x) => x.label === label)?.id ?? randomUUID();
  const semiValidKey = (key: string, real: boolean) => semiValid(key, real ? realId : randomIds);
  const allKeys = (f: (k: string) => any) => Object.fromEntries(KEYS.body.map((k) => [k, f(k)]));

  // built after the seed exists (the half-valid variants carry real ids)
  const makeBodies = (): { name: string; body: any; raw?: string }[] => [
    { name: 'empty', body: {} },
    { name: 'null', body: allKeys(() => null) },
    { name: 'number', body: allKeys(() => 12345) },
    { name: 'negative', body: allKeys(() => -1) },
    { name: 'huge-int', body: allKeys(() => 9007199254740993) },
    { name: 'long-string', body: allKeys(() => 'x'.repeat(400)) }, // 195 fields x 400 = ~78 KB: under the 100 KB body limit, so it reaches the handlers (5000 each was refused with 413 before any code ran)
    { name: 'boolean', body: allKeys(() => true) },
    { name: 'empty-array', body: allKeys(() => []) },
    { name: 'nested-object', body: allKeys(() => ({ a: { b: { c: {} } } })) },
    { name: 'string-array', body: allKeys(() => ['a', 'b']) },
    { name: 'empty-string', body: allKeys(() => '') },
    { name: 'sql-ish', body: allKeys(() => "' OR 1=1; -- ") },
    { name: 'nul-byte', body: allKeys(() => 'a\u0000b') },
    { name: 'bad-date', body: allKeys(() => '2020-13-45') },
    { name: 'not-uuid', body: allKeys(() => 'not-a-uuid') },
    { name: 'semi-valid', body: allKeys((k) => semiValidKey(k, true)) },
    { name: 'semi-valid-foreign-ids', body: allKeys((k) => semiValidKey(k, false)) },
    { name: 'prototype-pollution', body: JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}') },
    { name: 'array-body', body: [1, 2, 3] },
    { name: 'string-body', body: null, raw: '"just a string"' },
  ];
  let BODIES: ReturnType<typeof makeBodies> = [];
  // the lighter set used for the less privileged personas
  const LIGHT = ['null', 'number', 'semi-valid', 'nul-byte', 'string-array', 'nested-object'];

  const q = (o: Record<string, string>) => '?' + Object.entries(o).map(([k, v]) => `${k}=${v}`).join('&');
  const makeQueries = (): { name: string; qs: string }[] => [
    { name: 'negative', qs: q(Object.fromEntries(KEYS.query.map((k) => [k, '-1']))) },
    { name: 'text', qs: q(Object.fromEntries(KEYS.query.map((k) => [k, 'abc']))) },
    { name: 'quote', qs: q(Object.fromEntries(KEYS.query.map((k) => [k, "%27%20OR%201%3D1"]))) },
    { name: 'nul-byte', qs: q(Object.fromEntries(KEYS.query.map((k) => [k, 'a%00b']))) },
    { name: 'huge-numbers', qs: '?limit=999999999&page=999999999&days=99999999&months=99999999&year=99999' },
    { name: 'zero', qs: '?limit=0&page=0&days=0&months=0' },
    { name: 'array-and-object-shapes', qs: q({ ...Object.fromEntries(KEYS.query.map((k) => [`${k}[]`, 'a'])), ...Object.fromEntries(KEYS.query.map((k) => [`${k}[$ne]`, '1'])) }) },
    { name: 'repeated', qs: '?' + KEYS.query.map((k) => `${k}=a&${k}=b`).join('&') },
    { name: 'semi-valid', qs: q(Object.fromEntries(KEYS.query.map((k) => [k, /Id$/.test(k) ? realId(ID_LABEL[k.replace(/Id$/, '')] ?? 'member') : /^(from|to|asOf|joinedFrom|joinedTo)$/.test(k) ? '2026-01-01' : /^(limit|page|days|months|year)$/.test(k) ? '5' : 'active']))) },
  ];

  let QUERIES: ReturnType<typeof makeQueries> = [];

  // ---- routes ----
  const routes = () => listRoutes(app);
  const fuzzable = () => fuzzableRoutes(app);

  // ---- one request ----
  const stats: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, error: 0 };
  const failures = new Map<string, string>();
  const send = async (token: string | null, method: string, url: string, opts: { body?: any; raw?: string; qs?: string } = {}) => {
    let t: request.Test = (request(app.getHttpServer()) as any)[method.toLowerCase()](`/api/v1${url}${opts.qs ?? ''}`).timeout(30000);
    if (token) t = t.set('Authorization', `Bearer ${token}`);
    if (method !== 'GET') t = opts.raw !== undefined ? t.set('Content-Type', 'application/json').send(opts.raw) : t.send(opts.body ?? {});
    return t;
  };
  const check = async (label: string, token: string | null, r: { method: string; path: string }, url: string, opts: { body?: any; raw?: string; qs?: string }) => {
    let status = 0;
    try {
      const res = await send(token, r.method, url, opts);
      status = res.status;
      stats[`${Math.floor(status / 100)}xx`] = (stats[`${Math.floor(status / 100)}xx`] ?? 0) + 1;
      const leaked = typeof res.text === 'string' && LEAK.test(res.text);
      if (status >= 500 || leaked) failures.set(`${r.method} ${r.path} [${label}] -> ${status}${leaked ? ' LEAK' : ''}`, String(res.text).slice(0, 160));
    } catch (e: any) {
      stats.error++;
      failures.set(`${r.method} ${r.path} -> ${e.code || e.message}`, label);
    }
    return status;
  };

  // Which seeded ids make a route reach real code? Probed once per route as the secretary.
  const hitIds = new Map<string, string[]>();
  const urlFor = (routePath: string, id: string, foreign = false) =>
    routePath.replace('/api/v1', '').replace(/:([A-Za-z]+)/g, (_m, n: string) => {
      if (foreign) return randomUUID();
      const label = ID_LABEL[n.replace(/Id$/, '')];
      return n !== 'id' && label ? realId(label) : id;
    });

  beforeAll(async () => {
    process.env.BILLING_WEBHOOK_SECRET = 'fuzz-webhook-secret-long-enough-0123456789abcdef'; // so the signature path is the one being fuzzed
    app = await createTestApp();
    prisma = getPrisma(app);
    F = await makeFellowship(prisma, 'FZ');
    D = await makeDepartment(prisma, F.id, 'FZD');
    const s = await seedEverything(prisma, F, D);
    seeded = s.seeded;
    who.secretary = await makeUser(prisma, { fellowshipId: F.id, roles: ['secretary'] });
    who.treasurer = await makeUser(prisma, { fellowshipId: F.id, roles: ['treasurer'] });
    who.deptSecretary = await makeUser(prisma, { fellowshipId: F.id, roles: ['department_secretary'], departmentId: D.id });
    who.ordinary = await makeUser(prisma, { fellowshipId: F.id, roles: ['ordinary_member'] });
    who.admin = await makeUser(prisma, { fellowshipId: null, roles: ['admin'] });
    who.support = await makeUser(prisma, { fellowshipId: null, roles: ['platform_support'] });
    const extra = await makeMember(prisma, { fellowshipId: F.id, name: 'Second Person' });
    await addToDepartment(prisma, extra.id, D.id);
    seeded.push({ label: 'member', id: extra.id });
    BODIES = makeBodies();
    QUERIES = makeQueries();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('the harvest found the field names and the seed covers a wide spread of entities', () => {
    expect(KEYS.body.length).toBeGreaterThan(100);
    expect(KEYS.query.length).toBeGreaterThan(25);
    expect(seeded.length).toBeGreaterThanOrEqual(24);
    expect(fuzzable().length).toBeGreaterThan(150);
  });

  it('with no token every route is refused (401) - only the deliberately public ones answer', async () => {
    const PUBLIC = [
      'POST /api/v1/activities/attendance',
      // The public sites. These are @Public() BY DESIGN - a landing page is meant to be readable by anybody who
      // can reach the internet - so answering without a token is correct here, not a hole. What must hold is that
      // they reveal nothing: they take a subdomain rather than a record id, and a fellowship only resolves once it
      // has published. The other suite, security.int-spec.ts, checks what a token cannot cross; public-site
      // isolation of actual content is asserted in public-site-isolation.int-spec.ts.
      'GET /api/v1/public/fellowships/:subdomain',
      'GET /api/v1/public/fellowships/:subdomain/pages/:key',
      'GET /api/v1/public/fellowships/:subdomain/leadership',
      'GET /api/v1/public/fellowships/:subdomain/departments',
      'GET /api/v1/public/fellowships/:subdomain/ministries',
      'GET /api/v1/public/fellowships/:subdomain/events',
      'GET /api/v1/public/fellowships/:subdomain/news',
      'GET /api/v1/public/fellowships/:subdomain/publications',
      'GET /api/v1/public/fellowships/:subdomain/gallery',
      'GET /api/v1/public/fellowships/:subdomain/gallery/photos',
      'GET /api/v1/public/fellowships/:subdomain/sermons',
      'GET /api/v1/public/fellowships/:subdomain/testimonies',
      'GET /api/v1/public/fellowships/:subdomain/projects',
      'GET /api/v1/public/fellowships/:subdomain/get-involved',
      'GET /api/v1/public/fellowships/:subdomain/giving',
      'GET /api/v1/public/site/stats',
      'GET /api/v1/public/site/plans',
      'GET /api/v1/registrations/plans',
    ];
    // The three public forms, plus signup, are the only unauthenticated WRITES in the system. They answer 201/400,
    // not 401, for the same design reason.
    const PUBLIC_WRITES = [
      'POST /api/v1/public/fellowships/:subdomain/prayer-requests',
      'POST /api/v1/public/fellowships/:subdomain/contact',
      'POST /api/v1/public/fellowships/:subdomain/donations',
      'POST /api/v1/registrations',
    ];
    const bad: string[] = [];
    for (const r of routes().filter((x) => !['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready'].includes(x.path) && !x.path.startsWith('/api/v1/billing/webhooks'))) {
      if (PUBLIC.includes(`${r.method} ${r.path}`) || PUBLIC_WRITES.includes(`${r.method} ${r.path}`) || !['GET', 'POST', 'PUT', 'DELETE'].includes(r.method)) continue;
      const res = await send(null, r.method, urlFor(r.path, randomUUID()));
      // 410 Gone: the retired impersonation routes answer the same to everybody and touch nothing.
      const retired = /\/auth\/(approve-)?impersonat/.test(r.path) && res.status === 410;
      if (res.status !== 401 && !retired) bad.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 300000);

  it('forged, expired and unsigned tokens are refused on every kind of route', async () => {
    const owner = who.secretary;
    const payload = { sub: owner.id, email: owner.email, roles: ['secretary'], permissions: [] };
    const tokens: Record<string, string> = {
      garbage: 'not.a.token',
      'wrong-secret': jwt.sign(payload, 'some-other-secret', { expiresIn: '1h' }),
      expired: jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: -60 }),
      'alg-none': `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.`,
      'refresh-as-access': jwt.sign({ sub: owner.id, tokenType: 'refresh' }, process.env.JWT_SECRET as string, { expiresIn: '1h' }),
      'unknown-user': jwt.sign({ ...payload, sub: randomUUID() }, process.env.JWT_SECRET as string, { expiresIn: '1h' }),
      'wrong-token-version': jwt.sign({ ...payload, tv: 99 }, process.env.JWT_SECRET as string, { expiresIn: '1h' }),
    };
    const bad: string[] = [];
    for (const [kind, token] of Object.entries(tokens)) {
      for (const url of ['/profile', '/members', '/finance/summary', '/users', '/dashboard/summary']) {
        const res = await send(token, 'GET', url);
        // A 404 for a path that does not exist is fine; what must never happen is a 2xx or a 5xx.
        if (res.status !== 401 && res.status !== 404) bad.push(`${kind} ${url} -> ${res.status}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('probe: find the seeded ids that make each id-taking route reach real code', async () => {
    let reached = 0;
    const list = fuzzable().filter((r) => /:/.test(r.path));
    for (const r of list) {
      const hits: string[] = [];
      if (paramNames(r.path).every((n) => n !== 'id' && ID_LABEL[n.replace(/Id$/, '')])) {
        hits.push('named');
      } else {
        for (const s of seeded) {
          const res = await send(who.secretary.token, r.method, urlFor(r.path, s.id), { body: BODIES.find((b) => b.name === 'semi-valid')!.body });
          if (res.status !== 404 && res.status < 500) hits.push(s.id);
          if (hits.length >= 3) break;
        }
      }
      hitIds.set(`${r.method} ${r.path}`, hits);
      if (hits.length) reached++;
    }
    console.log(`[fuzz] ${reached}/${list.length} id-taking routes reached handler code with a real id`);
    expect(reached / list.length).toBeGreaterThan(0.6);
  }, 600000);

  const fuzzAs = async (persona: string, bodyNames: string[] | null, queryNames: string[] | null) => {
    const token = who[persona].token;
    for (const r of fuzzable()) {
      const ids = /:/.test(r.path) ? (hitIds.get(`${r.method} ${r.path}`) ?? []) : ['-'];
      const use = ids.length ? ids : [seeded[0].id];
      for (const id of use) {
        const url = urlFor(r.path, id === 'named' || id === '-' ? seeded[0].id : id);
        if (r.method === 'GET') {
          for (const v of QUERIES.filter((x) => !queryNames || queryNames.includes(x.name))) await check(`${persona} query:${v.name}`, token, r, url, { qs: v.qs });
        } else {
          for (const v of BODIES.filter((x) => !bodyNames || bodyNames.includes(x.name))) await check(`${persona} body:${v.name}`, token, r, url, { body: v.body, raw: v.raw });
          for (const v of QUERIES.filter((x) => ['array-and-object-shapes', 'nul-byte'].includes(x.name))) await check(`${persona} query:${v.name}`, token, r, url, { qs: v.qs, body: BODIES.find((b) => b.name === 'semi-valid')!.body });
        }
      }
      // ids of the wrong kind or from nowhere never reach an unhandled error either
      if (/:/.test(r.path)) await check(`${persona} foreign-ids`, token, r, urlFor(r.path, '', true), { body: BODIES.find((b) => b.name === 'semi-valid-foreign-ids')!.body });
    }
  };

  // FUZZ_ONLY=secretary,admin narrows the personas while investigating a failure.
  const ONLY = (process.env.FUZZ_ONLY || '').split(',').filter(Boolean);
  const enabled = (persona: string) => ONLY.length === 0 || ONLY.includes(persona);

  (enabled('secretary') ? it : it.skip)('secretary: every GET survives hostile query strings and every POST/PUT survives hostile bodies', async () => {
    await fuzzAs('secretary', null, null);
    expect([...failures].map(([k, v]) => `${k}   <= ${v}`)).toEqual([]);
  }, 1800000);

  it.each(['treasurer', 'deptSecretary', 'ordinary', 'admin', 'support'].filter(enabled))('%s: the same, with the lighter set of hostile inputs', async (persona) => {
    failures.clear();
    await fuzzAs(persona, LIGHT, ['negative', 'nul-byte', 'array-and-object-shapes', 'semi-valid']);
    expect([...failures].map(([k, v]) => `${k}   <= ${v}`)).toEqual([]);
  }, 1800000);

  it('the sign-in and password routes survive hostile bodies too (clean 4xx, never 5xx or a leak)', async () => {
    failures.clear();
    const authRoutes = routes().filter((r) => r.path.startsWith('/api/v1/auth') && r.method === 'POST' && !/logout/.test(r.path));
    expect(authRoutes.length).toBeGreaterThanOrEqual(3);
    const fresh = await makeUser(prisma, { fellowshipId: F.id, roles: ['ordinary_member'] }); // may be re-keyed by change-password
    for (const r of authRoutes) {
      for (const v of BODIES) {
        await check(`anon body:${v.name}`, null, r, r.path.replace('/api/v1', ''), { body: v.body, raw: v.raw });
        await check(`user body:${v.name}`, fresh.token, r, r.path.replace('/api/v1', ''), { body: v.body, raw: v.raw });
      }
      for (const body of [{ email: ['a@b.c'], password: 'x' }, { email: { $ne: null }, password: { $ne: null } }, { email: 'a@b.c', password: ['x'] }, { refreshToken: { a: 1 } }, { refreshToken: 12345 }, { oldPassword: [], newPassword: {} }]) {
        await check('anon typed-body', null, r, r.path.replace('/api/v1', ''), { body });
      }
    }
    expect([...failures].map(([k, v]) => `${k}   <= ${v}`)).toEqual([]);
  }, 300000);

  it('the billing webhook refuses hostile and unsigned bodies without a 5xx', async () => {
    failures.clear();
    const r = { method: 'POST', path: '/api/v1/billing/webhooks/:provider' };
    for (const provider of ['signed', 'nope', '%00', 'a'.repeat(300)]) {
      for (const v of BODIES) await check(`webhook ${provider} body:${v.name}`, null, r, `/billing/webhooks/${provider}`, { body: v.body, raw: v.raw });
      await check(`webhook ${provider} bad-signature`, null, r, `/billing/webhooks/${provider}`, { body: { id: 'x' } });
    }
    expect([...failures].map(([k, v]) => `${k}   <= ${v}`)).toEqual([]);
  }, 120000);

  it('nothing polluted the prototype chain, and the run reached both success and failure paths', () => {
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    console.log(`[fuzz] responses: ${JSON.stringify(stats)}`);
    expect(stats['5xx']).toBe(0);
    expect(stats.error).toBe(0);
    expect(stats['2xx']).toBeGreaterThan(100); // the hostile inputs did get through validation sometimes: real code paths ran
    expect(stats['4xx']).toBeGreaterThan(1000);
  });
});
