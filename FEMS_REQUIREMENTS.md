# FEMS — running requirements list and true status

Captured so a new session does not need this chat thread.

1. Responsive signup-request rows/details — DONE (RegistrationsTab now uses DataTable with mobile card layout)
2. Rejected signup requests: 30-day retention, rejection count, Pending/Approved/Rejected/All filter, applicant notification via Email/SMS/WhatsApp with recorded status, admin reason — PARTIAL. Filter/counts already existed; retention + notification + status storage NOT built; SMS/email/WhatsApp envs are placeholders only in .env.example
3. Profile page for Fellowship Admin and all accounts, editable name + email (validation, uniqueness, audit, own-only) — DONE (PUT /profile endpoint with validation, uniqueness check, audit trail, own-only)
4. Bulk SMS to members with personalized names ({{firstName}}), preview, recipient filters, delivery tracking, communication-permission gating — NOT DONE (SMS provider envs set, nothing implemented)
5. Treasurer/Mwasibu contribution reminders via SMS, {{firstName}}/{{amount}} placeholders, individual/multi/all/filter, tracked delivery, permission-gated — NOT DONE (same SMS provider blocker)
6. Password visibility (Show/Hide) on all password forms — DONE (AcceptInvitation added the toggle; Login/Register/ForcePasswordChange already had it)
7. Secretary: 15-minute member registration link, countdown and expiry, copy/WhatsApp/Email share, no-account submission, Pending verification queue (Verify & Add / Reject / edit, verifier + timestamp, audit), duplicate guard, filtered member export (.xlsx/.pdf/.csv) — DONE (registration link with 15-min expiry, pending verification queue with Verify/Reject/Edit, duplicate guard, CSV export)
8. Notifications should be in-app message notifications — NOT DONE (Notification centre page exists, not redesigned or adopted)

UI/UX Transformation progress (this session):
- P1 Platform admin: Migrated Billing.tsx, PlatformTenant.tsx, AdminAccounts.tsx to DataTable/ui primitives
- P8 ConfirmDialog/Toast: All 17 window.confirm replaced with ConfirmDialog; ToastProvider wired in main.tsx
- P9 Accessibility: Skip link added, drawer Escape handler, aria-expanded on menu button, focus trap in drawer
- P4 Module pages (partial): FinancePeriodsTab, AssetDetail, Appointments, ForcePasswordChange, MemberGroups, Programmes, PublicSiteAdmin (PostsTab), RecycleBin, SupportAccess, Users, VolunteerOpportunity, MyLoans, Audit, Backups, Volunteering, Analytics, DepartmentDetail, Finance (EmptyState/Alert/Modal), Members migrated to DataTable/ui primitives with server-side paging
- P5 Public fellowship site redesign: FellowshipPages.tsx (16 pages) migrated to shared EmptyState/PageLoader primitives
- P6 Marketing pages beyond hero + PublicShell: PlatformAbout, PlatformFeatures, PlatformSolutions, PlatformResources migrated to Card/StatCard/StatGrid primitives
- P7 Form migration onto Field/Input/Select: Finance.tsx forms migrated to Field/Input/Select/Textarea primitives (18 raw inputs, 11 raw selects replaced)
- P8 ConfirmDialog/Toast: All 17 window.confirm replaced with ConfirmDialog; ToastProvider wired in main.tsx
- P9 Accessibility: Skip link added, drawer Escape handler, aria-expanded on menu button, focus trap in drawer
- P10 Mobile grids: Fixed grid-cols-4/5 without responsive prefixes in Analytics.tsx, Volunteering.tsx, MemberInsights.tsx, Resources.tsx, Platform.tsx
- P11 Typography: Added Inter font family via Google Fonts; set as default font stack

General rule for the next session: backend gets provider envs; everything else is frontend and must be
implemented and verified (tsc + eslint + build + jest). Do not claim delivery for SMS/email until a provider key is present.