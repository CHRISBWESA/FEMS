import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ROLES_KEY } from '../decorators/role.decorators';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RoleName } from '../authorization/roles';
import { Permission } from '../authorization/permissions';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.get<boolean>(
      IS_PUBLIC_KEY,
      context.getHandler(),
    );
    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    let roles: string[] = [];
    let permissions: Permission[] = [];

    if (typeof user.roles === 'string') {
      roles = [user.roles];
    } else {
      roles = user.roles || [];
    }

    permissions = user.permissions || [];

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = roles.some((r: string) => requiredRoles.includes(r as RoleName));
      if (!hasRole) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    if (requiredPermissions && requiredPermissions.length > 0) {
      const hasPermission = permissions.some((p: Permission) =>
        requiredPermissions.includes(p),
      );
      if (!hasPermission) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    return true;
  }
}
