// StockService (Phase 8 step 3): the ONE entry point for moving stock. Every voucher, count, transfer and
// later module (GRN, delivery, production) calls this; nothing else writes stock_ledger.
//
// What it adds on top of the valuation core (posting.ts -> postCoreMovement):
//   * sorted locking   - balances are locked in (warehouse, item) order, so two postings never deadlock;
//   * slices           - quantity by batch / bin / status (stock_slices); they must add up to the balance;
//   * batches, FEFO    - a batch-tracked item is issued first-expiry-first-out, blocked / expired batches never;
//   * serials          - a serial-tracked item needs exactly qty unique serial numbers;
//   * Quality Inspection stock (client requirement 2) - received into QUALITY_INSPECTION, never issuable until
//                         a status change (Phase 12 Usage Decision) moves it to UNRESTRICTED or BLOCKED;
//   * reservations / holds / frozen warehouse / backdate guard (D-20) / in-transaction equality assertion.
// Decimal only. Posted ledger rows are never edited: a cancel is a reversal (reverseVoucher).
import { Errors } from '../../../core/http/errors';
import type { Db } from '../../../core/db/prisma';
import { D, ZERO, round3, str } from '../money';
import type { Dec } from '../money';
import {
  entriesOfVoucher,
  insufficientStock,
  lockBalance,
  postCoreMovement,
  reversalOf,
} from './posting';
import type { LedgerVoucherType, Movement, PostedEntry, StockStatus } from './posting';

export const NO_ID = '00000000-0000-0000-0000-000000000000';
const orNil = (v: string | null | undefined): string => v ?? NO_ID;

export interface BatchSpec {
  batchNo: string;
  mfgDate?: string | null;
  expiryDate?: string | null;
  supplierName?: string | null;
  grnRef?: string | null;
}

export interface StockMoveInput {
  warehouseId: string;
  itemId: string;
  direction: 'IN' | 'OUT';
  /** Base-UOM quantity, > 0. */
  qty: Dec;
  postingDate: string;
  voucherType: LedgerVoucherType;
  voucherId: string;
  voucherNo: string;
  createdById: string;
  lineId?: string | null;
  /** Inflow: unit cost, or the exact value (transfer receipts keep the dispatched value). */
  rate?: Dec;
  value?: Dec;
  batchId?: string | null;
  batch?: BatchSpec | null;
  serialNos?: string[] | null;
  binId?: string | null;
  /** Inflow status. Default: QUALITY_INSPECTION when the item needs QC, else UNRESTRICTED. */
  stockStatus?: StockStatus;
  /** Outflow: take from this status (default UNRESTRICTED). */
  fromStatus?: StockStatus;
  reasonCode?: string | null;
  /** Outflow at exactly this value / rate (a transit warehouse mixes transfers, so the average would misprice). */
  outValue?: Dec;
  outRate?: Dec;
  reservationId?: string | null;
  uom?: string | null;
  uomFactor?: Dec | null;
  /** Posting made by this count may enter a frozen warehouse. */
  countId?: string | null;
  /** The caller checked that the user has `approve` (D-20). */
  allowBackdate?: boolean;
  /** Adjustments / reconciliations may take reserved stock (the reservation is shortened) and expired/blocked batches. */
  corrective?: boolean;
}

export interface MoveResult {
  entries: (PostedEntry & { batchId: string | null; binId: string | null })[];
  /** Serial numbers moved. */
  serialNos: string[];
}

interface ItemRow {
  id: string;
  code: string;
  batch_tracked: boolean;
  serial_tracked: boolean;
  qc_required: boolean;
  shelf_life_days: number | null;
  status: string;
}

interface WarehouseRow {
  id: string;
  code: string;
  unit_id: string;
  status: string;
  frozen_by_count_id: string | null;
  is_transit: boolean;
}

interface SliceRow {
  batch_id: string;
  bin_id: string;
  qty: string;
  expiry_date: Date | null;
  created_at: Date | null;
  batch_no: string | null;
  qc_status: string | null;
  recalled: boolean | null;
  bin_code: string | null;
}

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}

// ---------------------------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------------------------
/** Locks the balance rows of all (warehouse, item) pairs in a fixed order, so concurrent postings queue instead of deadlock. */
export async function lockInOrder(
  tx: Db,
  pairs: { warehouseId: string; itemId: string }[],
): Promise<void> {
  const seen = new Set<string>();
  const sorted = pairs
    .filter((p) => {
      const k = `${p.warehouseId}|${p.itemId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) =>
      a.warehouseId === b.warehouseId
        ? a.itemId.localeCompare(b.itemId)
        : a.warehouseId.localeCompare(b.warehouseId),
    );
  for (const p of sorted) await lockBalance(tx, p.itemId, p.warehouseId);
}

// ---------------------------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------------------------
export async function applySlice(
  tx: Db,
  key: {
    itemId: string;
    warehouseId: string;
    batchId?: string | null;
    binId?: string | null;
    status: StockStatus;
  },
  delta: Dec,
): Promise<void> {
  // Insert the row at 0 first: a negative delta must never be the inserted value (the CHECK sees it before ON CONFLICT).
  await tx.$executeRaw`
    INSERT INTO stock_slices (item_id, warehouse_id, batch_id, bin_id, stock_status, qty)
    VALUES (${key.itemId}::uuid, ${key.warehouseId}::uuid, ${orNil(key.batchId)}::uuid,
            ${orNil(key.binId)}::uuid, ${key.status}, 0)
    ON CONFLICT (item_id, warehouse_id, batch_id, bin_id, stock_status) DO NOTHING`;
  await tx.$executeRaw`
    UPDATE stock_slices SET qty = qty + ${str(delta)}::numeric, updated_at = now()
    WHERE item_id = ${key.itemId}::uuid AND warehouse_id = ${key.warehouseId}::uuid AND batch_id = ${orNil(key.batchId)}::uuid
      AND bin_id = ${orNil(key.binId)}::uuid AND stock_status = ${key.status}`;
}

async function sliceTotal(tx: Db, itemId: string, warehouseId: string): Promise<Dec> {
  const r = await tx.$queryRaw<{ q: string | null }[]>`
    SELECT COALESCE(sum(qty), 0)::text AS q FROM stock_slices
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  return D(r[0]?.q ?? '0');
}

/** Slices that can be issued: UNRESTRICTED, batch released + not recalled + (unless corrective) not expired. */
async function issuableSlices(
  tx: Db,
  itemId: string,
  warehouseId: string,
  status: StockStatus,
  filter: { batchId?: string | null; binId?: string | null },
): Promise<SliceRow[]> {
  const batchF = filter.batchId ?? null;
  const binF = filter.binId ?? null;
  return tx.$queryRaw<SliceRow[]>`
    SELECT s.batch_id::text, s.bin_id::text, s.qty::text, b.expiry_date, b.created_at, b.batch_no,
           b.qc_status, b.recalled, w.code AS bin_code
    FROM stock_slices s
    LEFT JOIN batches b ON b.id = s.batch_id
    LEFT JOIN wms_bins w ON w.id = s.bin_id
    WHERE s.item_id = ${itemId}::uuid AND s.warehouse_id = ${warehouseId}::uuid
      AND s.stock_status = ${status} AND s.qty > 0
      AND (${batchF}::uuid IS NULL OR s.batch_id = ${batchF}::uuid)
      AND (${binF}::uuid IS NULL OR s.bin_id = ${binF}::uuid)
    ORDER BY b.expiry_date ASC NULLS LAST, b.created_at ASC NULLS LAST, b.batch_no ASC NULLS LAST,
             w.code ASC NULLS LAST`;
}

async function activeHolds(tx: Db, itemId: string, warehouseId: string): Promise<Dec> {
  const r = await tx.$queryRaw<{ q: string }[]>`
    SELECT COALESCE(sum(qty), 0)::text AS q FROM stock_holds
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid AND status = 'Active'`;
  return D(r[0]?.q ?? '0');
}

export interface Availability {
  onHand: Dec;
  unrestricted: Dec;
  qualityInspection: Dec;
  blocked: Dec;
  reserved: Dec;
  held: Dec;
  /** unrestricted - reserved - held (never negative). */
  available: Dec;
}

export async function availability(
  tx: Db,
  itemId: string,
  warehouseId: string,
): Promise<Availability> {
  const rows = await tx.$queryRaw<{ stock_status: StockStatus; q: string }[]>`
    SELECT stock_status, COALESCE(sum(qty),0)::text AS q FROM stock_slices
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid GROUP BY stock_status`;
  const by = (s: StockStatus): Dec => D(rows.find((r) => r.stock_status === s)?.q ?? '0');
  const bal = await tx.$queryRaw<{ on_hand: string; reserved_qty: string }[]>`
    SELECT on_hand::text, reserved_qty::text FROM stock_balances
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  const reserved = D(bal[0]?.reserved_qty ?? '0');
  const held = await activeHolds(tx, itemId, warehouseId);
  const unrestricted = by('UNRESTRICTED');
  const free = unrestricted.minus(reserved).minus(held);
  return {
    onHand: D(bal[0]?.on_hand ?? '0'),
    unrestricted,
    qualityInspection: by('QUALITY_INSPECTION'),
    blocked: by('BLOCKED'),
    reserved,
    held,
    available: free.greaterThan(0) ? free : ZERO,
  };
}

// ---------------------------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------------------------
async function resolveBatchForInflow(
  tx: Db,
  item: ItemRow,
  m: StockMoveInput,
  userId: string,
): Promise<string | null> {
  if (!item.batch_tracked) {
    if (m.batchId || m.batch) {
      throw Errors.validation({ batch: `Item ${item.code} is not batch-tracked.` });
    }
    return null;
  }
  if (m.batchId) {
    const b = await tx.batch.findFirst({ where: { id: m.batchId, itemId: item.id } });
    if (!b) throw Errors.validation({ batch: 'This batch does not belong to the item.' });
    return b.id;
  }
  const spec = m.batch;
  if (!spec || !spec.batchNo.trim()) {
    throw Errors.batchRequired(`Item ${item.code} is batch-tracked: enter a batch number.`);
  }
  const batchNo = spec.batchNo.trim();
  const existing = await tx.batch.findFirst({ where: { itemId: item.id, batchNo } });
  const mfg = spec.mfgDate || null;
  let expiry = spec.expiryDate || null;
  if (item.shelf_life_days && !mfg && !existing) {
    throw Errors.validation({
      mfgDate: `Item ${item.code} has a shelf life: enter the manufacturing date.`,
    });
  }
  if (!expiry && mfg && item.shelf_life_days) expiry = addDays(mfg, item.shelf_life_days);
  if (mfg && mfg > m.postingDate) {
    throw Errors.validation({
      mfgDate: 'The manufacturing date cannot be after the posting date.',
    });
  }
  if (mfg && expiry && expiry <= mfg) {
    throw Errors.validation({
      expiryDate: 'The expiry date must be after the manufacturing date.',
    });
  }
  if (expiry && expiry < m.postingDate && !m.corrective) {
    throw Errors.batchExpired(`Batch ${batchNo} expired on ${expiry}; it cannot be received.`);
  }
  if (existing) {
    // A batch is identified by item + number; its dates never change (BR-INV-08).
    if (mfg && existing.mfgDate && isoOf(existing.mfgDate) !== mfg) {
      throw Errors.conflict(`Batch ${batchNo} already exists with another manufacturing date.`);
    }
    if (expiry && existing.expiryDate && isoOf(existing.expiryDate) !== expiry) {
      throw Errors.conflict(`Batch ${batchNo} already exists with another expiry date.`);
    }
    return existing.id;
  }
  const created = await tx.batch.create({
    data: {
      itemId: item.id,
      batchNo,
      mfgDate: mfg ? new Date(`${mfg}T00:00:00Z`) : null,
      expiryDate: expiry ? new Date(`${expiry}T00:00:00Z`) : null,
      supplierName: spec.supplierName ?? null,
      grnRef: spec.grnRef ?? null,
      qcStatus: 'Released',
      createdById: userId,
    },
  });
  await tx.batchEvent.create({
    data: { batchId: created.id, event: 'CREATED', toValue: batchNo, createdById: userId },
  });
  return created.id;
}

// ---------------------------------------------------------------------------------------------
// Serial numbers
// ---------------------------------------------------------------------------------------------
function checkSerials(item: ItemRow, qty: Dec, serials: string[] | null | undefined): string[] {
  if (!item.serial_tracked) {
    if (serials && serials.length > 0) {
      throw Errors.validation({ serialNos: `Item ${item.code} is not serial-tracked.` });
    }
    return [];
  }
  if (!qty.isInteger()) {
    throw Errors.serialQtyMismatch(
      `Item ${item.code} is serial-tracked: the quantity must be a whole number.`,
    );
  }
  const list = (serials ?? []).map((s) => s.trim()).filter((s) => s !== '');
  if (list.length !== qty.toNumber()) {
    throw Errors.serialQtyMismatch(
      `Item ${item.code} needs exactly ${str(qty)} serial numbers; ${list.length} given.`,
    );
  }
  if (new Set(list).size !== list.length) {
    throw Errors.serialDuplicate('The same serial number is listed twice.');
  }
  return list;
}

async function serialEvent(
  tx: Db,
  serialId: string,
  event: string,
  warehouseId: string | null,
  m: { voucherId: string; voucherNo: string; createdById: string },
) {
  await tx.serialEvent.create({
    data: {
      serialId,
      event,
      warehouseId,
      voucherId: m.voucherId,
      voucherNo: m.voucherNo,
      createdById: m.createdById,
    },
  });
}

async function serialsIn(
  tx: Db,
  item: ItemRow,
  m: StockMoveInput,
  batchId: string | null,
  list: string[],
) {
  for (const sn of list) {
    const found = await tx.serialNumber.findUnique({
      where: { itemId_serialNo: { itemId: item.id, serialNo: sn } },
    });
    if (found) {
      // A returned serial may come back; anything else already exists.
      if (
        found.status === 'Issued' ||
        found.status === 'In Transit' ||
        found.status === 'Returned'
      ) {
        await tx.serialNumber.update({
          where: { id: found.id },
          data: {
            status: 'In Stock',
            warehouseId: m.warehouseId,
            lastMovementAt: new Date(),
            currentOwner: null,
          },
        });
        await serialEvent(
          tx,
          found.id,
          m.voucherType === 'TRANSFER_IN' ? 'RECEIVED' : 'RETURNED',
          m.warehouseId,
          m,
        );
        continue;
      }
      throw Errors.serialDuplicate(`Serial number ${sn} already exists for item ${item.code}.`);
    }
    const row = await tx.serialNumber.create({
      data: {
        itemId: item.id,
        serialNo: sn,
        warehouseId: m.warehouseId,
        batchId,
        status: 'In Stock',
        lastMovementAt: new Date(),
        createdById: m.createdById,
      },
    });
    await serialEvent(tx, row.id, 'RECEIVED', m.warehouseId, m);
  }
}

async function serialsOut(tx: Db, item: ItemRow, m: StockMoveInput, list: string[]) {
  const status =
    m.voucherType === 'TRANSFER_OUT'
      ? 'In Transit'
      : m.reasonCode && /damage|theft|loss/i.test(m.reasonCode)
        ? 'Scrapped'
        : 'Issued';
  for (const sn of list) {
    const found = await tx.serialNumber.findUnique({
      where: { itemId_serialNo: { itemId: item.id, serialNo: sn } },
    });
    if (
      !found ||
      found.warehouseId !== m.warehouseId ||
      !['In Stock', 'Reserved'].includes(found.status)
    ) {
      throw Errors.serialNotInStock(`Serial number ${sn} is not in stock in this warehouse.`);
    }
    await tx.serialNumber.update({
      where: { id: found.id },
      data: { status, lastMovementAt: new Date() },
    });
    await serialEvent(
      tx,
      found.id,
      status === 'In Transit' ? 'DISPATCHED' : status === 'Scrapped' ? 'SCRAPPED' : 'ISSUED',
      m.warehouseId,
      m,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------------------------
export function reservationStatus(reserved: Dec, fulfilled: Dec, required: Dec): string {
  if (fulfilled.greaterThanOrEqualTo(required)) return 'Fulfilled';
  if (reserved.isZero()) return 'Waiting';
  return reserved.plus(fulfilled).greaterThanOrEqualTo(required) ? 'Reserved' : 'Partial';
}

/** After stock arrives or is released: serve Waiting / Partial reservations in priority order (BR-INV-17). */
export async function runAllocator(tx: Db, itemId: string, warehouseId: string): Promise<void> {
  const a = await availability(tx, itemId, warehouseId);
  let free = a.available;
  if (free.lessThanOrEqualTo(0)) return;
  const open = await tx.$queryRaw<
    { id: string; required_qty: string; reserved_qty: string; fulfilled_qty: string }[]
  >`
    SELECT id, required_qty::text, reserved_qty::text, fulfilled_qty::text FROM stock_reservations
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid AND status IN ('Waiting','Partial')
    ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
             reserved_until ASC NULLS LAST, created_at ASC, code ASC
    FOR UPDATE`;
  let given = ZERO;
  for (const r of open) {
    if (free.lessThanOrEqualTo(0)) break;
    const need = D(r.required_qty).minus(D(r.reserved_qty)).minus(D(r.fulfilled_qty));
    const take = need.lessThan(free) ? need : free;
    if (take.lessThanOrEqualTo(0)) continue;
    const reserved = D(r.reserved_qty).plus(take);
    const status = reservationStatus(reserved, D(r.fulfilled_qty), D(r.required_qty));
    await tx.$executeRaw`
      UPDATE stock_reservations SET reserved_qty = ${str(reserved)}::numeric, status = ${status},
        version = version + 1, updated_at = now() WHERE id = ${r.id}::uuid`;
    free = free.minus(take);
    given = given.plus(take);
  }
  if (given.greaterThan(0)) {
    await tx.$executeRaw`
      UPDATE stock_balances SET reserved_qty = reserved_qty + ${str(given)}::numeric
      WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  }
}

/** BR-INV-19: lower reservations (lowest priority, newest first) until reserved <= the new on-hand. */
async function shortenReservations(tx: Db, itemId: string, warehouseId: string, newOnHand: Dec) {
  const bal = await tx.$queryRaw<{ reserved_qty: string }[]>`
    SELECT reserved_qty::text FROM stock_balances
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  let excess = D(bal[0]?.reserved_qty ?? '0').minus(newOnHand.greaterThan(0) ? newOnHand : ZERO);
  if (excess.lessThanOrEqualTo(0)) return;
  const rows = await tx.$queryRaw<
    { id: string; reserved_qty: string; required_qty: string; fulfilled_qty: string }[]
  >`
    SELECT id, reserved_qty::text, required_qty::text, fulfilled_qty::text FROM stock_reservations
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid AND reserved_qty > 0
    ORDER BY CASE priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END DESC,
             created_at DESC FOR UPDATE`;
  let removed = ZERO;
  for (const r of rows) {
    if (excess.lessThanOrEqualTo(0)) break;
    const have = D(r.reserved_qty);
    const cut = have.lessThan(excess) ? have : excess;
    const left = have.minus(cut);
    const status = reservationStatus(left, D(r.fulfilled_qty), D(r.required_qty));
    await tx.$executeRaw`
      UPDATE stock_reservations SET reserved_qty = ${str(left)}::numeric, status = ${status},
        version = version + 1, updated_at = now() WHERE id = ${r.id}::uuid`;
    excess = excess.minus(cut);
    removed = removed.plus(cut);
  }
  if (removed.greaterThan(0)) {
    await tx.$executeRaw`
      UPDATE stock_balances SET reserved_qty = reserved_qty - ${str(removed)}::numeric
      WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  }
}

async function consumeReservation(tx: Db, reservationId: string, qty: Dec): Promise<Dec> {
  const rows = await tx.$queryRaw<
    {
      reserved_qty: string;
      fulfilled_qty: string;
      required_qty: string;
      item_id: string;
      warehouse_id: string;
      status: string;
    }[]
  >`
    SELECT reserved_qty::text, fulfilled_qty::text, required_qty::text, item_id::text, warehouse_id::text, status
    FROM stock_reservations WHERE id = ${reservationId}::uuid FOR UPDATE`;
  const r = rows[0];
  if (!r) throw Errors.notFound('Reservation not found.');
  if (!['Reserved', 'Partial'].includes(r.status)) {
    throw Errors.conflict(`A ${r.status} reservation cannot be issued against.`);
  }
  const fromReservation = D(r.reserved_qty).lessThan(qty) ? D(r.reserved_qty) : qty;
  const reserved = D(r.reserved_qty).minus(fromReservation);
  const fulfilled = D(r.fulfilled_qty).plus(fromReservation);
  const status = reservationStatus(reserved, fulfilled, D(r.required_qty));
  await tx.$executeRaw`
    UPDATE stock_reservations SET reserved_qty = ${str(reserved)}::numeric, fulfilled_qty = ${str(fulfilled)}::numeric,
      status = ${status}, version = version + 1, updated_at = now() WHERE id = ${reservationId}::uuid`;
  await tx.$executeRaw`
    UPDATE stock_balances SET reserved_qty = reserved_qty - ${str(fromReservation)}::numeric
    WHERE item_id = ${r.item_id}::uuid AND warehouse_id = ${r.warehouse_id}::uuid`;
  return fromReservation;
}

// ---------------------------------------------------------------------------------------------
// The movement
// ---------------------------------------------------------------------------------------------
async function loadItem(tx: Db, itemId: string): Promise<ItemRow> {
  const r = await tx.$queryRaw<ItemRow[]>`
    SELECT id::text, code, batch_tracked, serial_tracked, qc_required, shelf_life_days, status::text AS status
    FROM items WHERE id = ${itemId}::uuid AND deleted_at IS NULL`;
  if (!r[0]) throw Errors.notFound('Item not found.');
  return r[0];
}

async function loadWarehouse(tx: Db, id: string): Promise<WarehouseRow> {
  const r = await tx.$queryRaw<WarehouseRow[]>`
    SELECT id::text, code, unit_id::text, status::text AS status, frozen_by_count_id::text, is_transit
    FROM warehouses WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  if (!r[0]) throw Errors.notFound('Warehouse not found.');
  return r[0];
}

async function assertNotBackdated(tx: Db, m: StockMoveInput) {
  if (m.allowBackdate) return;
  const r = await tx.$queryRaw<{ d: Date | null }[]>`
    SELECT max(posting_date) AS d FROM stock_ledger
    WHERE item_id = ${m.itemId}::uuid AND warehouse_id = ${m.warehouseId}::uuid`;
  const last = r[0]?.d ? isoOf(r[0].d) : null;
  if (last && m.postingDate < last) {
    throw Errors.backdatedPosting(
      `The last movement of this item here is dated ${last}; a posting dated ${m.postingDate} needs a user with approve rights.`,
    );
  }
}

export const StockService = {
  availability,
  runAllocator,
  lockInOrder,

  /** Posts a list of movements; locks first (sorted), then posts in the given order. */
  async postMany(tx: Db, moves: StockMoveInput[]): Promise<MoveResult[]> {
    await lockInOrder(tx, moves);
    const out: MoveResult[] = [];
    for (const m of moves) out.push(await StockService.postMovement(tx, m));
    return out;
  },

  async postMovement(tx: Db, m: StockMoveInput): Promise<MoveResult> {
    if (m.qty.lessThanOrEqualTo(0)) {
      throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    }
    const qty = round3(m.qty);
    const [item, wh] = await Promise.all([
      loadItem(tx, m.itemId),
      loadWarehouse(tx, m.warehouseId),
    ]);
    if (item.status !== 'ACTIVE' && !m.corrective) {
      throw Errors.validation({ item: `Item ${item.code} is inactive.` });
    }
    if (wh.status !== 'ACTIVE' && m.voucherType !== 'REVERSAL') {
      throw Errors.validation({ warehouse: `Warehouse ${wh.code} is inactive.` });
    }
    if (wh.frozen_by_count_id && wh.frozen_by_count_id !== m.countId) {
      throw Errors.warehouseFrozen(`Warehouse ${wh.code} is frozen for a physical count.`);
    }
    await lockInOrder(tx, [m]);
    await assertNotBackdated(tx, m);
    if (item.batch_tracked && item.serial_tracked) {
      throw Errors.trackingConflict(`Item ${item.code} is both batch- and serial-tracked.`);
    }
    const serials = checkSerials(item, qty, m.serialNos);
    const result: MoveResult = { entries: [], serialNos: serials };

    if (m.direction === 'IN') {
      const batchId = await resolveBatchForInflow(tx, item, { ...m, qty }, m.createdById);
      const status: StockStatus =
        m.stockStatus ??
        (item.qc_required && m.voucherType === 'RECEIPT' ? 'QUALITY_INSPECTION' : 'UNRESTRICTED');
      if (m.binId) await assertBin(tx, m.binId, m.warehouseId);
      const e = await postCoreMovement(tx, {
        unitId: wh.unit_id,
        warehouseId: m.warehouseId,
        itemId: m.itemId,
        postingDate: m.postingDate,
        voucherType: m.voucherType,
        voucherId: m.voucherId,
        voucherNo: m.voucherNo,
        createdById: m.createdById,
        qtyIn: qty,
        rate: m.rate,
        value: m.value,
        batchId,
        binId: m.binId ?? null,
        stockStatus: status,
        lineId: m.lineId ?? null,
        uom: m.uom ?? null,
        uomFactor: m.uomFactor ?? null,
        reasonCode: m.reasonCode ?? null,
      });
      await applySlice(
        tx,
        { itemId: m.itemId, warehouseId: m.warehouseId, batchId, binId: m.binId, status },
        qty,
      );
      if (item.serial_tracked) await serialsIn(tx, item, m, batchId, serials);
      result.entries.push({ ...e, batchId, binId: m.binId ?? null });
      if (status === 'UNRESTRICTED') await runAllocator(tx, m.itemId, m.warehouseId);
      return result;
    }

    // ---- outflow ----
    const from: StockStatus = m.fromStatus ?? 'UNRESTRICTED';
    if (m.batch && !m.batchId) {
      const b = await tx.batch.findFirst({
        where: { itemId: m.itemId, batchNo: m.batch.batchNo.trim() },
      });
      if (!b)
        throw Errors.validation({
          batch: `Batch ${m.batch.batchNo} does not exist for item ${item.code}.`,
        });
      m = { ...m, batchId: b.id };
    }
    const a = await availability(tx, m.itemId, m.warehouseId);
    if (!m.reservationId && !m.corrective) {
      if (qty.greaterThan(a.available)) {
        if (qty.lessThanOrEqualTo(a.unrestricted)) {
          throw Errors.stockReserved(
            `Only ${str(a.available)} available (${str(a.reserved)} reserved, ${str(a.held)} on hold).`,
          );
        }
        if (a.qualityInspection.greaterThan(0) || a.blocked.greaterThan(0)) {
          throw Errors.insufficientStock(
            `Not enough usable stock: ${str(a.unrestricted)} unrestricted; ${str(a.qualityInspection)} is in Quality Inspection and ${str(a.blocked)} is blocked.`,
          );
        }
        throw insufficientStock(a.unrestricted, qty);
      }
    }
    const slices = await issuableSlices(tx, m.itemId, m.warehouseId, from, {
      batchId: m.batchId,
      binId: m.binId,
    });
    const today = m.postingDate;
    const usable = slices.filter((s) => {
      if (s.batch_id === NO_ID) return true;
      if (m.corrective) return true;
      if (s.qc_status !== 'Released' || s.recalled) return false;
      if (s.expiry_date && isoOf(s.expiry_date) < today) return false;
      return true;
    });
    if (
      item.batch_tracked &&
      !m.batchId &&
      usable.length < slices.length &&
      sumQty(usable).lessThan(qty)
    ) {
      // Stock exists but only in blocked / expired batches.
      const bad = slices.find((s) => !usable.includes(s));
      if (bad?.expiry_date && isoOf(bad.expiry_date) < today)
        throw Errors.batchExpired(`Batch ${bad.batch_no} has expired.`);
      throw Errors.batchBlocked(`Batch ${bad?.batch_no ?? ''} is ${bad?.qc_status ?? 'blocked'}.`);
    }
    if (m.batchId && slices.length > 0 && usable.length === 0) {
      const bad = slices[0];
      if (bad?.expiry_date && isoOf(bad.expiry_date) < today)
        throw Errors.batchExpired(`Batch ${bad.batch_no} has expired.`);
      throw Errors.batchBlocked(`Batch ${bad?.batch_no ?? ''} is ${bad?.qc_status ?? 'blocked'}.`);
    }
    // Greedy FEFO allocation.
    let remaining = qty;
    const takes: { batchId: string | null; binId: string | null; qty: Dec }[] = [];
    for (const s of usable) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const have = D(s.qty);
      const take = have.lessThan(remaining) ? have : remaining;
      takes.push({
        batchId: s.batch_id === NO_ID ? null : s.batch_id,
        binId: s.bin_id === NO_ID ? null : s.bin_id,
        qty: take,
      });
      remaining = remaining.minus(take);
    }
    if (remaining.greaterThan(0)) {
      throw insufficientStock(sumQty(usable), qty);
    }
    // BR-INV-19: a corrective outflow may not leave reserved > on hand.
    const bal = await lockBalance(tx, m.itemId, m.warehouseId);
    if (m.corrective) await shortenReservations(tx, m.itemId, m.warehouseId, bal.onHand.minus(qty));
    if (m.reservationId) await consumeReservation(tx, m.reservationId, qty);
    for (const t of takes) {
      const e = await postCoreMovement(tx, {
        unitId: wh.unit_id,
        warehouseId: m.warehouseId,
        itemId: m.itemId,
        postingDate: m.postingDate,
        voucherType: m.voucherType,
        voucherId: m.voucherId,
        voucherNo: m.voucherNo,
        createdById: m.createdById,
        qtyOut: t.qty,
        ...(m.outValue && takes.length === 1 ? { outValue: m.outValue, outRate: m.outRate } : {}),
        batchId: t.batchId,
        binId: t.binId,
        stockStatus: from,
        lineId: m.lineId ?? null,
        uom: m.uom ?? null,
        uomFactor: m.uomFactor ?? null,
        reasonCode: m.reasonCode ?? null,
      });
      await applySlice(
        tx,
        {
          itemId: m.itemId,
          warehouseId: m.warehouseId,
          batchId: t.batchId,
          binId: t.binId,
          status: from,
        },
        t.qty.negated(),
      );
      result.entries.push({ ...e, batchId: t.batchId, binId: t.binId });
    }
    if (item.serial_tracked) await serialsOut(tx, item, m, serials);
    return result;
  },

  /**
   * Cancel: undo every live ledger row of a voucher with REVERSAL rows dated `postingDate` (the cancel date),
   * newest first. Slices, serials and the balance follow. Stock that has since been used makes this fail with
   * INSUFFICIENT_STOCK (the user must first undo the later movements).
   */
  async reverseVoucher(
    tx: Db,
    voucherId: string,
    ctx: {
      voucherNo: string;
      postingDate: string;
      createdById: string;
      serialsByLine?: Map<string, string[]>;
    },
  ): Promise<
    {
      id: string;
      original: string;
      qty: Dec;
      value: Dec;
      inflow: boolean;
      itemId: string;
      warehouseId: string;
      unitId: string;
    }[]
  > {
    const rows = (await entriesOfVoucher(tx, voucherId)).reverse();
    await lockInOrder(
      tx,
      rows.map((r) => ({ warehouseId: r.warehouse_id, itemId: r.item_id })),
    );
    const done: {
      id: string;
      original: string;
      qty: Dec;
      value: Dec;
      inflow: boolean;
      itemId: string;
      warehouseId: string;
      unitId: string;
    }[] = [];
    for (const e of rows) {
      const mv: Movement = reversalOf(e, {
        voucherId,
        voucherNo: ctx.voucherNo,
        postingDate: ctx.postingDate,
        createdById: ctx.createdById,
      });
      const wasInflow = D(e.qty_in).greaterThan(0);
      const qty = wasInflow ? D(e.qty_in) : D(e.qty_out);
      if (wasInflow) {
        // Taking an inflow back: the stock must still be there, in the slice it entered (and not reserved away).
        const bal = await lockBalance(tx, e.item_id, e.warehouse_id);
        await shortenReservations(tx, e.item_id, e.warehouse_id, bal.onHand.minus(qty));
        const sl = await tx.$queryRaw<{ q: string }[]>`
          SELECT qty::text AS q FROM stock_slices
          WHERE item_id = ${e.item_id}::uuid AND warehouse_id = ${e.warehouse_id}::uuid AND batch_id = ${orNil(e.batch_id)}::uuid
            AND bin_id = ${orNil(e.bin_id)}::uuid AND stock_status = ${e.stock_status}`;
        const have = D(sl[0]?.q ?? '0');
        if (have.lessThan(qty)) {
          throw Errors.insufficientStock(
            `Cannot cancel: only ${str(have)} of the ${str(qty)} received is still in this ${e.stock_status.toLowerCase().replace('_', ' ')} stock. Reverse the later movements first.`,
          );
        }
      }
      const posted = await postCoreMovement(tx, mv);
      await applySlice(
        tx,
        {
          itemId: e.item_id,
          warehouseId: e.warehouse_id,
          batchId: e.batch_id,
          binId: e.bin_id,
          status: e.stock_status,
        },
        wasInflow ? qty.negated() : qty,
      );
      done.push({
        id: posted.id,
        original: e.id,
        qty,
        value: posted.value,
        inflow: !wasInflow,
        itemId: e.item_id,
        warehouseId: e.warehouse_id,
        unitId: e.unit_id,
      });
      if (!wasInflow) await runAllocator(tx, e.item_id, e.warehouse_id);
      // Serials follow the line.
      const list = e.line_id ? ctx.serialsByLine?.get(e.line_id) : undefined;
      if (list && list.length > 0)
        await reverseSerials(tx, e.item_id, list, wasInflow, voucherId, ctx);
    }
    return done;
  },

  /** QUALITY_INSPECTION -> UNRESTRICTED / BLOCKED (Phase 12 Usage Decision calls this). Value is unchanged. */
  async changeStatus(
    tx: Db,
    p: {
      warehouseId: string;
      itemId: string;
      qty: Dec;
      batchId?: string | null;
      binId?: string | null;
      from: StockStatus;
      to: StockStatus;
      postingDate: string;
      voucherId: string;
      voucherNo: string;
      createdById: string;
    },
  ): Promise<void> {
    if (p.from === p.to) throw Errors.validation({ status: 'Choose a different status.' });
    const wh = await loadWarehouse(tx, p.warehouseId);
    await lockInOrder(tx, [p]);
    const sl = await tx.$queryRaw<{ q: string }[]>`
      SELECT qty::text AS q FROM stock_slices
      WHERE item_id = ${p.itemId}::uuid AND warehouse_id = ${p.warehouseId}::uuid AND batch_id = ${orNil(p.batchId)}::uuid
        AND bin_id = ${orNil(p.binId)}::uuid AND stock_status = ${p.from}`;
    if (D(sl[0]?.q ?? '0').lessThan(p.qty)) {
      throw Errors.insufficientStock(
        `Only ${sl[0]?.q ?? '0'} is in ${p.from.toLowerCase().replace('_', ' ')} status.`,
      );
    }
    const common = {
      unitId: wh.unit_id,
      warehouseId: p.warehouseId,
      itemId: p.itemId,
      postingDate: p.postingDate,
      voucherType: 'STATUS_CHANGE' as const,
      voucherId: p.voucherId,
      voucherNo: p.voucherNo,
      createdById: p.createdById,
      batchId: p.batchId ?? null,
      binId: p.binId ?? null,
    };
    const out = await postCoreMovement(tx, { ...common, qtyOut: p.qty, stockStatus: p.from });
    await postCoreMovement(tx, {
      ...common,
      qtyIn: p.qty,
      rate: out.rate,
      value: out.value,
      stockStatus: p.to,
    });
    await applySlice(
      tx,
      {
        itemId: p.itemId,
        warehouseId: p.warehouseId,
        batchId: p.batchId,
        binId: p.binId,
        status: p.from,
      },
      p.qty.negated(),
    );
    await applySlice(
      tx,
      {
        itemId: p.itemId,
        warehouseId: p.warehouseId,
        batchId: p.batchId,
        binId: p.binId,
        status: p.to,
      },
      p.qty,
    );
    if (p.to === 'UNRESTRICTED') await runAllocator(tx, p.itemId, p.warehouseId);
  },

  /**
   * In-transaction equality assertion (INV-3): for every touched (item, warehouse) the slices add up to the balance,
   * and the balance equals the last ledger row. A mismatch is a defect: throw, so the whole transaction rolls back.
   */
  async assertEquality(tx: Db, pairs: { warehouseId: string; itemId: string }[]): Promise<void> {
    const seen = new Set<string>();
    for (const p of pairs) {
      const k = `${p.warehouseId}|${p.itemId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const [bal, slices, last] = await Promise.all([
        tx.$queryRaw<{ on_hand: string; value: string }[]>`
          SELECT on_hand::text, value::text FROM stock_balances WHERE item_id = ${p.itemId}::uuid AND warehouse_id = ${p.warehouseId}::uuid`,
        sliceTotal(tx, p.itemId, p.warehouseId),
        tx.$queryRaw<{ balance_qty: string; balance_value: string }[]>`
          SELECT balance_qty::text, balance_value::text FROM stock_ledger
          WHERE item_id = ${p.itemId}::uuid AND warehouse_id = ${p.warehouseId}::uuid ORDER BY posted_at DESC, id DESC LIMIT 1`,
      ]);
      const onHand = D(bal[0]?.on_hand ?? '0');
      const value = D(bal[0]?.value ?? '0');
      if (!slices.equals(onHand)) {
        throw new Error(
          `Stock integrity: slices ${str(slices)} != on hand ${str(onHand)} (item ${p.itemId}, warehouse ${p.warehouseId})`,
        );
      }
      if (
        last[0] &&
        (!D(last[0].balance_qty).equals(onHand) || !D(last[0].balance_value).equals(value))
      ) {
        throw new Error(
          `Stock integrity: ledger running balance != stock_balances (item ${p.itemId}, warehouse ${p.warehouseId})`,
        );
      }
    }
  },
};

const sumQty = (rows: SliceRow[]): Dec => rows.reduce((a, r) => a.plus(D(r.qty)), ZERO);

async function assertBin(tx: Db, binId: string, warehouseId: string) {
  const b = await tx.wmsBin.findFirst({ where: { id: binId, deletedAt: null } });
  if (!b || b.warehouseId !== warehouseId) {
    throw Errors.validation({ bin: 'This bin does not belong to the warehouse.' });
  }
  if (b.status !== 'Active') throw Errors.binBlocked(`Bin ${b.code} is inactive.`);
}

async function reverseSerials(
  tx: Db,
  itemId: string,
  list: string[],
  originalWasInflow: boolean,
  voucherId: string,
  ctx: { voucherNo: string; createdById: string },
) {
  for (const sn of list) {
    const s = await tx.serialNumber.findUnique({
      where: { itemId_serialNo: { itemId, serialNo: sn } },
    });
    if (!s) continue;
    await tx.serialNumber.update({
      where: { id: s.id },
      data: originalWasInflow
        ? { status: 'Scrapped', warehouseId: null, lastMovementAt: new Date() }
        : { status: 'In Stock', lastMovementAt: new Date(), currentOwner: null },
    });
    await tx.serialEvent.create({
      data: {
        serialId: s.id,
        event: 'CANCELLED',
        warehouseId: s.warehouseId,
        voucherId,
        voucherNo: ctx.voucherNo,
        createdById: ctx.createdById,
      },
    });
  }
}
