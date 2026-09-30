# Rollback Guide

The release order is build -> verify -> back up -> rehearse/migrate -> deploy backend -> health/smoke -> deploy frontend. This guide describes the least-damaging response when a step fails. Do not improvise a database operation.

## Why an application rollback is expected to be safe

The repository's migrations are additive/backfilling: new tables, nullable/defaulted columns, indexes and data backfills; no drops, renames or type changes. The previous application version should therefore continue to work against the migrated schema. This is why the order is *migrate, then deploy* and why the normal rollback is to redeploy the previous artifact **without changing the database**.

Preserve this property: never drop or rename something the previous version still uses in the same release. Split such a change across releases and rehearse it on a restored copy.

## Decision table

| Symptom | Action |
|---|---|
| Build, typecheck, lint or required tests fail | Nothing is deployed. Fix and restart the release. |
| `migrate status` shows another checkout's history or a failed migration | Stop. Identify the target database. Nothing should be applied. |
| `migrate deploy` fails | Keep the previous application version, preserve the error, fix forward with a reviewed migration. Do not edit `_prisma_migrations` by hand. |
| New backend does not start | Read the sanitized start-up reason; fix configuration/artifact and restart the previous artifact. |
| `/api/v1/health/live` fails | Process/edge problem; keep traffic away and restore the previous process/host. |
| `/api/v1/health/ready` returns 503 | Database/connectivity problem; do not treat an application rollback as a schema fix. |
| Health passes but `smoke.js` fails | Redeploy the previous backend and, if the frontend changed, the previous frontend. |
| 5xx/latency/auth spikes after go-live | Stop the release, preserve logs/artifacts, redeploy previous artifacts, then investigate. |
| Data is corrupted/lost | Stop writes, restore a verified backup into a new database, compare, then decide how to switch. Record the data-loss window. |

## Application rollback

1. Stop routing new traffic to the new backend (or stop it).
2. Start the previous `dist/` with the same environment variables and `npm run start:prod`. Do not start it in development mode.
3. If the frontend changed API usage, redeploy the previous `frontend/dist` as well. Existing open tabs keep the old bundle until the service worker updates; do not clear user offline data during rollback.
4. Verify:
   - `GET /api/v1/health/live` -> `200 {"status":"ok"}`;
   - `GET /api/v1/health/ready` -> `200 {"status":"ok","database":"ok"}`;
   - `node scripts/smoke.js` with a non-temporary smoke account;
   - sign-in, sign-out, forced password change and one tenant-isolation spot check with two accounts from different fellowships.
5. Preserve the failed artifact, its logs, request IDs, migration version and time window for the review.

## Database rollback

Prisma has no down migration. Use this order:

1. leave the additive schema in place if the previous application works;
2. fix forward with a new reviewed migration;
3. restore a verified dump into a new empty database, verify it, and switch deliberately.

Never run `prisma migrate reset`, `prisma db push`, `DROP`, `TRUNCATE` or a hand-written reverse migration against production. Never restore over a live database.

## Emergency switches that need no deployment

- Suspend one tenant from the platform tenant page; its authenticated requests and public check-in are refused.
- Switch off a module for one tenant from platform module settings.
- End one person's sessions by resetting/changing their password; `token_version` invalidates earlier tokens.
- End every session by rotating `JWT_SECRET` and restarting.
- Stop the signed billing webhook by unsetting `BILLING_WEBHOOK_SECRET` (the endpoint refuses processing).
- Stop the API process; the static frontend may still serve its cached shell, but API-dependent screens will not work.

## Release gate reminders

- `TEST_DATABASE_URL` absent means integration tests are skipped, not passed.
- The local `fems` database is not a safe target; use a confirmed, isolated migrated database.
- Backup/restore is external; verify a recent dump before any release and rehearse restore separately.

## Exit criteria

Health/readiness pass, smoke and tenant spot check pass, error/latency figures return to baseline, the failed artifact and evidence are retained, and the incident owner has recorded the remaining data-loss window and follow-up actions.
