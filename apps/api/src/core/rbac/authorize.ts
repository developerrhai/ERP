// Route guards and service assertions built on role-rules.ts, so every permission check goes
// through the one rule table and fails with the same 403 shape.
import type { RequestHandler } from 'express';
import { Errors } from '../http/errors';
import { canManage, hasMinRole } from './role-rules';
import type { RoleCode } from './role-rules';

/** Route guard: the caller's role (loaded from the DB by authenticate) must be at least `minRole`. */
export function requireMinRole(minRole: RoleCode): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(Errors.unauthenticated());
    if (!hasMinRole(req.auth.role, minRole)) return next(Errors.forbidden());
    next();
  };
}

export function assertCanManage(actorRole: RoleCode, targetRole: RoleCode, message?: string): void {
  if (!canManage(actorRole, targetRole)) {
    throw Errors.forbidden(message ?? 'You are not allowed to manage users with this role.');
  }
}
