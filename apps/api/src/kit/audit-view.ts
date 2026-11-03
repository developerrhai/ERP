// apps/api/src/kit/audit-view.ts
// Generic audit view for Kit pages (docs/plans/07-ENGINE-KIT.md §6 KR-14, §12 T-KIT-05)

import { Prisma } from '@prisma/client';
import { prisma } from '../core/db/prisma';
import { hasMinRole } from '../core/rbac/role-rules';
import { scopeFor, accessUserOf } from '../core/rbac/access';
import { auditLogRepository } from '../modules/audit-logs/repository';
import { toAuditLogDto } from '../modules/audit-logs/service';
import type { Caller } from '../modules/records/service';
import { unitFilter } from '../modules/inventory/typed';

export async function kitAudit(
  caller: Caller,
  pageId: string,
  page: { page: number; size: number },
  recordId?: string,
) {
  const where: Prisma.Sql[] = [
    Prisma.sql`a.detail ->> 'pageId' = ${pageId}`,
  ];

  if (recordId) {
    where.push(Prisma.sql`a.target_id = ${recordId}`);
  }

  const units = unitFilter(caller);
  if (units.none) {
    where.push(Prisma.sql`false`);
  } else if (units.unitId) {
    where.push(Prisma.sql`a.detail ->> 'unitId' = ${units.unitId}`);
  }

  const user = caller.auth.user;
  const scope = await scopeFor(accessUserOf(user), pageId);
  if (scope === 'OWN') {
    where.push(Prisma.sql`a.actor_id = ${user.id}::uuid`);
  }

  const clause = Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`;
  const offset = (page.page - 1) * page.size;
  const [ids, count] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM audit_logs a ${clause}
      ORDER BY a.at DESC, a.id DESC LIMIT ${page.size} OFFSET ${offset}`,
    prisma.$queryRaw<
      { total: number }[]
    >`SELECT count(*)::int AS total FROM audit_logs a ${clause}`,
  ]);

  const rows = (await auditLogRepository.findByIds(ids.map((r) => r.id))).map(toAuditLogDto);
  const privileged = hasMinRole(caller.auth.role, 'ADMIN');
  return {
    rows: privileged ? rows : rows.map((r) => ({ ...r, ip: null, userAgent: null })),
    total: count[0]?.total ?? 0,
  };
}
