#!/usr/bin/env node
/*
 * Release load check for the FEMS API: read-only GET requests at a fixed concurrency, with latency percentiles.
 * Run it against STAGING (or a production-sized copy), not against a production system people are using.
 *
 *   BASE_URL=https://staging-api.example.org/api/v1 \
 *   LOAD_EMAIL=... LOAD_PASSWORD=... \
 *   [LOAD_CONCURRENCY=10] [LOAD_REQUESTS=200] [LOAD_P95_MS=1000] [LOAD_PATHS=/members?limit=50,/activities] \
 *   node scripts/load-check.js
 *
 * The API rate-limits per client address (RATE_LIMIT_MAX per RATE_LIMIT_WINDOW_MS, default 600/minute). A load test from
 * one machine will hit that limit; 429 answers are counted separately and left out of the latency figures. To measure
 * the application rather than the limiter, raise RATE_LIMIT_MAX on the environment under test.
 *
 * Exit code: 0 = every endpoint had no server errors and p95 under the threshold, 1 = otherwise, 2 = could not run.
 * Requires Node 18+ (global fetch). No dependencies.
 */
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '');
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 10);
const REQUESTS = Number(process.env.LOAD_REQUESTS || 200);
const P95_LIMIT = Number(process.env.LOAD_P95_MS || 1000);
const PATHS = (process.env.LOAD_PATHS ||
  ['/profile', '/dashboard', '/notifications', '/members?limit=50', '/members?limit=50&search=Member', '/activities', '/departments', '/youth', '/finance/contributions',
    '/finance/reports/summary', '/members/reports/summary', '/analytics/overview', '/analytics/participation', '/analytics/finance', '/resources/assets', '/volunteers/opportunities'].join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);

if (!BASE || typeof fetch !== 'function') {
  console.error('Set BASE_URL (for example https://staging-api.example.org/api/v1). Node 18 or newer is required.');
  process.exit(2);
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

async function getToken() {
  if (process.env.LOAD_TOKEN) return process.env.LOAD_TOKEN;
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.LOAD_EMAIL, password: process.env.LOAD_PASSWORD }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.accessToken) throw new Error(`sign-in failed (${res.status}); set LOAD_EMAIL and LOAD_PASSWORD or LOAD_TOKEN`);
  return json.accessToken;
}

async function hammer(path, token) {
  const lat = [];
  let ok = 0, limited = 0, client = 0, server = 0, network = 0, bytes = 0, next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next++ < REQUESTS) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        const body = await res.arrayBuffer();
        const ms = performance.now() - t0;
        if (res.status === 429) limited++;
        else if (res.status >= 500) server++;
        else if (res.status >= 400) client++;
        else { ok++; lat.push(ms); bytes += body.byteLength; }
      } catch {
        network++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const secs = (Date.now() - started) / 1000;
  lat.sort((a, b) => a - b);
  return { path, ok, limited, client, server, network, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat[lat.length - 1] || 0, kb: ok ? bytes / ok / 1024 : 0, rps: (ok + limited + client + server) / secs };
}

(async () => {
  const token = await getToken();
  console.log(`FEMS load check: ${BASE}\n${CONCURRENCY} concurrent clients, ${REQUESTS} requests per endpoint, p95 limit ${P95_LIMIT} ms\n`);
  console.log('endpoint'.padEnd(34) + 'ok'.padStart(6) + '429'.padStart(6) + '4xx'.padStart(6) + '5xx'.padStart(6) + 'err'.padStart(5) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'max'.padStart(8) + 'KB'.padStart(8) + 'req/s'.padStart(8));
  let failed = false;
  const rows = [];
  for (const path of PATHS) {
    const r = await hammer(path, token);
    rows.push(r);
    const flag = r.server || r.network || (r.ok && r.p95 > P95_LIMIT) ? '  <-- ' + (r.server || r.network ? 'ERRORS' : 'SLOW') : '';
    if (flag) failed = true;
    console.log(path.slice(0, 33).padEnd(34) + String(r.ok).padStart(6) + String(r.limited).padStart(6) + String(r.client).padStart(6) + String(r.server).padStart(6) + String(r.network).padStart(5) +
      r.p50.toFixed(0).padStart(8) + r.p95.toFixed(0).padStart(8) + r.p99.toFixed(0).padStart(8) + r.max.toFixed(0).padStart(8) + r.kb.toFixed(1).padStart(8) + r.rps.toFixed(0).padStart(8) + flag);
  }
  const limited = rows.reduce((n, r) => n + r.limited, 0);
  if (limited) console.log(`\nNote: ${limited} requests were rate limited (429) and are not in the latency figures. Raise RATE_LIMIT_MAX on the environment under test to measure the application itself.`);
  const denied = rows.filter((r) => r.client > 0 && r.ok === 0).map((r) => r.path);
  if (denied.length) console.log(`Note: this account was refused (4xx) on ${denied.join(', ')}; those endpoints were not measured.`);
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(`load check could not run: ${e.message}`);
  process.exit(2);
});
