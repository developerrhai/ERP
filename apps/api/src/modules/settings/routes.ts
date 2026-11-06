// Route table for /settings (Phase 01):
// GET /letterhead for any signed-in user, PUT /letterhead with `controls` on admin-settings.
// GET/PUT /security with view/edit on admin-security.
import { Router } from 'express';
import {
  authenticate,
  requireMfaSatisfied,
  requirePasswordChanged,
} from '../../core/auth/authenticate';
import { securityPolicySchema } from '../../core/auth/security-policy';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { settingsController } from './controller';
import { letterheadSchema } from './schemas';

export function createSettingsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMfaSatisfied, resolveContext);

  router.get('/letterhead', asyncHandler(settingsController.getLetterhead));
  router.put(
    '/letterhead',
    requirePageAction('admin-settings', 'controls'),
    validate({ body: letterheadSchema }),
    asyncHandler(settingsController.putLetterhead),
  );
  router.patch(
    '/letterhead',
    requirePageAction('admin-settings', 'controls'),
    validate({ body: letterheadSchema.partial() }),
    asyncHandler(settingsController.patchLetterhead),
  );
  router.post(
    '/letterhead/test-pdf',
    requirePageAction('admin-settings', 'view'),
    asyncHandler(settingsController.testPdf),
  );

  router.get(
    '/security',
    requirePageAction('admin-security', 'view'),
    asyncHandler(settingsController.getSecurityPolicy),
  );
  router.put(
    '/security',
    requirePageAction('admin-security', 'edit'),
    validate({ body: securityPolicySchema }),
    asyncHandler(settingsController.putSecurityPolicy),
  );

  return router;
}
