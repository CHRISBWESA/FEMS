export const DEPARTMENT_LEADER_ROLES = ['department_chairperson', 'department_secretary'];

/** True for someone whose only office is leading a department: their home is the department workspace. */
export function isDepartmentLeaderOnly(roles: string[] = []): boolean {
  const meaningful = roles.filter((r) => r !== 'ordinary_member');
  return meaningful.length > 0 && meaningful.every((r) => DEPARTMENT_LEADER_ROLES.includes(r));
}
