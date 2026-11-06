// /notifications and /notification-preferences: every signed-in user sees only their own items
// (another user's id answers 404). test-email is for Administrators (level >= 95).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requireAuth } from '../../core/auth/auth-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { kickEmailSend } from '../../core/jobs';
import { validate, validated } from '../../core/http/validate';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { notificationService } from './service';
import { idParamsSchema, listQuerySchema, preferencesBodySchema } from './schemas';

export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);

  router.get(
    '/',
    validate({ query: listQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', listQuerySchema);
      const result = await notificationService.list(requireAuth(req).userId, {
        page: q.page,
        size: q.size,
        ...(q.unread !== undefined ? { unread: q.unread } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.group ? { group: q.group } : {}),
      });
      res.set('Cache-Control', 'no-store');
      res.json({
        data: result.rows,
        meta: { page: q.page, size: q.size, total: result.total, unread: result.unread },
      });
    }),
  );

  router.get(
    '/unread-count',
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: { count: await notificationService.unreadCount(requireAuth(req).userId) } });
    }),
  );

  router.post(
    '/read-all',
    asyncHandler(async (req: Request, res: Response) => {
      res.json({ data: { updated: await notificationService.readAll(requireAuth(req).userId) } });
    }),
  );

  router.post(
    '/test-email',
    asyncHandler(async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      if (auth.level < ADMIN_LEVEL) throw Errors.forbidden();
      const result = await notificationService.testEmail(auth.userId);
      await kickEmailSend().catch(() => undefined);
      res.json({ data: result });
    }),
  );

  router.post(
    '/:id/read',
    validate({ params: idParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      res.json({ data: await notificationService.markRead(requireAuth(req).userId, id) });
    }),
  );

  return router;
}

export function createNotificationPreferencesRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);
  router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await notificationService.preferences(requireAuth(req).userId) });
    }),
  );
  router.put(
    '/',
    validate({ body: preferencesBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', preferencesBodySchema);
      res.json({
        data: await notificationService.savePreferences(requireAuth(req).userId, body.items),
      });
    }),
  );
  return router;
}
