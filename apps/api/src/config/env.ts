// Reads and validates every environment variable once, so a misconfigured server fails fast at boot
// instead of misbehaving later. Everything else imports the typed `env` object from here.
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DURATION = /^(\d+)(s|m|h)$/;
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600 };

/** Parses "15m" / "900s" / "1h" into seconds. */
export function parseDurationSeconds(value: string): number {
  const match = DURATION.exec(value);
  if (!match?.[1] || !match[2]) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * (UNIT_SECONDS[match[2]] ?? 1);
}

/** Maps the TRUST_PROXY string to what Express accepts: boolean, hop count, or address list. */
export function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.string().url(),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
      .refine(
        (v) => !/change-me/i.test(v),
        'JWT_ACCESS_SECRET still contains the placeholder "change-me"',
      ),
    ACCESS_TOKEN_TTL: z
      .string()
      .regex(DURATION, 'ACCESS_TOKEN_TTL must look like 15m, 900s or 1h')
      .default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RATE_LIMIT_DISABLED: booleanString,
    /** Express `trust proxy` value. `loopback` trusts only a proxy on this machine (the Vite dev proxy). */
    TRUST_PROXY: z.string().trim().min(1).default('loopback'),
    /** Max Argon2 hash/verify operations in flight; beyond that requests get 503 SERVER_BUSY. */
    ARGON2_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(8),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.JWT_ACCESS_SECRET.length < 48) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET must be at least 48 characters in production',
      });
    }
    if (value.RATE_LIMIT_DISABLED && value.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RATE_LIMIT_DISABLED'],
        message: 'RATE_LIMIT_DISABLED=true is only allowed when NODE_ENV=test',
      });
    }
  })
  .transform((value) => ({
    ...value,
    accessTokenTtlSeconds: parseDurationSeconds(value.ACCESS_TOKEN_TTL),
    isProduction: value.NODE_ENV === 'production',
    trustProxy: parseTrustProxy(value.TRUST_PROXY),
  }));

export type Env = z.infer<typeof envSchema>;

/** Validates a raw environment; throws one readable error listing every problem. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export const env: Env = loadEnv(process.env);
