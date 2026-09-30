import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_MODULE_KEY } from '../decorators/platform.decorators';
import { ModuleAvailabilityService } from './module-availability.service';

@Injectable()
export class ModuleAvailabilityGuard implements CanActivate {
  constructor(private reflector: Reflector, private modules: ModuleAvailabilityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(REQUIRES_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!key) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user?.fellowshipId) return true; // platform accounts are handled by PlatformBoundaryGuard
    if (await this.modules.isEnabled(user.fellowshipId, key)) return true;
    throw new ForbiddenException('This module is not enabled for your fellowship.');
  }
}
