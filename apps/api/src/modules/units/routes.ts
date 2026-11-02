// Route table for /units (Phase 3 §A2): `view` on admin-branches (Unit Master) to list,
// `controls` to create / edit / delete, all through the shared access decision.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { unitsController } from './controller';
import {
  createUnitSchema,
  listUnitsQuerySchema,
  unitIdParamsSchema,
  updateUnitSchema,
} from './schemas';

const PAGE = 'admin-branches';

export function createUnitsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  router.get(
    '/',
    requirePageAction(PAGE, 'view'),
    validate({ query: listUnitsQuerySchema }),
    asyncHandler(unitsController.list),
  );
  router.post(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: createUnitSchema }),
    asyncHandler(unitsController.create),
  );
  router.patch(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: unitIdParamsSchema, body: updateUnitSchema }),
    asyncHandler(unitsController.update),
  );
  router.delete(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: unitIdParamsSchema }),
    asyncHandler(unitsController.remove),
  );
  return router;
}
