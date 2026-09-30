export const PERMISSIONS = {
  // User management
  USER_MANAGE: 'user.manage',
  USER_VIEW: 'user.view',
  USER_PASSWORD_RESET: 'user.password_reset',
  // Role assignment is governed by its own permissions rather than by who holds which role, because holding a role
  // must never imply the power to hand that role (or a higher one) to somebody else:
  //
  //   USER_ROLE_ASSIGN      - may hand out the fellowship's ordinary roles (member, department leader, content
  //                           manager, youth, volunteer). A Secretary holds this.
  //   USER_ROLE_ASSIGN_GOV  - may hand out GOVERNANCE roles: chairperson, assistant chairperson, secretary,
  //                           assistant secretary, treasurer. These are the offices that approve money, sign off
  //                           records and hold the fellowship's authority, so they are deliberately a separate
  //                           grant. Only the Fellowship Administrator holds it.
  //
  // A Treasurer therefore cannot appoint a Chairperson even though a Treasurer can approve expenses: the ability to
  // approve and the ability to appoint are different powers, and conflating them is how a fellowship ends up with a
  // treasurer who appointed themselves.
  USER_ROLE_ASSIGN: 'user.role_assign',
  USER_ROLE_ASSIGN_GOV: 'user.role_assign_governance',

  // Member management
  MEMBER_REGISTER: 'member.register',
  MEMBER_EDIT: 'member.edit',
  MEMBER_STATUS_CHANGE: 'member.status_change',
  MEMBER_VIEW_ALL: 'member.view_all',
  MEMBER_VIEW_OWN_DEPT: 'member.view_own_dept',

  // Member engagement (Phase 14). Emergency contact is gated separately from the rest of the
  // enrichment profile; reports/engagement are aggregate-or-indicator only (no scores).
  MEMBER_PROFILE_VIEW: 'member.profile_view',
  MEMBER_PROFILE_EDIT: 'member.profile_edit',
  MEMBER_EMERGENCY_VIEW: 'member.emergency_view',
  MEMBER_EMERGENCY_EDIT: 'member.emergency_edit',
  MEMBER_HISTORY_VIEW: 'member.history_view',
  MEMBER_ENGAGEMENT_VIEW: 'member.engagement_view',
  MEMBER_REPORTS_VIEW: 'member.reports_view',
  MEMBER_GROUPS_VIEW: 'member.groups_view',
  MEMBER_GROUPS_MANAGE: 'member.groups_manage',

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

  // Advanced finance (Phase 15)
  FINANCE_CATEGORY_MANAGE: 'finance.category_manage',
  FINANCE_CAMPAIGN_MANAGE: 'finance.campaign_manage',
  FINANCE_INCOME_RECORD: 'finance.income_record',
  FINANCE_PERIOD_MANAGE: 'finance.period_manage',
  FINANCE_PLEDGE_MANAGE: 'finance.pledge_manage',
  FINANCE_RELEASE_RECORD: 'finance.release_record',
  FINANCE_REPORTS_VIEW: 'finance.reports_view',
  FINANCE_DEPARTMENT_VIEW: 'finance.department_view',
  FINANCE_MEMBER_STATEMENT_VIEW: 'finance.member_statement_view',

  // Resources & assets (Phase 16)
  RESOURCES_VIEW: 'resources.view',
  RESOURCES_MANAGE: 'resources.manage',
  RESOURCES_ASSIGN: 'resources.assign',
  RESOURCES_CHECKOUT: 'resources.checkout',
  RESOURCES_MAINTENANCE_MANAGE: 'resources.maintenance_manage',
  RESOURCES_RETIRE: 'resources.retire',
  RESOURCES_DOCUMENTS_MANAGE: 'resources.documents_manage',
  RESOURCES_REPORTS_VIEW: 'resources.reports_view',
  RESOURCES_COST_VIEW: 'resources.cost_view',
  RESOURCES_DEPARTMENT_VIEW: 'resources.department_view',

  // Platform administration (Phase 19). These belong to platform accounts only; a tenant role never holds them
  // (except SUPPORT_ACCESS_MANAGE, which lets a fellowship's Secretary decide on support-access requests).
  PLATFORM_TENANTS_VIEW: 'platform.tenants_view',
  PLATFORM_TENANTS_MANAGE: 'platform.tenants_manage',
  PLATFORM_ONBOARD: 'platform.onboard',
  PLATFORM_ANALYTICS_VIEW: 'platform.analytics_view',
  PLATFORM_AUDIT_VIEW: 'platform.audit_view',
  PLATFORM_SUPPORT_REQUEST: 'platform.support_request',
  PLATFORM_SUPPORT_VIEW: 'platform.support_view',
  PLATFORM_STAFF_MANAGE: 'platform.staff_manage',
  SUPPORT_ACCESS_MANAGE: 'support.access_manage',

  // SaaS billing (Phase 20) - the platform's own subscription billing, separate from fellowship Finance.
  PLATFORM_BILLING_VIEW: 'platform.billing_view',
  PLATFORM_BILLING_MANAGE: 'platform.billing_manage',
  BILLING_VIEW: 'billing.view',

  // Volunteer & service management (Phase 17)
  VOLUNTEER_MANAGE: 'volunteer.manage',
  VOLUNTEER_DEPARTMENT_MANAGE: 'volunteer.department_manage',
  VOLUNTEER_REPORTS_VIEW: 'volunteer.reports_view',
  VOLUNTEER_HISTORY_VIEW: 'volunteer.history_view',

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

  // Youth & Children
  YOUTH_VIEW: 'youth.view',
  YOUTH_DETAILS_VIEW: 'youth.details_view',
  YOUTH_CREATE: 'youth.create',
  YOUTH_EDIT: 'youth.edit',
  YOUTH_STATUS_CHANGE: 'youth.status_change',
  YOUTH_GUARDIANS_VIEW: 'youth.guardians_view',
  YOUTH_GUARDIANS_MANAGE: 'youth.guardians_manage',
  YOUTH_AGE_GROUPS_MANAGE: 'youth.age_groups_manage',
  YOUTH_ATTENDANCE_VIEW: 'youth.attendance_view',
  YOUTH_ATTENDANCE_MANAGE: 'youth.attendance_manage',
  YOUTH_REPORTS_VIEW: 'youth.reports_view',
  YOUTH_SAFEGUARDING_VIEW: 'youth.safeguarding_view',
  YOUTH_SAFEGUARDING_MANAGE: 'youth.safeguarding_manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
