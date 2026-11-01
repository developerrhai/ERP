// Route table for /permissions: ADMIN and above; the per-role hierarchy (§2.6) is in the service.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requireMinRole } from '../../core/rbac/authorize';
import { permissionsController } from './controller';
import { putPermissionsSchema, roleParamsSchema } from './schemas';

export function createPermissionsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole('ADMIN'));
  router.get('/', asyncHandler(permissionsController.list));
  router.put(
    '/:role',
    validate({ params: roleParamsSchema, body: putPermissionsSchema }),
    asyncHandler(permissionsController.replace),
  );
  return router;
}
