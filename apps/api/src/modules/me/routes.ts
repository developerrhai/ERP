// Route table for /me: GET /me/menu, GET /me/permissions?pageId= and GET/PUT /me/context. Any
// signed-in user whose password change is not pending (Phase 1 gate). /me does not mount
// resolveContext: these routes are how the web recovers from a stale X-Unit-Id / X-FY-Id.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { meController } from './controller';
import { mePermissionsQuerySchema, putContextSchema, putLocaleSchema } from './schemas';

export function createMeRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  router.get('/menu', asyncHandler(meController.menu));
  router.get(
    '/permissions',
    validate({ query: mePermissionsQuerySchema }),
    asyncHandler(meController.permissions),
  );
  router.get('/context', asyncHandler(meController.getContext));
  router.put(
    '/context',
    validate({ body: putContextSchema }),
    asyncHandler(meController.putContext),
  );
  router.get('/locale', asyncHandler(meController.getLocale));
  router.put('/locale', validate({ body: putLocaleSchema }), asyncHandler(meController.putLocale));
  return router;
}
