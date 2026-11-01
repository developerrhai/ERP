// Route table for /auth. /me, /change-password and /logout stay reachable while the password must
// be changed; /logout-all is not (CONTRACT §6). Cookie endpoints also need X-Requested-With.
import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  authenticate,
  requirePasswordChanged,
  requireRequestedWith,
} from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { authController } from './controller';
import { changePasswordSchema, loginSchema } from './schemas';

export function createAuthRouter(deps: {
  loginIpLimiter: RequestHandler;
  loginLimiter: RequestHandler;
  changePasswordLimiter: RequestHandler;
}): Router {
  const router = Router();
  router.post(
    '/login',
    deps.loginIpLimiter,
    deps.loginLimiter,
    validate({ body: loginSchema }),
    asyncHandler(authController.login),
  );
  router.post('/refresh', requireRequestedWith, asyncHandler(authController.refresh));
  router.post('/logout', requireRequestedWith, asyncHandler(authController.logout));
  router.post(
    '/logout-all',
    authenticate,
    requirePasswordChanged,
    asyncHandler(authController.logoutAll),
  );
  router.get('/me', authenticate, asyncHandler(authController.me));
  router.post(
    '/change-password',
    authenticate,
    deps.changePasswordLimiter,
    validate({ body: changePasswordSchema }),
    asyncHandler(authController.changePassword),
  );
  return router;
}
