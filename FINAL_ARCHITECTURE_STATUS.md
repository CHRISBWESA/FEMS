# Final Architecture Status

## As built

- **Backend:** NestJS 11 modular REST API, TypeScript, Prisma 6, PostgreSQL. Global authentication, forced-password, platform-boundary, role, module-availability, department-scope and throttling guards are registered in `AppModule`.
- **Frontend:** React 18 + Vite PWA, Axios, Tailwind. The service worker precaches the app shell but never caches authenticated API responses.
- **Authentication:** stateless bearer JWT access/refresh tokens; access tokens are revalidated against the current user, token version, active/deleted state and tenant status on every request. Temporary passwords are forced to change before normal layout or protected routes.
- **Tenancy:** `fellowship_id` on tenant tables plus server-side `TenantScopeService` and service-level department/gender/ownership checks. There is no hostname-based tenant routing and no database row-level security layer.
- **Authorization:** static role registry drives permissions; the server reloads current roles from the database rather than trusting JWT claims. Platform principals are default-denied from tenant controllers. Protected leadership/finance roles cannot be granted or managed by tenant users; platform administrators can provision tenant leadership without tenant data access.
- **Workflows:** shared approval engine for money requests, finance edits/deletes, reports, IT content, department transfers/removals and role unassignment. Money workflows use segregation of duties and conditional transactional writes; report/document statuses are synchronized from the decision transaction.
- **Modules:** members/engagement, departments, activities/attendance, reports, finance, youth, resources/assets, volunteers/service, analytics/dashboard, IT content, platform administration, billing/plans, audit, recycle bin and in-app notifications.
- **Operations:** liveness/readiness endpoints, request-ID correlation, privacy-safe production request logs, graceful shutdown hooks, start/release environment checks, backend smoke and load scripts, and 17 additive migrations.

## Explicit operational boundaries

- No payment provider, card/mobile-money integration, e-mail, SMS or push provider is implemented. Billing records are entered manually; a provider-neutral signed, idempotent webhook exists.
- No scheduler/worker exists. Time-dependent reminders, billing maintenance, graduation and age-group recalculation are endpoint/operator-triggered.
- Uploaded file bytes are validated but not stored; only document metadata is persisted. There is no download route.
- Backups are external. The in-app backup endpoints report `409` for unsupported operations and never fabricate a dump/success row.
- IT document deletion and recycle-bin restore are not implemented and return `409`; unfinished workflows are not created.
- Rate-limit counters are per process, not shared. Multi-instance deployments multiply the effective limit.
- The repository contains no hosting/DNS/TLS/CI/monitoring-provider configuration. These are human/operator responsibilities.

## Security posture

Implemented controls include password policy and lockout, random temporary passwords, token-version revocation, bearer-only authentication, CORS/Helmet/NUL-byte/input hardening, explicit-field writes, tenant reference validation, upload content checks, public check-in dedup key, tenant-scoped recycle bin, audit redaction and platform/tenant separation.

Accepted or deferred risks:

- browser `localStorage` token storage (mitigated by short access tokens, revocation and the documented CSP recommendation);
- stateless refresh tokens without server-side session inventory/rotation;
- no metrics/tracing/error-tracking provider integration;
- browser/device, real-environment load and restore acceptance not executed here;
- database-backed integration/security suite requires an isolated `TEST_DATABASE_URL` and is **SKIPPED** without it.

See [PHASE_22_SECURITY_REPORT.md](PHASE_22_SECURITY_REPORT.md), [SECURITY.md](SECURITY.md) and [FEMS_FINAL_MASTER_REPORT.md](FEMS_FINAL_MASTER_REPORT.md) for the full evidence and remaining blockers.
