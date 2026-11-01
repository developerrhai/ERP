// The shape of "who is calling" after authenticate has re-checked the DB, plus the request
// metadata (ip, user agent) that services pass to the audit log.
import type { Request } from 'express';
import type { User } from '@prisma/client';
import type { RoleCode } from '../rbac/role-rules';
import { Errors } from '../http/errors';

export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Always the role from the database, never from the token. */
  role: RoleCode;
  user: User;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  const userAgent = req.get('user-agent');
  return {
    ip: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}

/** For handlers behind authenticate: returns the context or fails closed. */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw Errors.unauthenticated();
  return req.auth;
}
