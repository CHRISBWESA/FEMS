# Fellowship Management System - Key Architecture Decisions

## 1. Tech Stack Choice

**Decision**: Backend = NestJS (Node.js TypeScript), Frontend = React + Vite PWA, DB = PostgreSQL, ORM = Prisma
**Rationale**: NestJS provides modular architecture with built-in guards/interceptors ideal for complex RBAC. React + Vite gives fast PWA development. PostgreSQL ensures relational integrity. Prisma provides type safety and migration tooling.

## 2. Authentication Strategy

**Decision**: JWT access tokens in HttpOnly Secure SameSite=Strict cookies + refresh tokens in DB
**Rationale**: HttpOnly cookies prevent XSS-based token theft. SameSite=Strict mitigates CSRF. Short-lived access tokens reduce exposure window.

## 3. Approval Engine

**Decision**: Centralized approval state machine (not per-feature)
**Rationale**: Requirements specify reusable approval system supporting: approver role, approver user, approval stage, approved/rejected status, comment, timestamp, required sequence, resubmission. A centralized engine avoids duplicating logic per finance/IT/reports module.

## 4. Department Data Isolation

**Decision**: Server-side enforced on every query; not just frontend hiding
**Rationale**: Requirement explicitly states "Never rely on hiding UI elements for security." All queries for department-scoped resources filter by the authenticated user's department.

## 5. Notification Channel

**Decision**: In-app notifications ONLY
**Rationale**: Requirements say "Use: IN-APP NOTIFICATIONS ONLY. Do not implement email, SMS, or WhatsApp notification delivery unless explicitly added later."

## 6. Recycle Bin Retention

**Decision**: 30-day hard retention, then permanent deletion by scheduled job
**Rationale**: Requirements specify "Deleted records remain in the recycle bin for 30 DAYS."

## 7. Backup Frequency

**Decision**: Every 12 hours via cron job
**Rationale**: Requirements specify "Backups must run: Every 12 hours."

## 8. Impersonation

**Decision**: Approval-required 10-minute session with audit trail
**Rationale**: Requirements: "Admin requests impersonation → account owner approves → Admin can impersonate for 10 minutes." Cannot silently extend.

## 9. File Storage

**Decision**: Local filesystem with metadata in DB; architecture allows S3 swap
**Rationale**: Simpler for initial deployment. File access routes through API for security.

## 10. Approval State Enforcement

**Decision**: States enforced server-side via state machine; cannot be bypassed via direct DB writes
**Rationale**: Requirement: "Never allow a user to bypass an approval workflow by directly changing database status."

## 11. Password Reset

**Decision**: Token-based reset (generate reset token, deliver in-app), never expose old password
**Rationale**: Requirement: "Never expose the user's old password."

## 12. Graduation Status

**Decision**: System automatically sets "Graduated" based on expected graduation date + current date
**Rationale**: Requirement: "Graduated: Automatically determined by the system using the registered graduation date."

## 13. Department Transfer Approval

**Decision**: Full workflow enforced — Old Chair → New Chair → Main Secretary final approval required
**Rationale**: Requirement specifies 7-step workflow ending in Main Secretary approval.

## 14. Department Member Removal

**Decision**: Two approvers (Department Secretary + Department Chair) before removal
**Rationale**: Requirement: "Department removal: Department Secretary + Department Chair approval is required."

## 15. IT Content Approval

**Decision**: IT Department Secretary approval + Chairperson/Asst Chairperson final (publication workflow)
**Rationale**: Requirement: "IT Department Secretary approves IT content. Chairperson/Assistant Chairperson provides final approval."

## 16. Money Request Approval Sequence

**Decision**: Requester → Secretary → Chairperson/Asst Chairperson → Treasurer final (strict sequence)
**Rationale**: Requirement: "The Treasurer can approve only AFTER the Chairperson/Assistant Chairperson has approved."

## 17. Audit Log Storage

**Decision**: Separate audit_logs table, append-only, JSONB for old/new values
**Rationale**: Requirement lists detailed audit fields including old value, new value, approval info, IP/device.

## 18. Finance Edit/ Delete Approval

**Decision**: Treasurer requests edit/delete; requires Secretary + Chairperson approval (not just one)
**Rationale**: Requirement: "Treasurer can edit/delete contribution records only with required approval from Secretary + Chairperson." Uses established approval mechanism.
