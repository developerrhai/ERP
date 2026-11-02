// The only code that touches the items table, plus the counts that decide IN_USE (ledger rows and
// vouchers). Soft delete keeps the code reserved; a barcode is unique only while the item is alive.
import type { Item, Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Db } from '../../../core/db/prisma';
import { escapeLike } from '../../../core/http/query-safety';

export const itemRepository = {
  find(id: string, deleted = false, db: Db = prisma): Promise<Item | null> {
    return db.item.findFirst({ where: { id, deletedAt: deleted ? { not: null } : null } });
  },

  findByCode(code: string, db: Db = prisma): Promise<Item | null> {
    return db.item.findUnique({ where: { code } });
  },

  findByBarcode(barcode: string, excludeId?: string, db: Db = prisma): Promise<Item | null> {
    return db.item.findFirst({
      where: { barcode, deletedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
  },

  async list(
    filter: { q?: string; status?: 'ACTIVE' | 'INACTIVE'; deleted: boolean },
    orderBy: Prisma.ItemOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ): Promise<{ rows: Item[]; total: number }> {
    const where: Prisma.ItemWhereInput = {
      deletedAt: filter.deleted ? { not: null } : null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { code: { contains: escapeLike(filter.q), mode: 'insensitive' } },
              { name: { contains: escapeLike(filter.q), mode: 'insensitive' } },
              { barcode: { contains: escapeLike(filter.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.item.findMany({ where, orderBy, ...page }),
      prisma.item.count({ where }),
    ]);
    return { rows, total };
  },

  /** Next auto code ITM/00001 (company-wide, serialised by an advisory lock in the caller's tx). */
  async nextCode(db: Db): Promise<string> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('item_code'))`;
    const rows = await db.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(MAX(substring(code from 5)::int), 0) + 1 AS next
      FROM items WHERE code ~ '^ITM/[0-9]+$'`;
    return `ITM/${String(rows[0]?.next ?? 1).padStart(5, '0')}`;
  },

  create(data: Prisma.ItemUncheckedCreateInput, db: Db): Promise<Item> {
    return db.item.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.ItemUncheckedUpdateManyInput,
    db: Db,
  ): Promise<boolean> {
    const result = await db.item.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async softDelete(id: string, actorId: string, at: Date, db: Db): Promise<boolean> {
    const result = await db.item.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: at, deletedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async restore(id: string, actorId: string, db: Db): Promise<boolean> {
    const result = await db.item.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null, updatedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  /** Vouchers (any status, not deleted) that name the item. */
  countVouchers(id: string, db: Db = prisma): Promise<number> {
    return db.stockVoucher.count({ where: { itemId: id, deletedAt: null } });
  },
};
