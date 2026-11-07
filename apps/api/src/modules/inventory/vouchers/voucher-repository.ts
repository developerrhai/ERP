// The only code that touches stock_vouchers / stock_voucher_lines for the header+lines vouchers (Phase 8).
// Visibility: a voucher is visible in a unit when it belongs to it, or (transfers) when the destination is
// in it. Data scope and soft delete are applied here, in SQL, never in the UI only.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Db } from '../../../core/db/prisma';
import { escapeLike } from '../../../core/http/query-safety';

const include = {
  warehouse: {
    select: { id: true, code: true, name: true, status: true, unitId: true, isTransit: true },
  },
  toWarehouse: { select: { id: true, code: true, name: true, status: true, unitId: true } },
  fy: {
    select: { id: true, code: true, label: true, status: true, startDate: true, endDate: true },
  },
  lines: {
    orderBy: { lineNo: 'asc' as const },
    include: {
      item: { select: { id: true, code: true, name: true, baseUom: true, standardCost: true } },
    },
  },
} satisfies Prisma.StockVoucherInclude;

type Raw = Prisma.StockVoucherGetPayload<{ include: typeof include }>;
/** Lines carry their item; the item relation is typed through the line include. */
export type VoucherRow = Omit<Raw, 'lines'> & {
  lines: (Raw['lines'][number] & {
    item: {
      id: string;
      code: string;
      name: string;
      baseUom: string;
      standardCost: Prisma.Decimal | null;
    };
  })[];
};

export interface Scope {
  ownUserId?: string | undefined;
  department: string | null;
  anyDepartment: boolean;
}

export interface VoucherFilter {
  kind: string;
  id?: string;
  unitId: string | null;
  none: boolean;
  scope: Scope;
  q?: string | undefined;
  status?: string | undefined;
  deleted?: boolean;
}

function whereOf(f: VoucherFilter): Prisma.StockVoucherWhereInput {
  const and: Prisma.StockVoucherWhereInput[] = [];
  if (f.id) and.push({ id: f.id });
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
        {
          lines: {
            some: {
              OR: [
                { item: { code: { contains: like, mode: 'insensitive' } } },
                { item: { name: { contains: like, mode: 'insensitive' } } },
                { batchNo: { contains: like, mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    });
  }
  return { kind: f.kind, deletedAt: f.deleted ? { not: null } : null, AND: and };
}

export const voucherRepo = {
  find(f: VoucherFilter, db: Db = prisma): Promise<VoucherRow | null> {
    return db.stockVoucher.findFirst({ where: whereOf(f), include }) as Promise<VoucherRow | null>;
  },

  async list(f: VoucherFilter, page: { skip: number; take: number }) {
    const where = whereOf(f);
    const [rows, total] = await Promise.all([
      prisma.stockVoucher.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...page,
      }),
      prisma.stockVoucher.count({ where }),
    ]);
    return { rows: rows as VoucherRow[], total };
  },

  create(
    data: Omit<Prisma.StockVoucherUncheckedCreateInput, 'lines'> & {
      lines: { create: Prisma.StockVoucherLineUncheckedCreateWithoutVoucherInput[] };
    },
    db: Db,
  ) {
    return db.stockVoucher.create({ data });
  },

  /** Replace header fields and all lines of a Draft/Rejected voucher, guarded by the version. */
  async replace(
    id: string,
    version: number,
    data: Prisma.StockVoucherUncheckedUpdateManyInput,
    lines: Prisma.StockVoucherLineUncheckedCreateWithoutVoucherInput[],
    db: Db,
  ): Promise<boolean> {
    const r = await db.stockVoucher.updateMany({
      where: { id, version, deletedAt: null, status: { in: ['Draft', 'Rejected'] } },
      data: { ...data, version: { increment: 1 } },
    });
    if (r.count !== 1) return false;
    await db.stockVoucherLine.deleteMany({ where: { voucherId: id } });
    await db.stockVoucherLine.createMany({ data: lines.map((l) => ({ ...l, voucherId: id })) });
    return true;
  },

  setLine(id: string, data: Prisma.StockVoucherLineUncheckedUpdateInput, db: Db) {
    return db.stockVoucherLine.update({ where: { id }, data });
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
