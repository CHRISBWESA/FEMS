# AI Development Rules for Fellowship Management System

> **Current-state note (Phase 23):** repository source and the Phase 22/23 reports are authoritative. The rules below that require HttpOnly-cookie JWTs, class-validator DTOs on every route, Redis throttling, scheduled backups, impersonation, or automatic graduation describe the original design and are not claims about the running system. Preserve the actual tenant/RBAC/approval controls and never weaken them to satisfy an older statement.

This document defines constraints and rules for AI-assisted development of this project. Follow these strictly.

## Core Rules

### 1. CONTEXT BEFORE CODE
Always read and understand the relevant documentation files before writing code:
- Before implementing any module, read the corresponding section of PRD.md, ARCHITECTURE.md, DATABASE.md, API_SPEC.md, SECURITY.md.
- Never write application code without first understanding entity relationships, permissions, and workflows.

### 2. DO NOT INVENT BUSINESS RULES
- The requirements in the master prompt are authoritative.
- If a requirement is not specified, choose the simplest safe technical implementation.
- Record any implementation-only decisions in `DECISIONS.md`.
- Never silently invent an important business rule.
- Never change an explicitly defined permission or approval workflow.

### 3. SERVER-SIDE AUTHORIZATION ONLY
- NEVER trust the frontend to enforce permissions.
- Every API endpoint must enforce authorization (RBAC + department scoping).
- Never rely on hiding UI elements for security.
- Never allow bypassing approval workflows by direct DB writes.
- Department data isolation must be server-side enforced.

### 4. SECURITY FIRST
- All mutations must write to the audit log within the same transaction.
- Never expose database errors or secrets to clients.
- All inputs must be validated (class-validator).
- Never expose the user's old password during reset.
- Use parameterized queries (via Prisma ORM).
- JWT in HttpOnly Secure SameSite=Strict cookies.

### 5. APPROVAL WORKFLOWS ARE SACROSANCT
- Use the centralized approval state machine.
- States: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, RESUBMITTED, FINAL_APPROVED, CANCELLED.
- Never allow skipping a stage.
- Each finance approval sequence (Secretary + Chairperson) requires BOTH, in the correct order.
- Money request: Requester → Secretary → Chair/Asst Chair → Treasurer (strict sequence).

### 6. AUDIT EVERYTHING
- Every important action must be logged in `audit_logs`.
- Audit entry: Who + What + When + Target + Result.
- For changes: Old value + New value.
- For approvals: Approver + Stage + Decision + Comment + Time.
- Impersonation actions linked to impersonation session ID.

### 7. DOCUMENTATION MUST BE UPDATED
- After implementing a module, update the relevant documentation.
- Keep API_SPEC.md, DATABASE.md, TASKS.md in sync.
- Add any new decisions to DECISIONS.md.

### 8. TEST-DRIVEN FOR PERMISSIONS
- Create automated tests for every permission combination.
- Before declaring a feature done, write tests that:
  - Confirm a role CAN do permitted actions.
  - Confirm a role CANNOT do restricted actions.
- Department isolation tests must use URL/IDOR-style access attempts.

### 9. IMPLEMENTATION ORDER
Follow the phases strictly:
1. Auth + RBAC (must work before anything else is secured)
2. Members
3. Departments
4. Activities
5. Reports
6. Finance (with approval engine)
7. Notifications
8. IT Content
9. Audit
10. Recycle Bin
11. Backups
12. PWA optimization
13. Final testing

### 10. FINAL DELIVERABLE
Before declaring complete:
- Run the full test suite.
- Fix all critical authorization and workflow problems.
- Verify no unauthorized access paths exist.
- Confirm PWA is installable.
- Confirm backups/restore work.
- Confirm audit logs capture everything.
