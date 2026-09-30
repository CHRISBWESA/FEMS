# Backup and Restore Guide

## Current status

| Capability | State |
|---|---|
| In-app `/backups` endpoints | Honest status only. Manual backup and restore return `409 Conflict` (`OPERATION_UNAVAILABLE`); no dump is run, no file is copied, and no successful backup row is fabricated. |
| `pg_dump` procedure | Documented below. **Not executed against a production environment in this workspace.** |
| Scheduled backups | **Not configured.** Must be provided by the hosting/database platform or an operator job. |
| Retention/off-host copies/encryption | **Not configured.** |
| Restore drill on real infrastructure | **Not performed.** |

Do not describe FEMS as backup-ready until scheduled backups exist, recent copies are monitored, and a restore has been tested in the real environment.

## What needs backing up

Only PostgreSQL contains business state. Application code is rebuilt from the reviewed commit. Uploaded file bytes are not stored, so there is no upload directory to back up. `DATABASE_URL` credentials, `JWT_SECRET` and `BILLING_WEBHOOK_SECRET` live in the secret manager and require their own backup/recovery policy.

## Backup procedure

Use the PostgreSQL tools matching the server version and run them from a controlled backup host/job:

```text
pg_dump --format=custom --no-owner --no-privileges --file fems-<UTC timestamp>.dump "$DATABASE_URL"
pg_restore --list fems-<UTC timestamp>.dump
sha256sum fems-<UTC timestamp>.dump
```

The archive must be readable, non-empty, and its checksum recorded with the file. Do not print `DATABASE_URL` in logs or job output.

Store copies:

- encrypted at rest;
- on a different host/account from the live database;
- with least-privilege read access;
- with a documented retention policy appropriate for member, youth and financial data;
- with an alert on failure and on backup age.

A starting policy is daily copies for 14 days, weekly for 8 weeks and monthly for 12 months, but the fellowship/system owner must choose a policy that satisfies its obligations. Restoring an old backup also restores data later deleted on request, so retention must be a conscious decision.

## Restore procedure

Never restore over a live database. Restore into a new empty database, verify it, and only then switch traffic or migrate the application.

```text
createdb <new restore database>
pg_restore --no-owner --no-privileges --exit-on-error --dbname <new restore database> fems-<UTC timestamp>.dump
```

Before switching traffic:

1. Confirm the dump checksum and restore log.
2. Compare representative row counts with the source/expected state at backup time.
3. Run the matching application version against the restored database.
4. Verify `GET /api/v1/health/ready` returns `200`.
5. Run `npx prisma migrate status` and the empty-diff check from [DATABASE_MIGRATION_GUIDE.md](DATABASE_MIGRATION_GUIDE.md).
6. Run `backend/scripts/smoke.js` and a two-tenant isolation spot check.
7. Record backup time, restore duration, data-loss window, operator and verification evidence.

If credential compromise is involved, rotate `JWT_SECRET` after restoring. Restoring the data also restores token versions, so rotation is the reliable way to end all sessions.

## Backup and restore in the application

The in-app screens now state the external responsibility and expose only legacy metadata without internal file paths. The API refuses to claim that a backup or restore happened. Do not reintroduce fake `manual_*.json` or `safety_*.json` success rows.

## Recovery decision

| Situation | Action |
|---|---|
| Recent corruption or accidental deletion | Stop writes, preserve evidence, restore a recent dump into a new database, compare, and switch deliberately. |
| Lost database host | Provision a new database, restore the newest verified dump, run migration verification, then switch the application. |
| Missing/old backups | Treat data loss honestly, record the window, and do not claim a successful recovery until verification passes. |
| Failed backup job | Alert the operator, fix the job, run a manual verified dump, and confirm retention/age alerting. |

## Evidence required for production readiness

- backup job/managed-service configuration;
- timestamped successful backup logs;
- checksum and encryption/off-host location;
- retention configuration;
- alert delivery test for failure and backup age;
- a dated restore drill into a new database with the checks above.

Until that evidence exists, backup readiness is **NOT VERIFIED**.
