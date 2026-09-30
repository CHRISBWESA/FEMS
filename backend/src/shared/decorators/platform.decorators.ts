import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ACCESS_KEY = 'platform_access';
export const REQUIRES_MODULE_KEY = 'requires_module';

/**
 * Marks a controller/route as safe for platform accounts (admin, platform_support): it exposes platform
 * configuration or a user's own data, never a fellowship's operational data. Everything WITHOUT this marker
 * is closed to platform accounts by PlatformBoundaryGuard, so a new module is safe by default.
 */
export const PlatformAccess = () => SetMetadata(PLATFORM_ACCESS_KEY, true);

/** The controller belongs to an optional module that a fellowship can have switched off. */
export const RequiresModule = (key: string) => SetMetadata(REQUIRES_MODULE_KEY, key);
