// Security Policy service: reads the 'security_policy' row in settings with a 30s cache.
// Clamped to environment limits.
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { z } from 'zod';

export interface SecurityPolicy {
  passwordMinLength: number;
  maxFailedLogins: number;
  lockoutMinutes: number;
  idleMinutes: number;
  absoluteHours: number;
  maxSessionsPerUser: number;
  mfaRequiredForAdmins: boolean;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  passwordMinLength: 12,
  maxFailedLogins: 10,
  lockoutMinutes: 15,
  idleMinutes: 30,
  absoluteHours: 12,
  maxSessionsPerUser: 10,
  mfaRequiredForAdmins: false,
};

export const securityPolicySchema = z.object({
  passwordMinLength: z
    .number({ invalid_type_error: 'Password minimum length must be a number.' })
    .int('Password minimum length must be an integer.')
    .min(12, 'Password minimum length must be between 12 and 128 characters.')
    .max(128, 'Password minimum length must be between 12 and 128 characters.'),
  maxFailedLogins: z
    .number({ invalid_type_error: 'Failed logins threshold must be a number.' })
    .int('Failed logins threshold must be an integer.')
    .min(3, 'Maximum failed logins must be between 3 and 20.')
    .max(20, 'Maximum failed logins must be between 3 and 20.'),
  lockoutMinutes: z
    .number({ invalid_type_error: 'Lockout duration must be a number.' })
    .int('Lockout duration must be an integer.')
    .min(5, 'Lockout duration must be between 5 and 1440 minutes.')
    .max(1440, 'Lockout duration must be between 5 and 1440 minutes.'),
  idleMinutes: z
    .number({ invalid_type_error: 'Idle timeout must be a number.' })
    .int('Idle timeout must be an integer.')
    .min(5, 'Idle timeout must be between 5 and 240 minutes.')
    .max(240, 'Idle timeout must be between 5 and 240 minutes.'),
  absoluteHours: z
    .number({ invalid_type_error: 'Absolute session lifetime must be a number.' })
    .int('Absolute session lifetime must be an integer.')
    .min(1, 'Absolute session limit must be between 1 and 72 hours.')
    .max(72, 'Absolute session limit must be between 1 and 72 hours.'),
  maxSessionsPerUser: z
    .number({ invalid_type_error: 'Max sessions per user must be a number.' })
    .int('Max sessions per user must be an integer.')
    .min(1, 'Maximum sessions per user must be between 1 and 50.')
    .max(50, 'Maximum sessions per user must be between 1 and 50.'),
  mfaRequiredForAdmins: z.boolean({
    invalid_type_error: 'Two-step verification requirement must be true or false.',
  }),
});

export type SecurityPolicyInput = z.infer<typeof securityPolicySchema>;

export interface SecurityPolicyRecord {
  policy: SecurityPolicy;
  version: number;
  updatedAt: Date;
}

let cachedPolicyRecord: SecurityPolicyRecord | null = null;
let cacheExpiry = 0;

export function invalidateSecurityPolicyCache(): void {
  cachedPolicyRecord = null;
  cacheExpiry = 0;
}

export const clearPolicyCache = invalidateSecurityPolicyCache;

export async function getSecurityPolicyRecord(db: Db = prisma): Promise<SecurityPolicyRecord> {
  const now = Date.now();
  if (cachedPolicyRecord && cacheExpiry > now) {
    return cachedPolicyRecord;
  }

  const row = await db.setting.findUnique({
    where: { key: 'security_policy' },
  });

  if (!row) {
    const record: SecurityPolicyRecord = {
      policy: { ...DEFAULT_SECURITY_POLICY },
      version: 1,
      updatedAt: new Date(),
    };
    cachedPolicyRecord = record;
    cacheExpiry = now + 30_000;
    return record;
  }

  const parsed = securityPolicySchema.safeParse(row.value);
  const policy: SecurityPolicy = parsed.success
    ? parsed.data
    : { ...DEFAULT_SECURITY_POLICY, ...(row.value as Record<string, unknown>) };

  const record: SecurityPolicyRecord = {
    policy,
    version: row.version,
    updatedAt: row.updatedAt,
  };

  cachedPolicyRecord = record;
  cacheExpiry = now + 30_000;
  return record;
}

export async function getSecurityPolicy(db: Db = prisma): Promise<SecurityPolicy> {
  const record = await getSecurityPolicyRecord(db);
  return record.policy;
}
