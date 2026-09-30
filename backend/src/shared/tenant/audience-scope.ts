import { ROLES } from '../authorization/roles';

const MANAGEMENT_ROLES = new Set<string>([
  ROLES.SECRETARY,
  ROLES.ASSISTANT_SECRETARY,
  ROLES.CHAIRPERSON,
  ROLES.ASSISTANT_CHAIRPERSON,
  ROLES.ADMIN,
]);

const DEPARTMENT_LEADER_ROLES = new Set<string>([
  ROLES.DEPARTMENT_SECRETARY,
  ROLES.DEPARTMENT_CHAIRPERSON,
]);

export function audienceVisibilityWhere(currentUser: any): Record<string, unknown> {
  const roles: string[] = currentUser.roles || [];
  if (roles.some((role) => MANAGEMENT_ROLES.has(role))) return {};
  if (roles.some((role) => DEPARTMENT_LEADER_ROLES.has(role))) {
    if (!currentUser.departmentId) return { id: { in: [] } };
    return { OR: [
      { audience_type: { in: ['all_members', 'leaders'] } },
      { audience_type: 'department', department_id: currentUser.departmentId },
    ] };
  }
  if (roles.includes(ROLES.ORDINARY_MEMBER)) return { audience_type: 'all_members' };
  return { id: { in: [] } };
}

export function isAudienceVisible(record: any, currentUser: any): boolean {
  const roles: string[] = currentUser.roles || [];
  if (roles.some((role) => MANAGEMENT_ROLES.has(role))) return true;
  if (record.audience_type === 'all_members') return true;
  if (record.audience_type === 'leaders') return roles.some((role) => DEPARTMENT_LEADER_ROLES.has(role));
  if (record.audience_type === 'department') {
    return !!currentUser.departmentId && record.department_id === currentUser.departmentId &&
      roles.some((role) => DEPARTMENT_LEADER_ROLES.has(role));
  }
  return false;
}
