# Fellowship Management System - Architecture

> **Current-state note (Phase 23):** the source code is authoritative. The early design sections below that mention cookie authentication, Redis rate limiting, local/S3 file storage, cron backups, React Query, containerized production, or automatic graduation describe superseded intent. The implemented boundaries and operational status are in [FINAL_ARCHITECTURE_STATUS.md](FINAL_ARCHITECTURE_STATUS.md), [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md), and [SECURITY.md](SECURITY.md).

## 1. Overview

```
┌─────────────────────┐    HTTPS    ┌──────────────────────────┐    ┌──────────────────┐
│  Frontend (PWA)     │◄───────────►│  Backend (RESTful API)    │◄──►│  PostgreSQL      │
│  React + Vite       │             │  NestJS (Node.js)         │    │  Relational DB   │
│  Service Worker     │             │  JWT + Session            │    │  ACID            │
│  Manifest           │             │  RBAC Guards              │    │  Constraints     │
│                     │             │  File Storage (local/s3)  │    │                  │
└─────────────────────┘             └──────────────────────────┘    └──────────────────┘
```

## 2. Technology Stack

### Frontend
- **Framework**: React 18 (Hooks, Context API for state management)
- **Build Tool**: Vite (fast HMR, PWA plugin included)
- **Styling**: Tailwind CSS (responsive, accessible)
- **PWA**: Vite PWA plugin (service worker, manifest, offline caching)
- **HTTP Client**: Axios with interceptors for auth
- **State Management**: React Query for server state, Context for auth

### Backend
- **Framework**: NestJS (modular, TypeScript, built-in DI, guards, interceptors)
- **ORM**: Prisma (type-safe, migrations, relations)
- **Database**: PostgreSQL
- **Authentication**: JWT + HttpOnly Secure cookies + Session tracking
- **Password Hashing**: bcrypt (salted, 12 rounds)
- **File Storage**: Multer for uploads, local filesystem (configurable to S3 later)
- **API Format**: RESTful JSON

### DevOps
- **Containerization**: Docker + Docker Compose (app, db, redis for rate limiting)
- **Configuration**: Environment variables (.env files)
- **Logging**: NestJS Logger + structured audit logs
- **Monitoring**: Basic health checks (extendable)

## 3. Architectural Principles

1. **Server-side authority**: All permissions, data isolation, approval workflows enforced on the server. No trust in frontend.
2. **Security by default**: RBAC guards on every endpoint, input validation, output encoding, CSRF tokens, rate limiting.
3. **Audit-first design**: Every mutation creates an audit log entry.
4. **Approval engines**: Reusable approval system for finance, reports, IT content, contributions edits, etc.
5. **Department isolation**: Queries filtered by department scope using guards.
6. **Separation of concerns**: Modular design (auth module, members module, departments module, finance module, etc.).

## 4. Module Structure (NestJS)

```
src/
├── auth/
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   ├── local.strategy.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── rbac.guard.ts
│   │   ├── impersonate.guard.ts
│   │   └── department.guard.ts
│   ├── decorators/
│   │   ├── roles.decorator.ts
│   │   └── permissions.decorator.ts
│   └── strategies/
├── members/
├── departments/
├── activities/
├── reports/
├── finance/
├── notifications/
├── audit/
├── recycle-bin/
├── backups/
├── it-content/
├── youth/
│   ├── youth.controller.ts        # participants, guardians, attendance, reports summary
│   ├── youth.service.ts
│   ├── youth-age-groups.controller.ts
│   └── youth-age-groups.service.ts
├── shared/
│   ├── approval-engine/
│   ├── notification-engine/
│   └── utils/
└── app.module.ts
```

## 5. Security Architecture

See SECURITY.md for full details. Summary:

- **Authentication**: JWT in HttpOnly Secure SameSite=Strict cookies
- **RBAC**: Role-based guards with permission constants
- **Department Scoping**: Department context injected per request
- **CSRF Protection**: Double-submit cookie pattern or same-origin checks + CSRF token
- **Rate Limiting**: Redis-based throttling (express-rate-limit equivalent)
- **IDOR Protection**: All entity access validated against user's role/department
- **Input Validation**: class-validator + DTOs for all inputs
- **Output Encoding**: Automatic via ORM + response sanitization

## 6. Data Flow

1. Client sends authenticated request with JWT cookie
2. NestJS Passport strategy validates JWT
3. RBAC guard checks permissions against user's roles
4. Department guard scopes data access
5. Controller receives validated, authorized request
6. Service applies business logic + approval state machine
7. Audit service logs every mutation
8. Notification engine generates in-app notifications
9. Response returned to client

## 7. Deployment

- **Development**: Docker Compose (app, db, redis)
- **Production**: Containerized, behind nginx reverse proxy, HTTPS, env-based config
- **Backups**: Cron job every 12 hours (pg_dump), stored local + cloud
- **Monitoring**: Health endpoint, logs to stdout for aggregation

## 8. PWA Architecture

- **Service worker** (vite-plugin-pwa / Workbox `generateSW`): precaches the built app shell only, with a
  navigation fallback to `index.html` (never for `/api/`). API responses are never cached or intercepted.
- **Manifest**: standalone display, theme colour, PNG icons (192/512, maskable, Apple touch icon).
- **Offline**: the app shell opens offline; attendance recording (with a downloaded member list) works offline
  and syncs safely - see section 17 for exactly what is and is not supported. There is no generic offline
  mode and no background sync.
- **Installability**: manifest + icons + service worker are in place; not verified in a browser.

## 9. Youth & Children Management

Manages youth/child participants, their guardians, age groups, and (via existing modules)
programs, attendance, documents and reports. Introduced as Phase 13.

### Entities (`backend/prisma/schema.prisma`)

- **`AgeGroup`** — fellowship-configurable ranges (name, min_age, max_age, description,
  is_active, display_order). Ranges are validated as non-overlapping per fellowship at the
  service layer (no DB exclusion constraint — this schema doesn't use those elsewhere).
- **`YouthProfile`** — the participant record. **Does not reuse `Member`**: `Member` requires
  `expected_graduation_year`/`expected_graduation_month` and carries campus-fellowship-specific
  fields (`programme`, `year_of_study`, `university`) that don't apply to a child with no
  graduation timeline; forcing placeholder values would corrupt Member-based reporting.
  `member_id` is nullable+unique so an older "youth" who also holds an adult-style Member record
  can still be linked. `age_group_id` is auto-resolved from `date_of_birth` on create/update, and
  can be bulk-refreshed via `POST /youth/age-groups/recalculate` after age-group config changes
  (no scheduled job — recalculation is on-demand only).
- **`YouthGuardian`** — links a `YouthProfile` to an existing `Member` (guardians are not a new
  person type), with `relationship_type`, `is_primary`, `consent_status`. A participant may have
  zero, one, or many guardians. The service layer rejects a guardian whose `fellowship_id`
  differs from the participant's, preventing cross-fellowship linking even for admin.
- **`Attendance.youth_profile_id`** — the one existing-model change: an additive, nullable FK
  (mirrors the existing nullable `member_id` column) so a child without a `Member` record still
  gets structured, queryable attendance history instead of only the free-text
  `recorded_by_name` field. Fully backward compatible — every existing `Attendance` caller is
  unaffected.

### Deliberately reused, not duplicated

- **Programs/meetings/attendance UI** — no new `YouthProgram` entity. A fellowship creates a
  Department (e.g. "Children's Ministry") through the existing Departments CRUD, then uses the
  existing `Activity`/`Attendance` create/edit/attendance-recording flow with
  `audience_type: 'department'`. `/youth/programs` in the frontend is a thin department-filtered
  view over `/activities` that links straight into the existing `ActivityDetail` page.
- **Documents** — no new document model/permissions. A participant's "Documents" tab queries the
  existing `/it-content/documents` endpoint filtered by the participant's `department_id`.
- **Notifications, Audit, Approval engine** — reuse `NotificationEngineService`, `AuditService`,
  and (where genuinely needed) `ApprovalEngineService` exactly as every other module does. Youth
  CRUD itself is direct (not approval-gated), matching how Member registration works.

### Permissions

Thirteen `youth.*` permissions added to `shared/authorization/permissions.ts` (view,
details_view, create, edit, status_change, guardians_view/manage, age_groups_manage,
attendance_view/manage, reports_view, safeguarding_view/manage). Deliberately no
`youth.programs.*` or `youth.documents.*` — those actions are gated by the underlying
Activities/IT-Content permissions they reuse, avoiding two independent permission gates on one
resource.

Role grants (`shared/authorization/roles.ts`) follow the precedent already set for Members:
Secretary gets the full set; Assistant Secretary gets create/view but not edit/status-change
(mirrors the Member.edit split); Chairperson/Assistant Chairperson get view+reports only
(oversight, not blanket child-detail access); Treasurer gets none (finance access ≠ youth
access, an explicit requirement); Department Secretary/Chairperson get view/details/guardians
view/attendance scoped to their own department, enforced in the service layer the same way
`members.service.ts` scopes department leaders to `MEMBER_VIEW_OWN_DEPT`.

**Known deviation**: Admin inherits every permission (via the existing `Object.values(PERMISSIONS)`
pattern already used for every other module in this codebase), so Admin also gets full Youth
access. A stricter "even Admin shouldn't get blanket child data" rule would require a
Youth-specific exception to how Admin works everywhere else in this app — out of scope for this
phase; noted here rather than silently ignored.

### Privacy / safeguarding model

`YouthService` strips sensitive fields from API responses based on the caller's permissions
(date of birth/age/gender require `youth.details_view`; safeguarding notes require
`youth.safeguarding_view`; guardians require `youth.guardians_view`/`_manage`). This is the first
field-level access control in this codebase — every other module gates at the endpoint/query
level only — introduced specifically for Youth's privacy requirement rather than generalized
elsewhere. No youth/child data is exposed through any public/unauthenticated endpoint.

### What was intentionally not built

- **A settings-registry system** — no per-fellowship configuration store exists anywhere in this
  codebase (no `Settings` model). Rather than introduce one for a single module, Youth
  configurability is expressed through real domain models instead (`AgeGroup` rows *are* the
  age-group configuration).
- **Module enable/disable lifecycle** — no `Module`/`TenantModule` concept exists in this
  codebase; every NestJS module is always active. Building a module-lifecycle system was judged
  out of scope for adding one feature module.

Both were explicitly requested by the original Phase 13 spec (written for a more advanced,
multi-tenant "ModuleDefinition"-based version of FEMS that this checkout is not), and are
recorded here as scope decisions, not oversights.

## 10. Member Engagement (Phase 14)

Enriches the existing Members module. Everything builds on what this checkout actually has (static
`ROLE_DEFINITIONS` RBAC, `fellowship_id` scoping via `TenantScopeService`, `Activity`/`Attendance`,
`DepartmentMember`, in-app `Notification`). There is no Events/Meetings/Communications module here, so
"event participation" = `Activity` attendance and communication preferences are informational (FEMS
delivers in-app notifications only).

### Audit of what already existed
| Area | Existing | Decision |
|---|---|---|
| Member profile | name, phone, email, gender, programme, year_of_study, university, graduation, status | Education **not** duplicated. Added only occupation, membership date, skills, interests, service interests, preferred channels, emergency contact |
| Status history | only the last change on `Member` (older values buried in `audit_logs` JSON) | New auditable `MembershipHistory` |
| Groups | Departments only | New lightweight `MemberGroup` |
| Attendance | recorded **by name only**; `member_id` was never set by any UI | New authenticated member attendance; public endpoint hardened |
| Reports | `Report` = narrative department report workflow, not analytics | Aggregate endpoint (same approach as Youth) |

### Data model
`MemberProfile` (1:1 with `Member`, separate table because `GET /members` returns raw `Member` rows to
department/gender leaders - a sensitive column there would leak immediately), `MembershipHistory`
(event types registered / status_changed / department_joined / department_transferred /
department_removed; department ids are plain scalars so history survives removal of what it refers to;
written in the **same transaction** as the change it records; the migration backfills a baseline
timeline), `MemberGroup`, `MemberGroupMember`. `MembershipStatus` is unchanged (active/inactive/
graduated) - "transferred" is a history event, "archived" is inactive plus a reason.

### Permissions (`member.*`)
`profile_view/edit`, `emergency_view/edit`, `history_view`, `engagement_view`, `reports_view`,
`groups_view/manage`. Secretary: all. Assistant Secretary: all but `emergency_edit`. Chair/Asst Chair:
`reports_view`, `groups_view` (aggregate only). Department Secretary/Chair: `profile_view`,
`engagement_view`, `reports_view`, scoped to members **actively** in their own department (engagement
counts only their department's activities). Treasurer, Gender Leader, Ordinary Member: none. Admin: none since Phase 19 (see section 15)
(existing convention). Attendance recording reuses `activity.attendance`.

### Privacy model
* Emergency contact requires its own permission; reading it is audited; audit metadata never contains
  emergency values (only that they changed).
* `GET /members` list rows never contain occupation/emergency data; tags appear only with `profile_view`.
* Every new search filter requires its permission and returns **403 (never silently ignored)** without it;
  free-text `search` is not widened to profile fields.
* Engagement is facts only (no composite score). Youth involvement is shown only to callers with
  `youth.view` + `youth.guardians_view` who are not department-scoped.
* Aggregate reports contain no names; tag summaries need `profile_view`.

### Endpoints
`GET|PUT /members/:id/profile`, `GET /members/:id/history`, `GET /members/:id/engagement?days=`,
`GET /members/reports/summary?months=&days=`, `member-groups` CRUD + bulk add/remove,
`POST /activities/:id/attendance/members`, extra `GET /members` filters (skills, interests,
serviceInterests, joinedFrom/To, groupId, attendedWithinDays, notAttendedWithinDays).
Response casing: new dedicated endpoints are camelCase; additive `profile` on list rows is snake_case to
match the existing row shape.

### Security hardening delivered with this phase
* Public `POST /activities/attendance` now ignores a client-supplied `memberId` (previously anyone could
  forge attendance against any member).
* Malformed ids now return 404/400 instead of 500 on all new endpoints and on Youth (Phase 13).
* Phase 13 route-order bug fixed (`GET /youth/age-groups` was captured by `GET /youth/:id`).
* Login JWT / login response now carry role-derived permissions (previously the stale `users.permissions`
  column, and none at all in the login response body).

### Known limitations
* Historical name-only attendance cannot be attributed to members (no fuzzy matching is done); reports
  surface the linked/name-only split.
* Department leaders cannot record member attendance (only holders of `activity.attendance`).
* Backfilled history places pre-existing members at their registration date; older intermediate status
  changes are not reconstructable.
* Emergency contacts are stored in plaintext like other contact fields (no field encryption exists).
* Reports load the scoped member set into memory (fine for fellowship-sized data; revisit for very large tenants).

## 11. Advanced Finance & Contributions (Phase 15)

Extends the existing Finance module (contributions, expenses, budgets, money requests, the shared approval
engine). There is no second finance system. Money-affecting rules are enforced on the server and verified
against real Postgres (`backend/test/integration/finance-*.int-spec.ts`).

### Defects found in the pre-existing module and fixed (baseline measured on real Postgres)
| Finding | Severity | Fix |
|---|---|---|
| **One approval marked a money request/expense/budget `FINAL_APPROVED`** (the chain was decorative) | Critical | Entity status is now written by the approval engine, inside the decision transaction, from the *workflow* status: intermediate approvals give `UNDER_REVIEW`; only the last stage gives `FINAL_APPROVED` |
| Requester could approve their own request; one person could approve several stages | High | Segregation of duties for all finance workflows: submitter may not decide any stage; one person may approve at most one stage |
| Approvals not race-safe: two concurrent deciders could both succeed, so a final-approval side effect could run twice | High | Decision writes are conditional (`step still pending`, `approval still at this stage/status`) in one transaction; the loser gets 409 |
| Contribution/expense/budget creation returned 500 for every payload (camelCase DTO spread into Prisma; `purpose`/`fiscalYear` unmapped) | High (feature dead) | Explicit field mapping + strict validation; `Expense.purpose` column added |
| Unvalidated amounts/dates/ids; a member/department from another fellowship could be referenced; mass assignment (`id`, `fellowship_id`, `approval_status`) | High | Central validators (`finance.validation.ts`), tenant-scoped reference checks that are indistinguishable from "not found", no spread of client bodies |
| Contribution/expense/budget **edit and delete requests never did anything** (workflow type mismatch, edit didn't store changes) | Medium | Requests store validated whitelisted changes; on final approval they are applied *inside the decision transaction* (deletes go to the recycle bin first) |
| Department leaders could not see their own requests (service contradicted controller) | Medium | Department-scoped visibility (own department only; never member giving) |
| `GET /approvals` was admin-only, so it returned nothing for everyone; garbage ids -> 500 | Medium | Role gate widened (the service already filters to the caller's own stages); UUID validation |
| Approver notifications were a stub returning `[]` | Low | Real, tenant-scoped, neutral-text notifications to whoever must act next |

### New capabilities
* **Release (disbursement)** of an approved money request: Treasurer only (not admin, not the requester),
  once, never above the approved amount. Authorization *and* approval state are re-checked inside the
  transaction; `money_request_releases.money_request_id` is UNIQUE so the database guarantees exactly-once
  even under concurrent attempts.
* **Campaigns** (progress = contributions + other income), **categories** (per kind), **income records**
  (non-member income), **financial periods** (closed periods reject new/edited/deleted records dated inside
  them; re-opening needs Secretary/Chairperson and a reason), **pledges** (commitments compared with actual
  contributions; they never create contributions), **receipts** (`receipt_document_id` reuses the documents
  table; must be same-fellowship and not public website content).
* **Reports**: fellowship summary (contributions, income, approved-only expenses, money requests, releases,
  budget vs actual), department-scoped variant for leaders (no member/contribution/income data),
  member statements (finance viewers, audited) and `GET /finance/my-contributions` (a member sees only the
  member record linked to their own account).
* Lists are paginated (`limit`/`page`, total in `X-Total-Count`); reports use `groupBy`/`aggregate`/SQL
  `date_trunc`, not row loading.

### Permissions (`finance.*`, Phase 15)
`category_manage`, `campaign_manage`, `income_record`, `period_manage`, `pledge_manage`, `release_record`,
`reports_view`, `department_view`, `member_statement_view`. Treasurer/Secretary manage setup; only Treasurer
holds `release_record`; Chair/Assistants get `reports_view` + `member_statement_view`; department leaders get
`department_view` only.

### Known limitations
* Edit/delete requests are decided on the Approvals screen, which requires the *exact* stage role (an
  assistant secretary cannot decide a `secretary` stage there, unlike on the expense/budget/money-request
  endpoints). This is the pre-existing generic behaviour and was left unchanged.
* Budget-vs-actual matches approved expenses to the calendar year in which the fiscal year starts.
* Currency is displayed as `$` (existing behaviour); amounts are stored as Decimal(12,2).
* Receipts are linked by document id; there is no receipt download endpoint because the Documents module
  has none yet (files are stored but never served) - see Phase 22 findings.

## 12. Resources & Asset Management (Phase 16)

Tracks the fellowship's physical assets (sound equipment, chairs, projectors, vehicles, stock such as
hymn books). Everything is tenant-scoped by `fellowship_id` like the rest of the system; it is a separate
module (`backend/src/resources/`, routes under `/resources`) with no changes to existing tables.

### Data model (migration `20260925100000_resources_assets`, additive)
`AssetCategory`, `AssetLocation` (per-fellowship, unique names, deactivate instead of delete), `Asset`
(auto tag `AST-XXXXXX`, unique per fellowship; status `available | checked_out | in_maintenance | retired | lost`;
condition; optional serial, acquisition date/cost, owning department, location, custodian member; consumables
carry `quantity` + `reorder_level`), `AssetLoan`, `AssetMaintenance`, `AssetHistory` (append-only ledger),
`AssetDocument` (links to the existing documents table; no second file store).

### Rules enforced on the server
* **State changes are conditional updates** (`updateMany ... where status = X`, count must be 1) inside a
  transaction: two concurrent check-outs of the same asset cannot both succeed (loser gets 409); a retired
  or lost asset can no longer be edited, transferred, lent or maintained; an asset that is checked out cannot
  be retired, transferred, or sent to maintenance; maintenance start/complete/cancel are each guarded the same way.
* Consumable stock cannot go negative (`adjust-quantity` is a guarded conditional update); consumables are
  adjusted, not checked out.
* **Every change writes an `AssetHistory` row in the same transaction** (created, updated, condition changed,
  transferred, checked out/in, maintenance events, quantity adjusted, documents attached/removed, retired/lost).
  Retiring is the only "delete": records are never removed.
* Tenant safety: an asset, category, location, department, member or document from another fellowship is
  indistinguishable from "not found"; ids are UUID-validated; client bodies are never spread into Prisma.
* Department leaders see and lend only **their own department's** assets (`resources.department_view`); they
  cannot see fellowship-wide assets, other departments' assets, or cost fields.
* **Cost privacy**: `acquisition_cost` and maintenance `cost` are stripped from every response unless the
  caller holds `resources.cost_view` (Secretary, Assistant Secretary, Chair, Assistant Chair, Treasurer, Admin).
* Members can list only their own loans (`GET /resources/my-loans`, resolved from the account's linked member).

### Permissions (`resources.*`)
`view`, `manage`, `assign`, `checkout`, `maintenance_manage`, `retire`, `documents_manage`, `reports_view`,
`cost_view`, `department_view`. Secretary holds all; Assistant Secretary all except `retire`; Chair/Assistant
Chair/Treasurer get view + reports + cost view; department leaders get `department_view`. Platform accounts hold none of these
(Phase 19, section 15).

### Reports and reminders
`GET /resources/reports/summary` (counts by status/category/location/condition/department, value at cost
when permitted, open/overdue loans, open/overdue maintenance, recent movements, low stock).
`POST /resources/reminders/run` sends neutral in-app notifications for overdue loans (to the borrower's own
account) and overdue maintenance (to managers), de-duplicated to once per 24h. **There is no scheduler in this
codebase**, so reminders are triggered by calling the endpoint (e.g. from a cron job / from the UI).

### Known limitations
* Attached documents are linked, not served: the Documents module stores files but has no download
  endpoint (see Phase 22 findings).
* No barcode/QR scanning and no depreciation calculation (out of scope; `acquisition_cost` is informational).
* Loans are per member; a member with no linked user account cannot be notified.
* Verified against real Postgres (30 integration tests) but not in a browser.

## 13. Volunteer & Service Management (Phase 17)

Lets the fellowship publish ways to serve, schedule shifts, take sign-ups, and keep a service history. It
adds no second people/user system: volunteers are existing **Members**, scope comes from existing
**Departments**, an optional shift can link to an existing **Activity**, and messages use the existing
**notification engine**. Module: `backend/src/volunteers/`, routes under `/volunteers`.

### Data model (migration `20260926100000_volunteer_service`, additive; hand-checked for zero drift)
`ServiceRole` (configurable per fellowship; optional `required_skills` tags), `ServiceOpportunity`
(department optional, coordinator = a Member, status `draft | open | closed | cancelled`), `ServiceShift`
(start/end, capacity, optional role, location and Activity; status `scheduled | cancelled`; CHECK constraints:
end after start, capacity 1-1000), `ServiceAssignment` (one row per shift+member, UNIQUE; status
`applied | confirmed | rejected | withdrawn | cancelled | attended | no_show`). The assignment rows are the
service history; there is no separate history table.

### Who can do what
| Actor | Can |
|---|---|
| Any signed-in member | Browse **open** opportunities and their upcoming shifts; apply/withdraw for themselves; see only their own history (`/volunteers/my-service`) |
| Coordinator (any member named on the opportunity) | Create/edit/cancel shifts, see the roster (names + status only), approve/reject applications, remove volunteers, record attendance - for that opportunity only. Cannot edit the opportunity, and cannot place arbitrary members (that would let a non-leader look members up by id) |
| Department leader (`volunteer.department_manage`) | Everything above for their own department's opportunities, incl. creating them and placing members **of their own department** |
| Secretary / Assistant Secretary (`volunteer.manage`) | Everything fellowship-wide, incl. roles, reminders, reinstating people, `volunteer.history_view` |
| Chair / Assistant Chair / department leaders (`volunteer.reports_view`) | Aggregate reports (department leaders: own department only) |
Platform accounts (admin, platform_support) have no access to volunteering at all since Phase 19 (section 15).

### Rules enforced on the server
* **Capacity and double-booking are race-free.** Every booking path locks the shift row (`SELECT ... FOR UPDATE`)
  and then the member row, always in that order (no deadlocks), re-reads the shift under the lock, counts filled
  places, and rejects any overlap with the member's other confirmed/attended shifts (`409`). Verified with
  concurrent requests (6 racing assignments into 2 places -> exactly 2 win; one member into two overlapping
  shifts -> exactly one wins).
* Application decisions and withdrawals are conditional updates; two simultaneous decisions -> one `409`.
* A shift can be booked only while `scheduled` and before it starts; editing times needs an empty shift;
  capacity cannot drop below the confirmed count; cancelling a shift/opportunity cancels all active assignments
  in the same transaction and notifies the volunteers.
* Attendance: only a confirmed volunteer of a shift that has started; `no_show` may be corrected to `attended`
  once, `attended` is final. If the shift is linked to an Activity, an `attended` volunteer also gets a normal
  member-linked `Attendance` row (once), so engagement counts stay consistent.
* Draft/closed/cancelled opportunities do not exist for members (404); other tenants get 403; malformed/unknown
  ids get 404; client bodies are never spread into Prisma; `fellowship_id` always comes from the caller.
* Notifications are neutral (no titles, names or notes) and go only to the affected member/coordinator.
  Reminders (`POST /volunteers/reminders/run`, managers) send one 24-hour notice per confirmed volunteer per
  shift. **There is no scheduler in this codebase**, so something must call that endpoint (cron, or the UI).
* Skill suggestions match a role's `required_skills` to `MemberProfile.skills/service_interests`. Because that is
  profile data it needs `member.profile_view` as well as being a manager/department leader; department leaders
  only see members of their own department; already-placed and conflicting members are excluded.
* Every mutation writes an audit row; reading another member's history is audited too.

### Reports
`GET /volunteers/reports/summary?from&to`: shifts and assignments by status, volunteers, hours served
(attended only), attendance rate, fill rate, by opportunity, by department, monthly trend, unfilled shifts in
the next 14 days. Aggregates only - no names.

### Known limitations
* No recurring shifts (create each occurrence), no waiting list (a full shift can still collect applications
  that a coordinator may approve if a place opens), no e-mail/SMS (in-app notifications only).
* Reminders are endpoint-triggered (no scheduler exists).
* Deleted/deactivated members keep their historical assignments (FK is restrictive; no member hard-delete exists).
* Verified against real Postgres (34 integration tests) but not in a browser.

## 14. Analytics & Dashboards (Phase 18)

A read-only layer (`backend/src/analytics/`, routes under `/analytics`). It stores nothing and copies nothing:
every figure is computed on request from the source tables.

### Audit of what existed
| Finding | Severity | Action |
|---|---|---|
| **`GET /dashboard` counted members, activities and departments across ALL fellowships and returned them to every signed-in user (ordinary members included)** | High (cross-tenant disclosure) | Counts are now scoped through `TenantScopeService`; a platform account now gets platform figures only (Phase 19). Regression-tested with two fellowships |
| Member Insights (Phase 14) already covers membership growth, department distribution and participation, but loads all members and every attendance row of the window into memory | Medium (scale) | Left as is (its response is consumed by the Member Insights page); the analytics membership/participation sections use SQL aggregates instead. Listed for the Phase 22 hardening pass |
| Youth summary (Phase 13) loaded every youth profile to count them | Low | Now two `groupBy` queries |
| `attendance.activity_id` (the join key of every per-event query) and `attendance.member_id` had no index; activities had none on `(fellowship_id, date)` | Low now, grows with data | Migration `20260927100000_analytics_indexes` (3 indexes). Measured on 56k attendance rows: per-event lookup 3.5 ms -> 0.09 ms; the aggregate queries ran in 5-12 ms with or without (the planner uses the activities index, not the attendance ones, at this size) |
| No server-side export exists; only a client-side CSV template download in Members | - | See Exports |
| Modules that do **not** exist here, so nothing is reported for them: welfare, communications (beyond in-app notifications), meetings (Activities are the events), website/CMS, platform administration (Phase 19) | - | Documented gap, not faked |

### Design
* **Same rules as the source module.** Finance, youth, resources and volunteers sections call that module's own
  report service (`FinanceReportsService`, `YouthService.reportsSummary`, `ResourcesReportsService`,
  `VolunteerReportsService`), so their permission checks, tenant scope and department scope apply unchanged
  (e.g. department leaders get no contribution/income data and no youth summary; the treasurer gets no
  membership or volunteer data). `GET /analytics/overview` returns headline numbers only for the sections the
  caller may see and reports failed sections instead of failing as a whole.
* **Membership** (`member.reports_view`): totals by status, monthly registrations/status changes from the audited
  history, active members per department. Department leaders are confined to members currently in their own
  department; a department filter for wide viewers is checked against the caller's fellowship.
* **Participation** (`member.reports_view`): events held and attendance (duplicates counted once; name-only records
  de-duplicated per event by lower-cased name), unique attendees, participation rate against active members, by
  month / audience / department, recent events, and drill-down into one event (`activityId`; another department's
  or fellowship's event is refused). One SQL row per event (capped at 2000, `truncated` flag), never per
  attendance row. **Youth attendance is excluded** and attendee names are never returned.
* **Filters**: `from`/`to` (max five years, `to` not in the future), `periodId` (a financial period of the caller's
  fellowship sets the window), `departmentId` (department leaders are forced to their own; asking for another is
  403), `activityId`, `months`, and `fellowshipId` (ignored for everyone
  else). An age-group filter is not offered: the youth summary already breaks participants down by age group.
* **Exports**: the existing export mechanism is a client-side CSV download; the Analytics page reuses it
  (`frontend/src/lib/csv.ts`) and exports only what the user was already sent, so there is no new server-side
  authorization surface. Cells starting with `= + - @` are prefixed to prevent spreadsheet formula injection.

### Performance
No N+1 queries: each section issues a fixed number of grouped queries. Checked with a 40-event x 75-attendee data
set (3000 attendance rows): participation responds in well under a second and the payload stays under 20 KB.

### Known limitations
* Not verified in a browser. No caching (each call recomputes); acceptable at this scale.
* Figures for events recorded by name only cannot be attributed to a member or department (the UI says so).
* Finance analytics inherit Phase 15's definitions (only fully approved expenses count as spending).

## 15. Platform Administration & Tenant Lifecycle (Phase 19)

Platform administration is now separate from fellowship (tenant) operations. A **fellowship** is a tenant
(`fellowships`, scoped by `fellowship_id` everywhere else). Platform accounts belong to no fellowship.

### Audit: what existed and what was wrong
| Finding | Severity | Action |
|---|---|---|
| **The `admin` role held every permission and was global** (any tenant's members, finance, youth safeguarding data, recycle bin), although the UI hid those screens | High (violates least privilege) | `admin` now holds only platform permissions. A global guard (`PlatformBoundaryGuard`) closes **every controller not marked `@PlatformAccess()`** to platform accounts, so future modules are closed by default. Verified over every registered route |
| **Password reset was unscoped**: a Secretary could reset ANY user's password in ANY fellowship - including the platform admin - and always got the constant temporary password `123456789` (account takeover) | **Critical** | Reset is tenant-scoped; platform accounts cannot be reset by tenant staff; nobody resets an admin; an assistant cannot reset the secretary; temporary passwords are 96-bit random |
| **Deactivated/deleted accounts kept working**: the JWT check never looked at `is_active`/`deleted_at`, and refresh tokens (7 days) kept minting access tokens | High | Checked on every request and on refresh |
| **Deactivating a fellowship did nothing** (`is_active` was never read) | High | Real lifecycle (`status`), enforced on every request, at login/refresh, and on the public attendance link |
| **The audit log had no tenant column and `/audit` returned every fellowship's entries to any Secretary/Chairperson** | High (cross-tenant disclosure) | `audit_logs.fellowship_id` (backfilled from the actor); tenant views are scoped; the platform sees platform-level entries only |
| **Impersonation was broken and unsafe**: the approval token was never delivered to the account owner, the issued token was a full copy of the user's access, it was not revocable, and audit entries were not attributed to the impersonator | High if it had worked | Retired (`410 Gone`); replaced by support access grants |
| Backups were open to every Secretary/Assistant and are a **stub**: they only write a database row (no dump, no restore), yet "restore" reports success | High (misleading) / production blocker | Restricted to platform admins. **Real backup/restore does not exist in the application** - see the Phase 23 runbook (`pg_dump`) |
| `ProfileController` was never registered (`GET /profile` answered 404) | Low | Registered; it also lists the fellowship's switched-off modules |

### Tenant lifecycle (only states compatible with the architecture)
`active` and `suspended` (reversible; data kept). `is_active` is kept in step for older code. Suspension
locks out all of the fellowship's users at once (the next request is refused, login and refresh are refused,
public attendance links stop working), ends open support access, requires a recorded reason, and is audited
against the fellowship (so the fellowship sees it). Transitions are conditional writes (409 on repeat).
*Archived/deleted* states and a sub-domain per tenant are not offered: nothing in this architecture resolves a
tenant from the host name, and hard deletion of tenant data is out of scope.

### Onboarding (`POST /platform/onboarding`)
One transaction: fellowship + optional module switches + the first administrator (a Secretary with a
linked member record). The temporary password (random, `must_change_password`) is returned once and never
stored in clear or written to the audit log. A failure leaves nothing behind.
`POST /platform/tenants/:id/administrators` adds another administrator without needing access to the
fellowship's member list.

### Module availability
Optional modules (`finance`, `youth`, `resources`, `volunteers`, `analytics`, `member_engagement`) can be
switched off per fellowship (`fellowship_module_settings`; no row = on, so existing tenants are unaffected).
Enforced by a global guard on the module's controllers (`@RequiresModule`), by the analytics sections, and in
the navigation (`GET /profile` lists switched-off modules). Cached 5 s per process.

### Platform roles and permissions
`admin` (platform administrator: tenants, onboarding, staff, platform audit and dashboard, secretary
accounts, backups) and `platform_support` (read-only tenant status and dashboard; may *request* support
access). Permissions are `platform.*`; a fellowship's Secretary additionally holds `support.access_manage`.
Only a platform admin can assign platform roles; platform administrator accounts are provisioned out-of-band.

### Support access (replaces impersonation)
A platform user requests access to one fellowship for named **scopes** (`tenant_config`, `user_directory` - both
read-only and free of operational data), a reason and a duration (15-240 minutes). The fellowship's
**Secretary** approves or denies (platform accounts cannot approve, not even their own request). An approved
grant is bound to the requester, the fellowship and the scopes, expires on its own, can be ended by either side
at any moment, and is **re-checked on every call**. Each use is audited against the fellowship. Operational data
(members, finance, youth, resources, volunteers, attendance) is deliberately not grantable.

### Platform dashboard and audit
`GET /platform/dashboard`: tenant counts by status, account counts, active fellowships without an active
secretary, module usage, support activity - aggregates only, no names or e-mail addresses.
`GET /platform/audit`: entries of `platform.*` / `support.*` actions and of any platform account.

### Known limitations
* No token revocation: a password or role change does not invalidate already-issued tokens (access tokens live
  15 min; refresh tokens 7 days). Deactivation and suspension DO take effect at once.
* E-mail is not sent anywhere (no mail service exists): temporary passwords are handed over by the operator.
* No per-tenant sub-domain routing; no plan/billing assignment yet (Phase 20).
* Verified against real Postgres (36 integration tests) but not in a browser.

## 16. SaaS Billing, Plans & Subscriptions (Phase 20)

FEMS's own subscription billing for a fellowship (a tenant). It is a **separate domain from the fellowship's
Finance module**: different tables (`saas_*`), different services, different permissions. Nothing here reads or
writes contributions, income, expenses, budgets or money requests, and Finance never references billing (both
are enforced by tests, including a source scan). No card or bank details are stored anywhere (checked against
the schema by a test).

### Audit
There was no billing, plan, subscription or payment-provider code anywhere in the repository (only the tenant
lifecycle and module switches from Phase 19), so this is new. `fellowships.status` and the module switches
were reused rather than duplicated.

### Model (migration `20260929100000_saas_billing`, additive)
`saas_plans` (code, price, currency, month/year interval, trial days, **included modules**, **limits**),
`saas_subscriptions` (one per fellowship, UNIQUE), `saas_invoices` (numbers from a DB sequence; plan name and
price are copied at issue time), `saas_subscription_events` (append-only history), `saas_webhook_events`
(UNIQUE `(provider, event_id)` = the idempotency key). CHECK constraints: price >= 0, amount > 0, period order.

### Plans are configuration
A plan lists optional modules (`shared/modules/modules.ts`) and numeric limits (`shared/billing/plan-config.ts`:
`max_users`, `max_members`, `max_storage_mb`). Adding a limit means one registry entry and one
`EntitlementsService.assertWithinLimit()` call where the counted thing is created (today: user accounts, members
incl. CSV import, document upload). There are no scattered `if plan == ...` checks.

### Subscription states (only those the business model needs)
`trialing -> active -> past_due -> expired`, and `cancelled`. Every change is a conditional write and is added to
the history; each is audited against the fellowship.
* **assign** (with or without the plan's free trial; refused if current usage already exceeds the plan's limits),
  **change plan** (immediate; same usage check), **cancel** (at the end of a paid period, or now; a trial ends now),
  **reactivate** (after payment was arranged), **maintenance** (time-driven: trial past its end -> expired; active
  with an overdue open invoice -> past_due; past_due longer than 14 days -> expired; scheduled cancellation whose
  period ended -> cancelled). There is no scheduler in this codebase, so `POST /platform/billing/maintenance` must be
  called by an administrator or a cron job; it is idempotent.
* **Access is never decided by billing.** Authentication and RBAC are untouched: a lapsed subscription does not stop
  sign-in or core features (members, departments, activities, approvals). It only (a) switches the optional
  modules that the plan does not include - or all of them once cancelled/expired - off, through the same
  `ModuleAvailabilityService` as the platform's module switch (the platform switch always wins), and (b) blocks
  *adding* users/members/documents. A fellowship with **no subscription is unmanaged** and behaves exactly as
  before, so existing tenants are unaffected until a platform administrator assigns a plan.
* Limits are soft (no lock): two simultaneous additions can overshoot by a unit.

### Invoices, payments and receipts
The platform administrator issues an invoice (one open invoice per subscription, enforced under a row lock; free
plans cannot be invoiced), and records the payment received *outside* FEMS (reference required). Applying a
payment is one conditional write (open -> paid), so it can never be applied twice; it moves the subscription to
the invoiced period and restores an overdue or expired subscription (a cancelled one stays cancelled). A paid
invoice doubles as the receipt (`RCP-` number). Invoices can be voided while open. The fellowship's Secretary
sees the plan, status, usage and their own invoices/receipts, read-only; nobody else in the fellowship, and no
other fellowship, can.

### Payments and webhooks - what is and is not integrated
**No payment provider (Stripe, Paystack, M-Pesa, ...) is integrated, and no online payment works.** The code has a
`PaymentProvider` abstraction and one provider-neutral **signed webhook** (`POST /billing/webhooks/signed`, header
`X-Fems-Signature: t=<unix>,v1=<HMAC-SHA256(secret, "t.body")>`, secret `BILLING_WEBHOOK_SECRET`, at least 32
characters; without it the endpoint answers 503 and accepts nothing). A real gateway would need its own adapter.
* authenticated by signature over timestamp + raw body (constant-time compare); requests older than 5 minutes or
  from the future are refused (replay protection);
* idempotent: the event id is stored under a UNIQUE key, redelivery is acknowledged without being applied again,
  the same id with a different body is refused (409), a previously failed event can be retried;
* events can only act on invoices/subscriptions by id, and a payment must match the invoice's amount and currency;
  supported types: `invoice.paid`, `payment.failed`, `subscription.cancelled`; unknown types are acknowledged and
  ignored; permanent problems answer 422 so a provider does not retry forever;
* every outcome is recorded (`saas_webhook_events`) and audited. Payloads are not stored, only a hash.

### Permissions
`platform.billing_view` (admin, support), `platform.billing_manage` (admin only), `billing.view` (a fellowship's
Secretary, own fellowship only). Fellowship users - including the Treasurer - cannot reach platform billing, and
platform accounts cannot reach a fellowship's billing page (they are not fellowship users).

### Known limitations
* No provider adapter, no online checkout, no automatic renewal or invoicing, no proration, no tax handling,
  no PDF invoices, no dunning e-mails (no mail service exists): billing is administered by hand.
* One currency per plan; amounts are `Decimal(12,2)`.
* Verified against real Postgres (33 integration tests) but not in a browser.

## 17. Mobile, PWA & Offline (Phase 21)

### Exactly what works offline
| Works offline | Details |
|---|---|
| **The app shell** | The built app is precached by the service worker, so the installed app opens without a connection. Any page that needs the server shows its normal error / an offline banner until the connection returns |
| **Recording attendance for members** (`activity.attendance`: Secretary, Assistant Secretary) | Download the member list for an activity once while online ("member list"), then tap names to mark people present with no connection. Check-ins are stored on the device and sent automatically when online again (on reconnect, when the tab becomes visible, every 30 s while something is waiting, or "Send now") |
| **Member lookup while checking in** | Search by name or member code within the downloaded list. Nothing else about members is available offline |

**Not supported offline** (deliberately): everything else - finance, youth/safeguarding, resources, volunteers, analytics, approvals, user/platform administration, creating or editing members, and the public name-only check-in link (an anonymous submission cannot be re-authorised later and would invite duplicates and spam; the page says so).

### Audit: what existed
| Finding | Severity | Action |
|---|---|---|
| **The service worker cached every authenticated `GET /api/*` response (NetworkFirst, no expiry, no per-user key)** and nothing cleared it on logout. On a shared device the next user would be served the previous user's members/finance/youth data when the network failed, and the data stayed on disk after sign-out | **High** | The runtime API cache is removed; the service worker now precaches the app shell only and never answers API requests. The built `sw.js` contains a single navigation route |
| The manifest referenced `icon-192.png` / `icon-512.png` that did not exist (no install icon) | Low | Real PNG icons generated (`scripts/generate-icons.mjs`) incl. a maskable icon and an Apple touch icon |
| Architecture text claimed "background sync for offline mutations" - not implemented | Docs | Corrected (section 8) |
| Access and refresh tokens are kept in `localStorage` (readable by any script running in the page) | Medium | **Unchanged** - moving to HttpOnly cookies is an architectural change; recorded for Phase 22. The offline store never touches tokens |
| `.input` text was 14 px (iOS Safari zooms the page on focus), tap targets ~36 px, `h-screen` (100vh) clips behind mobile browser bars | Low | 16 px inputs on phones, 44 px targets on touch devices, `100dvh`, `viewport-fit=cover` + safe-area padding, horizontal scroll on the two tables that lacked it |

### Design
* **The device only remembers what it saw; the server decides again.** `GET /activities/:id/attendance/roster`
  returns id + name + member code only (no phone, e-mail, gender, status) for the caller's fellowship, audited.
  `POST /activities/:id/attendance/sync` takes up to 200 operations `{ opId, memberId, at }`. On every sync the
  caller is authenticated and authorised **at that moment** (a permission revoked, an account deactivated or a
  fellowship suspended while offline stops it), the activity must be in the caller's fellowship, every member is
  checked against the fellowship (unknown and foreign members are indistinguishable), and results come back per
  operation: `applied | duplicate | already_recorded | rejected`.
* **Exactly-once**: `attendance_sync_ops` has UNIQUE `(user_id, op_id)` (op ids are client UUIDs; another user
  replaying an id is judged as a new operation), and a per-activity advisory lock makes "already recorded?" +
  insert atomic - two devices recording the same member produce one row. A rejected operation is final and is
  replayed as `duplicate`. The client removes an operation only after the server confirmed it, sends one run per
  account at a time (double tap / online event / timer can never overlap) and batches by 200.
* **Conflicts**: already recorded by someone else -> confirmed and dropped; member/activity gone -> rejected and
  kept visible with the reason until dismissed; permission gone -> kept, with the reason; session expired
  (401) -> everything kept, sync resumes after signing in as the same account; server trouble -> retried.
  Old check-in times (up to 14 days) are kept, stale or future ones are replaced by the server's time.
* **Local data**: IndexedDB `fems-offline`, only via `src/offline/idb.ts`. `rosters` (per account and activity,
  24-hour expiry, wiped on sign-out and when the session ends) and `outbox` (operation id, activity, member, time,
  no names). No tokens, e-mail, phone or financial data. Unsynced check-ins survive session expiry but are only
  deleted on sign-out after an explicit confirmation, or after 14 days. Another account signing in on the same
  device never sees or sends them. There is no encryption at rest beyond the device's own protection (screen
  lock/OS profile); the exposure is therefore limited to names + codes of one fellowship for at most 24 hours and
  is removed on sign-out.

### Verification
Server: 14 real-Postgres integration tests (authorisation, tenant boundaries, idempotency, concurrency,
re-authorisation, validation, privacy). Client logic: 23 unit tests on a real IndexedDB implementation
(`fake-indexeddb`): queueing, sync outcomes for every response class, single-flight, batching, partial failure,
account isolation, expiry and wipe, plus static guards (no API caching in the service worker, no credentials in
the offline modules, IndexedDB only in `idb.ts`, valid PNG icons).

### Not verified
No browser or device was available: the React screens, the service worker in a real browser, installability,
the actual responsive layouts (only reviewed and adjusted by reading the code), and real offline/reconnect
behaviour on a phone are **NOT VERIFIED**. There is no automated layout test.
