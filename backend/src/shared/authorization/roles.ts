import { PERMISSIONS, Permission } from './permissions';

export const ROLES = {
  ADMIN: 'admin',
  PLATFORM_SUPPORT: 'platform_support',
  // The fellowship's SYSTEM administrator: the person who configures the FEMS account itself - who has an account,
  // who holds which role, who is invited. Deliberately NOT a fellowship office. It carries no members, no finance
  // and no approvals; Chairperson, Secretary and Treasurer are the organizational leadership and are separate roles
  // that this account administers but does not hold by default.
  FELLOWSHIP_ADMIN: 'fellowship_admin',
  SECRETARY: 'secretary',
  ASSISTANT_SECRETARY: 'assistant_secretary',
  CHAIRPERSON: 'chairperson',
  ASSISTANT_CHAIRPERSON: 'assistant_chairperson',
  TREASURER: 'treasurer',
  DEPARTMENT_SECRETARY: 'department_secretary',
  DEPARTMENT_CHAIRPERSON: 'department_chairperson',
  IT_ADMIN: 'it_admin',
  GENDER_LEADER: 'gender_leader',
  ORDINARY_MEMBER: 'ordinary_member',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const PLATFORM_ROLES = new Set<RoleName>([ROLES.ADMIN, ROLES.PLATFORM_SUPPORT]);

export interface RoleConfig {
  name: RoleName;
  description: string;
  permissions: Permission[];
}

/**
 * The roles that carry a fellowship's authority: they approve money, sign off records, and are the offices a
 * constitution would name.
 *
 * Listed once here because "may this person appoint a Chairperson?" is a question about the ROLE, not about the
 * person holding it, and it has to be answered in exactly one place. Assigning any of these requires
 * `USER_ROLE_ASSIGN_GOV`; assigning anything else within the fellowship requires only `USER_ROLE_ASSIGN`.
 */
export const GOVERNANCE_ROLES: ReadonlySet<RoleName> = new Set<RoleName>([
  ROLES.CHAIRPERSON,
  ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.SECRETARY,
  ROLES.ASSISTANT_SECRETARY,
  ROLES.TREASURER,
]);

/**
 * The Secretary's operational permissions, kept separate so the description above can be read as a single idea:
 * the IT administrator manages the fellowship's public content, and is explicitly NOT built out of these.
 *
 * Note the absence of `USER_ROLE_ASSIGN_GOV`. A Secretary runs the congregation's day-to-day administration and may
 * appoint ordinary members and department leaders, but may NOT appoint a Treasurer, Secretary or Chairperson: those
 * are the fellowship's governance, and the Fellowship Administrator appoints them.
 */
const SECRETARY_PERMISSIONS: Permission[] = [
      PERMISSIONS.MEMBER_REGISTER,
      PERMISSIONS.MEMBER_EDIT,
      PERMISSIONS.MEMBER_STATUS_CHANGE,
      PERMISSIONS.MEMBER_VIEW_ALL,
      PERMISSIONS.DEPARTMENT_MANAGE,
      PERMISSIONS.DEPARTMENT_LEADERS_MANAGE,
      PERMISSIONS.DEPARTMENT_MEMBER_ADD,
      PERMISSIONS.DEPARTMENT_MEMBER_REMOVE,
      PERMISSIONS.DEPARTMENT_TRANSFER,
      PERMISSIONS.ACTIVITY_CREATE,
      PERMISSIONS.ACTIVITY_EDIT,
      PERMISSIONS.ACTIVITY_CANCEL,
      PERMISSIONS.REPORT_SUBMIT,
      PERMISSIONS.REPORT_REVIEW,
      PERMISSIONS.REPORT_FINAL_APPROVE,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_CONTRIBUTION_RECORD,
      PERMISSIONS.FINANCE_CONTRIBUTION_EDIT,
      PERMISSIONS.FINANCE_EXPENSE_RECORD,
      PERMISSIONS.FINANCE_EXPENSE_APPROVE,
      PERMISSIONS.FINANCE_BUDGET_CREATE,
      PERMISSIONS.FINANCE_BUDGET_APPROVE,
      PERMISSIONS.FINANCE_MONEY_REQUEST_CREATE,
      PERMISSIONS.FINANCE_MONEY_REQUEST_APPROVE,
      PERMISSIONS.USER_PASSWORD_RESET,
      PERMISSIONS.USER_MANAGE,
      // Ordinary roles only. `USER_ROLE_ASSIGN_GOV` is deliberately NOT here: a Secretary appoints members and
      // department leaders, never the fellowship's officers.
      PERMISSIONS.USER_ROLE_ASSIGN,
      PERMISSIONS.RECYCLE_RESTORE,
      PERMISSIONS.BACKUP_RESTORE,
      PERMISSIONS.ACTIVITY_ATTENDANCE,
      PERMISSIONS.ACTIVITY_SHARE_LINK,
      PERMISSIONS.ADMIN_AUDIT_VIEW,
      PERMISSIONS.YOUTH_VIEW,
      PERMISSIONS.YOUTH_DETAILS_VIEW,
      PERMISSIONS.YOUTH_CREATE,
      PERMISSIONS.YOUTH_EDIT,
      PERMISSIONS.YOUTH_STATUS_CHANGE,
      PERMISSIONS.YOUTH_GUARDIANS_VIEW,
      PERMISSIONS.YOUTH_GUARDIANS_MANAGE,
      PERMISSIONS.YOUTH_AGE_GROUPS_MANAGE,
      PERMISSIONS.YOUTH_ATTENDANCE_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_MANAGE,
      PERMISSIONS.YOUTH_REPORTS_VIEW,
      PERMISSIONS.YOUTH_SAFEGUARDING_VIEW,
      PERMISSIONS.YOUTH_SAFEGUARDING_MANAGE,
      PERMISSIONS.MEMBER_PROFILE_VIEW,
      PERMISSIONS.MEMBER_PROFILE_EDIT,
      PERMISSIONS.MEMBER_EMERGENCY_VIEW,
      PERMISSIONS.MEMBER_EMERGENCY_EDIT,
      PERMISSIONS.MEMBER_HISTORY_VIEW,
      PERMISSIONS.MEMBER_ENGAGEMENT_VIEW,
      PERMISSIONS.MEMBER_REPORTS_VIEW,
      PERMISSIONS.MEMBER_GROUPS_VIEW,
      PERMISSIONS.MEMBER_GROUPS_MANAGE,
      PERMISSIONS.FINANCE_CATEGORY_MANAGE,
      PERMISSIONS.FINANCE_CAMPAIGN_MANAGE,
      PERMISSIONS.FINANCE_INCOME_RECORD,
      PERMISSIONS.FINANCE_PERIOD_MANAGE,
      PERMISSIONS.FINANCE_PLEDGE_MANAGE,
      PERMISSIONS.FINANCE_REPORTS_VIEW,
      PERMISSIONS.FINANCE_MEMBER_STATEMENT_VIEW,
      PERMISSIONS.RESOURCES_VIEW,
      PERMISSIONS.RESOURCES_MANAGE,
      PERMISSIONS.RESOURCES_ASSIGN,
      PERMISSIONS.RESOURCES_CHECKOUT,
      PERMISSIONS.RESOURCES_MAINTENANCE_MANAGE,
      PERMISSIONS.RESOURCES_RETIRE,
      PERMISSIONS.RESOURCES_DOCUMENTS_MANAGE,
      PERMISSIONS.RESOURCES_REPORTS_VIEW,
      PERMISSIONS.RESOURCES_COST_VIEW,
      PERMISSIONS.SUPPORT_ACCESS_MANAGE,
      PERMISSIONS.BILLING_VIEW,
      PERMISSIONS.VOLUNTEER_MANAGE,
      PERMISSIONS.VOLUNTEER_REPORTS_VIEW,
      PERMISSIONS.VOLUNTEER_HISTORY_VIEW,
];

export const ROLE_DEFINITIONS: RoleConfig[] = [
  {
    // The platform administrator runs the platform (tenants, accounts, backups, platform audit). It deliberately
    // does NOT hold any permission over a fellowship's operational data (members, finance, youth, resources,
    // volunteers, recycle bin...). Before Phase 19 it held every permission.
    name: ROLES.ADMIN,
    description: 'Platform administrator',
    permissions: [
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.USER_VIEW,
      PERMISSIONS.USER_PASSWORD_RESET,
      PERMISSIONS.ADMIN_SETTINGS,
      PERMISSIONS.ADMIN_BACKUP,
      PERMISSIONS.ADMIN_RESTORE,
      PERMISSIONS.ADMIN_AUDIT_VIEW,
      // Acting as a fellowship account. Deliberately NOT combined with role assignment: the administrator can
      // enter a fellowship to fix something as that person, but does not hand out the fellowship's job titles.
      PERMISSIONS.ADMIN_IMPERSONATE,
      PERMISSIONS.BACKUP_CREATE,
      PERMISSIONS.BACKUP_RESTORE,
      PERMISSIONS.PLATFORM_TENANTS_VIEW,
      PERMISSIONS.PLATFORM_TENANTS_MANAGE,
      PERMISSIONS.PLATFORM_ONBOARD,
      PERMISSIONS.PLATFORM_ANALYTICS_VIEW,
      PERMISSIONS.PLATFORM_AUDIT_VIEW,
      PERMISSIONS.PLATFORM_SUPPORT_REQUEST,
      PERMISSIONS.PLATFORM_SUPPORT_VIEW,
      PERMISSIONS.PLATFORM_STAFF_MANAGE,
      PERMISSIONS.PLATFORM_BILLING_VIEW,
      PERMISSIONS.PLATFORM_BILLING_MANAGE,
    ],
  },
  {
    // Support staff: read-only platform metrics and tenant status, and they may ASK a fellowship for scoped,
    // time-limited diagnostic access. They cannot change a tenant.
    name: ROLES.PLATFORM_SUPPORT,
    description: 'Platform support (read-only, scoped)',
    permissions: [
      PERMISSIONS.PLATFORM_TENANTS_VIEW,
      PERMISSIONS.PLATFORM_ANALYTICS_VIEW,
      PERMISSIONS.PLATFORM_SUPPORT_REQUEST,
      PERMISSIONS.PLATFORM_SUPPORT_VIEW,
      PERMISSIONS.PLATFORM_BILLING_VIEW,
    ],
  },
  {
    name: ROLES.ASSISTANT_SECRETARY,
    description: 'Assistant Secretary with same access except Secretary-only actions',
    permissions: [
      PERMISSIONS.MEMBER_REGISTER,
      PERMISSIONS.MEMBER_VIEW_ALL,
      PERMISSIONS.DEPARTMENT_MANAGE,
      PERMISSIONS.DEPARTMENT_LEADERS_MANAGE,
      PERMISSIONS.DEPARTMENT_MEMBER_ADD,
      PERMISSIONS.DEPARTMENT_MEMBER_REMOVE,
      PERMISSIONS.DEPARTMENT_TRANSFER,
      PERMISSIONS.ACTIVITY_CREATE,
      PERMISSIONS.ACTIVITY_EDIT,
      PERMISSIONS.ACTIVITY_CANCEL,
      PERMISSIONS.REPORT_REVIEW,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.USER_PASSWORD_RESET,
      PERMISSIONS.RECYCLE_RESTORE,
      PERMISSIONS.BACKUP_RESTORE,
      PERMISSIONS.ACTIVITY_ATTENDANCE,
      PERMISSIONS.ACTIVITY_SHARE_LINK,
      PERMISSIONS.ADMIN_AUDIT_VIEW,
      PERMISSIONS.YOUTH_VIEW,
      PERMISSIONS.YOUTH_DETAILS_VIEW,
      PERMISSIONS.YOUTH_CREATE,
      PERMISSIONS.YOUTH_GUARDIANS_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_MANAGE,
      PERMISSIONS.YOUTH_REPORTS_VIEW,
      PERMISSIONS.MEMBER_PROFILE_VIEW,
      PERMISSIONS.MEMBER_PROFILE_EDIT,
      PERMISSIONS.MEMBER_EMERGENCY_VIEW,
      PERMISSIONS.MEMBER_HISTORY_VIEW,
      PERMISSIONS.MEMBER_ENGAGEMENT_VIEW,
      PERMISSIONS.MEMBER_REPORTS_VIEW,
      PERMISSIONS.MEMBER_GROUPS_VIEW,
      PERMISSIONS.MEMBER_GROUPS_MANAGE,
      PERMISSIONS.FINANCE_REPORTS_VIEW,
      PERMISSIONS.FINANCE_MEMBER_STATEMENT_VIEW,
      PERMISSIONS.RESOURCES_VIEW,
      PERMISSIONS.RESOURCES_MANAGE,
      PERMISSIONS.RESOURCES_ASSIGN,
      PERMISSIONS.RESOURCES_CHECKOUT,
      PERMISSIONS.RESOURCES_MAINTENANCE_MANAGE,
      PERMISSIONS.RESOURCES_DOCUMENTS_MANAGE,
      PERMISSIONS.RESOURCES_REPORTS_VIEW,
      PERMISSIONS.RESOURCES_COST_VIEW,
      PERMISSIONS.VOLUNTEER_MANAGE,
      PERMISSIONS.VOLUNTEER_REPORTS_VIEW,
      PERMISSIONS.VOLUNTEER_HISTORY_VIEW,
    ],
  },
  {
    name: ROLES.CHAIRPERSON,
    description: 'Chairperson with approval and oversight access',
    permissions: [
      PERMISSIONS.REPORT_FINAL_APPROVE,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_EXPENSE_APPROVE,
      PERMISSIONS.FINANCE_BUDGET_APPROVE,
      PERMISSIONS.FINANCE_MONEY_REQUEST_APPROVE,
      PERMISSIONS.ADMIN_AUDIT_VIEW,
      PERMISSIONS.FINANCE_CONTRIBUTION_EDIT,
      PERMISSIONS.YOUTH_VIEW,
      PERMISSIONS.YOUTH_REPORTS_VIEW,
      PERMISSIONS.MEMBER_REPORTS_VIEW,
      PERMISSIONS.MEMBER_GROUPS_VIEW,
      PERMISSIONS.FINANCE_REPORTS_VIEW,
      PERMISSIONS.FINANCE_MEMBER_STATEMENT_VIEW,
      PERMISSIONS.RESOURCES_VIEW,
      PERMISSIONS.RESOURCES_REPORTS_VIEW,
      PERMISSIONS.RESOURCES_COST_VIEW,
      PERMISSIONS.VOLUNTEER_REPORTS_VIEW,
    ],
  },
  {
    // The fellowship's SYSTEM administrator. Its whole job is configuring the FEMS account: who has access, which
    // roles exist, and who is invited to hold them. It holds no members, no finance and no approvals, because it is
    // an office in the software rather than an office in the congregation. A fellowship that wants one person to be
    // both the system administrator and, say, the Secretary simply holds both roles - the two are independent and
    // compose rather than conflict.
    name: ROLES.FELLOWSHIP_ADMIN,
    description: 'Fellowship system administrator (configures the FEMS account, appoints office holders)',
    permissions: [
      PERMISSIONS.USER_VIEW,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.USER_PASSWORD_RESET,
      PERMISSIONS.USER_ROLE_ASSIGN,
      // The one role besides the platform administrator that may appoint a Treasurer, Secretary or Chairperson.
      PERMISSIONS.USER_ROLE_ASSIGN_GOV,
      PERMISSIONS.SUPPORT_ACCESS_MANAGE,
      PERMISSIONS.RECYCLE_RESTORE,
    ],
  },
  {
    name: ROLES.SECRETARY,
    description: 'Main Secretary managing members, departments, activities, reports',
    permissions: SECRETARY_PERMISSIONS,
  },
  {
    // Content manager for the fellowship's public site. Deliberately NOT an administrative role: it holds only
    // the three it.content_* permissions, which no other role has, so it can publish and edit the landing-page
    // content (announcements, publications, gallery, sermons) without being able to touch members, finance or
    // accounts. Whoever also runs the fellowship is a `secretary` as well; the two are complementary.
    name: ROLES.IT_ADMIN,
    description: 'Content manager for the fellowship public site',
    permissions: [
      PERMISSIONS.IT_CONTENT_EDIT,
      PERMISSIONS.IT_CONTENT_PUBLISH_APPROVE,
      PERMISSIONS.IT_CONTENT_DELETE_APPROVE,
    ],
  },
  {
    name: ROLES.ASSISTANT_CHAIRPERSON,
    description: 'Assistant Chairperson, same as Chairperson for approvals',
    permissions: [
      PERMISSIONS.REPORT_FINAL_APPROVE,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_EXPENSE_APPROVE,
      PERMISSIONS.FINANCE_BUDGET_APPROVE,
      PERMISSIONS.FINANCE_MONEY_REQUEST_APPROVE,
      PERMISSIONS.ADMIN_AUDIT_VIEW,
      PERMISSIONS.FINANCE_CONTRIBUTION_EDIT,
      PERMISSIONS.YOUTH_VIEW,
      PERMISSIONS.YOUTH_REPORTS_VIEW,
      PERMISSIONS.MEMBER_REPORTS_VIEW,
      PERMISSIONS.MEMBER_GROUPS_VIEW,
      PERMISSIONS.FINANCE_REPORTS_VIEW,
      PERMISSIONS.FINANCE_MEMBER_STATEMENT_VIEW,
      PERMISSIONS.RESOURCES_VIEW,
      PERMISSIONS.RESOURCES_REPORTS_VIEW,
      PERMISSIONS.RESOURCES_COST_VIEW,
      PERMISSIONS.VOLUNTEER_REPORTS_VIEW,
    ],
  },
  {
    name: ROLES.TREASURER,
    description: 'Treasurer managing contributions, expenses, budgets, money requests',
    permissions: [
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_CONTRIBUTION_RECORD,
      PERMISSIONS.FINANCE_CONTRIBUTION_EDIT,
      PERMISSIONS.FINANCE_EXPENSE_RECORD,
      PERMISSIONS.FINANCE_BUDGET_CREATE,
      PERMISSIONS.FINANCE_MONEY_REQUEST_APPROVE,
      PERMISSIONS.FINANCE_CATEGORY_MANAGE,
      PERMISSIONS.FINANCE_CAMPAIGN_MANAGE,
      PERMISSIONS.FINANCE_INCOME_RECORD,
      PERMISSIONS.FINANCE_PERIOD_MANAGE,
      PERMISSIONS.FINANCE_PLEDGE_MANAGE,
      PERMISSIONS.FINANCE_RELEASE_RECORD,
      PERMISSIONS.FINANCE_REPORTS_VIEW,
      PERMISSIONS.FINANCE_MEMBER_STATEMENT_VIEW,
      PERMISSIONS.RESOURCES_VIEW,
      PERMISSIONS.RESOURCES_REPORTS_VIEW,
      PERMISSIONS.RESOURCES_COST_VIEW,
    ],
  },
  {
    name: ROLES.DEPARTMENT_SECRETARY,
    description: 'Department Secretary for own department',
    permissions: [
      PERMISSIONS.MEMBER_VIEW_OWN_DEPT,
      PERMISSIONS.DEPARTMENT_MEMBER_ADD,
      PERMISSIONS.DEPARTMENT_MEMBER_REMOVE,
      PERMISSIONS.REPORT_SUBMIT,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.YOUTH_VIEW,
      PERMISSIONS.YOUTH_DETAILS_VIEW,
      PERMISSIONS.YOUTH_GUARDIANS_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_MANAGE,
      PERMISSIONS.MEMBER_PROFILE_VIEW,
      PERMISSIONS.MEMBER_ENGAGEMENT_VIEW,
      PERMISSIONS.MEMBER_REPORTS_VIEW,
      PERMISSIONS.FINANCE_DEPARTMENT_VIEW,
      PERMISSIONS.RESOURCES_DEPARTMENT_VIEW,
      PERMISSIONS.VOLUNTEER_DEPARTMENT_MANAGE,
      PERMISSIONS.VOLUNTEER_REPORTS_VIEW,
    ],
  },
  {
    name: ROLES.DEPARTMENT_CHAIRPERSON,
    description: 'Department Chairperson for own department',
    permissions: [
      PERMISSIONS.MEMBER_VIEW_OWN_DEPT,
      PERMISSIONS.DEPARTMENT_MEMBER_ADD,
      PERMISSIONS.DEPARTMENT_MEMBER_REMOVE,
      PERMISSIONS.REPORT_SUBMIT,
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.YOUTH_VIEW,
      PERMISSIONS.YOUTH_DETAILS_VIEW,
      PERMISSIONS.YOUTH_GUARDIANS_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_VIEW,
      PERMISSIONS.YOUTH_ATTENDANCE_MANAGE,
      PERMISSIONS.MEMBER_PROFILE_VIEW,
      PERMISSIONS.MEMBER_ENGAGEMENT_VIEW,
      PERMISSIONS.MEMBER_REPORTS_VIEW,
      PERMISSIONS.FINANCE_DEPARTMENT_VIEW,
      PERMISSIONS.RESOURCES_DEPARTMENT_VIEW,
      PERMISSIONS.VOLUNTEER_DEPARTMENT_MANAGE,
      PERMISSIONS.VOLUNTEER_REPORTS_VIEW,
    ],
  },
  {
    name: ROLES.GENDER_LEADER,
    description: 'Gender Leader who can register members of their gender',
    permissions: [
      PERMISSIONS.MEMBER_REGISTER,
    ],
  },
  {
    name: ROLES.ORDINARY_MEMBER,
    description: 'Ordinary fellowship member',
    permissions: [],
  },
];

export const getRoleByName = (name: string): RoleConfig | undefined =>
  ROLE_DEFINITIONS.find((r) => r.name === name);

/** A role's display name, for messages that name the role rather than its key. */
export const roleLabel = (name: string): string => getRoleByName(name)?.description ?? name;

// Single source of truth for "what may a user with these roles do". This is what the server enforces
// (JwtStrategy) and what tokens/login responses should advertise to the client, so the UI never
// disagrees with the API because a stored permissions column went stale.
export const permissionsForRoles = (roles: string[] | undefined): Permission[] =>
  Array.from(new Set(ROLE_DEFINITIONS.filter((r) => (roles || []).includes(r.name)).flatMap((r) => r.permissions)));
