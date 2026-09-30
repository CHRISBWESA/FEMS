# Fellowship Management System - Task Breakdown

> **Current-state note (Phase 23):** the phase numbering below is the original offset plan and is not the canonical Phase 14-23 sequence. The dedicated DOCX prompts and [FEMS_FINAL_MASTER_REPORT.md](FEMS_FINAL_MASTER_REPORT.md) are authoritative for current status; unchecked browser/database/operations items remain real blockers.

## Phase 1 — Analysis & Documentation (COMPLETE)
- [x] PRD.md
- [x] ARCHITECTURE.md
- [x] DATABASE.md
- [x] API_SPEC.md
- [x] DESIGN.md
- [x] SECURITY.md
- [x] NOTIFICATIONS.md
- [x] AUDIT.md
- [x] BACKUP_RECOVERY.md
- [x] TESTING.md
- [x] USER_FLOWS.md
- [x] TASKS.md (this file)
- [x] DECISIONS.md
- [x] README.md
- [x] .env.example
- [x] AI_RULES.md

## Phase 2 — Project Setup & Database
- [x] Create backend project structure (NestJS)
- [x] Create frontend project structure (React + Vite PWA)
- [x] Set up Docker Compose (PostgreSQL via Supabase CLI, Redis via root docker-compose.yml)
- [x] Implement database schema (Prisma models) — see backend/prisma/schema.prisma
- [ ] Run migrations — run `npx prisma migrate dev --name init` against the local Supabase Postgres instance
- [x] Create indexes and constraints
- [x] Seed data for development — see backend/prisma/seed.ts

## Phase 3 — Authentication
- [ ] User login/logout endpoints
- [ ] JWT token generation + cookie storage
- [ ] Password hashing (bcrypt)
- [ ] Password reset (token-based)
- [ ] Session management (refresh tokens)
- [ ] RBAC module + guards
- [ ] Impersonation workflow (request → approve → 10-min session → audit)
- [ ] CSRF protection
- [ ] Rate limiting

## Phase 4 — Members
- [ ] Member registration API (Secretary, Gender Leader)
- [ ] Member profile API (read)
- [ ] Member edit API (Secretary only)
- [ ] Member status change (Secretary only; Graduated = system)
- [ ] Graduation date edit (Secretary)
- [ ] Graduation auto-detection job
- [ ] Department membership
- [ ] Frontend: member list, detail, edit, registration forms

## Phase 5 — Departments
- [ ] Department CRUD (Secretary)
- [ ] Department leaders management (Secretary)
- [ ] Custom fields schema management (Department Leaders)
- [ ] Custom field values per member
- [ ] Department isolation (server-side filters)
- [ ] Department transfer workflow (request → old chair → new chair → Secretary)
- [ ] Department removal workflow (Dept Secretary + Dept Chair approval)
- [ ] Frontend: department list, detail, leader management

## Phase 6 — Activities
- [ ] Activity creation (Secretary, Assistant Secretary)
- [ ] Activity audience targeting (all members, department, leaders, group)
- [ ] Activity edit/delete (Secretary, Assistant Secretary)
- [ ] Attendance recording (leaders confirm, shared link for members)
- [ ] Shareable attendance link generation
- [ ] Frontend: activity list, detail, create form, attendance UI

## Phase 7 — Reports
- [ ] Report submission (Department Leaders)
- [ ] Report review (Secretary/Assistant Secretary)
- [ ] Report final approval (Chairperson/Assistant Chairperson)
- [ ] Report rejection with comment
- [ ] Report resubmission after rejection
- [ ] Frontend: report list, detail, submit form, approval UI

## Phase 8 — Finance
- [ ] Contributions (Treasurer records, no approval; edit/delete requires approval)
- [ ] Expenses (Treasurer records + Secretary+Chair approval)
- [ ] Budgets (Treasurer creates + Secretary+Chair approval)
- [ ] Money requests (Secretary/Dept Leaders → Secretary → Chair → Treasurer)
- [ ] Full approval state machine
- [ ] Frontend: finance dashboards, transaction forms, approval workflows

## Phase 9 — Notifications
- [ ] Notification engine (event → notification)
- [ ] Notification center UI
- [ ] Unread count API + UI badge
- [ ] Auto-generation for all defined events

## Phase 10 — IT Content
- [ ] Documents (upload, approval workflow, access control)
- [ ] Gallery (upload, approval)
- [ ] News/Announcements (create, approve)
- [ ] Publication workflow (IT Secretary → Chairperson/Asst Chair)
- [ ] Deletion workflow (IT Secretary + IT Chair approval)
- [ ] Frontend: content management UI

## Phase 11 — Audit Trail
- [ ] Audit logging for all mutations
- [ ] Audit query API (Admin, Secretary, Chairperson)
- [ ] Audit UI (filtered list)
- [ ] Impersonation context in audit

## Phase 12 — Recycle Bin
- [ ] Soft delete implementation
- [ ] Recycle bin API (list, restore, permanent delete)
- [ ] 30-day retention enforcement
- [ ] Restore/ permanent delete permissions

## Phase 13 — Backups
- [ ] Backup scheduler (every 12 hours)
- [ ] Backup API (create manual, list, status)
- [ ] Restore workflow (safety backup + confirmation)
- [ ] Local + cloud storage

## Phase 14 — PWA
- [ ] Manifest configuration
- [ ] Service worker setup
- [ ] Installability (add to home screen)
- [ ] Offline shell caching
- [ ] Background sync for offline mutations

## Phase 15 — Testing
- [ ] All RBAC permission tests
- [ ] Department isolation tests
- [ ] Approval workflow tests
- [ ] Authentication tests
- [ ] Finance workflow tests
- [ ] Notification tests
- [ ] Audit tests
- [ ] PWA tests
- [ ] Fix all critical issues

## Phase 16 — Youth & Children Management
(Requested as "Phase 13"; renumbered here since this project's own Phase 13 is already Backups —
see ARCHITECTURE.md section 9 for the full design and scope decisions.)
- [x] `AgeGroup`, `YouthProfile`, `YouthGuardian` Prisma models + additive `Attendance.youth_profile_id`
- [x] Migration `backend/prisma/migrations/20260922100000_youth_children_management` — applied and verified
      (zero drift vs schema.prisma) on a scratch database; **not** applied to `backend/.env`'s
      `DATABASE_URL`, which points at an unrelated project's database
- [x] `youth.*` permissions + role grants (Secretary/Asst Secretary/Chair/Dept leaders scoped per spec)
- [x] Backend module: participants CRUD, guardians, attendance (reuses `Activity`/`Attendance`),
      age groups + non-overlap validation + recalculation, reports summary
- [x] Field-level privacy stripping (DOB/notes/guardians hidden without the matching permission)
- [x] Frontend: `/youth`, `/youth/:id`, `/youth/age-groups`, `/youth/programs`, `/youth/reports`
- [x] Unit tests (tenant isolation, department scope, permission stripping, cross-tenant guardian
      rejection, attendance linking) + real-Postgres integration smoke test (found and fixed a
      route-shadowing 500 on `GET /youth/age-groups` and UUID-validation gaps)
- [ ] Settings-registry integration — not built (no such system exists in this codebase; see
      ARCHITECTURE.md §9 "What was intentionally not built")
- [ ] Module enable/disable lifecycle — not built (same reason)
- [ ] Point `DATABASE_URL` at a database matching this checkout (`.env.example` expects the local
      Supabase instance on port 54322) and run `npx prisma migrate deploy`

## Phase 17 — Advanced Member & Fellowship Engagement (requested as "Phase 14")
- [x] `MemberProfile`, `MembershipHistory` (+ backfill), `MemberGroup`, `MemberGroupMember` + migration `20260923100000_member_engagement`
- [x] Profile / history / engagement / reports / groups APIs, extra `GET /members` filters, member-linked attendance
- [x] 9 `member.*` permissions + role grants; privacy gating and audit rules (see ARCHITECTURE.md section 10)
- [x] Frontend: member detail tabs, advanced filters, Member Insights, Member Groups, activity member-attendance panel
- [x] Real-Postgres integration suite (`backend/test/integration`, `npm run test:integration`) + unit tests
- [ ] Browser verification of the UI (no browser tooling available in the build environment)

## Phase 18 — Advanced Finance & Contributions (requested as "Phase 15")
- [x] Fixed critical approval bypass, segregation of duties, race-safe decisions, dead create endpoints (see ARCHITECTURE.md section 11)
- [x] Release (payout) of approved money requests with DB-enforced exactly-once; campaigns, categories, income, periods, pledges, receipts
- [x] Reports (fellowship + department scoped), member statements, member self-service giving
- [x] Migration `20260924100000_finance_advanced` (additive) applied + drift-checked on scratch DB
- [x] 26 + 23 real-Postgres integration tests (chain, release, concurrency, edit/delete, validation, scope, reports)

## Phase 19 — Resources & Asset Management (requested as "Phase 16")
- [x] Assets, categories, locations, loans, maintenance, append-only history, document links + migration `20260925100000_resources_assets`
- [x] Race-safe state transitions (conditional updates), cost privacy, department-scoped visibility, reminder endpoint
- [x] Frontend: Resources (assets / maintenance / setup / reports), asset detail, Borrowed Items
- [x] 30 real-Postgres integration tests; migration drift check empty on scratch DB
- [ ] Browser verification of the UI; scheduler for reminders (none exists in this codebase)

## Phase 20 — Volunteer & Service Management (requested as "Phase 17")
- [x] Roles, opportunities, shifts, assignments (application/assignment/attendance) + migration `20260926100000_volunteer_service`
- [x] Race-free capacity and double-booking rules (row locks), coordinators, department scope, neutral notifications, audit
- [x] Reports (aggregates), member service history, skills-based suggestions, endpoint-triggered reminders
- [x] Frontend: Volunteering (opportunities / my service / roles / reports) and opportunity detail with shifts + roster
- [x] 34 real-Postgres integration tests; migration drift check empty on scratch DB
- [ ] Browser verification of the UI; scheduler for reminders; recurring shifts

## Phase 21 — Advanced Analytics & Dashboards (requested as "Phase 18")
- [x] Fixed cross-tenant leak in `GET /dashboard`; youth summary aggregated in SQL
- [x] `/analytics` overview + membership + participation (SQL) and delegated finance / youth / resources / volunteers sections
- [x] Filters (date, financial period, department, event); department/tenant/role boundaries tested; sensitive data excluded
- [x] Migration `20260927100000_analytics_indexes` (evidence-based); client-side CSV export with formula-injection guard
- [x] Frontend Analytics page; 17 real-Postgres integration tests
- [ ] Browser verification; Member Insights (Phase 14) still aggregates in memory (see Phase 22 list)

## Phase 22 — Platform Administration & SaaS Management (requested as "Phase 19")
- [x] Tenant lifecycle (active/suspended) enforced on every request, login, refresh and the public attendance link
- [x] Platform/tenant boundary: `admin` holds platform permissions only; default-deny guard over every route (tested)
- [x] Onboarding workflow, module availability per fellowship, platform dashboard and audit, platform staff
- [x] Scoped, time-boxed, tenant-approved support access (replaces the broken impersonation)
- [x] Fixed: password-reset takeover + constant temporary password, deactivated users still working, cross-tenant audit log, open backups
- [x] Migration `20260928100000_platform_administration`; 36 real-Postgres integration tests
- [ ] Browser verification; token revocation; real backups (the application "backup" is a stub); e-mail delivery

## Phase 23 — Billing, Plans & Subscriptions (requested as "Phase 20")
- [x] Plans (modules + limits as data), subscriptions (trialing/active/past_due/cancelled/expired), history, invoices/receipts
- [x] Entitlements: plan modules through the existing module guard; user/member/storage limits at the creation points
- [x] Provider abstraction + signed, replay-safe, idempotent webhook (no real provider integrated; no online payments)
- [x] Strict separation from fellowship Finance (tests incl. source scan); no card data anywhere
- [x] Migration `20260929100000_saas_billing`; 33 real-Postgres integration tests; frontend plans/subscriptions/billing pages
- [ ] Browser verification; payment provider adapter; scheduler for the maintenance run; invoice PDFs / e-mail

## Phase 24 — Mobile, PWA & Offline (requested as "Phase 21")
- [x] Removed the service-worker cache of authenticated API responses (cross-user / post-logout data exposure)
- [x] Offline attendance recording + member lookup: user-scoped expiring roster, outbox with operation ids, idempotent server sync with re-authorisation
- [x] Migration `20260930100000_attendance_sync_ops`; 14 integration + 23 client unit tests (real IndexedDB implementation)
- [x] PWA icons/manifest, viewport, 16 px inputs, 44 px touch targets, dynamic viewport height, offline/sync banner
- [ ] Verification in a real browser/phone (installability, layouts, real offline); tokens still in localStorage (Phase 22)

## Final
- [ ] Run full test suite
- [ ] Fix all authorization and workflow issues
- [ ] Final documentation review
