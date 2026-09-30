#!/usr/bin/env node
/*
 * Post-deployment smoke test for the FEMS API. Read-only: it creates, changes and deletes no business data. The only
 * writes are the audit/session side effects of signing in, refreshing and signing out with the account you give it.
 *
 *   BASE_URL=https://api.example.org/api/v1 \
 *   FRONTEND_ORIGIN=https://app.example.org \
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... \
 *   node scripts/smoke.js
 *
 * Without SMOKE_EMAIL / SMOKE_PASSWORD only the unauthenticated checks run (the rest are reported as SKIP).
 * Use an account that does NOT have to change its password (a temporary password only allows changing it).
 * Sign-in is rate limited (10/min/IP by default) and this script signs in twice, so do not run it in a tight loop.
 * Exit code: 0 = no FAIL, 1 = at least one FAIL, 2 = the script could not run.
 *
 * Requires Node 18+ (global fetch). No dependencies.
 */
const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '');
const ORIGIN = process.env.FRONTEND_ORIGIN || '';
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const SLOW_MS = Number(process.env.SMOKE_SLOW_MS || 2000);

if (!BASE || typeof fetch !== 'function') {
  console.error('Set BASE_URL (for example https://api.example.org/api/v1). Node 18 or newer is required.');
  process.exit(2);
}

const results = [];
const record = (status, name, detail = '') => {
  results.push({ status, name, detail });
  console.log(`${status.padEnd(5)} ${name}${detail ? '  - ' + detail : ''}`);
};
const pass = (n, d) => record('PASS', n, d);
const fail = (n, d) => record('FAIL', n, d);
const warn = (n, d) => record('WARN', n, d);
const skip = (n, d) => record('SKIP', n, d);

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json, ms: Date.now() - started };
}

const expectStatus = (name, res, ok) => {
  const allowed = Array.isArray(ok) ? ok : [ok];
  if (allowed.includes(res.status)) pass(name, `${res.status} in ${res.ms} ms`);
  else fail(name, `expected ${allowed.join('/')} but got ${res.status}: ${res.text.slice(0, 120)}`);
  return allowed.includes(res.status);
};
const noLeak = (name, res) => {
  if (/PrismaClient|Invalid `prisma|node_modules|password_hash|\n\s+at\s+\S+/.test(res.text)) fail(name, 'the response leaks internals');
  else pass(name);
};

(async () => {
  console.log(`FEMS smoke test against ${BASE}\n`);
  const url = new URL(BASE);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  // ---- transport ----
  if (url.protocol === 'https:') pass('the API is served over HTTPS');
  else if (local) warn('the API is served over plain HTTP', 'acceptable for localhost only');
  else fail('the API is served over HTTPS', `BASE_URL is ${url.protocol}//${url.host}`);

  // ---- liveness, readiness and correlation ----
  const correlationId = `smoke-${Date.now()}`;
  const live = await call('GET', '/health/live', { headers: { 'X-Request-Id': correlationId } });
  expectStatus('GET /health/live answers 200', live, 200);
  live.headers.get('x-request-id') === correlationId ? pass('X-Request-Id is echoed for correlation') : fail('X-Request-Id is echoed for correlation', 'missing or changed');
  const health = await call('GET', '/health/ready');
  if (expectStatus('GET /health/ready answers 200', health, 200)) {
    if (health.json?.status === 'ok' && health.json?.database === 'ok') pass('the readiness check reports the database as reachable');
    else fail('the readiness check reports the database as reachable', health.text.slice(0, 120));
  }
  if (health.ms > SLOW_MS) warn('readiness check latency', `${health.ms} ms`);

  // ---- headers ----
  const h = health.headers;
  h.get('x-content-type-options') === 'nosniff' ? pass('X-Content-Type-Options: nosniff') : fail('X-Content-Type-Options: nosniff', 'missing');
  h.get('x-powered-by') ? fail('X-Powered-By is not exposed', h.get('x-powered-by')) : pass('X-Powered-By is not exposed');
  if (url.protocol === 'https:') h.get('strict-transport-security') ? pass('Strict-Transport-Security is set') : warn('Strict-Transport-Security is set', 'missing - the proxy may add it');

  // ---- CORS ----
  if (ORIGIN) {
    const ok = await call('OPTIONS', '/auth/login', { headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
    ok.headers.get('access-control-allow-origin') === ORIGIN ? pass('CORS allows the frontend origin', ORIGIN) : fail('CORS allows the frontend origin', `Access-Control-Allow-Origin is "${ok.headers.get('access-control-allow-origin')}"`);
    const evil = await call('OPTIONS', '/auth/login', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    const echoed = evil.headers.get('access-control-allow-origin');
    echoed && echoed !== ORIGIN ? fail('CORS refuses other origins', `echoed ${echoed}`) : pass('CORS refuses other origins');
  } else {
    skip('CORS checks', 'set FRONTEND_ORIGIN to run them');
  }

  // ---- default deny ----
  for (const p of ['/members', '/users', '/finance/summary', '/dashboard', '/profile']) {
    const r = await call('GET', p);
    [401, 404].includes(r.status) ? pass(`unauthenticated GET ${p} is refused`, String(r.status)) : fail(`unauthenticated GET ${p} is refused`, `got ${r.status}`);
  }
  expectStatus('a garbage bearer token is refused', await call('GET', '/profile', { token: 'not.a.token' }), 401);

  // ---- hostile input never becomes a server error ----
  for (const [label, opts] of [
    ['a malformed JSON body', { raw: '{"email": ' }],
    ['a wrong-typed sign-in body', { body: { email: ['x'], password: { a: 1 } } }],
    ['a NUL byte in a sign-in body', { body: { email: 'a\u0000b', password: 'x' } }],
  ]) {
    const r = await call('POST', '/auth/login', opts);
    r.status >= 400 && r.status < 500 ? pass(`${label} is a client error`, String(r.status)) : fail(`${label} is a client error`, `got ${r.status}`);
    noLeak(`${label} leaks nothing`, r);
  }
  const nf = await call('GET', '/definitely-not-a-route');
  expectStatus('an unknown route is a clean 404', nf, 404);
  noLeak('the 404 leaks nothing', nf);

  // ---- an authenticated session ----
  if (!EMAIL || !PASSWORD) {
    skip('sign in, session, refresh and sign out', 'set SMOKE_EMAIL and SMOKE_PASSWORD to run them');
  } else {
    const login = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    if (!expectStatus('sign-in works', login, [200, 201]) || !login.json?.accessToken) {
      fail('the rest of the session checks', 'cannot continue without a session');
    } else {
      const { accessToken, refreshToken } = login.json;
      login.json.user?.mustChangePassword ? fail('the smoke account can use the system', 'it must change its password first') : pass('the smoke account can use the system');
      if (refreshToken) {
        // a refresh token is not an access token
        expectStatus('a refresh token is refused as a bearer token', await call('GET', '/profile', { token: refreshToken }), 401);
      }
      const timings = [];
      for (const p of ['/profile', '/dashboard', '/notifications/unread-count', '/members?limit=1', '/activities', '/departments']) {
        const r = await call('GET', p, { token: accessToken });
        if ([200].includes(r.status)) {
          pass(`GET ${p}`, `${r.ms} ms`);
          timings.push(r.ms);
          if (r.ms > SLOW_MS) warn(`GET ${p} is slow`, `${r.ms} ms`);
        } else if (r.status === 403) skip(`GET ${p}`, 'this account may not read it');
        else fail(`GET ${p}`, `got ${r.status}: ${r.text.slice(0, 100)}`);
        noLeak(`GET ${p} leaks nothing`, r);
      }
      if (refreshToken) {
        const rf = await call('POST', '/auth/refresh', { body: { refreshToken } });
        expectStatus('token refresh works', rf, [200, 201]) && rf.json?.accessToken ? pass('token refresh returns a new access token') : fail('token refresh returns a new access token');
      }
      expectStatus('sign-out works', await call('POST', '/auth/logout', { token: accessToken }), [200, 201]);
      if (timings.length) pass('median read latency', `${timings.sort((a, b) => a - b)[Math.floor(timings.length / 2)]} ms`);
    }
  }

  const counts = results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  console.log(`\n${results.length} checks: ${['PASS', 'WARN', 'SKIP', 'FAIL'].map((s) => `${counts[s] || 0} ${s}`).join(', ')}`);
  process.exit(counts.FAIL ? 1 : 0);
})().catch((e) => {
  console.error(`smoke test could not run: ${e.message}`);
  process.exit(2);
});
