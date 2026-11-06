// GET /health: public liveness + database check used by the web app's health pill and by ops.
// GET /health/whoami: diagnostics endpoint guarded by admin-security view (Phase 01).
import { Router } from 'express';
import {
  authenticate,
  requireMfaSatisfied,
  requirePasswordChanged,
} from '../../core/auth/authenticate';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { logger } from '../../core/logger';
import { requirePageAction } from '../../core/rbac/access';

export type DbPing = () => Promise<void>;

export const defaultDbPing: DbPing = async () => {
  await prisma.$queryRaw`SELECT 1`;
};

export function createHealthRouter(dbPing: DbPing = defaultDbPing): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        await dbPing();
        res.json({ data: { status: 'ok', db: 'ok' } });
      } catch (err) {
        logger.error({ err }, 'Health check: database unreachable');
        res.status(503).json({ data: { status: 'degraded', db: 'down' } });
      }
    }),
  );

  router.get(
    '/whoami',
    authenticate,
    requirePasswordChanged,
    requireMfaSatisfied,
    requirePageAction('admin-security', 'view'),
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({
        data: {
          ip: req.ip,
          forwardedFor: req.headers['x-forwarded-for'] ?? null,
          trustProxy: req.app.get('trust proxy'),
          protocol: req.protocol,
        },
      });
    }),
  );

  return router;
}
