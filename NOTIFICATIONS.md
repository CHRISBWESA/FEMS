# Fellowship Management System - Notifications & Events

## 1. Notification Engine

In-app notification system. All notifications are stored in the `notifications` table and displayed in UI.

### Notification Object
| Field | Type | Description |
|-------|------|-------------|
| id | UUID | PK |
| recipient_user_id | UUID | FK to users (who receives it) |
| event_type | TEXT | Trigger event (see list below) |
| title | TEXT | Short title |
| message | TEXT | Full message |
| entity_type | TEXT | Related entity type (e.g., "member", "activity", "finance_contribution") |
| entity_id | UUID | Related entity ID |
| is_read | BOOLEAN | Read/unread flag |
| created_at | TIMESTAMP | When generated |
| actor_user_id | UUID | Who triggered it (optional) |

## 2. Event Types (Auto-generated Notifications)

Notifications are generated automatically by system events. No approval required for notifications.

| Event Type | Trigger | Recipients | Example Title |
|-----------|---------|------------|---------------|
| `activity_new` | New activity created | Targeted audience | "New Activity: Sunday Service" |
| `activity_updated` | Activity changed | Targeted audience | "Activity Updated: Time Changed" |
| `activity_cancelled` | Activity cancelled | Targeted audience | "Activity Cancelled: Friday Prayer" |
| `document_new` | New document uploaded + approved | Authorized viewers | "New Document Available" |
| `comment_new` | New comment on report/activity | Related stakeholders | "New comment on your report" |
| `approval_request` | Approval needed | Assigned approver | "Approval needed: Money request #123" |
| `approval_received` | Request approved/rejected | Requester | "Your money request was approved" |
| `finance_request` | Finance approval request | Finance approver (Secretary/Chair) | "Finance approval: Expense #45" |
| `finance_approved` | Finance approved/rejected | Requester | "Expense request approved" |
| `report_submitted` | Report submitted | Secretary/Asst Secretary | "Department report submitted" |
| `report_approved` | Report final approval | Department leader | "Report approved by Chairperson" |
| `report_rejected` | Report rejected | Requester | "Report rejected: please correct" |
| `department_change` | Department membership change | Affected member | "Added to Choir department" |
| `department_transfer` | Transfer complete/approval needed | Affected member + approvers | "Department transfer to praise" |
| `leadership_change` | Leadership role assigned/removed | Affected user + system | "Assigned as Department Secretary" |
| `member_change` | Important member info change | Member + system | "Your profile was updated" |
| `password_reset` | Password reset performed | Target user | "Your password was reset by Secretary" |
| `impersonation_requested` | Admin requested impersonation | Target user | "Admin requested to view your account" |
| `impersonation_approved` | Impersonation started | Admin user | "Impersonation session started (10 min)" |
| `impersonation_expired` | Impersonation session ended | Admin user | "Impersonation session expired" |
| `recycle_restore` | Record restored | Admin/Secretary | "Record restored from recycle bin" |
| `backup_completed` | Backup finished | Admin/Secretary | "Backup completed successfully" |
| `backup_restore` | System restored | Admin/Secretary | "System restored to backup [time]" |
| `system_change` | System settings updated | Admin | "System settings updated" |
| `invitation` | User invited to department | Invitee | "You've been added to IT Department" |

## 3. Notification Delivery

- **Channel**: In-app notifications ONLY (stored in `notifications` table)
- **No email, SMS, or WhatsApp** unless later explicitly added
- Notifications appear in:
  - Header dropdown (last 10, with unread badge)
  - Dedicated `/notifications` page (full list, paginated, filterable)
  - Real-time via WebSocket (optional enhancement) or polling

## 4. Notification API

### GET `/notifications`
List notifications for current user (paginated, filterable by read/unread).

### PATCH `/notifications/:id/read`
Mark single notification as read.

### PATCH `/notifications/mark-all-read`
Mark all user's notifications as read.

### GET `/notifications/unread-count`
Quick count of unread notifications.

## 5. Business Event → Notification Mapping

### Activity Events
```
Activity created → notify targeted audience (activity_new)
Activity updated → notify targeted audience (activity_updated)
Activity cancelled → notify targeted audience (activity_cancelled)
```

### Approval Events
```
Approval needed at step → notify current stage approver (approval_request)
Approval decision made → notify requester and next stage (approval_received / approval_next_step)
```

### Finance Events
```
Expense recorded → notify Secretary + Chairperson (finance_request)
Expense approved → notify Treasurer + requester (finance_approved)
Expense rejected → notify Treasurer + requester (finance_approved with rejection)
Budget created → notify Secretary + Chairperson
Money request created → notify Secretary (then auto-routes to Chairperson → Treasurer)
```

### Report Events
```
Report submitted → notify Secretary/Assistant Secretary (report_submitted)
Report approved → notify Chairperson/Asst Chairperson for final approval
Report final approved → notify department leader (report_approved)
Report rejected → notify department leader (report_rejected)
```

### Member Events
```
New member registered → notify Secretary (member_change)
Member status changed → notify member (member_change)
Member graduated (system) → notify member + Secretary (member_change)
```

### Department Events
```
Member added to department → notify member + Department Secretary/Chair (department_change)
Member removed from department → notify member (department_change)
Department transfer requested → notify old/new chairs + Secretary (department_transfer)
Department transfer approved → notify member (department_change)
```

### IT Content Events
```
Content submitted → notify IT Department Secretary (approval_request)
Content approved by Secretary → notify Chairperson/Asst Chair (approval_request)
Content final approved → notify IT members (document_new)
Content deletion requested → notify Secretary + Chair (approval_request)
Content deletion approved → notify IT members
```

### Impersonation Events
```
Impersonation requested → notify target user with approve link (impersonation_requested)
Impersonation approved → notify Admin (impersonation_approved)
Impersonation 8 min warning → notify Admin (impersonation_expired warning)
Impersonation expired → notify Admin (impersonation_expired)
```

### System Events
```
Backup completed → notify Admin/Secretary (backup_completed)
Backup restored → notify Admin/Secretary (backup_restore)
Record restored from recycle bin → notify Admin/Secretary (recycle_restore)
Password reset → notify target user (password_reset)
System setting change → notify Admin (system_change)
```

## 6. Audit Connection

All notification-generating events are also audited. The `audit_logs` table's `comment` field may reference the notification ID.

## 7. Performance

- Notifications are generated asynchronously after transaction commit
- Batch insert for bulk notifications
- Read counts cached with invalidation on read/unread changes
