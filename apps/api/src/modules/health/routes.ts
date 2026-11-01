// GET /health: a public liveness + database check used by the web app's health pill and by ops.
// The DB ping is injectable so tests can prove the "database down" reply.
import { Router } from 'express';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { logger } from '../../core/logger';

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
  return router;
}
