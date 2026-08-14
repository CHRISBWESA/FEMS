# Fellowship Management System - Task Breakdown

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
- [ ] Create backend project structure (NestJS)
- [ ] Create frontend project structure (React + Vite PWA)
- [ ] Set up Docker Compose (PostgreSQL, Redis)
- [ ] Implement database schema (Prisma models)
- [ ] Run migrations
- [ ] Create indexes and constraints
- [ ] Seed data for development

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

## Final
- [ ] Run full test suite
- [ ] Fix all authorization and workflow issues
- [ ] Final documentation review
