# Fellowship Management System - Security Design

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
