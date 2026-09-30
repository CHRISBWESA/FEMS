# Incident Response Guide

For the person on call: record what is known, contain first, investigate second, and write down every action with a timestamp. Never put tokens, passwords, connection strings, member/youth details, financial amounts or document content in logs, screenshots or tickets. Quote request IDs, entity IDs and event codes instead.

## First ten minutes

1. Record detection time, symptoms, reporter, release/artifact version and affected tenant(s) if known.
2. Check `GET /api/v1/health/live` and `GET /api/v1/health/ready`.
   - live fails: process/edge/host problem;
   - live passes but ready fails `503`: database connectivity problem;
   - readiness passes but users fail: inspect recent release, 5xx/401/403 and logs.
3. Collect API stdout/stderr around the incident. Production request lines contain timestamp, request ID, method, normalized route, status and duration; they intentionally omit query strings, bodies, credentials and raw record ids.
4. Use `X-Request-Id` from a user report/error to correlate edge and API logs.
5. Check database connections, disk, memory, migrations, backup jobs, proxy/TLS and DNS.
6. If the class is uncertain, treat it as a security incident until proven otherwise.

## Incident classes

### Outage or readiness failure

- Confirm whether the last release completed migration and health checks.
- Roll back the application artifact if the release is implicated; see [ROLLBACK_GUIDE.md](ROLLBACK_GUIDE.md).
- If `DATABASE_URL`, credentials or connectivity is wrong, restore configuration and restart; do not change the schema to work around connectivity.
- Escalate database-host failure to the database owner.

### Account takeover or leaked password

- Reset the account's password. That increments `token_version` and ends every earlier access/refresh token.
- Check `audit_logs` for `auth.login`, `auth.account_locked`, `password.reset` and `password.change`.
- Eight wrong passwords within 15 minutes lock the account for 15 minutes; a locked account answers like a wrong password.

### Leaked `JWT_SECRET` or forged tokens

- Rotate `JWT_SECRET` through the secret manager and restart/reload according to the host. All sessions end.
- Rotate `DATABASE_URL` credentials and `BILLING_WEBHOOK_SECRET` too if they shared the exposure path.
- Do not paste the old or new secret into a ticket.

### Suspected cross-tenant exposure

- Suspend the affected tenant from the platform tenant page, or stop the API if unsure.
- Preserve request/audit evidence and identify the route, request ID and identifiers involved.
- Check whether the path, body, query, header, export, document, report, notification or search surface was involved.
- The regression suites `security.int-spec`, `security-fuzz.int-spec` and `security-tenant-refs.int-spec` show how to reproduce requests, but they require an isolated test database.
- Notification duties to fellowships and data-protection authorities may apply; that decision is for the system owner/legal adviser, not an automated agent.

### Suspicious upload

Uploads are size/type/content-signature checked and their bytes are not stored or served. Review the document metadata row, uploader, department and audit trail; do not attempt to execute the uploaded sample.

### Billing anomaly

- Unset `BILLING_WEBHOOK_SECRET` to stop webhook processing if a provider is connected.
- Billing payments are otherwise entered manually; review platform billing access and `saas_webhook_events`. A replayed provider event is idempotent and must not create a second effect.
- No live payment provider is integrated; do not describe this incident as a card/mobile-money incident unless a real provider is deployed.

### Rate limiting affecting real users

Usually `TRUST_PROXY` is wrong behind a proxy (all clients share one bucket) or multiple API instances count separately. Correct the setting; do not simply raise limits. The current counters are process-local.

### Data loss/corruption

Stop writes, preserve evidence, and restore a verified dump into a new database ([BACKUP_RESTORE_GUIDE.md](BACKUP_RESTORE_GUIDE.md)). Records soft-deleted through the application may still be in the recycle bin, but restore is currently unavailable; database-level loss requires a backup. Record the data-loss window honestly.

## Useful evidence locations

| Question | Where |
|---|---|
| Who did what, when | tenant-scoped `audit_logs` / `GET /api/v1/audit` |
| Which platform action ran | platform audit view |
| Who has support access to a tenant | `support_access_grants` (scoped, time-limited, tenant-approved) |
| Which anonymous attendance arrived twice | `attendance.public_checkin_key` and `attendance_sync_ops` |
| Whether a backup exists | external backup job/managed service; in-app metadata is not evidence |

## Escalation and closure

Record timeline, root cause, affected data/tenants, containment, recovery, evidence, and follow-up owners. Add or strengthen a regression test for every security/reliability defect. Update this guide and the relevant runbook if the incident exposed a gap. Do not close a security incident merely because the service is reachable again.
