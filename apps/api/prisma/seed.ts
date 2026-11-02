// `npm run db:seed`: idempotent. Phase 2 and Phase 3 defaults first (no env needed; never overwrites
// admin edits), then the single SUPER_ADMIN from SUPERADMIN_* only if none exists (mustChangePassword=true).
import { prisma } from '../src/core/db/prisma';
import { logger } from '../src/core/logger';
import { runSeed } from '../src/core/seed/run-seed';

runSeed(prisma, process.env)
  .then((result) => {
    logger.info({ inserted: result.phase2 }, 'Seed: Phase 2 defaults applied (missing rows only)');
    logger.info({ inserted: result.phase3 }, 'Seed: Phase 3 defaults applied (missing rows only)');
    logger.info(
      { inserted: result.phase5 },
      'Seed: Inventory defaults applied (missing rows only)',
    );
    logger.info(
      { loginId: result.superAdmin.loginId },
      result.superAdmin.status === 'created'
        ? 'Seed: Super Admin created'
        : 'Seed: a Super Admin already exists; nothing to do',
    );
  })
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
