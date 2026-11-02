// Route table for /financial-years (Phase 3 §A2): `view` on admin-fy to list, `controls` to add,
// relabel, set current, close and reopen.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { financialYearsController } from './controller';
import { createFinancialYearSchema, fyIdParamsSchema, updateFinancialYearSchema } from './schemas';

const PAGE = 'admin-fy';

export function createFinancialYearsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  router.get('/', requirePageAction(PAGE, 'view'), asyncHandler(financialYearsController.list));
  router.post(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: createFinancialYearSchema }),
    asyncHandler(financialYearsController.create),
  );
  router.patch(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: fyIdParamsSchema, body: updateFinancialYearSchema }),
    asyncHandler(financialYearsController.update),
  );
  for (const [path, handler] of [
    ['set-current', financialYearsController.setCurrent],
    ['close', financialYearsController.close],
    ['reopen', financialYearsController.reopen],
  ] as const) {
    router.post(
      `/:id/${path}`,
      requirePageAction(PAGE, 'controls'),
      validate({ params: fyIdParamsSchema }),
      asyncHandler(handler),
    );
  }
  return router;
}
