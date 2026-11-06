// The shape of "who is calling" after authenticate has re-checked the DB, plus the request
// metadata (ip, user agent) that services pass to the audit log.
import type { Request } from 'express';
import type { Role, User, UserDepartment } from '@prisma/client';
import { Errors } from '../http/errors';

export type UserWithRoleAndDepts = User & {
  role: Role;
  extraDepartments?: UserDepartment[];
};

export interface AuthContext {
  userId: string;
  sessionId: string;
  familyId?: string;
  roleId: string;
  roleCode: string;
  level: number;
  allUnits: boolean;
  departments: string[];
  /** Legacy role string code for backwards compatibility. */
  role: string;
  user: UserWithRoleAndDepts;
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
