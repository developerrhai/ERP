// Audit rows of the typed Inventory pages (GET /pages/:pageId/audit and /records/:id/audit): the
// audit entries of items, warehouses and vouchers whose detail names the page. Same row shape as
// /audit-logs. Voucher pages follow the caller's data scope (OWN: own entries only) and the unit of
// the request context (the unit is in the entry's detail); items are company-wide. ip and user agent
// are only shown to ADMIN and above.
import { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { hasMinRole } from '../../core/rbac/role-rules';
import { scopeFor, accessUserOf } from '../../core/rbac/access';
import { auditLogRepository } from '../audit-logs/repository';
import { toAuditLogDto } from '../audit-logs/service';
import type { Caller } from '../records/service';
import { unitFilter } from './typed';

export async function typedAudit(
  caller: Caller,
  pageId: string,
  page: { page: number; size: number },
  recordId?: string,
) {
  const where: Prisma.Sql[] = [
    Prisma.sql`a.target_type IN ('Item', 'Warehouse', 'Voucher')`,
    Prisma.sql`a.detail ->> 'pageId' = ${pageId}`,
  ];
  if (recordId) where.push(Prisma.sql`a.target_id = ${recordId}`);
  if (pageId !== 'inv-items') {
    const units = unitFilter(caller);
    if (units.none) where.push(Prisma.sql`false`);
    else if (units.unitId) {
      // A transfer entry also matters to the destination unit.
      where.push(
        Prisma.sql`(a.detail ->> 'unitId' = ${units.unitId} OR a.detail ->> 'toUnitId' = ${units.unitId})`,
      );
    }
  }
  const user = caller.auth.user;
  const scope = await scopeFor(accessUserOf(user), pageId);
  if (scope === 'OWN' && pageId !== 'inv-items' && pageId !== 'wms-warehouses') {
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
