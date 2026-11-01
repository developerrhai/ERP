// Route table for GET /roles (ADMIN and above; roles are fixed in code, so read-only).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { requireMinRole } from '../../core/rbac/authorize';
import { rolesController } from './controller';

export function createRolesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole('ADMIN'));
  router.get('/', asyncHandler(rolesController.list));
  return router;
}
