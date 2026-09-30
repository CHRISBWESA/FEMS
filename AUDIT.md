# Fellowship Management System - Audit Trail

> **Historical design reference.** Audit logging and redaction are implemented, but the described IT document-deletion audit events are not written because document deletion now returns `409`. The current security/audit boundary is in [PHASE_22_SECURITY_REPORT.md](PHASE_22_SECURITY_REPORT.md).

## 1. Audit Requirements

The system records ALL important actions. Each audit entry contains:
- **User**: who performed the action
- **Action**: what was done (verb + entity)
- **Entity**: what was affected
- **Entity ID**: which record
- **Timestamp**: when
- **Old Value**: before for changes
- **New Value**: after for changes
- **IP/device information**: where
- **Approval information**: for approval actions
- **Comment/reason**: optional context

## 2. Auditable Actions

### Member Actions
- `member.register` — New member registered
- `member.edit` — Member profile edited (all fields with old/new)
- `member.status_change` — Membership status changed (Active/Inactive; Graduated is system)
- `member.graduation_edit` — Graduation date edited
- `member.password_reset` — Password reset performed on a member user

### Department Actions
- `department.create` — New department created
- `department.edit` — Department info updated
- `department.leader_assign` — Department leader assigned/removed
- `department.member_add` — Member added to department
- `department.member_remove_requested` — Removal request submitted
- `department.member_removed` — Member completely removed (after approval)
- `department.custom_fields_change` — Custom fields schema updated
- `department.custom_field_value_change` — Custom field value updated for member

### Transfer Actions
- `department_transfer.request` — Transfer request created
- `department_transfer.approve` — Transfer stage approved
- `department_transfer.reject` — Transfer stage rejected
- `department_transfer.complete` — Transfer completed (member moved)

### Activity Actions
- `activity.create` — Activity created
- `activity.edit` — Activity edited
- `activity.cancel` — Activity cancelled
- `activity.attendance` — Attendance recorded

### Report Actions
- `report.submit` — Report submitted
- `report.review_approve` — Report reviewed and approved
- `report.review_reject` — Report reviewed and rejected
- `report.final_approve` — Report final approval
- `report.resubmit` — Report resubmitted after rejection
- `report.comment` — Comment added to report

### Finance Actions
- `finance.contribution_create` — Contribution recorded
- `finance.contribution_edit_requested` — Edit requested
- `finance.contribution_edit_approved` — Edit approved
- `finance.contribution_edit_rejected` — Edit rejected
- `finance.contribution_delete_requested` — Delete requested
- `finance.contribution_deleted` — Contribution deleted (after approval)
- `finance.expense_create` — Expense recorded
- `finance.expense_approve` — Expense approved
- `finance.expense_reject` — Expense rejected
- `finance.expense_edit` — Expense edited (after approval)
- `finance.expense_delete` — Expense deleted (after approval)
- `finance.budget_create` — Budget created
- `finance.budget_approve` — Budget approved
- `finance.budget_reject` — Budget rejected
- `finance.budget_edit` — Budget edited
- `finance.budget_delete` — Budget deleted
- `finance.money_request_create` — Money request created
- `finance.money_request_approve` — Money request approved at each stage
- `finance.money_request_reject` — Money request rejected
- `finance.money_request_resubmit` — Money request resubmitted

### IT Content Actions
- `it_content.document_upload` — Document uploaded
- `it_content.document_publish_approve` — Publication approved
- `it_content.document_delete_request` — Deletion requested
- `it_content.document_deleted` — Document deleted (after approval)
- `it_content.announcement_create` — Announcement created
- `it_content.announcement_approve` — Announcement approved
- `it_content.gallery_upload` — Gallery image uploaded
- `it_content.gallery_delete` — Gallery image deletion

### Admin Actions
- `admin.user_create` — User account created
- `admin.user_edit` — User account edited
- `admin.user_delete` — User account deleted
- `admin.role_assign` — Role assigned to user
- `admin.role_remove` — Role removed from user
- `admin.setting_change` — System setting changed
- `admin.backup_create` — Manual backup created
- `admin.backup_restore` — System restored from backup
- `admin.recycle_permanent_delete` — Record permanently deleted
- `admin.recycle_restore` — Record restored from recycle bin

### Impersonation Actions
- `impersonation.request` — Impersonation request made
- `impersonation.approve` — Target user approved impersonation
- `impersonation.start` — Impersonation session started
- `impersonation.end` — Impersonation session ended (manual or expired)
- `impersonation.action` — Any action performed during impersonation (linked)

### Password Actions
- `password.reset` — Password reset by authorized user
- `password.change` — User changed own password

### Recycle Bin Actions
- `recycle.soft_delete` — Record soft-deleted (moved to recycle bin)
- `recycle.restore` — Record restored
- `recycle.permanent_delete` — Record permanently deleted

### Backup Actions
- `backup.create` — Scheduled or manual backup created
- `backup.restore` — System restored from backup

### Notification Actions
- `notification.send` — Notification generated for an event (logged for traceability)

## 3. Audit Log Schema

```sql
audit_logs {
  id              UUID PRIMARY KEY
  user_id         UUID FK → users (who performed action)
  action          TEXT NOT NULL
  entity_type     TEXT
  entity_id       UUID
  timestamp       TIMESTAMP DEFAULT NOW()
  old_value       JSONB (for edit actions)
  new_value       JSONB (for edit actions)
  ip_address      TEXT
  device_info     TEXT
  approval_info   JSONB (approver, stage, decision, comment, timestamp)
  comment         TEXT
  impersonation_session_id UUID FK → impersonation_sessions (if during impersonation)
}
```

## 4. Audit Access

Audit history can be viewed by:
- **Admin** — full access
- **Secretary** — full access
- **Chairperson** — full access

UI: `/audit` page with filters (user, action, entity type, date range) and pagination.

## 5. Immutability

- Audit logs are **append-only** — no updates or deletes
- Stored in separate table from application data
- Can be archived to cold storage for long-term retention

## 6. Implementation Notes

- Every controller method that performs a mutation triggers an audit log via an audit service
- Audit logging happens in the same transaction as the action (or immediately after), so if the action fails, audit is not logged
- Impersonation context is automatically attached to audit entries via request-scoped context
- For approval actions, the entire approval decision (stage, decision, comment, timestamp) is stored in `approval_info` JSONB
