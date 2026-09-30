import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PLATFORM_ACCESS_KEY } from '../decorators/platform.decorators';
import { ROLES } from './roles';

export const isPlatformPrincipal = (roles: string[] | string | undefined): boolean => {
  const list = typeof roles === 'string' ? [roles] : roles || [];
  return list.includes(ROLES.ADMIN) || list.includes(ROLES.PLATFORM_SUPPORT);
};

/**
 * Platform accounts run the platform; they are not members of any fellowship. This guard keeps them out of
 * every controller that is not explicitly marked @PlatformAccess(), i.e. out of all tenant operational data
 * (members, finance, youth, resources, volunteers, recycle bin...). Support access to a tenant is only possible
 * through an approved, scoped, time-limited SupportAccessGrant on the /platform/support routes.
 */
@Injectable()
export class PlatformBoundaryGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user || !isPlatformPrincipal(user.roles)) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(PLATFORM_ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (allowed) return true;
    throw new ForbiddenException("Platform accounts cannot access a fellowship's operational data.");
  }
}
