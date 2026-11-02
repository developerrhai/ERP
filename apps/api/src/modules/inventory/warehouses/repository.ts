// The only code that touches the warehouses table, plus the counts that decide IN_USE. Lists are
// filtered by the unit of the request context (all units for ADMIN+).
import type { Prisma, Unit, Warehouse } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Db } from '../../../core/db/prisma';
import { escapeLike } from '../../../core/http/query-safety';

export type WarehouseWithUnit = Warehouse & { unit: Pick<Unit, 'id' | 'code' | 'name' | 'status'> };

const include = { unit: { select: { id: true, code: true, name: true, status: true } } } as const;

export const warehouseRepository = {
  find(id: string, deleted = false, db: Db = prisma): Promise<WarehouseWithUnit | null> {
    return db.warehouse.findFirst({
      where: { id, deletedAt: deleted ? { not: null } : null },
      include,
    });
  },

  findByCode(code: string, db: Db = prisma): Promise<Warehouse | null> {
    return db.warehouse.findUnique({ where: { code } });
  },

  async list(
    filter: {
      q?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      deleted: boolean;
      unitId: string | null;
      none: boolean;
    },
    orderBy: Prisma.WarehouseOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ): Promise<{ rows: WarehouseWithUnit[]; total: number }> {
    const where: Prisma.WarehouseWhereInput = {
      deletedAt: filter.deleted ? { not: null } : null,
      ...(filter.none ? { id: { in: [] } } : {}),
      ...(filter.unitId ? { unitId: filter.unitId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { code: { contains: escapeLike(filter.q), mode: 'insensitive' } },
              { name: { contains: escapeLike(filter.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.warehouse.findMany({ where, orderBy, include, ...page }),
      prisma.warehouse.count({ where }),
    ]);
    return { rows, total };
  },

  create(data: Prisma.WarehouseUncheckedCreateInput, db: Db): Promise<Warehouse> {
    return db.warehouse.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.WarehouseUncheckedUpdateManyInput,
    db: Db,
  ): Promise<boolean> {
    const result = await db.warehouse.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async softDelete(id: string, actorId: string, at: Date, db: Db): Promise<boolean> {
    const result = await db.warehouse.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: at, deletedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async restore(id: string, actorId: string, db: Db): Promise<boolean> {
    const result = await db.warehouse.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null, updatedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  /** Ledger rows and live vouchers that point at the warehouse. */
  async countReferences(id: string, db: Db = prisma): Promise<number> {
    const [ledger, vouchers] = await Promise.all([
      db.stockLedger.count({ where: { warehouseId: id } }),
      db.stockVoucher.count({
        where: { deletedAt: null, OR: [{ warehouseId: id }, { toWarehouseId: id }] },
      }),
    ]);
    return ledger + vouchers;
  },
};
