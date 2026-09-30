# Fellowship Management System - User Flows

> **Historical design reference.** Some flows below are not implemented: cookie sessions, impersonation, automatic graduation, in-app backup/restore, and IT document deletion. Current behavior is in [FINAL_ARCHITECTURE_STATUS.md](FINAL_ARCHITECTURE_STATUS.md) and the Phase 22/23 reports. IT document deletion and recycle-bin restore explicitly return `409`.

## 1. Authentication Flows

### 1.1 Login
```
User -> Enter credentials -> Server validates -> Grant JWT + session cookie -> Dashboard (role-specific)
```

### 1.2 Password Reset (by authorized user)
```
Authorized user (Admin/Secretary/Assistant Secretary/IT) -> Select user -> Reset password -> System generates reset token -> Audit recorded -> User notified via in-app
```
Note: Never expose old password. Reset = generate new temporary password or reset token.

### 1.3 Impersonation (Admin)
```
Admin -> Request impersonation of target user -> Notification sent to target user (account owner) -> Account owner approves -> Admin gets 10-min session -> Actions audited -> Session expires automatically
```

## 2. Member Management Flows

### 2.1 Member Registration
```
Secretary or Gender Leader -> Register new member -> System creates record -> Audit recorded -> Notification generated
```
No approval required.

### 2.2 Member Status Change
```
Secretary -> Change status (Active<->Inactive manual, Graduated auto) -> System validates -> Update record -> Audit recorded -> Notification if important
```

### 2.3 Member Profile Edit
```
Main Secretary -> Edit member profile -> System validates -> Update record -> Audit recorded
```
Only Main Secretary can edit official records.

### 2.4 Graduation Date Adjustment
```
Secretary -> Edit expected graduation month/year -> System updates graduation tracking -> Audit recorded
```

## 3. Department Flows

### 3.1 Department Creation
```
Secretary -> Create department -> Assign Department Secretary and Chair -> Custom fields defined -> Department isolated -> Audit recorded
```

### 3.2 Department Transfer
```
Member -> Request transfer (old -> new dept) -> Old Dept Chair reviews -> New Dept Chair reviews -> Main Secretary final approval -> Member removed from old, added to new -> Audit recorded
```

### 3.3 Department Removal
```
Request -> Department Secretary + Department Chair approve -> Member completely removed from department -> Audit recorded
```
Member remains fellowship member.

### 3.4 Custom Fields Management
```
Department Leader -> Define custom fields -> System stores schema -> Fields available on member profiles in that department
```

## 4. Activity Flows

### 4.1 Activity Creation
```
Secretary/Assistant Secretary -> Create activity -> Set audience targeting -> Activity visible to targeted group only
```

### 4.2 Activity Attendance
```
Leaders activity: Leader confirms attendance
All members activity: Generate shareable link -> Members enter name -> Press Confirm
```

## 5. Report Flows

### 5.1 Department Report Submission
```
Department Leader -> Fill report -> Submit -> Secretary/Assistant Secretary reviews -> Approve with comment OR Reject with comment -> If approved: Chairperson/Assistant Chairperson final approval -> Report final
If rejected: Requester corrects -> Resubmits -> Workflow starts again
```

## 6. Finance Flows

### 6.1 Contribution
```
Treasurer -> Record contribution -> No approval -> Audit recorded
Treasurer edit/delete: Requires Secretary + Chairperson approval -> Workflow: Treasurer request -> Secretary approve -> Chairperson approve -> Change applied
```

### 6.2 Expense
```
Treasurer -> Record expense -> Requires Secretary + Chairperson approval -> Workflow: Treasurer -> Secretary -> Chairperson -> Approved
Editing: Treasurer + Secretary + Chairperson approval all required
Deleting: Treasurer + Secretary + Chairperson approval all required
```

### 6.3 Budget
```
Treasurer -> Create budget -> Requires Secretary + Chairperson approval
Editing: Treasurer + Secretary + Chairperson approval
Deleting: Treasurer + Secretary + Chairperson approval
```

### 6.4 Money Request
```
Department Leader or Secretary -> Create request -> Secretary review -> Chairperson/Assistant Chairperson -> Treasurer final approval
If rejected: Must contain comment -> Requester corrects -> Resubmits -> Workflow starts again
```

## 7. IT Content Flows

### 7.1 Content Publication
```
IT Member -> Edit/create content -> IT Department Secretary approval -> Chairperson/Assistant Chairperson final approval -> Published
```

### 7.2 Content Deletion
```
IT Member -> Request deletion -> IT Department Secretary approval -> IT Department Chair approval -> Deleted + audited
```

## 8. Admin Flows

### 8.1 Recycle Bin Restore
```
Admin/Secretary/Assistant Secretary -> View recycle bin -> Select record -> Restore -> Record active again -> Audit recorded
```

### 8.2 Permanent Delete
```
Admin/Secretary -> Select record -> Confirm permanent delete -> Audit recorded -> Record purged
```

### 8.3 Backup Restore
```
Admin/Secretary/Assistant Secretary -> Select backup -> Create safety backup -> Warn user -> Confirm -> Restore -> Audit recorded
```

## 9. Notification Flows
```
System Event -> Generate notification -> Store in notification center -> User sees in-app -> User can mark read/unread
```

## 10. Dashboard Views

### Admin Dashboard
- System overview
- Users management
- Settings
- Backup status
- Recycle Bin
- Audit access

### Secretary Dashboard
- Members
- Departments
- Activities
- Reports
- Approvals
- Notifications

### Assistant Secretary Dashboard
- Same as Secretary except Secretary-only actions hidden

### Chairperson Dashboard
- Pending approvals
- Finance overview
- Department reports
- Important notifications

### Treasurer Dashboard
- Contributions
- Expenses
- Budgets
- Money requests
- Finance approvals

### Department Leader Dashboard
- Own department members
- Own department activities
- Own department reports
- Own department finance
- Custom department information

### Ordinary Member Dashboard
- Activities they're invited to
- Announcements
- Notifications
- Documents
- Attendance confirmation
- Own profile
