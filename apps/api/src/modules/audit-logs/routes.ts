// Route table for /audit-logs: ADMIN and above, read-only (Phase 2 §2.6).
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requireMinRole } from '../../core/rbac/authorize';
import { auditLogsController } from './controller';
import { auditLogIdParamsSchema, listAuditLogsQuerySchema } from './schemas';

export function createAuditLogsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged, requireMinRole('ADMIN'));
  router.get(
    '/',
    validate({ query: listAuditLogsQuerySchema }),
    asyncHandler(auditLogsController.list),
  );
  router.get(
    '/:id',
    validate({ params: auditLogIdParamsSchema }),
    asyncHandler(auditLogsController.get),
  );
  return router;
}
