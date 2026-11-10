// GET /health: public liveness + database check used by the web app's health pill.
// GET /health/live: fast process-only liveness check (no DB/storage I/O).
// GET /health/ready: readiness gate (DB, pg-boss, LISTEN cache bus <= 30s down, storage, latest migration).
// GET /health/whoami: diagnostics endpoint guarded by admin-security view.
import { Router } from 'express';
import {
  authenticate,
  requireMfaSatisfied,
  requirePasswordChanged,
} from '../../core/auth/authenticate';
import { prisma } from '../../core/db/prisma';
import { asyncHandler } from '../../core/http/async-handler';
import { jobsRunning } from '../../core/jobs';
import { logger } from '../../core/logger';
import { requirePageAction } from '../../core/rbac/access';
import { getCacheBusHealth } from '../../core/rbac/cache-bus';
import { defaultStorage } from '../../core/storage';

export type DbPing = () => Promise<void>;

export const defaultDbPing: DbPing = async () => {
  await prisma.$queryRaw`SELECT 1`;
};

async function checkLatestMigration(): Promise<{ ok: boolean; latest: string | null; failedCount: number }> {
  try {
    const [latestRow, failedRow] = await Promise.all([
      prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `,
      prisma.$queryRaw<{ cnt: number }[]>`
        SELECT count(*)::int AS cnt
        FROM "_prisma_migrations"
        WHERE finished_at IS NULL AND rolled_back_at IS NULL
      `,
    ]);
    const failedCount = failedRow[0]?.cnt ?? 0;
    return { ok: failedCount === 0 && Boolean(latestRow[0]?.migration_name), latest: latestRow[0]?.migration_name ?? null, failedCount };
  } catch {
    return { ok: false, latest: null, failedCount: -1 };
  }
}

export function createHealthRouter(dbPing: DbPing = defaultDbPing): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      data: {
        status: 'ok',
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
  });

  router.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      let dbOk = false;
      try {
        await dbPing();
        dbOk = true;
      } catch (err) {
        logger.error({ err }, 'Readiness check: DB unreachable');
      }
      const cacheBus = getCacheBusHealth();
      const storage = defaultStorage.healthCheck
        ? await defaultStorage.healthCheck()
        : { ok: true, driver: defaultStorage.driverName };
      const migrations = dbOk ? await checkLatestMigration() : { ok: false, latest: null, failedCount: -1 };
      const requireJobs = process.env.HEALTH_REQUIRE_JOBS === 'true';
      const pgBossOk = requireJobs ? jobsRunning() : true;

      const ready = dbOk && cacheBus.ok && storage.ok && migrations.ok && pgBossOk;
      res.status(ready ? 200 : 503).json({
        data: {
          status: ready ? 'ready' : 'not_ready',
          pid: process.pid,
          checks: {
            db: { ok: dbOk },
            cacheBus,
            storage,
            pgBoss: { ok: pgBossOk, running: jobsRunning() },
            migrations,
          },
        },
      });
    }),
  );

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
          pid: process.pid,
        },
      });
    }),
  );

  return router;
}
