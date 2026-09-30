# Fellowship Management System - Security

> **Read this first.** The sections below the line ("Original design") were written before the system was built and describe
> the *intent*. Where they differ from what runs today, this status section is authoritative. The audit of what is actually
> implemented, with severities and evidence, is [PHASE_22_SECURITY_REPORT.md](PHASE_22_SECURITY_REPORT.md).

## Implementation status (what actually runs)

| Design statement | Reality |
|---|---|
| JWT in HttpOnly, Secure, SameSite cookies | **Not implemented.** The API authenticates by `Authorization: Bearer` header only (an `accessToken` cookie is deliberately ignored). The web app keeps the access and refresh tokens in `localStorage`, which any script running in the page can read - an **accepted risk** (report O-01) mitigated by a 15-minute access token, revocation on password change, and a recommended Content-Security-Policy on the static host. Because no cookie carries authentication, CSRF does not apply |
| Refresh tokens stored server-side, session table, IP/device binding, concurrent-session limits | **Not implemented.** Sessions are stateless JWTs plus `users.token_version`: changing or resetting a password, or an administrator resetting it, bumps the version and ends every earlier session at once. Deactivating a user, or suspending a fellowship, is checked on every request. The web app refreshes access tokens silently with the 7-day refresh token; a refresh token is refused as a bearer token. There is no refresh-token rotation and no list of sessions |
| Rate limit: 5 failed logins / 15 min / IP+account; 100 requests/min | **Different.** Per account: 8 failures inside 15 minutes lock the account for 15 minutes (a locked account answers exactly like a wrong password). Per client address: sign-in, refresh and password routes 10/minute, the public attendance link and payment webhook 30/minute, everything else 600/minute (tunable, see [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md)); counters are in process memory |
| Impersonation with owner approval | **Retired** (routes answer 410). Replaced by scoped, time-boxed, tenant-approved *support access* for platform-support staff; the platform administrator has no access to tenant data |
| Passwords: bcrypt 12 rounds, reset by random token | bcrypt cost 12 (implemented). Policy: at least 10 characters, not a common password, not built from the account's own name or e-mail. A reset generates a random one-time temporary password that must be changed at the next sign-in (enforced by the server on every route and by the web app) |
| Validation with class-validator DTOs | **Not used.** Controllers take plain interfaces; services validate by hand with shared helpers (`validateText`, `validateAmount`, `validateDate`, `validateRequiredUuid`, ...). Every route was fuzzed with wrong types, nulls, oversized values, NUL bytes and prototype-pollution keys (no 5xx, no leaks - `security-fuzz.int-spec`). NUL bytes are refused globally with 400 |
| "No raw SQL with user input" | Raw SQL exists (reports, lock-out counters, row locks) and is always parameterised through Prisma's tagged templates; no SQL string is built from input |
| Store files outside the web root, restrict per permission | Uploaded file **bytes are not stored at all** (type by content signature, size limit, sanitised names; metadata only). There is no download route to authorise |
| IDOR: ids non-enumerable, ownership checked | Tenant and department ownership are enforced in services and guards; the repository contains four independent sweeps (`security.int-spec`, `security-fuzz.int-spec`, `security-tenant-refs.int-spec`, `platform.int-spec`). They are **skipped without `TEST_DATABASE_URL`**, so runtime certification remains pending. |
| Input writes and references | Activity, announcement, document, report and user-role writes use explicit field maps; referenced departments/documents must belong to the authenticated tenant. Direct activity detail uses the same audience rule as lists. |
| Role escalation | Tenant users cannot change their own account or grant/manage protected Secretary/Treasurer/Chairperson roles. Platform administrators can provision tenant leadership through the platform tenant workflow. |
| Public attendance | Anonymous check-ins are name-only, time/tenant/audience/cancellation restricted, rate limited and deduplicated with a partial unique key. |
| Secure headers, CSP | `helmet` on the API (HSTS, nosniff, frame options, CSP `default-src 'self'`, ...). The **static frontend host must add its own** CSP and cache headers ([PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)) |
| Audit logging without sensitive content | Append-only `audit_logs`, scoped per fellowship; a redaction step masks any key named like a password, token, secret, key, hash or signature before a row is written; emergency-contact reads/edits log field names only. Application error logs are sanitized and production request logs contain only a request ID, route template, method, status and duration. |
| Backup/recycle honesty | The application never claims to run `pg_dump` or restore; unsupported backup operations return `409` (`OPERATION_UNAVAILABLE`) so they never look like a server fault in alerting. Recycle-bin listings omit original data and restore tokens, and tenant staff cannot act on another tenant's records. |

## Boundaries that are enforced (and tested)

1. **Authentication** -> **tenant status** -> **platform/tenant boundary** (platform accounts cannot reach any tenant route unless it is explicitly marked) -> **role** -> **module availability** (per fellowship and plan) -> **department scope** -> **resource** (fellowship, department, gender, ownership checks in the services).
2. **Approval chain**: a money request needs Secretary, then Chairperson, then Treasurer, each by a different person, decided atomically; the requester can never approve their own request.
3. **Finance and billing are separate**: SaaS billing never reads or writes fellowship finance tables (tested, including a source scan); no card data is stored anywhere.
4. **Offline attendance** is re-authorised on the server for every operation; nothing cached by the service worker contains API data.

## Reporting a vulnerability

Tell the system owner privately; do not include personal data in the report. Rotate secrets first if credentials may be exposed
([INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)).

---

# Original design (intent, partly superseded - see the status table above)

## 1. Authentication

### 1.1 Password Handling
- Passwords hashed with **bcrypt** (12 rounds, salted per user)
- Never store or return plaintext passwords
- `must_change_password` flag for forced initial password change
- Password reset generates secure random token (not old password), emailed via in-app notification token
- Rate limit login attempts (5 failed attempts per 15min per IP+account)

### 1.2 Session Management
- JWT access tokens (short-lived, 15 min expiration) stored in **HttpOnly, Secure, SameSite=Strict** cookies
- Refresh tokens for silent re-authentication (longer-lived, stored server-side with user session tracking)
- Logout: clear cookies + invalidate refresh token server-side
- Sessions tracked server-side (session table) with IP/device binding
- Concurrent session limits per user (configurable)

### 1.3 Impersonation Security
- Admin must request impersonation → target user (account owner) receives in-app approval notification
- Target user must approve via notification before impersonation begins
- Session limited to **10 minutes** then auto-expires
- Cannot silently extend; new request required
- Every action during impersonation recorded in audit with `impersonation_session_id`
- UI clearly shows banner: "ADMIN IMPERSONATING [username]"
- Admin cannot impersonate another Admin

## 2. Authorization (RBAC)

### 2.1 Role-Based Access Control
- Each user has zero or more roles
- Each role has zero or more permissions
- Permissions are granular: `member.create`, `member.edit`, `finance.view_contributions`, etc.
- Roles are assigned per-user (can hold multiple roles)

### 2.2 Permission Model

| Role | Key Permissions |
|------|-----------------|
| Admin | ALL permissions; user management; system settings; backups; recycle bin; impersonation |
| Secretary | members.*, departments.*, activities.*, reports.review, leadership.*, password.reset_any |
| Assistant Secretary | Same as Secretary except: reports.review is shared; backup.restore is allowed; member.status_change is allowed; excludes "secretary-only" approvals |
| Chairperson | approvals.chair.*, finance.view, reports.view_department_reports, IT.content.final_approve |
| Assistant Chairperson | Same as Chairperson; approvals.chair is interchangeable with Chairperson |
| Treasurer | finance.contributions.*, finance.expenses.*, finance.budgets.*, finance.money_requests.manage |
| Department Secretary | department_leaders.manage (own dept), department_members.manage (own dept), department_activities.*, department_reports.submit, department_finance.view |
| Department Chairperson | Same as Department Secretary; department_approvals.manage |
| Gender Leader | members.register (own gender), gender_group.manage |
| Ordinary Member | own_profile.view, activities.view_invited, announcements.view, documents.view_own_dept, notifications.view, attendance.confirm |

### 2.3 Department-Level Scoping (Critical)
- All queries for department-scoped resources include `WHERE department_id = <user's department>`
- **Never** rely on frontend filtering
- Guards validate department ownership before serving data
- Example: IT member cannot access `/department/choir/member/123` by changing URL — server rejects

### 2.4 Approval Workflow Enforcement
- Approvals are **server-side only** state machines
- Cannot bypass by directly setting database fields
- Each approval has: stage_order, approver_role, approver_user_id, status
- Workflow enforced by checking current_stage and validating the acting user is the designated approver
- States: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → (if approved) FINAL_APPROVED, (if rejected) RESUBMITTED → loop

## 3. Protection Against Common Attacks

### 3.1 IDOR (Insecure Direct Object Reference)
- All entity endpoints validate ownership/permissions before returning data
- UUID v4 used for all entity IDs (non-enumerable)
- Example: `/members/abc-123` — server checks `current_user can read member abc-123`

### 3.2 CSRF (Cross-Site Request Forgery)
- JWT in HttpOnly Secure SameSite=Strict cookies (mitigates CSRF significantly)
- Double-submit token pattern for state-changing requests that use cookies
- All POST/PUT/PATCH/DELETE endpoints validate CSRF token
- SameSite=Strict prevents cross-origin sends

### 3.3 XSS (Cross-Site Scripting)
- Output encoding on all dynamic content
- Content Security Policy (CSP) headers
- No client-side HTML rendering without sanitization
- React auto-escaping on all interpolations

### 3.4 Rate Limiting
- Login: 5 failed attempts / 15 min / IP+email
- General: 100 requests/min per IP (configurable)
- File upload: 20 uploads/min per user
- Password reset: 3 per hour per account

### 3.5 File Upload Security
- Validate file type (whitelist: images, PDFs, documents)
- Validate file size (max 10MB)
- Generate safe filenames (UUID-based, no user input in path)
- Store files outside web root or behind access-controlled route
- Restrict access per permissions
- Scan for malicious content (basic MIME validation)

### 3.6 SQL Injection
- Use Prisma ORM — parameterized queries by default
- No raw SQL with user input
- Input validation with class-validator DTOs

### 3.7 Privilege Escalation
- Roles/permissions checked in guards, not just frontend
- Cannot modify own roles/permissions
- Cannot access endpoints without required permission

## 4. Input Validation & Output Encoding

### 4.1 Validation
- All API inputs validated with `class-validator`
- DTOs define required fields, types, max lengths, formats
- Sanitization: trim strings, escape dangerous input

### 4.2 Output Encoding
- JSON responses are inherently safe (no HTML)
- For rich text (announcements), sanitize HTML on output
- CSP headers prevent injected scripts

## 5. Secrets Management

- Use `.env` files — never commit secrets
- `.env.example` provided with placeholder values
- Secrets: JWT_SECRET, DB_PASSWORD, ENCRYPTION_KEY, etc.
- Docker secrets or Kubernetes secrets in production
- Rotate secrets policy documented

## 6. Environment Variables

See `.env.example`. Key variables:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret (64+ char random)
- `JWT_ACCESS_EXPIRES_IN` — Access token expiry (default: 15m)
- `JWT_REFRESH_EXPIRES_IN` — Refresh token expiry (default: 7d)
- `BCRYPT_ROUNDS` — bcrypt rounds (default: 12)
- `RATE_LIMIT_WINDOW_MS` — Rate limit window
- `RATE_LIMIT_MAX` — Max requests per window
- `BACKUP_INTERVAL_HOURS` — Backup frequency (default: 12)
- `UPLOAD_MAX_SIZE` — Max upload size in bytes (default: 10MB)
- `ALLOWED_FILE_TYPES` — Comma-separated whitelist

## 7. Logging & Monitoring

- Application logs (stdout for container aggregation)
- Audit logs (separate table, immutable)
- Security event logging (failed logins, permission denied, etc.)
- Rate limit violation logging

## 8. Database Security

- PostgreSQL with least-privilege database user
- No public schema access from app
- Connection pooling
- Database-level constraints for data integrity
- Row-level security not required (application enforces via filters)

## 9. Secure Headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

## 10. Error Handling

- Never expose database errors, stack traces, or secrets
- Generic error messages for users
- Detailed errors only in logs
- 403 when permission denied (not 404 — avoids enumeration)
