// Route table for /auth (Phase 01): login, MFA challenge/verify, sessions, password reset,
// password policy, me, change-password, refresh, logout.
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
import {
  changePasswordSchema,
  familyIdParamSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaRecoveryCodesSchema,
  mfaSetupSchema,
  mfaVerifySchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from './schemas';

export interface AuthRouterDeps {
  loginIpLimiter: RequestHandler;
  loginLimiter: RequestHandler;
  changePasswordLimiter: RequestHandler;
  mfaVerifyLimiter: RequestHandler;
  passwordResetRequestIpLimiter: RequestHandler;
  passwordResetRequestEmailLimiter: RequestHandler;
  passwordResetConfirmLimiter: RequestHandler;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  // Public authentication & password reset endpoints
  router.post(
    '/login',
    deps.loginIpLimiter,
    deps.loginLimiter,
    validate({ body: loginSchema }),
    asyncHandler(authController.login),
  );

  router.post(
    '/mfa/verify',
    deps.mfaVerifyLimiter,
    validate({ body: mfaVerifySchema }),
    asyncHandler(authController.verifyMfa),
  );

  router.get('/password-policy', asyncHandler(authController.getPasswordPolicy));

  router.post(
    '/password-reset/request',
    deps.passwordResetRequestIpLimiter,
    deps.passwordResetRequestEmailLimiter,
    validate({ body: passwordResetRequestSchema }),
    asyncHandler(authController.requestPasswordReset),
  );

  router.post(
    '/password-reset/confirm',
    deps.passwordResetConfirmLimiter,
    validate({ body: passwordResetConfirmSchema }),
    asyncHandler(authController.confirmPasswordReset),
  );

  // Cookie-authenticated session refresh and logout
  router.post('/refresh', requireRequestedWith, asyncHandler(authController.refresh));
  router.post('/logout', requireRequestedWith, asyncHandler(authController.logout));

  // Authenticated user endpoints
  router.get('/me', authenticate, asyncHandler(authController.me));

  router.post(
    '/change-password',
    authenticate,
    deps.changePasswordLimiter,
    validate({ body: changePasswordSchema }),
    asyncHandler(authController.changePassword),
  );

  router.post(
    '/logout-all',
    authenticate,
    requirePasswordChanged,
    asyncHandler(authController.logoutAll),
  );

  // My Sessions
  router.get('/sessions', authenticate, asyncHandler(authController.listSessions));
  router.delete(
    '/sessions/:familyId',
    authenticate,
    validate({ params: familyIdParamSchema }),
    asyncHandler(authController.revokeSession),
  );
  router.post(
    '/sessions/revoke-others',
    authenticate,
    asyncHandler(authController.revokeOtherSessions),
  );

  // Two-Step Verification (MFA)
  router.get('/mfa', authenticate, asyncHandler(authController.getMfaStatus));
  router.post(
    '/mfa/setup',
    authenticate,
    validate({ body: mfaSetupSchema }),
    asyncHandler(authController.setupMfa),
  );
  router.post(
    '/mfa/enable',
    authenticate,
    validate({ body: mfaEnableSchema }),
    asyncHandler(authController.enableMfa),
  );
  router.post(
    '/mfa/disable',
    authenticate,
    validate({ body: mfaDisableSchema }),
    asyncHandler(authController.disableMfa),
  );
  router.post(
    '/mfa/recovery-codes',
    authenticate,
    validate({ body: mfaRecoveryCodesSchema }),
    asyncHandler(authController.regenerateRecoveryCodes),
  );

  return router;
}
