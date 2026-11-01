// Route table for /users. Every route requires a Bearer token, a changed password and ADMIN+;
// finer §1.2 rules (who may manage whom) are enforced in the service.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
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

export function createUsersRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole(USER_ADMIN_MIN_ROLE));

  router.get('/', validate({ query: listUsersQuerySchema }), asyncHandler(usersController.list));
  router.post('/', validate({ body: createUserSchema }), asyncHandler(usersController.create));
  router.get('/:id', validate({ params: userIdParamsSchema }), asyncHandler(usersController.get));
  router.patch(
    '/:id',
    validate({ params: userIdParamsSchema, body: updateUserSchema }),
    asyncHandler(usersController.update),
  );
  router.post(
    '/:id/reset-password',
    validate({ params: userIdParamsSchema, body: resetPasswordSchema }),
    asyncHandler(usersController.resetPassword),
  );
  return router;
}
