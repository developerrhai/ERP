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

const DEFAULT_WEB_ORIGIN = 'http://localhost:5173';

/**
 * Splits a comma-separated origin list. An origin is accepted only in canonical form: http(s),
 * host, optional port; no path, query, trailing slash or wildcard (it must equal `new URL(o).origin`).
 */
export function parseOrigins(raw: string | undefined): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const item of (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    let ok = false;
    try {
      const url = new URL(item);
      ok = (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === item;
    } catch {
      ok = false;
    }
    if (ok && !item.includes('*')) {
      if (!origins.includes(item)) origins.push(item);
    } else {
      invalid.push(item);
    }
  }
  return { origins, invalid };
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
    /** Exact CORS allow-list (comma-separated origins). CORS_ORIGINS and WEB_ORIGIN are aliases. */
    WEB_ORIGINS: z.string().optional(),
    CORS_ORIGINS: z.string().optional(),
    WEB_ORIGIN: z.string().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RATE_LIMIT_DISABLED: booleanString,
    /** Express `trust proxy` value. `loopback` trusts only a proxy on this machine (the Vite dev proxy). */
    TRUST_PROXY: z.string().trim().min(1).default('loopback'),
    /** Max Argon2 hash/verify operations in flight; beyond that requests get 503 SERVER_BUSY. */
    ARGON2_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(4),
    /** Pool caps across multi-process workers (Phase 20 §4.4: 2 processes × (10+5) ≈ 30 DB conns). */
    PRISMA_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
    PGBOSS_MAX_POOL: z.coerce.number().int().min(1).max(20).default(5),
    PGBOSS_TEAM_SIZE: z.coerce.number().int().min(1).max(10).default(2),
    /** Phase 20-C Storage driver ('local' in dev/test; 's3' in staging/prod with IAM instance role). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: z.string().optional(),
    AWS_REGION: z.string().default('ap-south-1'),
    S3_PREFIX: z.string().default('docs/'),
    S3_ENDPOINT: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString,
    S3_SSE_KMS_KEY_ID: z.string().optional(),
    S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    /** Phase 20-B Observability (Sentry without PII). */
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
    RELEASE_SHA: z.string().default('dev'),
    /** N+1 guard threshold (Phase 20 §5(a): alert/fail above 25 SQL queries per request). */
    N_PLUS_ONE_THRESHOLD: z.coerce.number().int().min(5).max(500).default(25),
    /** Phase 21 Web Push VAPID keys (stored in env only, never in DB) & Amazon SES settings. */
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().default('mailto:it@sawantgroup.example'),
    SES_REGION: z.string().default('ap-south-1'),
    SES_CONFIG_SET_TXN: z.string().optional(),
    SES_CONFIG_SET_MKT: z.string().optional(),
    SES_SNS_TOPIC_ARN: z.string().optional(),
    MAIL_FROM_DOMAIN: z.string().default('sawantgroup.example'),
    /** Optional previous JWT secret for verification during key rotation. */
    JWT_ACCESS_SECRET_PREVIOUS: z.string().min(32).optional(),
    /** AES-256-GCM encryption key for MFA secrets (32 bytes base64 or 64 hex chars). */
    MFA_ENCRYPTION_KEY: z.string().optional(),
    /** SMTP configuration for email password reset. */
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    /** Base URL of the web client for email links. */
    APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  })
  .superRefine((value, ctx) => {
    for (const key of ['WEB_ORIGINS', 'CORS_ORIGINS', 'WEB_ORIGIN'] as const) {
      const { invalid } = parseOrigins(value[key]);
      if (invalid.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `must be exact origins like https://app.example.com (no path or wildcard); invalid: ${invalid.join(', ')}`,
        });
      }
    }
    if (value.NODE_ENV === 'production') {
      if (value.JWT_ACCESS_SECRET.length < 48) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must be at least 48 characters in production',
        });
      }
      if (new Set(value.JWT_ACCESS_SECRET).size < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'JWT_ACCESS_SECRET must have at least 16 distinct characters in production',
        });
      }
      if (!value.MFA_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MFA_ENCRYPTION_KEY'],
          message: 'MFA_ENCRYPTION_KEY is required in production',
        });
      }
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
    corsOrigins: resolveCorsOrigins(value),
  }));

export type Env = z.infer<typeof envSchema>;

/** Union of WEB_ORIGINS, CORS_ORIGINS and WEB_ORIGIN; the dev default only when none is set. */
function resolveCorsOrigins(value: {
  WEB_ORIGINS?: string;
  CORS_ORIGINS?: string;
  WEB_ORIGIN?: string;
}): string[] {
  const all = [value.WEB_ORIGINS, value.CORS_ORIGINS, value.WEB_ORIGIN].flatMap(
    (raw) => parseOrigins(raw).origins,
  );
  const unique = [...new Set(all)];
  return unique.length > 0 ? unique : [DEFAULT_WEB_ORIGIN];
}

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
