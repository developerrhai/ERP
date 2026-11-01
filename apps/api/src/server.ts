// Process entry point: starts the HTTP server on PORT and shuts down cleanly (close server, disconnect
// Prisma) on SIGINT/SIGTERM.
import { createApp } from './app';
import { env } from './config/env';
import { warmUpDummyHash } from './core/auth/password';
import { prisma } from './core/db/prisma';
import { logger } from './core/logger';

void warmUpDummyHash();

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'RHAI ERP API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err: unknown) => logger.error({ err }, 'Prisma disconnect failed'))
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
