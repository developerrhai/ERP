// Why: one-shot CLI that runs the idempotent seed (defaults + owner) against whatever DATABASE_URL points at,
// used for the first production setup. Same logic as prisma/seed.ts.
import { PrismaClient } from '@prisma/client';
import { logger } from './core/logger';
import { runSeed } from './core/seed/run-seed';

async function main() {
  const db = new PrismaClient();
  try {
    const report = await runSeed(db, process.env);
    logger.info({ report }, 'Seed completed successfully');
  } catch (err) {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

void main();
