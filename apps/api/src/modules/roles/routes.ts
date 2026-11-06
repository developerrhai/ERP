// Routes for /roles (Phase 02 §6).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { requirePageAction } from '../../core/rbac/access';
import { rolesController } from './controller';

export function createRolesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get('/', requirePageAction('admin-roles', 'view'), asyncHandler(rolesController.list));
  router.get('/:id', requirePageAction('admin-roles', 'view'), asyncHandler(rolesController.get));
  router.post('/', requirePageAction('admin-roles', 'add'), asyncHandler(rolesController.create));
  router.patch('/:id', requirePageAction('admin-roles', 'edit'), asyncHandler(rolesController.update));
  router.delete('/:id', requirePageAction('admin-roles', 'delete'), asyncHandler(rolesController.delete));

  return router;
}
