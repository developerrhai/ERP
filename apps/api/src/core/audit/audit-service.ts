// Writes AuditLog rows for the security events in CONTRACT §6 Audit. The table is append-only (a DB
// trigger raises on UPDATE/DELETE), so this module only ever inserts.
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import type { RequestMeta } from '../auth/auth-context';

export const AUDIT_ACTIONS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'LOGOUT',
  'LOGOUT_ALL',
  'TOKEN_REUSE_DETECTED',
  'REFRESH_RACE',
  'PASSWORD_CHANGED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_PASSWORD_RESET',
  'DEPARTMENT_CREATED',
  'DEPARTMENT_UPDATED',
  'DEPARTMENT_DELETED',
  'PERMISSIONS_UPDATED',
  'DEPARTMENT_ACCESS_UPDATED',
  'MODULE_CONTROL_UPDATED',
  'SETTINGS_UPDATED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  targetType?:
    | 'User'
    | 'Session'
    | 'Department'
    | 'RolePermissions'
    | 'DepartmentAccess'
    | 'ModuleControl'
    | 'Setting'
    | null;
  targetId?: string | null;
  meta?: RequestMeta;
  detail?: Prisma.InputJsonObject;
}

export async function recordAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
      detail: entry.detail ?? {},
    },
  });
}
