// apps/api/src/modules/uoms/routes.ts
// Route table for /uoms (Phase 03 Order 3): `view` on admin-uom to list/get, `controls` to create/edit/delete.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { uomsController } from './controller';
import {
  createUomSchema,
  listUomsQuerySchema,
  uomIdParamsSchema,
  updateUomSchema,
} from './schemas';

const PAGE = 'admin-uom';

export function createUomsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/',
    requirePageAction(PAGE, 'view'),
    validate({ query: listUomsQuerySchema }),
    asyncHandler(uomsController.list),
  );

  router.get(
    '/:id',
    requirePageAction(PAGE, 'view'),
    validate({ params: uomIdParamsSchema }),
    asyncHandler(uomsController.get),
  );

  router.post(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: createUomSchema }),
    asyncHandler(uomsController.create),
  );

  router.patch(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: uomIdParamsSchema, body: updateUomSchema }),
    asyncHandler(uomsController.update),
  );

  router.delete(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: uomIdParamsSchema }),
    asyncHandler(uomsController.remove),
  );

  return router;
}
