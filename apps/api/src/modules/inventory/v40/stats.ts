// Availability numbers behind the V40 columns Demand / Available / Allocated / Short / Location of the Inventory pages.
// Everything is read from the same tables the stock engine writes (stock_slices, stock_balances, stock_holds,
// stock_reservations, stock_ledger), so the numbers on a page always agree with Stock Balance and Stock Reservation.
//   available = unrestricted slices - reserved - held (never below 0)        (BR-INV-03, same as availability())
//   demand    = still-open quantity of the open reservations (required - fulfilled)
//   allocated = quantity those open reservations already hold (reserved_qty)
//   short     = demand - allocated (never below 0)
import { Prisma } from '@prisma/client';
import { prisma } from '../../../core/db/prisma';
import type { Caller } from '../../records/service';
import { unitFilter } from '../typed';

export interface PairStat {
  itemId: string;
  warehouseId: string;
  unrestricted: number;
  qualityInspection: number;
  blocked: number;
  reserved: number;
  held: number;
  available: number;
  demand: number;
  allocated: number;
  short: number;
  batches: string | null;
  bins: string | null;
  lastMovement: string | null;
}

export const OPEN_RESERVATION = Prisma.sql`('Waiting','Partial','Reserved')`;

/** warehouses.unit_id filter of the request context ("All units" = ADMIN+, none = no unit chosen). */
export function scopeSql(caller: Caller, alias = 'w'): Prisma.Sql {
  const s = unitFilter(caller);
  if (s.none) return Prisma.sql`false`;
  if (s.unitId) return Prisma.sql`${Prisma.raw(alias)}.unit_id = ${s.unitId}::uuid`;
  return Prisma.sql`true`;
}

interface PairRow {
  item_id: string;
  warehouse_id: string;
  unrestricted: string;
  qi: string;
  blocked: string;
  reserved: string;
  held: string;
  demand: string;
  allocated: string;
  batches: string | null;
  bins: string | null;
  last_movement: Date | null;
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

/** Stats of up to ~200 (item, warehouse) pairs in one query. Key of the map: `${itemId}_${warehouseId}`. */
export async function pairStats(
  pairs: readonly { itemId: string; warehouseId: string }[],
): Promise<Map<string, PairStat>> {
  const out = new Map<string, PairStat>();
  if (pairs.length === 0) return out;
  const itemIds = pairs.map((p) => p.itemId);
  const whIds = pairs.map((p) => p.warehouseId);
  // unpaginated: bounded by the page of pairs the caller passes in
  const rows = await prisma.$queryRaw<PairRow[]>`
    SELECT p.item_id::text, p.warehouse_id::text,
      COALESCE((SELECT sum(s.qty) FROM stock_slices s WHERE s.item_id = p.item_id AND s.warehouse_id = p.warehouse_id AND s.stock_status = 'UNRESTRICTED'),0)::text AS unrestricted,
      COALESCE((SELECT sum(s.qty) FROM stock_slices s WHERE s.item_id = p.item_id AND s.warehouse_id = p.warehouse_id AND s.stock_status = 'QUALITY_INSPECTION'),0)::text AS qi,
      COALESCE((SELECT sum(s.qty) FROM stock_slices s WHERE s.item_id = p.item_id AND s.warehouse_id = p.warehouse_id AND s.stock_status = 'BLOCKED'),0)::text AS blocked,
      COALESCE((SELECT b.reserved_qty FROM stock_balances b WHERE b.item_id = p.item_id AND b.warehouse_id = p.warehouse_id),0)::text AS reserved,
      COALESCE((SELECT sum(h.qty) FROM stock_holds h WHERE h.item_id = p.item_id AND h.warehouse_id = p.warehouse_id AND h.status = 'Active'),0)::text AS held,
      COALESCE((SELECT sum(r.required_qty - r.fulfilled_qty) FROM stock_reservations r WHERE r.item_id = p.item_id AND r.warehouse_id = p.warehouse_id AND r.status IN ${OPEN_RESERVATION}),0)::text AS demand,
      COALESCE((SELECT sum(r.reserved_qty) FROM stock_reservations r WHERE r.item_id = p.item_id AND r.warehouse_id = p.warehouse_id AND r.status IN ${OPEN_RESERVATION}),0)::text AS allocated,
      (SELECT string_agg(DISTINCT bt.batch_no, ', ') FROM stock_slices s JOIN batches bt ON bt.id = s.batch_id
        WHERE s.item_id = p.item_id AND s.warehouse_id = p.warehouse_id AND s.qty > 0) AS batches,
      (SELECT string_agg(DISTINCT bn.code, ', ') FROM stock_slices s JOIN wms_bins bn ON bn.id = s.bin_id
        WHERE s.item_id = p.item_id AND s.warehouse_id = p.warehouse_id AND s.qty > 0) AS bins,
      (SELECT max(l.posted_at) FROM stock_ledger l WHERE l.item_id = p.item_id AND l.warehouse_id = p.warehouse_id) AS last_movement
    FROM unnest(${itemIds}::uuid[], ${whIds}::uuid[]) AS p(item_id, warehouse_id)`;
  for (const r of rows) {
    const unrestricted = n(r.unrestricted);
    const reserved = n(r.reserved);
    const held = n(r.held);
    const demand = n(r.demand);
    const allocated = n(r.allocated);
    out.set(`${r.item_id}_${r.warehouse_id}`, {
      itemId: r.item_id,
      warehouseId: r.warehouse_id,
      unrestricted,
      qualityInspection: n(r.qi),
      blocked: n(r.blocked),
      reserved,
      held,
      available: Math.max(0, round3(unrestricted - reserved - held)),
      demand,
      allocated,
      short: Math.max(0, round3(demand - allocated)),
      batches: r.batches,
      bins: r.bins,
      lastMovement: r.last_movement ? r.last_movement.toISOString() : null,
    });
  }
  return out;
}

export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface ItemStat {
  itemId: string;
  onHand: number;
  value: number;
  reserved: number;
  held: number;
  blocked: number;
  available: number;
  demand: number;
  allocated: number;
  short: number;
  location: string | null;
  warehouses: number;
}

/** Stock of whole items over the warehouses the caller may see (item master columns of Planning / Stock Policy). */
export async function itemStats(caller: Caller, itemIds: readonly string[]): Promise<Map<string, ItemStat>> {
  const out = new Map<string, ItemStat>();
  if (itemIds.length === 0) return out;
  // unpaginated: bounded by the page of items the caller passes in
  const bal = await prisma.$queryRaw<
    { item_id: string; warehouse_id: string; wh_code: string; on_hand: string; value: string }[]
  >`
    SELECT b.item_id::text, b.warehouse_id::text, w.code AS wh_code, b.on_hand::text, b.value::text
    FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
    WHERE b.item_id = ANY(${[...itemIds]}::uuid[]) AND ${scopeSql(caller)}`;
  const stats = await pairStats(bal.map((b) => ({ itemId: b.item_id, warehouseId: b.warehouse_id })));
  for (const id of itemIds) {
    out.set(id, {
      itemId: id,
      onHand: 0,
      value: 0,
      reserved: 0,
      held: 0,
      blocked: 0,
      available: 0,
      demand: 0,
      allocated: 0,
      short: 0,
      location: null,
      warehouses: 0,
    });
  }
  const where = new Map<string, string[]>();
  for (const b of bal) {
    const s = out.get(b.item_id);
    const p = stats.get(`${b.item_id}_${b.warehouse_id}`);
    if (!s || !p) continue;
    s.onHand = round3(s.onHand + n(b.on_hand));
    s.value = Math.round((s.value + n(b.value)) * 100) / 100;
    s.reserved = round3(s.reserved + p.reserved);
    s.held = round3(s.held + p.held);
    s.blocked = round3(s.blocked + p.blocked);
    s.available = round3(s.available + p.available);
    s.demand = round3(s.demand + p.demand);
    s.allocated = round3(s.allocated + p.allocated);
    s.short = round3(s.short + p.short);
    if (n(b.on_hand) > 0) {
      s.warehouses += 1;
      const list = where.get(b.item_id) ?? [];
      list.push(p.bins ? `${b.wh_code} / ${p.bins}` : b.wh_code);
      where.set(b.item_id, list);
    }
  }
  for (const [id, list] of where) {
    const s = out.get(id);
    if (s) s.location = list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
  }
  return out;
}

/** Demand / allocation of one item in one warehouse, used by the Allocate button. */
export async function reservedFor(itemId: string, warehouseId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(reserved_qty,0)::text AS q FROM stock_balances
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  return n(rows[0]?.q);
}
