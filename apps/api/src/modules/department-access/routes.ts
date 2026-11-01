// Route table for /department-access: GET (ADMIN+), PUT /:department (`controls` on
// admin-permissions, Phase 2 §2.6).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { requireMinRole } from '../../core/rbac/authorize';
import { departmentAccessController } from './controller';
import { departmentParamsSchema, putDepartmentAccessSchema } from './schemas';

export function createDepartmentAccessRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  router.get('/', requireMinRole('ADMIN'), asyncHandler(departmentAccessController.matrix));
  router.put(
    '/:department',
    requirePageAction('admin-permissions', 'controls'),
    validate({ params: departmentParamsSchema, body: putDepartmentAccessSchema }),
    asyncHandler(departmentAccessController.replace),
  );
  return router;
}
