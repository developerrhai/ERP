// Read queries over stock_balances (Stock Balance page) and stock_ledger (the ledger view of
// Inventory Transactions), as parameterised SQL. Both are filtered by the unit of the request
// context (the warehouse's unit); "All units" (ADMIN+) has no unit filter, a non-admin without a
// unit sees nothing.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import { escapeLike } from '../../../core/http/query-safety';

export interface UnitScope {
  unitId: string | null;
  none: boolean;
}

export interface BalanceRow {
  itemId: string;
  warehouseId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  reorderLevel: string | null;
  warehouseCode: string;
  warehouseName: string;
  unitId: string;
  unitCode: string;
  onHand: string;
  avgRate: string;
  stockValue: string;
  updatedAt: Date;
  belowReorder: boolean;
}

export interface LedgerRow {
  id: string;
  postingDate: Date;
  postedAt: Date;
  unitId: string;
  unitCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyIn: string;
  qtyOut: string;
  rate: string;
  value: string;
  balanceQty: string;
  voucherType: string;
  voucherNo: string;
  createdById: string;
  postedBy: string;
}

const BALANCE_FROM = Prisma.sql`
  FROM stock_balances b
  JOIN items i ON i.id = b.item_id
  JOIN warehouses w ON w.id = b.warehouse_id
  JOIN units un ON un.id = w.unit_id`;

function balanceWhere(
  scope: UnitScope,
  f: { q?: string; warehouseId?: string; belowReorder?: boolean; status?: string },
): Prisma.Sql {
  const where: Prisma.Sql[] = [Prisma.sql`true`];
  if (scope.none) where.push(Prisma.sql`false`);
  else if (scope.unitId) where.push(Prisma.sql`w.unit_id = ${scope.unitId}::uuid`);
  if (f.warehouseId) where.push(Prisma.sql`b.warehouse_id = ${f.warehouseId}::uuid`);
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(
      Prisma.sql`(i.code ILIKE ${like} ESCAPE '\\' OR i.name ILIKE ${like} ESCAPE '\\' OR w.name ILIKE ${like} ESCAPE '\\')`,
    );
  }
  const below = Prisma.sql`(i.reorder_level IS NOT NULL AND b.on_hand < i.reorder_level)`;
  if (f.belowReorder || f.status === 'Below Reorder') where.push(below);
  if (f.status === 'OK') where.push(Prisma.sql`NOT ${below}`);
  return Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`;
}

const BALANCE_ORDER: Record<string, Prisma.Sql> = {
  itemCode: Prisma.sql`i.code`,
  code: Prisma.sql`i.code`,
  itemName: Prisma.sql`i.name`,
  unit: Prisma.sql`un.code`,
  warehouse: Prisma.sql`w.name`,
  uom: Prisma.sql`i.base_uom`,
  onHand: Prisma.sql`b.on_hand`,
  avgRate: Prisma.sql`b.avg_rate`,
  stockValue: Prisma.sql`b.value`,
  reorderLevel: Prisma.sql`i.reorder_level`,
  status: Prisma.sql`(i.reorder_level IS NOT NULL AND b.on_hand < i.reorder_level)`,
  updatedAt: Prisma.sql`b.updated_at`,
};

export function balanceOrder(sort: string): Prisma.Sql | null {
  const desc = sort.startsWith('-');
  const expr = BALANCE_ORDER[desc ? sort.slice(1) : sort];
  if (!expr) return null;
  return Prisma.sql`${expr} ${Prisma.raw(desc ? 'DESC' : 'ASC')} NULLS LAST, b.item_id ASC, b.warehouse_id ASC`;
}

const BALANCE_COLUMNS = Prisma.sql`
  b.item_id AS "itemId", b.warehouse_id AS "warehouseId", i.code AS "itemCode", i.name AS "itemName",
  i.base_uom AS uom, i.reorder_level::text AS "reorderLevel", w.code AS "warehouseCode",
  w.name AS "warehouseName", w.unit_id AS "unitId", un.code AS "unitCode", b.on_hand::text AS "onHand",
  b.avg_rate::text AS "avgRate", b.value::text AS "stockValue", b.updated_at AS "updatedAt",
  (i.reorder_level IS NOT NULL AND b.on_hand < i.reorder_level) AS "belowReorder"`;

export const stockRepository = {
  async balances(
    scope: UnitScope,
    filter: { q?: string; warehouseId?: string; belowReorder?: boolean; status?: string },
    order: Prisma.Sql,
    page: { offset: number; limit: number },
  ): Promise<{ rows: BalanceRow[]; total: number; onHand: string; stockValue: string }> {
    const where = balanceWhere(scope, filter);
    const [rows, sums] = await Promise.all([
      prisma.$queryRaw<BalanceRow[]>`
        SELECT ${BALANCE_COLUMNS} ${BALANCE_FROM} ${where}
        ORDER BY ${order} LIMIT ${page.limit} OFFSET ${page.offset}`,
      prisma.$queryRaw<{ total: number; on_hand: string; value: string }[]>`
        SELECT count(*)::int AS total, COALESCE(sum(b.on_hand), 0)::text AS on_hand,
               COALESCE(sum(b.value), 0)::text AS value ${BALANCE_FROM} ${where}`,
    ]);
    const s = sums[0];
    return { rows, total: s?.total ?? 0, onHand: s?.on_hand ?? '0', stockValue: s?.value ?? '0' };
  },

  async balance(scope: UnitScope, itemId: string, warehouseId: string): Promise<BalanceRow | null> {
    const where = balanceWhere(scope, {});
    const rows = await prisma.$queryRaw<BalanceRow[]>`
      SELECT ${BALANCE_COLUMNS} ${BALANCE_FROM} ${where}
        AND b.item_id = ${itemId}::uuid AND b.warehouse_id = ${warehouseId}::uuid`;
    return rows[0] ?? null;
  },

  async ledger(
    scope: UnitScope,
    filter: { q?: string; warehouseId?: string },
    order: Prisma.Sql,
    page: { offset: number; limit: number },
  ): Promise<{ rows: LedgerRow[]; total: number }> {
    const where: Prisma.Sql[] = [Prisma.sql`true`];
    if (scope.none) where.push(Prisma.sql`false`);
    else if (scope.unitId) where.push(Prisma.sql`l.unit_id = ${scope.unitId}::uuid`);
    if (filter.warehouseId) where.push(Prisma.sql`l.warehouse_id = ${filter.warehouseId}::uuid`);
    if (filter.q) {
      const like = `%${escapeLike(filter.q)}%`;
      where.push(
        Prisma.sql`(l.voucher_no ILIKE ${like} ESCAPE '\\' OR i.code ILIKE ${like} ESCAPE '\\' OR i.name ILIKE ${like} ESCAPE '\\')`,
      );
    }
    const clause = Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}`;
    const from = Prisma.sql`
      FROM stock_ledger l
      JOIN items i ON i.id = l.item_id
      JOIN warehouses w ON w.id = l.warehouse_id
      JOIN units un ON un.id = l.unit_id
      JOIN users u ON u.id = l.created_by_id`;
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<LedgerRow[]>`
        SELECT l.id, l.posting_date AS "postingDate", l.posted_at AS "postedAt", l.unit_id AS "unitId",
               un.code AS "unitCode", l.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
               w.name AS "warehouseName", l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
               l.qty_in::text AS "qtyIn", l.qty_out::text AS "qtyOut", l.rate::text AS rate,
               l.value::text AS value, l.balance_qty::text AS "balanceQty", l.voucher_type AS "voucherType",
               l.voucher_no AS "voucherNo", l.created_by_id AS "createdById", u.name AS "postedBy"
        ${from} ${clause} ORDER BY ${order} LIMIT ${page.limit} OFFSET ${page.offset}`,
      prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${from} ${clause}`,
    ]);
    return { rows, total: count[0]?.total ?? 0 };
  },
};

const LEDGER_ORDER: Record<string, Prisma.Sql> = {
  postingDate: Prisma.sql`l.posting_date`,
  postedAt: Prisma.sql`l.posted_at`,
  createdAt: Prisma.sql`l.posted_at`,
  voucherNo: Prisma.sql`l.voucher_no`,
  code: Prisma.sql`l.voucher_no`,
  voucherType: Prisma.sql`l.voucher_type`,
  item: Prisma.sql`i.code`,
  warehouse: Prisma.sql`w.name`,
  qtyIn: Prisma.sql`l.qty_in`,
  qtyOut: Prisma.sql`l.qty_out`,
  value: Prisma.sql`l.value`,
  balanceQty: Prisma.sql`l.balance_qty`,
};

export function ledgerOrder(sort: string): Prisma.Sql | null {
  const desc = sort.startsWith('-');
  const expr = LEDGER_ORDER[desc ? sort.slice(1) : sort];
  if (!expr) return null;
  return Prisma.sql`${expr} ${Prisma.raw(desc ? 'DESC' : 'ASC')}, l.posted_at DESC, l.id DESC`;
}
