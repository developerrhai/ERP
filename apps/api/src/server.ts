// Process entry point: tops up missing Phase 2/3 defaults (insert-if-missing only, so a migrated DB is
// never left with empty module controls/permissions or without a company / FY), starts the HTTP server on PORT, and shuts down
// cleanly (close server, disconnect Prisma) on SIGINT/SIGTERM.
import { createApp } from './app';
import { env } from './config/env';
import { warmUpDummyHash } from './core/auth/password';
import { prisma } from './core/db/prisma';
import { logger } from './core/logger';
import { seedPhase2Defaults } from './core/seed/defaults';
import { seedPhase3Defaults } from './core/seed/phase3-defaults';
import { seedPhase5Defaults } from './core/seed/phase5-defaults';

void warmUpDummyHash();

async function ensureDefaults(): Promise<void> {
  try {
    const inserted = await seedPhase2Defaults(prisma);
    const phase3 = await seedPhase3Defaults(prisma);
    const phase5 = await seedPhase5Defaults(prisma);
    logger.info(
      { inserted, phase3, phase5 },
      'Boot: Phase 2/3 defaults checked (missing rows inserted only)',
    );
  } catch (err) {
    // Fail closed: access.ts treats a page without a module control as disabled. Keep serving
    // (health will show the DB state) rather than crash-looping.
    logger.error({ err }, 'Boot: could not apply Phase 2/3 defaults');
  }
}

let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;

void ensureDefaults().then(() => {
  server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'RHAI ERP API listening');
  });
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  const finish = () => {
    prisma
      .$disconnect()
      .catch((err: unknown) => logger.error({ err }, 'Prisma disconnect failed'))
      .finally(() => process.exit(0));
  };
  if (server) server.close(finish);
  else finish();
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
