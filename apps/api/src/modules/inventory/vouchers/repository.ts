// The only code that touches stock_vouchers. A voucher is visible in a unit when it belongs to it, or
// (transfers) when the destination warehouse is in it; data scope and soft delete are added by the
// service. Writes use optimistic locking on `version`; actions lock the voucher row first.
import type { Prisma, StockVoucher } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Db } from '../../../core/db/prisma';
import { escapeLike } from '../../../core/http/query-safety';

const include = {
  item: {
    select: { id: true, code: true, name: true, status: true, deletedAt: true, standardCost: true },
  },
  warehouse: {
    select: { id: true, code: true, name: true, status: true, unitId: true, deletedAt: true },
  },
  toWarehouse: {
    select: { id: true, code: true, name: true, status: true, unitId: true, deletedAt: true },
  },
  fy: {
    select: { id: true, code: true, label: true, status: true, startDate: true, endDate: true },
  },
} as const;

export type VoucherFull = Prisma.StockVoucherGetPayload<{ include: typeof include }>;

export interface VoucherFilter {
  kind: string;
  unitId: string | null;
  none: boolean;
  scope: { ownUserId?: string; department?: string | null; anyDepartment: boolean };
  q?: string;
  status?: string;
  deleted: boolean;
}

export function whereOf(f: VoucherFilter): Prisma.StockVoucherWhereInput {
  const and: Prisma.StockVoucherWhereInput[] = [];
  if (f.none) and.push({ id: { in: [] } });
  if (f.unitId) and.push({ OR: [{ unitId: f.unitId }, { toUnitId: f.unitId }] });
  if (f.scope.ownUserId) and.push({ createdById: f.scope.ownUserId });
  if (!f.scope.anyDepartment && !f.scope.ownUserId) {
    and.push(f.scope.department ? { department: f.scope.department } : { id: { in: [] } });
  }
  if (f.status) and.push({ status: f.status });
  if (f.q) {
    const like = escapeLike(f.q);
    and.push({
      OR: [
        { number: { contains: like, mode: 'insensitive' } },
        { reference: { contains: like, mode: 'insensitive' } },
        { batchSerial: { contains: like, mode: 'insensitive' } },
        {
          item: {
            OR: [
              { code: { contains: like, mode: 'insensitive' } },
              { name: { contains: like, mode: 'insensitive' } },
            ],
          },
        },
      ],
    });
  }
  return { kind: f.kind, deletedAt: f.deleted ? { not: null } : null, AND: and };
}

export const voucherRepository = {
  find(where: Prisma.StockVoucherWhereInput, db: Db = prisma): Promise<VoucherFull | null> {
    return db.stockVoucher.findFirst({ where, include });
  },

  async list(
    where: Prisma.StockVoucherWhereInput,
    orderBy: Prisma.StockVoucherOrderByWithRelationInput[],
    page: { skip: number; take: number },
  ): Promise<{ rows: VoucherFull[]; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.stockVoucher.findMany({ where, orderBy, include, ...page }),
      prisma.stockVoucher.count({ where }),
    ]);
    return { rows, total };
  },

  create(data: Prisma.StockVoucherUncheckedCreateInput, db: Db): Promise<StockVoucher> {
    return db.stockVoucher.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.StockVoucherUncheckedUpdateManyInput,
    db: Db,
  ): Promise<boolean> {
    const result = await db.stockVoucher.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async softDelete(id: string, actorId: string, at: Date, db: Db): Promise<boolean> {
    const result = await db.stockVoucher.updateMany({
      where: { id, status: 'Draft', deletedAt: null },
      data: { deletedAt: at, deletedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  async restore(id: string, actorId: string, db: Db): Promise<boolean> {
    const result = await db.stockVoucher.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null, updatedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  /** Row lock for the duration of the transaction: two actions on one voucher queue up. */
  async lock(id: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT id FROM stock_vouchers WHERE id = ${id}::uuid FOR UPDATE`;
  },
};
