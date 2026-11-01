// Runs once before the suite: resets rhai_erp_test via `prisma migrate reset --force --skip-seed`
// and applies the Phase 2 seed defaults, then creates the one SUPER_ADMIN the tests sign in as.
import { PrismaClient } from '@prisma/client';
import { resetTestDatabase } from '../scripts/reset-test-db';
import { hashPassword } from '../src/core/auth/password';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { TEST_ENV, TEST_OWNER } from './test-env';

export default async function setup(): Promise<void> {
  Object.assign(process.env, TEST_ENV);
  resetTestDatabase(TEST_ENV.DATABASE_URL);
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_ENV.DATABASE_URL } } });
  try {
    await seedPhase2Defaults(prisma);
    await prisma.user.create({
      data: {
        loginId: TEST_OWNER.loginId,
        email: TEST_OWNER.email,
        name: TEST_OWNER.name,
        role: 'SUPER_ADMIN',
        department: 'Administration',
        passwordHash: await hashPassword(TEST_OWNER.password),
        mustChangePassword: false,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
