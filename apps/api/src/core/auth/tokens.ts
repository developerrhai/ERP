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
  role: RoleCode;
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  role: z.enum(ROLES),
});

export function signAccessToken(claims: AccessClaims): { accessToken: string; expiresIn: number } {
  const accessToken = jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.accessTokenTtlSeconds,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { accessToken, expiresIn: env.accessTokenTtlSeconds };
}

/** Verifies signature, algorithm, issuer, audience and expiry. Throws a 401 AppError otherwise. */
export function verifyAccessToken(token: string): AccessClaims {
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.sessionExpired();
    throw Errors.unauthenticated('Invalid access token.');
  }
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) throw Errors.unauthenticated('Invalid access token.');
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
