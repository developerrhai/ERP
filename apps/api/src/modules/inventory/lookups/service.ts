// The searchable lookups behind the item / warehouse fields (docs/phase3-4 C3): GET /lookups/items
// and GET /lookups/warehouses. Items are company-wide (active only). Warehouses are limited to the
// unit of the request context, or to `unitId` when the caller may work in it; `any=true` lists every
// active warehouse (a transfer destination may be in another unit). Results are `{id, code, name, ...}`.
import { prisma } from '../../../core/db/prisma';
import { assertUnitChoice } from '../../../core/context/resolve-context';
import { escapeLike } from '../../../core/http/query-safety';
import type { Caller } from '../../records/service';

export interface LookupQuery {
  q?: string;
  limit: number;
  unitId?: string;
  any?: boolean;
}

export const lookupService = {
  async items(query: LookupQuery) {
    const like = query.q ? escapeLike(query.q) : null;
    const rows = await prisma.item.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        ...(like
          ? {
              OR: [
                { code: { contains: like, mode: 'insensitive' } },
                { name: { contains: like, mode: 'insensitive' } },
                { barcode: { contains: like, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ code: 'asc' }],
      take: query.limit,
      select: { id: true, code: true, name: true, baseUom: true },
    });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, uom: r.baseUom }));
  },

  async warehouses(caller: Caller, query: LookupQuery) {
    const user = caller.auth.user;
    let unitFilter: { unitId?: string; none?: boolean } = {};
    if (query.any) {
      unitFilter = {};
    } else if (query.unitId) {
      await assertUnitChoice(
        { id: user.id, role: user.role, defaultUnitId: user.defaultUnitId },
        query.unitId,
      );
      unitFilter = { unitId: query.unitId };
    } else if (caller.ctx.unitId) {
      unitFilter = { unitId: caller.ctx.unitId };
    } else if (!caller.ctx.allUnits) {
      unitFilter = { none: true };
    }
    if (unitFilter.none) return [];
    const like = query.q ? escapeLike(query.q) : null;
    const rows = await prisma.warehouse.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        ...(unitFilter.unitId ? { unitId: unitFilter.unitId } : {}),
        ...(like
          ? {
              OR: [
                { code: { contains: like, mode: 'insensitive' } },
                { name: { contains: like, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ code: 'asc' }],
      take: query.limit,
      select: { id: true, code: true, name: true, unitId: true, unit: { select: { code: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      unitId: r.unitId,
      unitCode: r.unit.code,
    }));
  },
};
