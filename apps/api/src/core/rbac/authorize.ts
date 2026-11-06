// Route guards and service assertions built on role-rules.ts (Phase 02 §5.5).
// Every permission check goes through these helpers and fails with consistent 403 errors.
import type { RequestHandler } from 'express';
import { Errors } from '../http/errors';
import { canManageLevel, hasMinLevel } from './role-rules';

/** Route guard: the caller's role level must be at least `minLevel` (e.g. 95 for Administrator+). */
export function requireMinLevel(minLevel: number): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(Errors.unauthenticated());
    if (!hasMinLevel(req.auth.level, minLevel)) return next(Errors.forbidden());
    next();
  };
}

/** Legacy alias for requireMinLevel(95) during migration. */
export function requireMinRole(_legacyRole: string = 'ADMIN'): RequestHandler {
  return requireMinLevel(95);
}

export function assertCanManage(actorLevel: number, targetLevel: number, message?: string): void {
  if (!canManageLevel(actorLevel, targetLevel)) {
    throw Errors.forbidden(message ?? 'You can only manage users below your own role.');
  }
}
