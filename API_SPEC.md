# Fellowship Management System - API Specification

> **Current-state note (Phase 23):** routes below are historical intent where they differ from registered controllers. Authentication is `Authorization: Bearer` (not cookies), `/auth/register` and impersonation routes are not public features, `/backups` create/restore and `/it-content/documents/:id/request-delete` return `409`, `/recycle-bin/:id/restore` returns `409` and listings omit `originalData`, `/system/settings` and `POST /it-content/gallery` do not exist, and health probes are `/api/v1/health/live` and `/api/v1/health/ready`. Verify a route in the current NestJS controllers before relying on this document.

## Base URL
`/api/v1`

## Authentication

All endpoints require a valid JWT in an HttpOnly Secure cookie. Exceptions:
- `POST /auth/login` - Login
- `POST /auth/refresh` - Token refresh
- `POST /auth/register` - Public registration (if enabled for testing)

## 1. Auth Endpoints

### POST `/auth/login`
Login with email and password.
```json
Request: { "email": "string", "password": "string" }
Response: { "accessToken": "jwt", "user": { "id", "email", "firstName", "lastName", "roles": ["string"] } }
```

### POST `/auth/logout`
Logout and invalidate session.
```json
Response: { "message": "Logged out" }
```

### POST `/auth/refresh`
Refresh access token.
```json
Response: { "accessToken": "jwt" }
```

### POST `/auth/change-password`
Change own password (if must_change_password).
```json
Request: { "oldPassword": "string", "newPassword": "string" }
Response: { "message": "Password changed" }
```

### POST `/auth/reset-password` (Admin/Secretary/Assistant Secretary/IT only)
Reset a user's password. Generates a reset token (never returns old password).
```json
Request: { "userId": "uuid" }
Response: { "resetToken": "token", "message": "Reset token generated" }
```

### POST `/auth/request-impersonation`
Request impersonation of a user. Sends approval request to target user.
```json
Request: { "targetUserId": "uuid", "reason": "string" }
Response: { "impersonationRequestId": "uuid", "message": "Approval requested" }
```

### POST `/auth/approve-impersonation/:token`
Target user approves impersonation request.
```json
Response: { "accessToken": "jwt", "expiresIn": 600, "impersonating": true }
```

### DELETE `/auth/cancel-impersonation`
Cancel active impersonation.
```json
Response: { "message": "Impersonation cancelled" }
```

## 2. Users & RBAC

### GET `/users`
List users (Admin, Secretary, Assistant Secretary).
```json
Response: [{ "id", "email", "firstName", "lastName", "phone", "gender", "roles": ["string"], "isActive", "createdAt", "updatedAt" }]
```

### GET `/users/:id`
Get user details (Admin, Secretary, Assistant Secretary).
```json
Response: { "id", "email", "firstName", "lastName", ... }
```

### PUT `/users/:id`
Update user (Admin, Secretary). Can change roles, status.
```json
Request: { "firstName"?: "string", "lastName"?: "string", "roles"?: ["string"], "isActive"?: boolean }
```

### DELETE `/users/:id`
Soft delete user (Admin).
```json
Response: { "message": "User deleted" }
```

### GET `/permissions`
List all permissions (Admin only).
```json
Response: [{ "id", "name", "description" }]
```

## 3. Members

### GET `/members`
List members (Secretary, Chairperson with restrictions, Department Leaders - own dept only, Gender Leaders).
Query params: `departmentId`, `status`, `search`, `page`, `limit`.
```json
Response: { "data": [...], "total": number, "page": number }
```

### POST `/members`
Register member (Secretary, Gender Leader).
```json
Request: { "fullName", "phone", "email", "gender", "programme", "yearOfStudy", "university", "expectedGraduationYear", "expectedGraduationMonth", "membershipStatus" }
Response: { "id", "memberCode", ... }
```

### GET `/members/:id`
Get member details (Secretary, Chairperson, own department leaders, Gender leaders - own gender, Ordinary Member - own profile).
```json
Response: { "id", "memberCode", "fullName", "phone", ... }
```

### PUT `/members/:id`
Edit member (Main Secretary only).
```json
Request: { "fullName"?, "phone"?, ... }
```

### PATCH `/members/:id/status`
Change member status (Main Secretary only for manual; system handles Graduated).
```json
Request: { "status": "active|inactive", "reason": "string" }
```

### PATCH `/members/:id/graduation`
Edit expected graduation (Secretary only).
```json
Request: { "expectedGraduationYear": number, "expectedGraduationMonth": number }
```

### POST `/members/:id/extend-graduation`
Extend graduation date (Secretary only).
```json
Request: { "newGraduationYear": number, "newGraduationMonth": number, "reason": "string" }
```

## 4. Departments

### GET `/departments`
List departments (Secretary, Assistant Secretary, Admin).
```json
Response: [{ "id", "name", "description", "isActive", "leaders": [...] }]
```

### POST `/departments`
Create department (Secretary).
```json
Request: { "name", "description", "customFieldsSchema": [object] }
Response: { "id", "name", ... }
```

### GET `/departments/:id`
Get department details (Secretary, Department Leaders - own dept only).
```json
Response: { "id", "name", "description", "members": [...], "leaders": [...], "customFields": [...] }
```

### PUT `/departments/:id`
Update department (Secretary).
```json
Request: { "name"?, "description"?, "isActive"?, "customFieldsSchema"? }
```

### POST `/departments/:id/leaders`
Assign department leader (Secretary).
```json
Request: { "userId": "uuid", "roleInDepartment": "department_secretary|department_chairperson", "startDate": "date" }
```

### POST `/departments/:id/members/:memberId`
Add member to department (Secretary, Department Leaders - with approval).
```json
Request: { "startDate": "date" }
```

### DELETE `/departments/:id/members/:memberId`
Request removal of member from department.
```json
Request: { "reason": "string" }
Response: { "approvalWorkflowId": "uuid", "message": "Removal request submitted; requires Department Secretary + Department Chairperson approval" }
```

## 5. Department Transfers

### POST `/department-transfers`
Request department transfer (Member requests their own, or Secretary creates on behalf).
```json
Request: { "memberId": "uuid", "fromDepartmentId": "uuid", "toDepartmentId": "uuid", "reason": "string" }
Response: { "approvalWorkflowId": "uuid", "status": "submitted" }
```

### GET `/department-transfers/:id`
Get transfer request status (Secretary, Chairpersons).
```json
Response: { "id", "member": {...}, "fromDepartment": {...}, "toDepartment": {...}, "steps": [...], "currentStatus": "state" }
```

### POST `/department-transfers/:id/approve`
Approve transfer at a stage (Old/New Department Chair, Main Secretary).
```json
Request: { "decision": "approved|rejected", "comment": "string" }
```

## 6. Activities

### GET `/activities`
List activities (authenticated users, filtered by audience).
```json
Response: [{ "id", "title", "description", "date", "audienceType", ... }]
```

### POST `/activities`
Create activity (Secretary, Assistant Secretary).
```json
Request: { "title", "description", "date", "endDate"?, "audienceType": "all_members|department|leaders|specific_group", "departmentId"?: "uuid", "specificGroup"?: "string" }
Response: { "id", "title", ... }
```

### GET `/activities/:id`
Get activity (authenticated users in target audience).
```json
Response: { "id", "title", ... }
```

### PUT `/activities/:id`
Edit activity (Secretary, Assistant Secretary).
```json
Request: { "title"?, "description"?, ... }
```

### POST `/activities/:id/share-attendance`
Generate shareable attendance link (Secretary, Assistant Secretary).
```json
Response: { "shareableLink": "url" }
```

### POST `/attendances`
Record attendance (member confirmation via link, or leader).
```json
Request: { "activityId": "uuid", "memberName"?: "string", "memberId"?: "uuid" }
```

## 7. Reports

### GET `/reports`
List reports (Department Leaders - own dept, Secretary, Assistant Secretary, Chairperson).
```json
Response: [{ "id", "department": {...}, "status", ... }]
```

### POST `/reports`
Submit department report (Department Leaders).
```json
Request: { "departmentId": "uuid", "title": "string", "content": "string", "attachments"?: [...] }
Response: { "id", "status": "submitted" }
```

### GET `/reports/:id`
Get report (Department Leaders - own dept, Secretary, Chairperson).
```json
Response: { "id", "department": {...}, "content": "string", "steps": [...], ... }
```

### POST `/reports/:id/approve`
Approve/reject report (Secretary/Assistant Secretary, then Chairperson/Assistant Chairperson).
```json
Request: { "decision": "approved|rejected", "comment": "string" }
```

## 8. Finance

### GET `/finance/contributions`
List contributions (Treasurer, Secretary, Chairperson, Assistant Chairperson).
```json
Response: [{ "id", "member": {...}, "amount", "type", "date", ... }]
```

### POST `/finance/contributions`
Record contribution (Treasurer only - no approval).
```json
Request: { "memberId": "uuid", "amount": "number", "type": "string", "date": "date" }
Response: { "id", ... }
```

### PATCH `/finance/contributions/:id`
Edit contribution (Treasurer requests; requires Secretary + Chairperson approval).
```json
Request: { "amount"?: "number", "type"?: "string", "date"?: "date", "reason": "string" }
Response: { "approvalWorkflowId": "uuid", "status": "submitted" }
```

### DELETE `/finance/contributions/:id`
Delete contribution (Treasurer requests; requires Secretary + Chairperson approval).
```json
Request: { "reason": "string" }
```

### GET `/finance/expenses`
List expenses (Treasurer, Secretary, Chairperson).
```json
Response: [{ "id", "title", "amount", "status", ... }]
```

### POST `/finance/expenses`
Record expense (Treasurer; requires Secretary + Chairperson approval).
```json
Request: { "title", "description", "amount", "date", "departmentId"?, "purpose" }
Response: { "id", "approvalWorkflowId" }
```

### POST `/finance/expenses/:id/approve`
Approve/reject expense (Secretary, Chairperson).
```json
Request: { "decision": "approved|rejected", "comment" }
```

### GET `/finance/budgets`
List budgets (Treasurer, Secretary, Chairperson).
```json
Response: [{ "id", "title", "amount", "fiscalYear", "status", ... }]
```

### POST `/finance/budgets`
Create budget (Treasurer; requires Secretary + Chairperson approval).
```json
Request: { "title", "description", "amount", "departmentId", "fiscalYear" }
Response: { "id", "approvalWorkflowId" }
```

### POST `/finance/budgets/:id/approve`
Approve/reject budget (Secretary, Chairperson).
```json
Request: { "decision": "approved|rejected", "comment" }
```

### GET `/finance/money-requests`
List money requests (Treasurer, Secretary, Chairperson).
```json
Response: [{ "id", "title", "amount", "status", ... }]
```

### POST `/finance/money-requests`
Create money request (Secretary, Department Leaders).
```json
Request: { "title", "description", "amount", "purpose", "departmentId" }
Response: { "id", "approvalWorkflowId" }
```

### POST `/finance/money-requests/:id/approve`
Approve money request (Secretary, Chairperson/Assistant Chairperson, Treasurer).
```json
Request: { "decision": "approved|rejected", "comment" }
```

## 9. IT Content

### GET `/it-content/documents`
List documents (IT department members, approved viewers).
```json
Response: [{ "id", "title", "filename", "contentType", "approvalStatus", ... }]
```

### POST `/it-content/documents`
Upload document (IT department members).
```json
Request: multipart/form-data { "title", "file", "departmentId" }
Response: { "id", "approvalWorkflowId", "status": "submitted" }
```

### POST `/it-content/documents/:id/approve`
Approve document publication (IT Department Secretary, then Chairperson/Assistant Chairperson).
```json
Request: { "decision": "approved|rejected", "comment" }
```

### POST `/it-content/documents/:id/request-delete`
Returns `409 Conflict` with `code: OPERATION_UNAVAILABLE`; it does not create an approval that cannot delete the document.

### GET `/it-content/announcements`
List announcements (Secretary, Assistant Secretary, approved viewers).
```json
Response: [{ "id", "title", "content", "audienceType", "status", ... }]
```

### POST `/it-content/announcements`
Create announcement (Secretary, Assistant Secretary).
```json
Request: { "title", "content", "audienceType", "departmentId"? }
```

### POST `/it-content/announcements/:id/approve`
Approve announcement (Chairperson/Assistant Chairperson).
```json
Request: { "decision": "approved|rejected", "comment" }
```

### GET `/it-content/gallery`
List gallery images (IT department, approved viewers).
```json
Response: [{ "id", "title", "filename", ... }]
```

Gallery images are uploaded through `POST /it-content/documents` with `isWebsiteContent=true` and an image content type. There is no separate gallery upload route.

## 10. Notifications

### GET `/notifications`
List user notifications (authenticated).
```json
Response: [{ "id", "eventType", "title", "message", "entityType", "entityId", "isRead", "createdAt" }]
```

### PATCH `/notifications/:id/read`
Mark notification as read.
```json
Response: { "message": "Marked as read" }
```

### PATCH `/notifications/mark-all-read`
Mark all notifications as read.
```json
Response: { "message": "All marked as read" }
```

### GET `/notifications/unread-count`
Get unread notification count.
```json
Response: { "count": number }
```

## 11. Audit

### GET `/audit`
List audit logs (Admin, Secretary, Chairperson, Assistant Chairperson).
Query: `userId`, `action`, `entityType`, `from`, `to`, `page`, `limit`.
```json
Response: [{ "id", "userId", "action", "entityType", "entityId", "timestamp", "oldValue", "newValue", "ipAddress", "comment" }]
```

## 12. Recycle Bin

### GET `/recycle-bin`
List same-fellowship deleted-record metadata (Secretary, Assistant Secretary). Original record data and restore tokens are never returned; platform administrators do not have this route.
```json
Response: [{ "id", "original_collection", "original_record_id", "deleted_by", "deleted_at", "fellowship_id" }]
```

### POST `/recycle-bin/:id/restore`
Always returns `409 Conflict` (`OPERATION_UNAVAILABLE`). The recycle-bin copy is retained; no restore is claimed.

### DELETE `/recycle-bin/:id`
Permanently delete a same-fellowship record (Secretary only; audited).

## 13. Backups

### GET `/backups`
Legacy backup metadata only (platform administrator). Internal file paths are omitted.

### GET `/backups/stats`
Reports `applicationBackup: false`, `scheduledBackup: false`, `verifiedRestore: false` and points to the external procedure.

### POST `/backups`
Always returns `409 Conflict` (`OPERATION_UNAVAILABLE`); FEMS does not run `pg_dump`.

### POST `/backups/:id/restore`
Always returns `409 Conflict` (`OPERATION_UNAVAILABLE`); restore a verified dump into a new database using `BACKUP_RESTORE_GUIDE.md`.

## 14. System

No `/system` controller or settings registry is implemented in the current backend. Platform module/tenant settings are under `/platform/tenants/:id`; environment settings are documented in `ENVIRONMENT_CONFIGURATION.md`.

## Error Responses

All errors follow format:
```json
{
  "statusCode": number,
  "message": "Human-readable message",
  "error": "ErrorType"
}
```

Common error messages:
- `403 Forbidden` - "You do not have permission to perform this action."
- `400 Bad Request` - "This approval step has already been completed."
- `400 Bad Request` - "This request must be approved by the Secretary first."
- `403 Forbidden` - "You cannot access another department."
- `401 Unauthorized` - "This impersonation session has expired."
