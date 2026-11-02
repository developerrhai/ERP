// Route table for GET /roles (ADMIN and above + `view` on admin-roles; roles are fixed in code, so
// read-only).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { requirePageAction } from '../../core/rbac/access';
import { requireMinRole } from '../../core/rbac/authorize';
import { rolesController } from './controller';

export function createRolesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole('ADMIN'), resolveContext);
  router.get('/', requirePageAction('admin-roles', 'view'), asyncHandler(rolesController.list));
  return router;
}
