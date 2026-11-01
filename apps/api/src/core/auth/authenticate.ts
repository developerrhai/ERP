// Bearer authentication that re-checks the database on every request (CONTRACT §6 Tokens): the
// session must be live, the user ACTIVE, and the role is taken from the DB, so a role change,
// deactivation or revocation takes effect immediately. Also the must-change-password and CSRF guards.
import type { RequestHandler } from 'express';
import { asyncHandler } from '../http/async-handler';
import { Errors } from '../http/errors';
import { isSessionLive, sessionRepository } from './session-repository';
import { verifyAccessToken } from './tokens';

export function readBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export const authenticate: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = readBearer(req.headers.authorization);
  if (!token) throw Errors.unauthenticated();
  const claims = verifyAccessToken(token);
  const session = await sessionRepository.findWithUser(claims.sid);
  if (!session || session.userId !== claims.sub || !isSessionLive(session)) {
    throw Errors.sessionExpired();
  }
  if (session.user.status !== 'ACTIVE') throw Errors.sessionExpired();
  req.auth = {
    userId: session.user.id,
    sessionId: session.id,
    role: session.user.role,
    user: session.user,
  };
  next();
});

/**
 * While mustChangePassword is set, everything except /auth/me, /auth/change-password,
 * /auth/logout and /meta/* is refused. Routers opt out by simply not mounting this guard.
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(Errors.unauthenticated());
  if (req.auth.user.mustChangePassword) return next(Errors.passwordChangeRequired());
  next();
};

export const CSRF_HEADER_VALUE = 'rhai-web';

/** Cookie-authenticated endpoints (/auth/refresh, /auth/logout) also need X-Requested-With. */
export const requireRequestedWith: RequestHandler = (req, _res, next) => {
  if (req.get('x-requested-with') !== CSRF_HEADER_VALUE) {
    return next(Errors.forbidden('Missing or invalid X-Requested-With header.'));
  }
  next();
};
