# Production Deployment Guide

This guide is provider-neutral. The repository does not select hosting, DNS, TLS, a process manager, a database service, or a monitoring product. Anything that requires real infrastructure is marked **NOT VERIFIED**.

## 1. Deployment units

| Part | Artifact | Runtime |
|---|---|---|
| Backend API | `backend/dist/main.js` from `npm run build` | one Node.js process per container/host, started with `npm run start:prod`; every route is under `/api/v1` |
| Frontend | `frontend/dist/` from `npm run build:release` | static files served by the chosen host/CDN |
| Database | PostgreSQL | external service; the schema is changed only by committed Prisma migrations |

The following are **not implemented** and must not be assumed:

- Redis is not used by the application. The root `docker-compose.yml` starts an unused Redis container; rate-limit counters live in each API process.
- Uploaded file bytes are validated but not stored. Only document metadata is persisted.
- There is no scheduler or background worker. Graduation checks, reminders, billing maintenance and age-group recalculation are endpoint- or operator-triggered.
- There is no payment, e-mail or SMS provider. Billing payments are recorded manually; a provider-neutral signed webhook exists for a future integration.
- There is no tenant subdomain routing. Every tenant uses the same origin; tenancy comes from the authenticated `fellowship_id`.

## 2. Required production configuration

The process refuses to start when production configuration is unsafe. See [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md).

Required:

- `NODE_ENV=production`
- `DATABASE_URL`: a PostgreSQL URL naming a database, preferably using a least-privilege application user
- `JWT_SECRET`: at least 32 characters, not a placeholder and not low-variety; use a unique 48+ character secret per environment
- `FRONTEND_URL`: the exact public `https://` origin, with no path, trailing slash, credentials, query or fragment

Recommended/tuning:

- `PORT`
- `TRUST_PROXY`, matching the real proxy topology
- `BILLING_WEBHOOK_SECRET` (at least 32 characters) only if the signed webhook is enabled
- rate-limit windows/limits, `UPLOAD_MAX_SIZE`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `DATABASE_FORCE_UTC_SESSION`

Do not deploy a `.env` file. `npm run start:prod` forces `NODE_ENV=production`, and `ConfigModule` then ignores env files. Supply values through the host's real secret/environment mechanism.

Validate the backend configuration without connecting to a database:

```text
cd backend
npm run check:release-env
```

## 3. Environments

| | Development | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | `development` or unset | `production` | `production` |
| Database | local, disposable | separate migrated database | separate least-privilege database |
| `JWT_SECRET` | development fallback is allowed | unique | unique, secret-managed |
| `FRONTEND_URL` | `http://localhost:5173` | staging https origin | production https origin |
| `VITE_API_BASE_URL` | localhost API | staging API | production API |
| Billing webhook secret | unset | separate | separate |

Never share a database or `JWT_SECRET` between environments. Do not copy production member, youth or finance data into staging unless it is deliberately anonymised and lawfully handled.

## 4. Repeatable release process

Run from a reviewed, clean commit. Stop at the first failure.

### 0. Prerequisites

- A recent, verified backup; see [BACKUP_RESTORE_GUIDE.md](BACKUP_RESTORE_GUIDE.md).
- Previous backend and frontend artifacts retained for rollback.
- Production secrets injected by the host, not committed.
- Confirmed release window and incident owner.

### 1. Install and build

```text
cd backend
npm ci
npx prisma generate
npm run typecheck
npm run typecheck:build
npm run lint
npm test
npm run build

cd ../frontend
npm ci
VITE_API_BASE_URL=https://api.example.org/api/v1 npm run build:release
```

`build:release` requires `VITE_API_BASE_URL` explicitly. It rejects an unset value, a non-https value, localhost, credentials/query/fragment values, or any path other than exactly `/api/v1`.

The database-backed gate must also run in the release environment:

```text
cd backend
TEST_DATABASE_URL=<disposable database whose name contains test or scratch> npm run test:integration:required
```

Without `TEST_DATABASE_URL`, `npm run test:integration` skips database-backed suites. A skipped suite is **not** a pass. The required gate refuses to run in that state.

### 2. Inspect migration state

```text
cd backend
npx prisma validate
npx prisma migrate status
```

Stop if `migrate status` reports migrations that are not in this repository, a failed migration, or a database that is not the confirmed release target. Full procedure: [DATABASE_MIGRATION_GUIDE.md](DATABASE_MIGRATION_GUIDE.md).

### 3. Back up, rehearse, migrate

1. Take and verify a fresh backup.
2. Restore it into a disposable database and rehearse the pending migrations.
3. On the confirmed production target run only:

```text
npx prisma migrate deploy
```

Never run `prisma migrate reset`, `prisma db push`, `DROP`, or `TRUNCATE` against production.

### 4. Deploy the backend

Deploy `dist/`, `package.json`, the lock file and generated Prisma client. Install production dependencies only for runtime; run Prisma CLI migration/generation from a release job that has dev dependencies.

`npm run start:prod`:

- refuses a pre-set non-production `NODE_ENV`;
- sets `NODE_ENV=production` before the application is loaded;
- runs `dist/main.js` (or `dist/src/main.js` if that is the produced layout);
- lets the application refuse an unsafe configuration with a sanitized message and non-zero exit code.

Use a process manager that restarts on failure and sends `SIGTERM` on stop. The API enables shutdown hooks, drains in-flight requests, and disconnects Prisma on shutdown. **NOT VERIFIED in a real hosting environment.**

### 5. Health checks

- `GET /api/v1/health/live` — process liveness; does not query the database.
- `GET /api/v1/health/ready` — bounded database connectivity; `503` when the database is unavailable.
- `GET /api/v1/health` — backward-compatible readiness alias.

All are public, reveal no tenant data, and bypass throttling so a monitor is not rate-limited. Point readiness/uptime monitoring at `/api/v1/health/ready`.

### 6. Smoke test

```text
cd backend
BASE_URL=https://api.example.org/api/v1 \
FRONTEND_ORIGIN=https://app.example.org \
SMOKE_EMAIL=<non-temporary smoke account> \
SMOKE_PASSWORD=<secret> \
node scripts/smoke.js
```

The script checks HTTPS, liveness/readiness, security headers, request-ID correlation, CORS, default-deny, hostile input, sign-in/refresh/sign-out and read latency. Exit code 1 means at least one failure. It has **not** been run against a real production deployment in this workspace.

### 7. Deploy the frontend

Upload the contents of `frontend/dist/` to the static host. Recommended headers:

- `index.html` and `sw.js`: `Cache-Control: no-cache`
- hashed files under `assets/`: `Cache-Control: public, max-age=31536000, immutable`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` such as `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.example.org; frame-ancestors 'none'; base-uri 'self'`

Start with `Content-Security-Policy-Report-Only`, review violations, then enforce. This is the main mitigation for the accepted risk that browser tokens are stored in `localStorage`.

### 8. Browser and device acceptance

**NOT VERIFIED here.** On staging verify sign-in, forced password change, refresh, routing/deep links, service-worker update, offline attendance synchronization, PWA installation, responsive layouts, logout/offline-data cleanup, and the browser/device matrix.

### 9. Observe and roll back

Watch the first release window for readiness failures, 5xx, 401/403 spikes, latency, database connections, and migration errors. Roll back if a stop condition is reached: [ROLLBACK_GUIDE.md](ROLLBACK_GUIDE.md).

## 5. Edge, routing and cookies

- Route `/api/v1/*` to the backend; route all other frontend paths to `index.html` (SPA fallback). The service worker denies `/api/` navigations.
- The API uses bearer tokens, not authentication cookies. `CORS` therefore allows exactly one origin (`FRONTEND_URL`); no cookie-based CSRF flow exists.
- `TRUST_PROXY` must match the number/type of proxies. Too low merges clients into one rate-limit bucket; too high allows forged forwarded addresses.
- The API sets `X-Request-Id` on every response. The browser sends one per request and preserves it across a silent token refresh.
- Set the proxy request-body limit at least as high as `UPLOAD_MAX_SIZE`.

## 6. Monitoring and alerting

The application emits Nest/Nest-adjacent stdout/stderr logs and database audit logs. In production, HTTP request logs are one JSON line per completed request containing timestamp, request ID, method, normalized route template, status and duration. They do not contain query strings, bodies, tokens, cookies, names, e-mails or raw record ids.

The repository does not contain a metrics exporter, tracing integration or error-tracking provider. Before go-live, the hosting/observability layer must provide:

1. stdout/stderr collection with alerts on `ERROR`;
2. readiness and uptime monitoring;
3. request-ID/trace correlation from the edge to the API;
4. database connection, disk, replication and backup-age monitoring;
5. alerts for sustained 5xx, 401/403 spikes, latency and readiness failures;
6. certificate/DNS expiry monitoring;
7. restricted log access and a documented retention period.

Audit logs are separate from application logs and are filtered by the audit redaction step. Logs and audit rows can still contain personal data and must be protected accordingly.

## 7. Performance evidence

Static limits and query patterns are implemented, and release checks are available in `backend/scripts/load-check.js`. **No load, latency, large-list or concurrency result from this workspace is claimed as production evidence.** Run the load check on staging with production-sized data, then repeat after go-live. Sign-in is intentionally expensive (bcrypt cost 12) and tightly rate-limited.

## 8. Human actions this repository cannot perform

- Choose and provision hosting, database, DNS, TLS, process manager and secret store.
- Configure real monitoring, alerting, log retention and on-call ownership.
- Schedule and monitor backups; perform and document a restore drill.
- Supply an isolated migrated test database for the required integration gate.
- Run staging smoke, load, browser and device acceptance.
- Review the accepted risks in [PHASE_22_SECURITY_REPORT.md](PHASE_22_SECURITY_REPORT.md) and [FEMS_FINAL_MASTER_REPORT.md](FEMS_FINAL_MASTER_REPORT.md).
