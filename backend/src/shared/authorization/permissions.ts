export const PERMISSIONS = {
  // User management
  USER_MANAGE: 'user.manage',
  USER_VIEW: 'user.view',
  USER_PASSWORD_RESET: 'user.password_reset',

  // Member management
  MEMBER_REGISTER: 'member.register',
  MEMBER_EDIT: 'member.edit',
  MEMBER_STATUS_CHANGE: 'member.status_change',
  MEMBER_VIEW_ALL: 'member.view_all',
  MEMBER_VIEW_OWN_DEPT: 'member.view_own_dept',

  // Department management
  DEPARTMENT_MANAGE: 'department.manage',
  DEPARTMENT_LEADERS_MANAGE: 'department.leaders_manage',
  DEPARTMENT_MEMBER_ADD: 'department.member_add',
  DEPARTMENT_MEMBER_REMOVE: 'department.member_remove',

  // Department transfer
  DEPARTMENT_TRANSFER: 'department.transfer',

  // Activities
  ACTIVITY_CREATE: 'activity.create',
  ACTIVITY_EDIT: 'activity.edit',
  ACTIVITY_CANCEL: 'activity.cancel',

  // Reports
  REPORT_SUBMIT: 'report.submit',
  REPORT_REVIEW: 'report.review',
  REPORT_FINAL_APPROVE: 'report.final_approve',

  // Finance
  FINANCE_VIEW: 'finance.view',
  FINANCE_CONTRIBUTION_RECORD: 'finance.contribution_record',
  FINANCE_CONTRIBUTION_EDIT: 'finance.contribution_edit',
  FINANCE_EXPENSE_RECORD: 'finance.expense_record',
  FINANCE_EXPENSE_APPROVE: 'finance.expense_approve',
  FINANCE_BUDGET_CREATE: 'finance.budget_create',
  FINANCE_BUDGET_APPROVE: 'finance.budget_approve',
  FINANCE_MONEY_REQUEST_CREATE: 'finance.money_request_create',
  FINANCE_MONEY_REQUEST_APPROVE: 'finance.money_request_approve',

  // IT Content
  IT_CONTENT_EDIT: 'it.content_edit',
  IT_CONTENT_PUBLISH_APPROVE: 'it.content_publish_approve',
  IT_CONTENT_DELETE_APPROVE: 'it.content_delete_approve',

  // Admin
  ADMIN_SETTINGS: 'admin.settings',
  ADMIN_BACKUP: 'admin.backup',
  ADMIN_RESTORE: 'admin.restore',
  ADMIN_RECYCLE_BIN: 'admin.recycle_bin',
  ADMIN_AUDIT_VIEW: 'admin.audit_view',
  ADMIN_IMPERSONATE: 'admin.impersonate',

  // Recycle bin
  RECYCLE_RESTORE: 'recycle.restore',
  RECYCLE_PERMANENT_DELETE: 'recycle.permanent_delete',

  // Backup
  BACKUP_CREATE: 'backup.create',
  BACKUP_RESTORE: 'backup.restore',

  // Attendance
  ACTIVITY_ATTENDANCE: 'activity.attendance',
  ACTIVITY_SHARE_LINK: 'activity.share_link',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
