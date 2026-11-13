// Route table for /me: GET /me/menu, GET /me/permissions?pageId= and GET/PUT /me/context. Any
// signed-in user whose password change is not pending (Phase 1 gate). /me does not mount
// resolveContext: these routes are how the web recovers from a stale X-Unit-Id / X-FY-Id.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { requireMinRole } from '../../core/rbac/authorize';
import { USER_ADMIN_MIN_ROLE } from '../../core/rbac/role-rules';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { meController } from './controller';
import {
  homePrefsSchema,
  mePermissionsQuerySchema,
  putContextSchema,
  putLocaleSchema,
  putPlantsSchema,
  roleLandingSchema,
  searchQuerySchema,
} from './schemas';

/** PUT /admin/role-landing: the landing page of a role (Home / My Dashboard / a chosen page). */
export function createRoleLandingRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole(USER_ADMIN_MIN_ROLE));
  router.put('/', validate({ body: roleLandingSchema }), asyncHandler(meController.setRoleLanding));
  return router;
}

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
  // Phase 23: plants, the Menu page, search, Home, favourites and recent pages
  router.get('/plants', asyncHandler(meController.getPlants));
  router.put('/plants', validate({ body: putPlantsSchema }), asyncHandler(meController.putPlants));
  router.get('/menu-v2', asyncHandler(meController.menuV2));
  router.get('/search', validate({ query: searchQuerySchema }), asyncHandler(meController.search));
  // Home needs the chosen plants for the movement counts, so it (only) resolves the context
  router.get('/home', resolveContext, asyncHandler(meController.home));
  router.put('/home-prefs', validate({ body: homePrefsSchema }), asyncHandler(meController.putHomePrefs));
  router.post('/favourites/:pageId', asyncHandler(meController.addFavourite));
  router.delete('/favourites/:pageId', asyncHandler(meController.removeFavourite));
  router.post('/recent/:pageId', asyncHandler(meController.touchRecent));
  router.get('/locale', asyncHandler(meController.getLocale));
  router.put('/locale', validate({ body: putLocaleSchema }), asyncHandler(meController.putLocale));
  return router;
}
