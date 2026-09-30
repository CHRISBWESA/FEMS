# Fellowship Management System - Testing

> **Read this first.** The original aspirational plan is retained below the current section. The current repository has no browser/E2E specs even though Cypress is installed as a dev dependency; do not treat `npm run test:e2e` as evidence.

## What exists

| Layer | Tool | Where | Needs a database |
|---|---|---|---|
| Backend unit tests | Jest + ts-jest | `backend/src/**/*.spec.ts` | no |
| Backend integration/security tests | Jest + Supertest against the full application (real guards, JWTs, Prisma) | `backend/test/integration/*.int-spec.ts` | **yes - a disposable migrated PostgreSQL database** |
| Frontend unit tests | Jest (esbuild transform, fake-indexeddb, axios adapter) | `frontend/src/**/*.test.ts` | no |
| Type checks | `tsc --noEmit` | backend and frontend | no |
| Lint | ESLint, check-only by default | backend and frontend | no |
| Post-deployment smoke | `backend/scripts/smoke.js` | a running API | no database by the script itself; it authenticates |
| Load check | `backend/scripts/load-check.js` | staging | a running API |

The checked-in test code covers unit behaviour and database-backed integration/security behaviour. The database-backed suite is **skipped without `TEST_DATABASE_URL`**; it is not a pass.

## Running them

```text
# backend
cd backend
npm run typecheck
npm run lint
npm test

# integration release gate - a disposable database whose name contains test or scratch
TEST_DATABASE_URL=<that database> npm run test:integration:required

# frontend
cd ../frontend
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run lint:fix` is mutating and is not a verification command. `npm run test:integration` is the permissive form that skips without a test URL; `test:integration:required` is the release gate and refuses to run without one.

## Test database safety

`test/integration/env-setup.ts` requires the decoded `TEST_DATABASE_URL` database name to contain `test` or `scratch` and replaces `DATABASE_URL` before Nest/Prisma loads. `harness.ts` uses `describe.skip` when it is absent. Tests create uniquely named data and do not delete, truncate or reset the database.

A schema drift check needs a second, empty scratch database as the shadow database:

```text
npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url <second scratch database> --script
```

Never use the local `fems` database for this command or for integration tests unless its ownership and migration history have been independently confirmed.


## The integration suites

| Suite | What it proves |
|---|---|
| `auth-permissions` | sign-in, permissions after login, role gates |
| `members-engagement`, `youth` | members, profile privacy, history, groups, reports, youth privacy and scoping |
| `finance-approvals`, `finance-advanced` | the approval chain (one approval never finishes a request, no self-approval, atomic decisions), finance records, pledges, statements |
| `resources`, `volunteers`, `analytics` | assets and loans, shifts and capacity/conflicts under concurrency, analytics scoping and figures |
| `platform`, `billing` | tenant lifecycle, the platform/tenant boundary over **every registered route**, support access, plans and entitlements, the signed webhook, finance/billing separation |
| `attendance-sync` | offline attendance: idempotency, re-authorisation, concurrency |
| `security` | cross-tenant sweep of every id-taking route, department/gender scope, sessions, lock-out, password policy, uploads, public check-in, error handling |
| `security-fuzz` | **every route** with hostile shapes (nulls, wrong types, oversized values, NUL bytes, prototype pollution, query-string arrays, half-valid bodies with real ids) as six different roles, forged/expired/unsigned tokens, unauthenticated calls: no 5xx, no leak, no hang |
| `security-tenant-refs` | an attacker fellowship sends the victim's ids in every body field and query parameter of every route: nothing of the victim may change, and nothing of the attacker may point at the victim |
| `security-throttle` | rate limits (needs its own process settings) |
| `security-timezone` | lock-out and time logic under databases set to New York, Nairobi and Auckland time |
| `paging` | bounded lists |

Narrow the personas of the fuzz suite while investigating: `FUZZ_ONLY=secretary,admin npx jest ... security-fuzz`.

## How to keep the net tight

- A new route is covered by the sweeps automatically (they enumerate the registered routes); a new *request field* is covered
  by the fuzz suite automatically (field names are harvested from the source); a new **kind of entity** needs a line in
  `test/integration/seed-all.ts` so the sweeps have a real id to attack with.
- A route that is public on purpose must be added to the `PUBLIC` lists of `platform.int-spec` (and, if it takes a body,
  be reviewed for abuse) - that is the point at which the review happens.
- Never weaken a test to make it pass. If a sweep fails, the route is wrong.

---

# Original test plan (partly aspirational - see the status above)

## 1. Test Framework

- **Backend**: Jest (TypeScript) + Supertest for HTTP tests
- **Frontend**: Jest + React Testing Library + Cypress for E2E
- **Integration tests**: Full API tests with test database

## 2. Test Categories

### 2.1 Authentication Tests
- [x] Login with valid credentials
- [x] Login with invalid credentials (rejected)
- [x] Login rate limiting (5 attempts / 15 min)
- [x] Logout clears session
- [x] Token refresh works
- [x] Access token expires after 15 min
- [x] Protected endpoints reject invalid/expired tokens

### 2.2 RBAC Tests (Critical)
Each role tested with allow/deny matrix:

#### Secretary
- [x] CAN: edit members
- [x] CAN: change member status
- [x] CAN: manage departments
- [x] CAN: manage activities
- [x] CAN: review reports
- [x] CAN: approve/reject assigned workflows
- [x] CAN: reset any fellowship user password
- [x] CANNOT: perform Treasurer-only finance operations

#### Assistant Secretary
- [x] CAN: same as Secretary EXCEPT Secretary-only actions
- [x] CAN: restore deleted records
- [x] CAN: reset any fellowship password
- [x] CAN: restore backups
- [x] CANNOT: perform Secretary-only approvals

#### Chairperson
- [x] CAN: approve where workflow requires
- [x] CAN: view finance records
- [x] CAN: view department reports
- [x] CANNOT: directly create/edit/delete operational records (unless in approval workflow)

#### Assistant Chairperson
- [x] CAN: perform approvals where "Chairperson OR Assistant Chairperson"
- [x] CANNOT: require both Chair + Assistant Chair approvals (only one needed)

#### Treasurer
- [x] CAN: record contributions (no approval)
- [x] CAN: record expenses (requires Secretary + Chair approval)
- [x] CAN: create budgets (requires Secretary + Chair approval)
- [x] CAN: manage money requests (final approval stage)
- [x] CAN: view finance records
- [x] CANNOT: edit/delete contributions without approval
- [x] CANNOT: edit members

#### Department Leaders (Secretary + Chairperson of own dept)
- [x] CAN: access own department data
- [x] CAN: manage own department members
- [x] CAN: manage own department activities
- [x] CAN: submit own department reports
- [x] CANNOT: access another department's data

#### Gender Leader
- [x] CAN: register members
- [x] CANNOT: edit existing member records (Secretary-only)

#### Ordinary Member
- [x] CAN: view own profile
- [x] CAN: view invited activities
- [x] CAN: confirm attendance via share link
- [x] CANNOT: edit member records
- [x] CANNOT: access finance or admin functions

#### Admin
- [x] CAN: manage users, passwords, settings, backups, recycle bin
- [x] CAN: request impersonation
- [x] CANNOT: silently impersonate without approval

### 2.3 Department Isolation Tests (Critical)
- [x] Department Secretary cannot GET/POST/PUT/DELETE another department's members
- [x] Department Chair cannot access another department's data
- [x] URL tampering (`/department/choir/member/123` → `/department/it/member/123`) returns 403
- [x] Department-scoped API filters return only department members

### 2.4 Approval Workflow Tests (Critical)
- [x] Cannot skip approval stages (direct DB state change rejected)
- [x] Cannot approve own request (self-approval rejected)
- [x] Only designated approver at current stage can approve
- [x] Rejection with comment
- [x] Resubmission resets to correct stage
- [x] Finance approval sequences cannot be skipped

#### Money Request Workflow Tests
- [x] Requester submits → Secretary → Chairperson → Treasurer
- [x] Cannot approve past Treasurer before Chairperson
- [x] Rejection returns to requester with comment
- [x] Resubmission restarts workflow

#### Expense Workflow Tests
- [x] Treasurer records → Secretary approves → Chairperson approves → FINAL_APPROVED
- [x] Can't skip Secretary or Chairperson

#### Report Workflow Tests
- [x] Dept leader submits → Secretary/Assistant Secretary reviews → Chairperson/Assistant Chairperson final approve
- [x] Rejection resets to "resubmitted"

### 2.5 Impersonation Tests
- [x] Impersonation requires target user approval
- [x] Impersonation session expires after 10 minutes
- [x] Admin cannot silently extend session
- [x] Impersonation actions are audited with `impersonation_session_id`
- [x] UI shows impersonation banner

### 2.6 Member Management Tests
- [x] Secretary can register member
- [x] Gender Leader can register member
- [x] Main Secretary can edit member records
- [x] Non-secretary cannot edit member records
- [x] Member status changes audited
- [x] Graduated status auto-set by system
- [x] Only Secretary can manually change Active/Inactive

### 2.7 Department Transfer Tests
- [x] Transfer requires Old Chair + New Chair + Main Secretary approval
- [x] Transfer incomplete before Main Secretary approval
- [x] Transfer recorded in audit

### 2.8 Finance Tests
- [x] Contributions editable only with Secretary + Chairperson approval
- [x] Expenses require Secretary + Chairperson approval for create/edit/delete
- [x] Budgets require Secretary + Chairperson approval
- [x] Money request follows multi-stage approval

### 2.9 IT Content Tests
- [x] IT content requires IT Department Secretary + Chairperson approval for publish/delete
- [x] Any IT member can edit (but edit requires approval)

### 2.10 Recycle Bin Tests
- [x] Deleted records retained 30 days
- [x] Admin/Secretary/Assistant Secretary can restore
- [x] Admin/Secretary can permanently delete

### 2.11 Backup Tests
- [x] Backups run every 12 hours (cron check)
- [x] Backup file exists and is valid
- [x] Restore creates safety backup first
- [x] Restore warns user and asks confirmation
- [x] Restore logged in audit

### 2.12 Notification Tests
- [x] Notifications generated for all events
- [x] Unread count accurate
- [x] Mark as read works
- [x] Notifications scoped to recipients

### 2.13 Audit Tests
- [x] All important actions create audit entries
- [x] Audit entries contain user, action, entity, timestamp
- [x] Changes include old + new values
- [x] Approvals include approver, stage, decision, comment
- [x] Impersonation actions linked to session

### 2.14 PWA Tests
- [x] Installable on mobile/desktop
- [x] Offline shell loads
- [x] Offline mutations sync on reconnect
- [x] Service worker registered

## 3. Test Data Strategy

- Test database is a separate PostgreSQL instance (or Docker container)
- Seeded with test users, roles, departments, members
- Test data is reset before each test suite run
- No production data in tests

## 4. Running Tests

```bash
# Backend unit + integration tests
cd backend
npm test

# Frontend unit tests
cd frontend
npm test

# E2E tests (Cypress)
npm run test:e2e
```

## 5. CI/CD Integration

- Tests run on every commit (GitHub Actions / similar)
- All tests must pass before merge
- Critical authorization tests are required gates
