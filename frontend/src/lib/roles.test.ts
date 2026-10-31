import { isDepartmentLeaderOnly } from './roles';

describe('isDepartmentLeaderOnly', () => {
  it('sends people who only lead departments to the workspace', () => {
    expect(isDepartmentLeaderOnly(['department_chairperson'])).toBe(true);
    expect(isDepartmentLeaderOnly(['department_secretary', 'department_chairperson'])).toBe(true);
    expect(isDepartmentLeaderOnly(['department_secretary', 'ordinary_member'])).toBe(true);
  });
  it('keeps fellowship officers in the administration screens', () => {
    expect(isDepartmentLeaderOnly(['secretary', 'department_chairperson'])).toBe(false);
    expect(isDepartmentLeaderOnly(['treasurer'])).toBe(false);
    expect(isDepartmentLeaderOnly(['ordinary_member'])).toBe(false);
    expect(isDepartmentLeaderOnly([])).toBe(false);
  });
});
