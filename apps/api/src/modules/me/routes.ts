// Route table for /me: GET /me/menu and GET /me/permissions?pageId=. Any signed-in user whose
// password change is not pending (Phase 1 gate).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { meController } from './controller';
import { mePermissionsQuerySchema } from './schemas';

export function createMeRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  router.get('/menu', asyncHandler(meController.menu));
  router.get(
    '/permissions',
    validate({ query: mePermissionsQuerySchema }),
    asyncHandler(meController.permissions),
  );
  return router;
}
