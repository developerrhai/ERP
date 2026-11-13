// Process entry point: Sentry init (no PII), advisory-locked boot defaults top-up,
// LISTEN/NOTIFY cache bus, pg-boss background workers, HTTP server, and graceful shutdown.
import { createApp } from './app';
import { env } from './config/env';
import { warmUpDummyHash } from './core/auth/password';
import { prisma } from './core/db/prisma';
import { startJobs, stopJobs } from './core/jobs';
import { logger } from './core/logger';
import { initSentry } from './core/observability/sentry';
import { startCacheBus, stopCacheBus } from './core/rbac/cache-bus';
import { withBootAdvisoryLock } from './core/seed/advisory-lock';
import { seedApprovalDefaults } from './core/seed/approval-defaults';
import { seedPhase2Defaults } from './core/seed/defaults';
import { seedPhase3Defaults } from './core/seed/phase3-defaults';
import { seedPhase5Defaults } from './core/seed/phase5-defaults';
import { syncRegistrySnapshot } from './modules/page-health/registry-v2';
import { registerApprovalJobHandlers } from './modules/approvals/register-jobs';
import { registerDataJobHandlers } from './modules/data-jobs/worker';
import { registerPhase20JobHandlers } from './modules/hardening/register-jobs';
import { startRealtimeBus, stopRealtimeBus } from './modules/notifications/realtime';
import { registerPhase21JobHandlers } from './modules/notifications/register-jobs';
import { registerDashboardJobHandlers } from './modules/dashboards/register-jobs';

initSentry();
void warmUpDummyHash();

async function ensureDefaults(): Promise<void> {
  try {
    await withBootAdvisoryLock(env.DATABASE_URL, async () => {
      const inserted = await seedPhase2Defaults(prisma);
      const phase3 = await seedPhase3Defaults(prisma);
      const phase5 = await seedPhase5Defaults(prisma);
      await seedApprovalDefaults(prisma);
      const registryVersion = await syncRegistrySnapshot();
      logger.info(
        { inserted, phase3, phase5, registryVersion },
        'Boot: Phase 2/3 defaults checked under advisory lock (missing rows inserted only)',
      );
    });
  } catch (err) {
    // Fail closed: access.ts treats a page without a module control as disabled. Keep serving
    // (health will show the DB state) rather than crash-looping.
    logger.error({ err }, 'Boot: could not apply Phase 2/3 defaults');
  }
}

let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;

async function startBackgroundJobs(): Promise<void> {
  // Jobs are best-effort at boot: if the queue cannot start, the API still serves and /health/ready reports it.
  try {
    registerDataJobHandlers();
    registerApprovalJobHandlers();
    registerPhase20JobHandlers();
    registerPhase21JobHandlers();
    registerDashboardJobHandlers();
    await startJobs();
  } catch (err) {
    logger.error({ err }, 'Boot: background jobs could not start');
  }
}

void ensureDefaults()
  .then(() => Promise.all([startCacheBus(env.DATABASE_URL), startRealtimeBus(env.DATABASE_URL)]))
  .then(() => {
    void startBackgroundJobs();
    server = createApp().listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV, pid: process.pid }, 'RHAI ERP API listening');
    });
  });

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  const finish = () => {
    Promise.allSettled([stopJobs(), stopCacheBus(), stopRealtimeBus()])
      .then(() => prisma.$disconnect())
      .catch((err: unknown) => logger.error({ err }, 'Prisma disconnect failed'))
      .finally(() => process.exit(0));
  };
  if (server) server.close(finish);
  else finish();
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
