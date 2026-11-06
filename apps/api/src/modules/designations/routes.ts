// apps/api/src/modules/designations/routes.ts
// Route table for /designations (Phase 03 Order 3): `view` on admin-designations to list/get, `controls` to create/edit/delete.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { designationsController } from './controller';
import {
  createDesignationSchema,
  designationIdParamsSchema,
  listDesignationsQuerySchema,
  updateDesignationSchema,
} from './schemas';

const PAGE = 'admin-designations';

export function createDesignationsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/',
    requirePageAction(PAGE, 'view'),
    validate({ query: listDesignationsQuerySchema }),
    asyncHandler(designationsController.list),
  );

  router.get(
    '/:id',
    requirePageAction(PAGE, 'view'),
    validate({ params: designationIdParamsSchema }),
    asyncHandler(designationsController.get),
  );

  router.post(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: createDesignationSchema }),
    asyncHandler(designationsController.create),
  );

  router.patch(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: designationIdParamsSchema, body: updateDesignationSchema }),
    asyncHandler(designationsController.update),
  );

  router.delete(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: designationIdParamsSchema }),
    asyncHandler(designationsController.remove),
  );

  return router;
}
