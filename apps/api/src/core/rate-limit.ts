// Rate limits (CONTRACT §6 + security review): login 5/min per IP+identifier and 20/min per IP,
// change-password 5/min per user, everything else 300/min per IP. In memory (no Redis yet); each
// createApp() builds fresh limiters so tests do not share counters. IPs are keyed with
// ipKeyGenerator (IPv6 grouped by /64) on req.ip, which honours the app's `trust proxy` setting.
import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { RateLimitInfo } from 'express-rate-limit';
import { Errors } from './http/errors';

const passThrough: RequestHandler = (_req, _res, next) => next();

function identifierOf(req: Request): string {
  const body: unknown = req.body;
  if (typeof body === 'object' && body !== null && 'identifier' in body) {
    const value = (body as { identifier: unknown }).identifier;
    if (typeof value === 'string') return value.trim().toLowerCase().slice(0, 254);
  }
  return '';
}

function ipKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function limiter(
  windowMs: number,
  limit: number,
  keyGenerator: (req: Request) => string,
): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
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

/** 5/min per IP + identifier: slows guessing one account's password. */
export function createLoginLimiter(enabled: boolean): RequestHandler {
  if (!enabled) return passThrough;
  return limiter(60_000, 5, (req) => `${ipKey(req)}|${identifierOf(req)}`);
}

/** 20/min per IP regardless of identifier: caps Argon2 work one client can trigger. */
export function createLoginIpLimiter(enabled: boolean): RequestHandler {
  if (!enabled) return passThrough;
  return limiter(60_000, 20, ipKey);
}

/** 5/min per authenticated user: stops brute-forcing the current password with a stolen token. */
export function createChangePasswordLimiter(enabled: boolean): RequestHandler {
  if (!enabled) return passThrough;
  return limiter(60_000, 5, (req) => `user:${req.auth?.userId ?? ipKey(req)}`);
}

export function createGlobalLimiter(enabled: boolean): RequestHandler {
  if (!enabled) return passThrough;
  return limiter(60_000, 300, ipKey);
}
