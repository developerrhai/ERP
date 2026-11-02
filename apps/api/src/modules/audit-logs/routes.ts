// Route table for /audit-logs: ADMIN and above plus `view` on admin-audit, read-only (Phase 2 §2.6).
// /actions is registered before /:id so it is not parsed as an id.
import { Router } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { resolveContext } from '../../core/context/resolve-context';
import { asyncHandler } from '../../core/http/async-handler';
import { validate } from '../../core/http/validate';
import { requirePageAction } from '../../core/rbac/access';
import { requireMinRole } from '../../core/rbac/authorize';
import { auditLogsController } from './controller';
import { auditLogIdParamsSchema, listAuditLogsQuerySchema } from './schemas';

export function createAuditLogsRouter(): Router {
  const router = Router();
  router.use(
    authenticate,
    requirePasswordChanged,
    requireMinRole('ADMIN'),
    requirePageAction('admin-audit', 'view'),
    resolveContext,
  );
  router.get('/actions', asyncHandler(auditLogsController.actions));
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
