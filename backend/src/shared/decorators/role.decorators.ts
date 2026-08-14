import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../authorization/roles';
import { Permission } from '../authorization/permissions';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';
export const DEPARTMENT_SCOPED_KEY = 'department_scoped';
export const DEPARTMENT_REQUIRED_ROLES = 'department_required_roles';

export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const DepartmentScoped = () => SetMetadata(DEPARTMENT_SCOPED_KEY, true);

export const DepartmentRequiredRoles = (...roles: RoleName[]) =>
  SetMetadata(DEPARTMENT_REQUIRED_ROLES, roles);
