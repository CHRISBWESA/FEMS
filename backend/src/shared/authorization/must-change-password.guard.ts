import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allow_when_password_change_required';
/** Routes an account with a temporary password may still use: changing it, signing out, reading its own profile. */
export const AllowWhenPasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

/**
 * A temporary password (issued at onboarding or by a reset) is only good for setting a real one. Until the
 * account does that, every other route answers 403 - the flag used to be advisory, so a temporary password
 * stayed a fully working credential indefinitely.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler())) return true;
    const user = context.switchToHttp().getRequest().user;
    if (!user?.mustChangePassword) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [context.getHandler(), context.getClass()]);
    if (allowed) return true;
    throw new ForbiddenException({ statusCode: 403, message: 'You must change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
}
