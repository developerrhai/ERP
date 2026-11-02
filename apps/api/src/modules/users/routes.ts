// Route table for /users. Every route requires a Bearer token, a changed password and ADMIN+, plus
// the admin-users page permission (view / add / edit); finer §1.2 rules (who may manage whom) are
// enforced in the service.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { requireMinRole } from '../../core/rbac/authorize';
import { USER_ADMIN_MIN_ROLE } from '../../core/rbac/role-rules';
import { usersController } from './controller';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  userIdParamsSchema,
} from './schemas';

const PAGE = 'admin-users';

export function createUsersRouter(): Router {
  const router = Router();
  router.use(
    authenticate,
    requirePasswordChanged,
    requireMinRole(USER_ADMIN_MIN_ROLE),
    resolveContext,
  );

  router.get(
    '/',
    requirePageAction(PAGE, 'view'),
    validate({ query: listUsersQuerySchema }),
    asyncHandler(usersController.list),
  );
  router.post(
    '/',
    requirePageAction(PAGE, 'add'),
    validate({ body: createUserSchema }),
    asyncHandler(usersController.create),
  );
  router.get(
    '/:id',
    requirePageAction(PAGE, 'view'),
    validate({ params: userIdParamsSchema }),
    asyncHandler(usersController.get),
  );
  router.patch(
    '/:id',
    requirePageAction(PAGE, 'edit'),
    validate({ params: userIdParamsSchema, body: updateUserSchema }),
    asyncHandler(usersController.update),
  );
  router.post(
    '/:id/reset-password',
    requirePageAction(PAGE, 'edit'),
    validate({ params: userIdParamsSchema, body: resetPasswordSchema }),
    asyncHandler(usersController.resetPassword),
  );
  return router;
}
