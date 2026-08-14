# Fellowship Management System - Product Requirements Document

## 1. Purpose

This document describes the requirements for a Fellowship Management Progressive Web App (PWA) for a Christian fellowship. The system replaces manual/spreadsheet-based processes with a centralized, secure, role-based platform for managing members, departments, activities, finance, reports, and IT/website content.

## 2. System Overview

- **Type**: Progressive Web App (PWA), installable on desktop and mobile
- **Architecture**: Frontend (React PWA) + Backend REST API + PostgreSQL database
- **Security**: RBAC, server-side authorization, department-level isolation, audit trail
- **Key Features**: Member management, department management, activities, finance, reports, IT content, notifications, audit, recycle bin, backups, impersonation

## 3. User Roles

| Role | Description |
|------|-------------|
| Admin | System administrator; manages users, passwords, settings, backups, recycle bin, impersonation |
| Secretary | Manages members, departments, activities, reports, approvals, leadership records |
| Assistant Secretary | Same as Secretary except Secretary-only actions; can restore deleted records, reset passwords, restore backups |
| Chairperson | Approval/oversight; finance viewing, department report viewing |
| Assistant Chairperson | Same as Chairperson; either can perform Chairperson approvals |
| Treasurer | Contributions, expenses, budgets, money requests |
| Department Secretary | Manages own department; scoped to department |
| Department Chairperson | Manages own department; scoped to department |
| Gender Leader | Registers members; manages gender group |
| Ordinary Member | Views own profile, activities, announcements, notifications, documents, attendance |

## 4. Major Features

### 4.1 Member Management
- Registration by Secretary or Gender Leaders (no approval)
- Fields: full name, phone, email, gender, programme/course, year of study, university, expected graduation year/month, membership status
- Status: Active, Inactive, Graduated (auto-determined by graduation date)
- Editing: Main Secretary only
- Reset password: Admin, Secretary, Assistant Secretary, IT Department

### 4.2 Department Management
- Departments have: Secretary, Chairperson (department-level leaders)
- Members can belong to departments (separate from fellowship membership)
- Department removal: Department Secretary + Department Chair approval
- Department transfer: Member request → Old Dept Chair → New Dept Chair → Main Secretary final
- Department custom fields (dynamic per department)
- Department data isolation (server-side enforced)

### 4.3 Activities
- Created by Secretary or Assistant Secretary
- Approval: Secretary only
- Visibility targeting: all members, specific department, leaders, specific group
- Attendance: leaders confirm; for all-member activities, shareable attendance link
- Events: news, announcements, documents, gallery, rehearsals, songs, performances, attendance, budget, expenses, participants

### 4.4 Reports
- Any department leader submits report
- Workflow: Dept leader → Secretary/Asst Secretary → Chairperson/Asst Chairperson
- Approval with comment or rejection with comment
- Resubmission on rejection

### 4.5 Finance
- **Contributions**: Treasurer records (no approval); editable only with Secretary+Chairperson approval
- **Expenses**: Treasurer records; approval: Secretary+Chairperson; deleting requires both
- **Budgets**: Treasurer creates; approval: Secretary+Chairperson; editing requires both
- **Money Requests**: Created by Secretary or Department Leaders; workflow: requester → Secretary → Chair/Asst Chair → Treasurer
- **States**: DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED, RESUBMITTED, FINAL_APPROVED, CANCELLED

### 4.6 IT Content / Website
- Gallery, documents, news, announcements, landing page backgrounds
- Publication workflow: IT Dept Secretary approval → Chairperson/Asst Chairperson final approval
- Any IT member can edit (requires approval)
- Deletion requires: IT Dept Secretary + IT Dept Chair approval

### 4.7 Admin
- Manage users, passwords, system settings, backups, recycle bin
- Impersonation: requires account owner approval, 10-minute session, audited
- Cannot silently impersonate

### 4.8 Notifications
- In-app notifications only (no email/SMS/WhatsApp unless added later)
- Auto-generated for: new activity, activity change/cancellation, new document, comment, approval requests/reviews, finance actions, report submissions, department changes, leadership changes, member changes

### 4.9 Recycle Bin
- Deleted records retained 30 days
- Restore: Admin, Secretary, Assistant Secretary
- Permanent deletion: Admin, Secretary

### 4.10 Backups
- Every 12 hours
- Cloud + local storage
- Indefinite retention
- Restore: Admin, Secretary, Assistant Secretary
- Safety backup before restore, audit record

### 4.11 Audit Trail
- Records all important actions
- Fields: user, action, entity, entity_id, timestamp, old_value, new_value, IP/device, approval info, comment/reason
- Viewable by: Admin, Secretary, Chairperson

## 5. Non-Functional Requirements

- Responsive, mobile-first, accessible
- Installable as PWA
- Secure authentication (hashed passwords, secure sessions/tokens)
- CSRF protection, rate limiting, input validation, output encoding
- Protection against IDOR and privilege escalation
- Environment-based configuration
- Production-ready deployment

## 6. Constraints

- No business rules invented beyond spec
- Server-side authorization always (never frontend-only)
- Approval workflows must be unbreakable
- Department data isolated at server level
