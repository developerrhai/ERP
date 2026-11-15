// Allocate / Reallocate on a row of a V40 Inventory tab: runs the stock allocator (BR-INV-17) for the item, so free stock goes to the
// Waiting / Partial reservations in priority order. Nothing is invented: the numbers returned are the reserved quantity before and after.
// Like the allocator that runs after every receipt, this writes no audit row of its own (the reservations it serves keep their versions).
import { prisma } from '../../../core/db/prisma';
import { Errors } from '../../../core/http/errors';
import type { Caller } from '../../records/service';
import { lockInOrder, runAllocator } from '../stock/stock-service';
import { scopeSql } from './stats';

export interface AllocateResult {
  warehouses: number;
  reservedBefore: number;
  reservedAfter: number;
  allocated: number;
  waiting: number;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export async function allocateStock(
  caller: Caller,
  itemId: string,
  warehouseId: string | null,
): Promise<AllocateResult> {
  const item = await prisma.item.findFirst({ where: { id: itemId, deletedAt: null }, select: { id: true } });
  if (!item) throw Errors.notFound('Item not found.');
  // the warehouse asked for, or every warehouse of the caller's unit where this item has open demand
  const targets = warehouseId
    // unpaginated: one warehouse by id
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT w.id::text FROM warehouses w
        WHERE w.id = ${warehouseId}::uuid AND w.deleted_at IS NULL AND ${scopeSql(caller)}`
    // unpaginated: the warehouses of one unit with open demand for one item
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT w.id::text FROM stock_reservations r JOIN warehouses w ON w.id = r.warehouse_id
        WHERE r.item_id = ${itemId}::uuid AND r.status IN ('Waiting','Partial') AND ${scopeSql(caller)}`;
  if (warehouseId && targets.length === 0) throw Errors.notFound('Warehouse not found in this unit.');
  let before = 0;
  let after = 0;
  let waiting = 0;
  for (const t of targets) {
    await prisma.$transaction(async (tx) => {
      await lockInOrder(tx, [{ warehouseId: t.id, itemId }]);
      const b0 = await tx.$queryRaw<{ q: string }[]>`
        SELECT COALESCE(reserved_qty,0)::text AS q FROM stock_balances
        WHERE item_id = ${itemId}::uuid AND warehouse_id = ${t.id}::uuid`;
      await runAllocator(tx, itemId, t.id);
      const b1 = await tx.$queryRaw<{ q: string }[]>`
        SELECT COALESCE(reserved_qty,0)::text AS q FROM stock_balances
        WHERE item_id = ${itemId}::uuid AND warehouse_id = ${t.id}::uuid`;
      const w = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM stock_reservations
        WHERE item_id = ${itemId}::uuid AND warehouse_id = ${t.id}::uuid AND status IN ('Waiting','Partial')`;
      before += Number(b0[0]?.q ?? 0);
      after += Number(b1[0]?.q ?? 0);
      waiting += w[0]?.n ?? 0;
    });
  }
  return {
    warehouses: targets.length,
    reservedBefore: r3(before),
    reservedAfter: r3(after),
    allocated: r3(after - before),
    waiting,
  };
}
