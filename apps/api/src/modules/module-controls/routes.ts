// Route table for /module-controls: GET (ADMIN+), PATCH /:pageId (`controls` on admin-settings).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { requireMinRole } from '../../core/rbac/authorize';
import { moduleControlsController } from './controller';
import {
  listModuleControlsQuerySchema,
  pageIdParamsSchema,
  updateModuleControlSchema,
} from './schemas';

export function createModuleControlsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  router.get(
    '/',
    requireMinRole('ADMIN'),
    requirePageAction('admin-settings', 'view'),
    validate({ query: listModuleControlsQuerySchema }),
    asyncHandler(moduleControlsController.list),
  );
  router.patch(
    '/:pageId',
    requirePageAction('admin-settings', 'controls'),
    validate({ params: pageIdParamsSchema, body: updateModuleControlSchema }),
    asyncHandler(moduleControlsController.update),
  );
  return router;
}
