# Database Migration Guide

## Safety boundary

Do not point `DATABASE_URL`, `prisma migrate`, tests, seeds or scripts at a database whose ownership and migration history are unknown. The local `backend/.env` database is documented by earlier read-only inspection as containing migration history from a different checkout. It is **not** a valid target for this repository. No migration, reset, drop, truncate or seed has been run against it during this continuation.

## Migrations in this checkout

`backend/prisma/migrations/` contains 17 migrations:

| # | Migration | Purpose |
|---|---|---|
| 1 | `20260825145717_init` | base schema |
| 2 | `20260825161156_approval_metadata` | approval workflow metadata |
| 3 | `20260826152315_fellowship_scoping` | tenant columns |
| 4 | `20260922100000_youth_children_management` | youth profiles, groups and guardians |
| 5 | `20260923100000_member_engagement` | member profile, history and groups |
| 6 | `20260924100000_finance_advanced` | campaigns, categories, periods, income, pledges, releases |
| 7 | `20260925100000_resources_assets` | assets, loans, maintenance, locations |
| 8 | `20260926100000_volunteer_service` | opportunities, shifts, assignments |
| 9 | `20260927100000_analytics_indexes` | activity/attendance indexes |
| 10 | `20260928100000_platform_administration` | tenant status, module switches, support grants, backfills |
| 11 | `20260929100000_saas_billing` | plans, subscriptions, invoices, payments, webhook events |
| 12 | `20260930100000_attendance_sync_ops` | offline-attendance operation idempotency |
| 13 | `20261001100000_auth_hardening` | token version, lockout counters, password-change timestamp |
| 14 | `20261002100000_recycle_bin_tenant` | recycle-bin tenant column/backfill |
| 15 | `20261003100000_foreign_key_indexes` | missing foreign-key indexes |
| 16 | `20261004100000_public_attendance_dedup` | anonymous check-in key, canonical-row backfill, partial unique index |
| 17 | `20261005100000_announcement_tenant_backfill` | derives missing announcement tenancy from the creator's fellowship |

Migrations 5, 10, 14, 16 and 17 rewrite/backfill rows. Review lock duration and query load on production-sized data before applying. Migration 16's index build can lock writes to `attendance`; rehearse it on a copy.

The current schema still has global unique names for some business keys (including `Department.name` and `Programme.name`). Two tenants cannot currently reuse the same department/programme name. This is an existing availability limitation, not tenant data exposure. Changing it to tenant-composite uniqueness requires a reviewed data-cleanup migration and is not performed automatically.

## Current verification evidence

Verified in this workspace without a database connection:

```text
npx prisma validate   -> schema valid
npx prisma generate   -> Prisma Client 6.19.3 generated
```

Not verified here:

- applying the migrations to an empty database;
- migration drift between `schema.prisma` and the migration history;
- migration status/drift on the configured `fems` database;
- the integration suite against a migrated database.

A drift check needs a second disposable scratch database as the shadow database. Do not substitute an unknown database.

## Procedure for a real environment

1. **Identify the target.** Record host, port, database name and application user. Confirm the database belongs to this FEMS deployment and to no other checkout.
2. **Back up and prove the backup restores.** Follow [BACKUP_RESTORE_GUIDE.md](BACKUP_RESTORE_GUIDE.md). Keep the dump outside the database host.
3. **Preflight with that URL only:**

   ```text
   npx prisma validate
   npx prisma migrate status
   ```

   Continue only if the history consists of this repository's migrations, fully applied or with a known pending tail. Stop on unknown migrations, a failed migration or a different target.
4. **Rehearse on a restored copy.** Restore a recent backup into a disposable database, apply this checkout's migrations with `npx prisma migrate deploy`, and time the backfills/index build.
5. **Apply forward only:**

   ```text
   npx prisma migrate deploy
   ```

   Never use `migrate dev`, `migrate reset`, `db push`, `DROP`, or `TRUNCATE` in production.
6. **Verify:**

   ```text
   npx prisma migrate status
   npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/schema.prisma --script
   ```

   Expect `Database schema is up to date!` and an empty migration diff. Then run the health check and smoke test in [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md).
7. **Record evidence:** migration versions before/after, start/end time, rehearsal duration, backup identifier, operator and verification output. Do not record credentials.

## Application rollback and database rollback

All migrations are intended to be additive/backfilling, so the previous application version should keep working after migration. This is the reason the release order is *migrate, then deploy*. Never combine a drop/rename with a release that still uses the old column/table; split it across releases.

There is no Prisma "down" migration. If forward repair is needed, write a new reviewed migration. If data is damaged, restore a verified dump into a new database and compare; never restore over the live database.

## Connection management

One Prisma pool exists per API process. Budget `instances × pool size` below PostgreSQL `max_connections`, leaving migration and administrative headroom. If needed, add `connection_limit=` to the runtime `DATABASE_URL`. The API forces each session to UTC; with a transaction-mode pooler that rejects startup options, set `DATABASE_FORCE_UTC_SESSION=false` and set the database/role time zone to UTC explicitly.

Use separate users:

- a migration/release user able to apply DDL;
- a least-privilege runtime user able to use the application tables/sequences;
- a separate backup user with only the privileges needed by `pg_dump`/`pg_restore`.

## Backup/restore interaction

A restored database carries its `_prisma_migrations` history. Before using it, run the same status/diff verification and then start the matching application version against it. The restore drill must target a new empty database, never the live one.
