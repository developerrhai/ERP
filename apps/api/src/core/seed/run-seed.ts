// The full seed as a function (used by prisma/seed.ts and tests). Phase 2 and Phase 3 defaults always
// run first and need no env at all; SUPERADMIN_* variables are required only when no Super Admin exists yet,
// so a DB is never left without permissions/module controls just because those vars are missing.
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { checkPasswordPolicy, hashPassword } from '../auth/password';
import { emailSchema, loginIdSchema, nameSchema } from '../../modules/users/schemas';
import { seedPhase2Defaults } from './defaults';
import type { SeedReport } from './defaults';
import { seedPhase3Defaults } from './phase3-defaults';
import { seedPhase5Defaults } from './phase5-defaults';
import type { Phase5SeedReport } from './phase5-defaults';
import type { Phase3SeedReport } from './phase3-defaults';

const superAdminEnvSchema = z.object({
  SUPERADMIN_LOGIN_ID: loginIdSchema,
  SUPERADMIN_EMAIL: emailSchema,
  SUPERADMIN_NAME: nameSchema,
  SUPERADMIN_PASSWORD: z.string().min(1),
});
export type SuperAdminConfig = z.output<typeof superAdminEnvSchema>;

/** Throws a readable error (never echoing values) when the SUPERADMIN_* variables are unusable. */
export function superAdminConfigFromEnv(source: NodeJS.ProcessEnv): SuperAdminConfig {
  const parsed = superAdminEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `No Super Admin exists and the SUPERADMIN_* variables are missing or invalid: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  const cfg = parsed.data;
  const problem = checkPasswordPolicy(cfg.SUPERADMIN_PASSWORD, {
    loginId: cfg.SUPERADMIN_LOGIN_ID,
    email: cfg.SUPERADMIN_EMAIL ?? null,
  });
  if (problem) throw new Error(`SUPERADMIN_PASSWORD rejected: ${problem}`);
  return cfg;
}

export interface SeedResult {
  phase2: SeedReport;
  phase3: Phase3SeedReport;
  phase5: Phase5SeedReport;
  superAdmin: { status: 'existing' | 'created'; loginId: string };
}

export async function runSeed(db: PrismaClient, source: NodeJS.ProcessEnv): Promise<SeedResult> {
  const phase2 = await seedPhase2Defaults(db);
  const phase3 = await seedPhase3Defaults(db);

  const existing = await db.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (existing) {
    const phase5 = await seedPhase5Defaults(db);
    return {
      phase2,
      phase3,
      phase5,
      superAdmin: { status: 'existing', loginId: existing.loginId },
    };
  }

  const cfg = superAdminConfigFromEnv(source);
  const email = cfg.SUPERADMIN_EMAIL ?? null;
  const clash = await db.user.findFirst({
    where: {
      OR: [
        { loginId: cfg.SUPERADMIN_LOGIN_ID },
        { email: cfg.SUPERADMIN_LOGIN_ID },
        ...(email ? [{ email }, { loginId: email }] : []),
      ],
    },
  });
  if (clash) {
    throw new Error('SUPERADMIN_LOGIN_ID or SUPERADMIN_EMAIL is already used by another user');
  }
  const user = await db.user.create({
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
  const phase5 = await seedPhase5Defaults(db);
  return { phase2, phase3, phase5, superAdmin: { status: 'created', loginId: user.loginId } };
}
