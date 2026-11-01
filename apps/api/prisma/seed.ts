// Idempotent seed: Phase 2 defaults (departments, families, permissions, module controls, letterhead;
// never overwriting admin edits), then the single SUPER_ADMIN from SUPERADMIN_* env vars if none exists
// (mustChangePassword=true). It never overwrites an existing user or password.
import { z } from 'zod';
import { checkPasswordPolicy, hashPassword } from '../src/core/auth/password';
import { prisma } from '../src/core/db/prisma';
import { logger } from '../src/core/logger';
import { seedPhase2Defaults } from '../src/core/seed/defaults';
import { emailSchema, loginIdSchema, nameSchema } from '../src/modules/users/schemas';

const seedEnvSchema = z.object({
  SUPERADMIN_LOGIN_ID: loginIdSchema,
  SUPERADMIN_EMAIL: emailSchema,
  SUPERADMIN_NAME: nameSchema,
  SUPERADMIN_PASSWORD: z.string().min(1),
});

async function main(): Promise<void> {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Seed needs valid SUPERADMIN_* variables: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const cfg = parsed.data;

  const report = await seedPhase2Defaults(prisma);
  logger.info({ inserted: report }, 'Seed: Phase 2 defaults applied (missing rows only)');

  const existing = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (existing) {
    logger.info({ loginId: existing.loginId }, 'Seed: a Super Admin already exists; nothing to do');
    return;
  }
  const email = cfg.SUPERADMIN_EMAIL ?? null;
  const policyProblem = checkPasswordPolicy(cfg.SUPERADMIN_PASSWORD, {
    loginId: cfg.SUPERADMIN_LOGIN_ID,
    email,
  });
  if (policyProblem) throw new Error(`SUPERADMIN_PASSWORD rejected: ${policyProblem}`);

  const clash = await prisma.user.findFirst({
    where: {
      OR: [
        { loginId: cfg.SUPERADMIN_LOGIN_ID },
        ...(email ? [{ email }, { loginId: email }] : []),
        { email: cfg.SUPERADMIN_LOGIN_ID },
      ],
    },
  });
  if (clash) {
    throw new Error(
      'Seed: SUPERADMIN_LOGIN_ID or SUPERADMIN_EMAIL is already used by another user',
    );
  }

  const user = await prisma.user.create({
    data: {
      loginId: cfg.SUPERADMIN_LOGIN_ID,
      email,
      name: cfg.SUPERADMIN_NAME,
      role: 'SUPER_ADMIN',
      department: 'Administration',
      passwordHash: await hashPassword(cfg.SUPERADMIN_PASSWORD),
      mustChangePassword: true,
    },
  });
  logger.info({ loginId: user.loginId, id: user.id }, 'Seed: Super Admin created');
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
