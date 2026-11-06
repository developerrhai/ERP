// apps/api/src/modules/currencies/routes.ts
// Route table for /currencies (Phase 03 Order 3): `view` on admin-currency to list/get, `controls` to create/edit/delete.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { currenciesController } from './controller';
import {
  createCurrencySchema,
  currencyIdParamsSchema,
  listCurrenciesQuerySchema,
  updateCurrencySchema,
} from './schemas';

const PAGE = 'admin-currency';

export function createCurrenciesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);

  router.get(
    '/',
    requirePageAction(PAGE, 'view'),
    validate({ query: listCurrenciesQuerySchema }),
    asyncHandler(currenciesController.list),
  );

  router.get(
    '/:id',
    requirePageAction(PAGE, 'view'),
    validate({ params: currencyIdParamsSchema }),
    asyncHandler(currenciesController.get),
  );

  router.post(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: createCurrencySchema }),
    asyncHandler(currenciesController.create),
  );

  router.patch(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: currencyIdParamsSchema, body: updateCurrencySchema }),
    asyncHandler(currenciesController.update),
  );

  router.delete(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: currencyIdParamsSchema }),
    asyncHandler(currenciesController.remove),
  );

  return router;
}
