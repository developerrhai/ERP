// Bearer authentication that re-checks the database on every request (CONTRACT §6 Tokens): the
// session must be live, the user ACTIVE, and the role is taken from the DB, so a role change,
// deactivation or revocation takes effect immediately. Also the must-change-password and CSRF guards.
import type { RequestHandler } from 'express';
import { asyncHandler } from '../http/async-handler';
import { Errors } from '../http/errors';
import { getSecurityPolicy } from './security-policy';
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
  const policy = await getSecurityPolicy();
  if (!session || session.userId !== claims.sub || !isSessionLive(session, new Date(), policy)) {
    throw Errors.sessionExpired();
  }
  if (session.user.status !== 'ACTIVE') throw Errors.sessionExpired();

  const homeDept = session.user.department;
  const extraDepts = (session.user.extraDepartments ?? []).map((d) => d.departmentName);
  const departments = [homeDept, ...extraDepts].filter((d): d is string => Boolean(d));

  req.auth = {
    userId: session.user.id,
    sessionId: session.id,
    familyId: session.familyId,
    roleId: session.user.role.id,
    roleCode: session.user.role.code,
    level: session.user.role.level,
    allUnits: session.user.role.allUnits,
    departments,
    role: session.user.role.code,
    user: session.user,
  };

  // Touch last_used_at at most once per 60 seconds; requests with X-Activity: background never touch it.
  const isBackground = req.get('x-activity') === 'background';
  if (!isBackground) {
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    void sessionRepository.touchLastUsedIfStale(session.id, sixtySecondsAgo);
  }

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

/**
 * While mfaRequiredForAdmins is enabled, administrators without MFA enabled are refused
 * everywhere except /auth/me, /auth/mfa/*, /auth/logout and /meta/*.
 */
export const requireMfaSatisfied: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.auth) return next(Errors.unauthenticated());
  const path = req.originalUrl || req.path;
  if (
    path.includes('/auth/me') ||
    path.includes('/auth/mfa') ||
    path.includes('/auth/logout') ||
    path.includes('/meta')
  ) {
    return next();
  }
  const policy = await getSecurityPolicy();
  const isAdmin = req.auth.level >= 95;
  if (policy.mfaRequiredForAdmins && isAdmin && !req.auth.user.mfaEnabled) {
    throw Errors.mfaSetupRequired();
  }
  next();
});

export const CSRF_HEADER_VALUE = 'rhai-web';

/** Cookie-authenticated endpoints (/auth/refresh, /auth/logout) also need X-Requested-With. */
export const requireRequestedWith: RequestHandler = (req, _res, next) => {
  if (req.get('x-requested-with') !== CSRF_HEADER_VALUE) {
    return next(Errors.forbidden('Missing or invalid X-Requested-With header.'));
  }
  next();
};
