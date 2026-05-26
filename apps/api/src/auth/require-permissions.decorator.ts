import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Stamp a route handler (or controller class) with the permission keys a user
 * must have to call it. `PermissionsGuard` enforces. Multiple keys are AND:
 *
 *   @RequirePermissions('branch.create')
 *   @RequirePermissions('branch.update', 'branch.archive')   // needs both
 *
 * A role's permissions array may include the wildcard `'*'` which matches any
 * required key. We use that to grant the founder all permissions at signup
 * without enumerating every key.
 */
export const RequirePermissions = (...keys: string[]) => SetMetadata(PERMISSIONS_KEY, keys);
