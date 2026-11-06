// Access tokens (JWT HS256, claims sub/sid/role) and refresh tokens (32 random bytes, stored only as
// sha256) per CONTRACT §6 Tokens. Also owns the `rt` cookie attributes so they are set in one place.
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { ROLES } from '../rbac/role-rules';
import type { RoleCode } from '../rbac/role-rules';
import { Errors } from '../http/errors';

const ISSUER = 'rhai-erp-api';
const AUDIENCE = 'rhai-erp-web';

export const REFRESH_COOKIE = 'rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AccessClaims {
  sub: string;
  sid: string;
  role?: string;
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  role: z.string().min(1).optional(),
});

export const CURRENT_KID = 'k1';
export const PREVIOUS_KID = 'k0';

export function signAccessToken(claims: AccessClaims): { accessToken: string; expiresIn: number } {
  const accessToken = jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.accessTokenTtlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
    keyid: CURRENT_KID,
  });
  return { accessToken, expiresIn: env.accessTokenTtlSeconds };
}

/** Verifies signature, algorithm, issuer, audience and expiry with kid support. */
export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.decode(token, { complete: true });
  const kid = decoded?.header?.kid;

  let secretToUse = env.JWT_ACCESS_SECRET;
  if (kid) {
    if (kid === CURRENT_KID) {
      secretToUse = env.JWT_ACCESS_SECRET;
    } else if (kid === PREVIOUS_KID && env.JWT_ACCESS_SECRET_PREVIOUS) {
      secretToUse = env.JWT_ACCESS_SECRET_PREVIOUS;
    } else {
      throw Errors.unauthenticated('Invalid access token.');
    }
  }

  let payload: unknown;
  try {
    payload = jwt.verify(token, secretToUse, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.sessionExpired();
    // If verification failed and there's a previous secret and kid was omitted, try previous
    if (!kid && env.JWT_ACCESS_SECRET_PREVIOUS) {
      try {
        payload = jwt.verify(token, env.JWT_ACCESS_SECRET_PREVIOUS, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
        });
      } catch (err2) {
        if (err2 instanceof jwt.TokenExpiredError) throw Errors.sessionExpired();
        throw Errors.unauthenticated('Invalid access token.');
      }
    } else {
      throw Errors.unauthenticated('Invalid access token.');
    }
  }

  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw Errors.unauthenticated('Invalid access token.');
  }
  return parsed.data;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    secure: env.isProduction,
  };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}
