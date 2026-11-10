// Rate limits backed by PostgreSQL UNLOGGED table `rate_limit_hits` (Phase 20 §4.1):
// safe across multiple API processes behind Nginx/proxy.
// Failure policy (§4.1): DB down -> fail OPEN for global limiter, fail CLOSED (503) for auth/login.
import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { IncrementResponse, Options, RateLimitInfo, Store } from 'express-rate-limit';
import { env } from '../config/env';
import { prisma } from './db/prisma';
import { Errors } from './http/errors';
import { logger } from './logger';

const passThrough: RequestHandler = (_req, _res, next) => next();

export type RateLimitFailMode = 'open' | 'closed';

export interface PgRateLimitStoreOptions {
  prefix: string;
  failMode: RateLimitFailMode;
  /** Allows injecting a custom DB runner (used in unit tests to simulate DB downtime). */
  queryHits?: (key: string, windowMs: number) => Promise<{ hits: number; resetAt: Date }>;
}

async function defaultQueryHits(key: string, windowMs: number): Promise<{ hits: number; resetAt: Date }> {
  const rows = await prisma.$queryRaw<{ hits: number; reset_at: Date }[]>`
    INSERT INTO "rate_limit_hits" ("key", "window_start", "hits")
    VALUES (
      ${key},
      date_bin((${windowMs}::bigint * interval '1 millisecond'), now(), timestamptz 'epoch'),
      1
    )
    ON CONFLICT ("key", "window_start")
    DO UPDATE SET "hits" = "rate_limit_hits"."hits" + 1
    RETURNING
      "hits",
      ("window_start" + (${windowMs}::bigint * interval '1 millisecond')) AS "reset_at"
  `;
  const row = rows[0];
  if (!row) throw new Error('rate_limit_hits upsert returned no row');
  return { hits: Number(row.hits), resetAt: new Date(row.reset_at) };
}

export class PgRateLimitStore implements Store {
  public windowMs = 60_000;
  public readonly localKeys = false;
  public readonly prefix: string;
  private readonly failMode: RateLimitFailMode;
  private readonly queryHits: (key: string, windowMs: number) => Promise<{ hits: number; resetAt: Date }>;

  constructor(opts: PgRateLimitStoreOptions) {
    this.prefix = opts.prefix;
    this.failMode = opts.failMode;
    this.queryHits = opts.queryHits ?? defaultQueryHits;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const namespaced = `${this.prefix}:${key}`;
    try {
      const { hits, resetAt } = await this.queryHits(namespaced, this.windowMs);
      return { totalHits: hits, resetTime: resetAt };
    } catch (err) {
      if (this.failMode === 'open') {
        logger.warn({ err, prefix: this.prefix }, 'Rate-limit DB error (fail-open for global limiter)');
        return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
      }
      logger.error({ err, prefix: this.prefix }, 'Rate-limit DB error (fail-closed 503 for login limiter)');
      throw Errors.serverBusy();
    }
  }

  async decrement(key: string): Promise<void> {
    const namespaced = `${this.prefix}:${key}`;
    try {
      await prisma.$executeRaw`
        UPDATE "rate_limit_hits"
        SET "hits" = GREATEST(0, "hits" - 1)
        WHERE "key" = ${namespaced}
          AND "window_start" = date_bin((${this.windowMs}::bigint * interval '1 millisecond'), now(), timestamptz 'epoch')
      `;
    } catch {
      // ignore decrement error on DB hiccup
    }
  }

  async resetKey(key: string): Promise<void> {
    const namespaced = `${this.prefix}:${key}`;
    await prisma.$executeRaw`DELETE FROM "rate_limit_hits" WHERE "key" = ${namespaced}`;
  }
}

/** Deletes expired rate-limit window rows older than 2 hours (run every 5 min via pg-boss). */
export async function cleanupRateLimitHits(): Promise<number> {
  const count = await prisma.$executeRaw`
    DELETE FROM "rate_limit_hits" WHERE "window_start" < now() - interval '2 hours'
  `;
  await prisma.$executeRaw`
    DELETE FROM "unknown_identifier_failures" WHERE "expires_at" < now()
  `;
  return Number(count);
}

export interface RateLimitFactoryOptions {
  /** Shared across processes (`false` only when unit tests isolate `createApp()` instances in the same DB). */
  shared?: boolean;
  instanceScope?: string;
  queryHits?: (key: string, windowMs: number) => Promise<{ hits: number; resetAt: Date }>;
}

function identifierOf(req: Request): string {
  const body: unknown = req.body;
  if (typeof body === 'object' && body !== null && 'identifier' in body) {
    const value = (body as { identifier: unknown }).identifier;
    if (typeof value === 'string') return value.trim().toLowerCase().slice(0, 254);
  }
  return '';
}

function emailOf(req: Request): string {
  const body: unknown = req.body;
  if (typeof body === 'object' && body !== null && 'email' in body) {
    const value = (body as { email: unknown }).email;
    if (typeof value === 'string') return value.trim().toLowerCase().slice(0, 254);
  }
  return '';
}

function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function defaultShared(): boolean {
  return env.NODE_ENV !== 'test' || process.env.RATE_LIMIT_SHARED === 'true';
}

function limiter(
  name: string,
  windowMs: number,
  limit: number,
  keyGenerator: (req: Request) => string,
  failMode: RateLimitFailMode,
  opts?: RateLimitFactoryOptions,
): RequestHandler {
  const shared = opts?.shared ?? defaultShared();
  const scope = shared ? 'shared' : (opts?.instanceScope ?? randomUUID());
  const store = new PgRateLimitStore({
    prefix: `${scope}:${name}`,
    failMode,
    queryHits: opts?.queryHits,
  });

  return rateLimit({
    windowMs,
    limit,
    store,
    passOnStoreError: false,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler: (req, _res, next) => {
      const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
      const resetTime = info?.resetTime;
      const seconds = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      next(Errors.rateLimited(seconds));
    },
  });
}

/** 5/min per IP + identifier: fail-closed (503) if DB down. */
export function createLoginLimiter(enabled: boolean, opts?: RateLimitFactoryOptions): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('login_id', 60_000, 5, (req) => `${ipKey(req)}|${identifierOf(req)}`, 'closed', opts);
}

/** 20/min per IP regardless of identifier: fail-closed (503) if DB down. */
export function createLoginIpLimiter(enabled: boolean, opts?: RateLimitFactoryOptions): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('login_ip', 60_000, 20, ipKey, 'closed', opts);
}

/** 5/min per authenticated user: stops brute-forcing the current password with a stolen token. */
export function createChangePasswordLimiter(enabled: boolean, opts?: RateLimitFactoryOptions): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('change_pw', 60_000, 5, (req) => `user:${req.auth?.userId ?? ipKey(req)}`, 'closed', opts);
}

/** 10/min per IP: prevents brute-forcing 6-digit TOTP codes or recovery codes. */
export function createMfaVerifyLimiter(enabled: boolean, opts?: RateLimitFactoryOptions): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('mfa_verify', 60_000, 10, ipKey, 'closed', opts);
}

/** 3/hour per email: prevents spamming an email address with reset links. */
export function createPasswordResetRequestEmailLimiter(
  enabled: boolean,
  opts?: RateLimitFactoryOptions,
): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('reset_email', 3600_000, 3, (req) => `reset_email:${emailOf(req)}`, 'closed', opts);
}

/** 10/hour per IP: prevents reset request floods from a single client. */
export function createPasswordResetRequestIpLimiter(
  enabled: boolean,
  opts?: RateLimitFactoryOptions,
): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('reset_ip', 3600_000, 10, ipKey, 'closed', opts);
}

/** 10/hour per IP: prevents brute-forcing password reset confirmation tokens. */
export function createPasswordResetConfirmLimiter(
  enabled: boolean,
  opts?: RateLimitFactoryOptions,
): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('reset_confirm', 3600_000, 10, ipKey, 'closed', opts);
}

/** 300/min per IP global limiter: fail-OPEN if DB down (§4.1). */
export function createGlobalLimiter(enabled: boolean, opts?: RateLimitFactoryOptions): RequestHandler {
  if (!enabled) return passThrough;
  return limiter('global', 60_000, 300, ipKey, 'open', opts);
}
