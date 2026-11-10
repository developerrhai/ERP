// /notifications and /notification-preferences: every signed-in user sees only their own items
// (another user's id answers 404). Supports both Phase 5 page mode and Phase 21 cursor/category mode.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePasswordChanged } from '../../core/auth/authenticate';
import { requireAuth } from '../../core/auth/auth-context';
import { asyncHandler } from '../../core/http/async-handler';
import { Errors } from '../../core/http/errors';
import { validate, validated } from '../../core/http/validate';
import { kickEmailSend } from '../../core/jobs';
import { ADMIN_LEVEL } from '../../core/rbac/role-rules';
import { notificationService } from './service';
import { idParamsSchema, listQuerySchema, preferencesBodySchema } from './schemas';

const readBatchSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    all: z.boolean().optional(),
  })
  .strict();

const seenBodySchema = z
  .object({
    upToSeq: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(authenticate, requirePasswordChanged);

  router.get(
    '/',
    validate({ query: listQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validated(res, 'query', listQuerySchema);
      res.set('Cache-Control', 'no-store');
      // Use cursor mode when cursor, category, or limit query params are provided
      if (q.cursor !== undefined || q.category !== undefined || q.limit !== undefined) {
        const result = await notificationService.listCursor(requireAuth(req).userId, {
          ...(q.unread !== undefined ? { unread: q.unread } : {}),
          ...(q.category ? { category: q.category } : {}),
          ...(q.type ? { type: q.type } : {}),
          ...(q.cursor ? { cursor: q.cursor } : {}),
          ...(q.limit ? { limit: q.limit } : {}),
          ...(q.includeArchived ? { includeArchived: q.includeArchived } : {}),
        });
        res.json({
          data: result.rows,
          meta: { nextCursor: result.nextCursor, unread: result.unread },
        });
        return;
      }

      const result = await notificationService.list(requireAuth(req).userId, {
        page: q.page,
        size: q.size,
        ...(q.unread !== undefined ? { unread: q.unread } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.group ? { group: q.group } : {}),
      });
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
    '/read',
    validate({ body: readBatchSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', readBatchSchema);
      const userId = requireAuth(req).userId;
      if (body.all) {
        res.json({ data: { updated: await notificationService.readAll(userId) } });
        return;
      }
      const ids = body.ids ?? [];
      let updated = 0;
      for (const id of ids) {
        try {
          await notificationService.markRead(userId, id);
          updated += 1;
        } catch {
          // Ignore unknown ids in batch
        }
      }
      res.json({ data: { updated } });
    }),
  );

  router.post(
    '/seen',
    validate({ body: seenBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validated(res, 'body', seenBodySchema);
      res.json({
        data: { updated: await notificationService.markSeen(requireAuth(req).userId, body.upToSeq) },
      });
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

  router.post(
    '/:id/archive',
    validate({ params: idParamsSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = validated(res, 'params', idParamsSchema);
      await notificationService.archiveNotification(requireAuth(req).userId, id);
      res.json({ data: { ok: true } });
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
