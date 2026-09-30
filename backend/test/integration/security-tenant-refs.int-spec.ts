import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { addToDepartment, createTestApp, describeDb, getPrisma, makeDepartment, makeFellowship, makeMember, makeUser } from './harness';
import { Seeded, seedEverything } from './seed-all';
import { fuzzableRoutes, harvestKeys, ID_LABEL, paramNames, semiValid } from './fuzz-util';

// Phase 22 - cross-tenant references. The earlier sweeps put another fellowship's ids in the URL path. This one puts them
// EVERYWHERE else a client controls: every field of every body, every query parameter, on every route, while the path
// carries the caller's own ids so the request reaches the business logic. The victim fellowship G is a canary; after the
// attack nothing of G may have changed, and nothing belonging to the attacker F may point at G.
describeDb('Phase 22 - cross-tenant references in bodies and query strings (real Postgres, full HTTP stack)', () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof getPrisma>;
  let F: any, G: any, DF: any, DG: any;
  let seedF: Seeded[], seedG: Seeded[];
  const who: Record<string, any> = {};
  const KEYS = harvestKeys();

  const idIn = (seed: Seeded[]) => (label: string) => seed.find((s) => s.label === label)?.id ?? randomUUID();
  const gId = (label: string) => idIn(seedG)(label);
  const fId = (label: string) => idIn(seedF)(label);

  const MODEL: Record<string, string> = {
    member: 'member', user: 'user', department: 'department', activity: 'activity', fellowship: 'fellowship', attendance: 'attendance',
    notification: 'notification', report: 'report', document: 'documentEntity', 'deleted-record': 'deletedRecord', youth: 'youthProfile',
    'age-group': 'ageGroup', 'asset-category': 'assetCategory', 'asset-location': 'assetLocation', asset: 'asset', opportunity: 'serviceOpportunity',
    shift: 'serviceShift', assignment: 'serviceAssignment', 'service-role': 'serviceRole', 'member-group': 'memberGroup', campaign: 'contributionCampaign',
    'finance-category': 'financeCategory', contribution: 'contribution', expense: 'expense', 'financial-period': 'financialPeriod', income: 'incomeRecord',
    budget: 'budget', 'money-request': 'moneyRequest', 'support-grant': 'supportAccessGrant', 'audit-entity': 'auditLog',
  };
  const fingerprint = async () => {
    const out: Record<string, string> = {};
    for (const s of seedG) {
      const row = await (prisma as any)[MODEL[s.label]].findUnique({ where: { id: s.id } });
      out[`${s.label}:${s.id}`] = JSON.stringify(row);
    }
    return out;
  };
  const tenantTables = async (): Promise<string[]> =>
    (await prisma.$queryRawUnsafe<{ table_name: string }[]>(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'fellowship_id'`)).map((r) => r.table_name);
  const rowsPerTable = async (tables: string[], fellowshipId: string) => {
    const out: Record<string, number> = {};
    for (const t of tables) out[t] = Number((await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM "${t}" WHERE fellowship_id = $1::uuid`, fellowshipId))[0].c);
    return out;
  };
  // Rows that belong to the attacker but hold one of the victim's ids in any uuid column.
  const referencesToG = async (tables: string[], ids: string[]) => {
    const found: string[] = [];
    for (const t of tables) {
      const cols = (await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'uuid' AND column_name NOT IN ('id', 'fellowship_id')`, t)).map((c) => c.column_name);
      for (const c of cols) {
        const n = Number((await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*) AS c FROM "${t}" WHERE fellowship_id = $1::uuid AND "${c}" = ANY($2::uuid[])`, F.id, ids))[0].c);
        if (n > 0) found.push(`${t}.${c} x${n}`);
      }
    }
    return found;
  };

  const failures = new Map<string, string>();
  const stats = { requests: 0, ok: 0 };
  const send = async (token: string, method: string, url: string, body: any, qs = '') => {
    let t: request.Test = (request(app.getHttpServer()) as any)[method.toLowerCase()](`/api/v1${url}${qs}`).timeout(30000).set('Authorization', `Bearer ${token}`);
    if (method !== 'GET') t = t.send(body ?? {});
    return t;
  };
  const allG = () => [...seedG.map((s) => s.id), ...Object.values(who).filter((u: any) => u.g).map((u: any) => u.id)];
  const urlWith = (routePath: string, idOf: (label: string) => string, unnamed: string) =>
    routePath.replace('/api/v1', '').replace(/:([A-Za-z]+)/g, (_m, n: string) => {
      const label = ID_LABEL[n.replace(/Id$/, '')];
      return n !== 'id' && label ? idOf(label) : unnamed;
    });
  const bodyWith = (idOf: (label: string) => string) => Object.fromEntries(KEYS.body.map((k) => [k, semiValid(k, idOf)]));
  const queryWith = (idOf: (label: string) => string) =>
    '?' + KEYS.query.map((k) => `${k}=${/Id$/.test(k) ? idOf(ID_LABEL[k.replace(/Id$/, '')] ?? 'member') : /^(from|to|asOf|joinedFrom|joinedTo)$/.test(k) ? '2026-01-01' : /^(limit|page|days|months|year)$/.test(k) ? '5' : 'active'}`).join('&');

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    F = await makeFellowship(prisma, 'TRF');
    G = await makeFellowship(prisma, 'TRG');
    DF = await makeDepartment(prisma, F.id, 'TRFD');
    DG = await makeDepartment(prisma, G.id, 'TRGD');
    seedF = (await seedEverything(prisma, F, DF)).seeded;
    const g = await seedEverything(prisma, G, DG);
    seedG = g.seeded;
    who.secretary = await makeUser(prisma, { fellowshipId: F.id, roles: ['secretary'] });
    who.treasurer = await makeUser(prisma, { fellowshipId: F.id, roles: ['treasurer'] });
    who.chairperson = await makeUser(prisma, { fellowshipId: F.id, roles: ['chairperson'] });
    who.deptSecretary = await makeUser(prisma, { fellowshipId: F.id, roles: ['department_secretary'], departmentId: DF.id });
    who.ordinary = await makeUser(prisma, { fellowshipId: F.id, roles: ['ordinary_member'] });
    const extra = await makeMember(prisma, { fellowshipId: F.id, name: 'Second F Person' });
    await addToDepartment(prisma, extra.id, DF.id);
    seedF.push({ label: 'member', id: extra.id });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('attacker fellowship F cannot read, change or attach anything of victim fellowship G through any field of any request', async () => {
    const tables = await tenantTables();
    const before = await fingerprint();
    const countsBefore = await rowsPerTable(tables, G.id);
    const gIds = allG();
    const leaked = new Set(gIds);
    // The public check-in link is open to anyone by design (anyone holding the link may check in to THAT activity, in the
    // activity's own fellowship, around the event) - it is covered by its own tests, not by "attacker vs victim".
    const routes = fuzzableRoutes(app).filter((r) => !(r.method === 'POST' && r.path === '/api/v1/activities/attendance'));
    expect(routes.length).toBeGreaterThan(150);

    const attack = async (persona: string, r: { method: string; path: string }, label: string, url: string, body: any, qs: string) => {
      stats.requests++;
      try {
        const res = await send(who[persona].token, r.method, url, body, qs);
        if (res.status < 300) stats.ok++;
        // ids the caller supplied and the server merely lists as refused are not data of the victim
        const text = String(res.text ?? '').replace(/"rejected":\[[^\]]*\]/g, '');
        const hit = [...leaked].find((id) => text.includes(id));
        // A 2xx that echoes one of G's ids back is data of G handed to (or attached by) the attacker.
        if (res.status < 300 && hit) failures.set(`${persona} ${r.method} ${r.path} [${label}] -> ${res.status} echoes a foreign id`, text.slice(0, 200));
        if (res.status >= 500) failures.set(`${persona} ${r.method} ${r.path} [${label}] -> ${res.status}`, text.slice(0, 160));
      } catch (e: any) {
        failures.set(`${persona} ${r.method} ${r.path} [${label}] -> ${e.code || e.message}`, '');
      }
    };

    for (const persona of Object.keys(who)) {
      for (const r of routes) {
        const own = paramNames(r.path).length ? seedF.map((s) => s.id).slice(0, 6) : ['-'];
        for (const ownId of own) {
          // (1) the path carries F's own ids; every body field / query parameter carries G's
          await attack(persona, r, 'foreign-refs-in-body', urlWith(r.path, fId, ownId), bodyWith(gId), r.method === 'GET' ? queryWith(gId) : '');
          if (r.method !== 'GET') await attack(persona, r, 'foreign-refs-in-query', urlWith(r.path, fId, ownId), bodyWith(fId), queryWith(gId));
        }
        // (2) the path carries G's ids, the body carries F's
        if (paramNames(r.path).length) {
          for (const s of seedG) await attack(persona, r, `path:${s.label}`, urlWith(r.path, gId, s.id), bodyWith(fId), '');
        }
      }
    }

    // ---- invariants ----
    const after = await fingerprint();
    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    const countsAfter = await rowsPerTable(tables, G.id);
    const grew = Object.keys(countsBefore).filter((t) => countsBefore[t] !== countsAfter[t]).map((t) => `${t}: ${countsBefore[t]} -> ${countsAfter[t]}`);
    const refs = await referencesToG(tables, gIds);
    console.log(`[tenant-refs] ${stats.requests} requests, ${stats.ok} answered 2xx`);

    expect({
      changed, // nothing of G was modified
      grew, // nothing was created inside or removed from G
      refs, // nothing of F points at G
      failures: [...failures].map(([k, v]) => `${k}   <= ${v}`), // no 5xx, no foreign id echoed in a 2xx
    }).toEqual({ changed: [], grew: [], refs: [], failures: [] });
  }, 3600000);
});
