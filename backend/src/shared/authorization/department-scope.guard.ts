import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEPARTMENT_SCOPED_KEY } from '../decorators/role.decorators';

@Injectable()
export class DepartmentScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const departmentScoped = this.reflector.getAllAndOverride<boolean>(
      DEPARTMENT_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!departmentScoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true;
    }

    const userRoles: string[] = typeof user.roles === 'string' ? [user.roles] : (user.roles || []);
    const isDepartmentLeader =
      userRoles.includes('department_secretary') || userRoles.includes('department_chairperson');

    if (!isDepartmentLeader) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    // For department leader routes, inject department context into the request
    // The actual resource access is validated in each controller/service
    // This ensures only dept leaders can reach dept-scoped handlers
    request.departmentContext = {
      departmentId: user.departmentId,
      isDepartmentLeader,
    };

    return true;
  }
}
