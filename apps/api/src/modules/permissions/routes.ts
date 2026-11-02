// Route table for /permissions: ADMIN and above (GET also needs `view` on admin-permissions); the
// per-role hierarchy (§2.6) is in the service.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { requireMinRole } from '../../core/rbac/authorize';
import { permissionsController } from './controller';
import { putPermissionsSchema, roleParamsSchema } from './schemas';

export function createPermissionsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole('ADMIN'), resolveContext);
  router.get(
    '/',
    requirePageAction('admin-permissions', 'view'),
    asyncHandler(permissionsController.list),
  );
  router.put(
    '/:role',
    validate({ params: roleParamsSchema, body: putPermissionsSchema }),
    asyncHandler(permissionsController.replace),
  );
  return router;
}
