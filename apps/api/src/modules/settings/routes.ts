// Route table for /settings: GET /letterhead for any signed-in user, PUT /letterhead with
// `controls` on admin-settings (Phase 2 §2.6).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { settingsController } from './controller';
import { letterheadSchema } from './schemas';

export function createSettingsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  router.get('/letterhead', asyncHandler(settingsController.getLetterhead));
  router.put(
    '/letterhead',
    requirePageAction('admin-settings', 'controls'),
    validate({ body: letterheadSchema }),
    asyncHandler(settingsController.putLetterhead),
  );
  return router;
}
