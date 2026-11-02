// Route table for /departments: `view` on admin-departments to list, `controls` to write
// (Phase 2 §2.6), all through the shared access decision.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { departmentsController } from './controller';
import {
  createDepartmentSchema,
  departmentIdParamsSchema,
  updateDepartmentSchema,
} from './schemas';

const PAGE = 'admin-departments';

export function createDepartmentsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, resolveContext);
  router.get('/', requirePageAction(PAGE, 'view'), asyncHandler(departmentsController.list));
  router.post(
    '/',
    requirePageAction(PAGE, 'controls'),
    validate({ body: createDepartmentSchema }),
    asyncHandler(departmentsController.create),
  );
  router.patch(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: departmentIdParamsSchema, body: updateDepartmentSchema }),
    asyncHandler(departmentsController.update),
  );
  router.delete(
    '/:id',
    requirePageAction(PAGE, 'controls'),
    validate({ params: departmentIdParamsSchema }),
    asyncHandler(departmentsController.remove),
  );
  return router;
}
