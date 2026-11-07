// Who may decide a level (docs/phases/PHASE-05.md §3 rule 6). "Approver by role" = users who hold
// that exact role, have "approve" on the page, can work in the document's unit, and whose home or
// extra departments include the document's department. Roles of level >= 70 are company-wide.
// Super User / Administrator are never added by default; a named user is taken as named.
import type { Prisma } from '@prisma/client';
import type { Db } from '../../core/db/prisma';
import { accessUserOf, can } from '../../core/rbac/access';
import type { AccessUser } from '../../core/rbac/access';
import {
  SETTINGS_APPROVAL_DOC_TYPE,
  SETTINGS_APPROVER_MIN_LEVEL,
} from '../../core/settings/constants';

export const COMPANY_WIDE_LEVEL = 70;

export interface Approver {
  id: string;
  name: string;
  roleId: string;
  roleName: string;
  roleLevel: number;
  approvalLimit: Prisma.Decimal | null;
}

export interface PoolQuery {
  approverRoleId: string | null;
  approverUserId: string | null;
  docType: string;
  unitId: string;
  /** Department name of the document. */
  department: string;
  /** The requester, the creator and anybody who already approved an earlier level. */
  exclude: ReadonlySet<string>;
}

export async function eligibleApprovers(tx: Db, q: PoolQuery): Promise<Approver[]> {
  if (!q.approverRoleId && !q.approverUserId) return [];
  const users = await tx.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(q.approverUserId ? { id: q.approverUserId } : { roleId: q.approverRoleId as string }),
    },
    include: { role: true, extraDepartments: true, units: { select: { unitId: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  const result: Approver[] = [];
  for (const u of users) {
    if (q.exclude.has(u.id)) continue;
    if (!u.role.allUnits && !u.units.some((x) => x.unitId === q.unitId)) continue;
    if (!q.approverUserId && u.role.level < COMPANY_WIDE_LEVEL) {
      const mine = new Set([u.department, ...u.extraDepartments.map((d) => d.departmentName)]);
      if (!mine.has(q.department)) continue;
    }
    const access = accessUserOf({
      id: u.id,
      roleId: u.roleId,
      roleCode: u.role.code,
      level: u.role.level,
      allUnits: u.role.allUnits,
      department: u.department,
      extraDepartments: u.extraDepartments,
    });
    // An empty docType (matrix preview without a document) skips the page-level check.
    if (q.docType && !(await canApproveAccess(access, q.docType))) continue;
    result.push({
      id: u.id,
      name: u.name,
      roleId: u.roleId,
      roleName: u.role.name,
      roleLevel: u.role.level,
      approvalLimit: u.approvalLimit,
    });
  }
  return result;
}

/** Display name of what a step asks for: the role name, or the named user. */
export async function approverLabel(
  tx: Db,
  step: { approverRoleId: string | null; approverUserId: string | null },
): Promise<string> {
  if (step.approverRoleId) {
    const role = await tx.role.findUnique({
      where: { id: step.approverRoleId },
      select: { name: true },
    });
    return role?.name ?? 'the assigned approver';
  }
  if (step.approverUserId) {
    const user = await tx.user.findUnique({
      where: { id: step.approverUserId },
      select: { name: true },
    });
    return user?.name ?? 'the assigned approver';
  }
  return 'the assigned approver';
}

/**
 * Page-level approve right for a document type. A settings change (Phase 6B) is approved by people
 * of the owner department, so it asks only for a Department Manager level or above.
 */
async function canApproveAccess(access: AccessUser, docType: string): Promise<boolean> {
  if (docType === SETTINGS_APPROVAL_DOC_TYPE) return access.level >= SETTINGS_APPROVER_MIN_LEVEL;
  return can(access, docType, 'approve');
}

export async function canApproveDoc(
  user: Parameters<typeof accessUserOf>[0],
  docType: string,
): Promise<boolean> {
  return canApproveAccess(accessUserOf(user), docType);
}
