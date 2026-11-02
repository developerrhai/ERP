// Route table for /company (Phase 3 §A2): `view` on admin-company to read, `controls` to PATCH.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { companyController } from './controller';
import { updateCompanySchema } from './schemas';

const PAGE = 'admin-company';

export function createCompanyRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  router.get('/', requirePageAction(PAGE, 'view'), asyncHandler(companyController.get));
  router.patch(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: updateCompanySchema }),
    asyncHandler(companyController.update),
  );
  return router;
}
