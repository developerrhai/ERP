// Routes for /permissions (Phase 02 §6).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { requirePageAction } from '../../core/rbac/access';
import { permissionsController } from './controller';

export function createPermissionsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/',
    requirePageAction('admin-permissions', 'view'),
    asyncHandler(permissionsController.list),
  );

  router.put(
    '/:roleId',
    requirePageAction('admin-permissions', 'controls'),
    asyncHandler(permissionsController.replace),
  );

  // Backwards compatibility alias for /:role
  router.put(
    '/:role',
    requirePageAction('admin-permissions', 'controls'),
    asyncHandler(permissionsController.replace),
  );

  return router;
}
