// The stock posting engine (docs/phase3-4 C1/C2): one function writes a ledger entry and updates the
// balance of (item, warehouse) in the CALLER's transaction, with SELECT ... FOR UPDATE on the balance
// row so concurrent movements queue up. Moving-average valuation: an inflow adds qty x rate, an
// outflow leaves at the current average rate; stock can never go negative (409 INSUFFICIENT_STOCK).
// A reversal undoes a ledger row exactly (same quantity and value, opposite direction).
import { randomUUID } from 'node:crypto';
import { Errors } from '../../../core/http/errors';
import type { Db } from '../../../core/db/prisma';
import { D, ZERO, round2, round6, str } from '../money';
import type { Dec } from '../money';

export type LedgerVoucherType =
  | 'OPENING'
  | 'RECEIPT'
  | 'ISSUE'
  | 'ADJUSTMENT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'REVERSAL';

export interface Balance {
  onHand: Dec;
  value: Dec;
  avgRate: Dec;
}

interface BalanceRow {
  on_hand: string;
  value: string;
  avg_rate: string;
}

const toBalance = (r: BalanceRow | undefined): Balance =>
  r ? { onHand: D(r.on_hand), value: D(r.value), avgRate: D(r.avg_rate) } : zeroBalance();

const zeroBalance = (): Balance => ({ onHand: ZERO, value: ZERO, avgRate: ZERO });

/** Current balance without locking (previews, lists). */
export async function readBalance(db: Db, itemId: string, warehouseId: string): Promise<Balance> {
  const rows = await db.$queryRaw<BalanceRow[]>`
    SELECT on_hand::text, value::text, avg_rate::text FROM stock_balances
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`;
  return toBalance(rows[0]);
}

export async function lockBalance(db: Db, itemId: string, warehouseId: string): Promise<Balance> {
  await db.$executeRaw`
    INSERT INTO stock_balances (item_id, warehouse_id, on_hand, value, avg_rate)
    VALUES (${itemId}::uuid, ${warehouseId}::uuid, 0, 0, 0)
    ON CONFLICT (item_id, warehouse_id) DO NOTHING`;
  const rows = await db.$queryRaw<BalanceRow[]>`
    SELECT on_hand::text, value::text, avg_rate::text FROM stock_balances
    WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid FOR UPDATE`;
  return toBalance(rows[0]);
}

export interface Movement {
  unitId: string;
  warehouseId: string;
  itemId: string;
  postingDate: string;
  voucherType: LedgerVoucherType;
  voucherId: string;
  voucherNo: string;
  createdById: string;
  /** Exactly one of qtyIn / qtyOut. */
  qtyIn?: Dec;
  qtyOut?: Dec;
  /** Inflow: the unit cost. Ignored for outflows (they leave at the moving average). */
  rate?: Dec;
  /** Inflow only: use this exact value instead of qty x rate (reversals, transfer receipts). */
  value?: Dec;
  /** Outflow only: leave at this exact value and rate (reversals of an inflow). */
  outValue?: Dec;
  outRate?: Dec;
  reversesId?: string;
}

export interface PostedEntry {
  id: string;
  qty: Dec;
  rate: Dec;
  /** Absolute value of the entry. */
  value: Dec;
  balance: Balance;
}

export const insufficientStock = (available: Dec, wanted: Dec) =>
  Errors.insufficientStock(`Not enough stock: ${str(available)} on hand, ${str(wanted)} needed.`);

/** Writes one ledger entry and updates the balance. Must run inside a transaction. */
export async function postMovement(db: Db, m: Movement): Promise<PostedEntry> {
  const before = await lockBalance(db, m.itemId, m.warehouseId);
  const inflow = m.qtyIn !== undefined && m.qtyIn.greaterThan(0);
  const qty = inflow ? (m.qtyIn ?? ZERO) : (m.qtyOut ?? ZERO);
  if (qty.lessThanOrEqualTo(0)) throw new Error('postMovement needs a positive quantity');

  let entryValue: Dec;
  let rate: Dec;
  let onHand: Dec;
  let value: Dec;
  if (inflow) {
    rate = m.rate ?? ZERO;
    entryValue = m.value ?? round2(qty.times(rate));
    onHand = before.onHand.plus(qty);
    value = before.value.plus(entryValue);
  } else {
    if (qty.greaterThan(before.onHand)) throw insufficientStock(before.onHand, qty);
    onHand = before.onHand.minus(qty);
    if (onHand.isZero()) {
      // The last unit takes the whole remaining value, so nothing is left behind.
      entryValue = before.value;
      rate = m.outRate ?? (qty.isZero() ? ZERO : round6(before.value.div(qty)));
    } else {
      rate = m.outRate ?? before.avgRate;
      entryValue = m.outValue ?? round2(qty.times(rate));
    }
    value = before.value.minus(entryValue);
  }
  const avgRate = onHand.greaterThan(0) ? round6(value.div(onHand)) : ZERO;
  const id = randomUUID();
  const signedValue = inflow ? entryValue : entryValue.negated();
  await db.$executeRaw`
    INSERT INTO stock_ledger (id, posted_at, posting_date, unit_id, warehouse_id, item_id, qty_in, qty_out, rate, value,
      balance_qty, balance_value, voucher_type, voucher_id, voucher_no, reverses_id, created_by_id)
    VALUES (${id}::uuid, clock_timestamp(), ${m.postingDate}::date, ${m.unitId}::uuid, ${m.warehouseId}::uuid, ${m.itemId}::uuid,
      ${inflow ? str(qty) : '0'}::numeric, ${inflow ? '0' : str(qty)}::numeric, ${str(rate)}::numeric,
      ${str(signedValue)}::numeric, ${str(onHand)}::numeric, ${str(value)}::numeric, ${m.voucherType},
      ${m.voucherId}::uuid, ${m.voucherNo}, ${m.reversesId ?? null}::uuid, ${m.createdById}::uuid)`;
  await db.$executeRaw`
    UPDATE stock_balances SET on_hand = ${str(onHand)}::numeric, value = ${str(value)}::numeric,
      avg_rate = ${str(avgRate)}::numeric, updated_at = now()
    WHERE item_id = ${m.itemId}::uuid AND warehouse_id = ${m.warehouseId}::uuid`;
  return { id, qty, rate, value: entryValue, balance: { onHand, value, avgRate } };
}

export interface LedgerRow {
  id: string;
  unit_id: string;
  warehouse_id: string;
  item_id: string;
  qty_in: string;
  qty_out: string;
  rate: string;
  value: string;
  voucher_type: LedgerVoucherType;
  voucher_no: string;
}

/** The live (not yet reversed) entries a voucher wrote, oldest first. */
export function entriesOfVoucher(db: Db, voucherId: string): Promise<LedgerRow[]> {
  return db.$queryRaw<LedgerRow[]>`
    SELECT l.id, l.unit_id, l.warehouse_id, l.item_id, l.qty_in::text, l.qty_out::text, l.rate::text,
           l.value::text, l.voucher_type, l.voucher_no
    FROM stock_ledger l
    WHERE l.voucher_id = ${voucherId}::uuid AND l.voucher_type <> 'REVERSAL'
      AND NOT EXISTS (SELECT 1 FROM stock_ledger r WHERE r.reverses_id = l.id)
    ORDER BY l.posted_at ASC, l.id ASC`;
}

/** Undoes every live entry of a voucher with REVERSAL entries (newest first). */
export async function reverseVoucher(
  db: Db,
  voucherId: string,
  context: { voucherNo: string; postingDate: string; createdById: string },
): Promise<number> {
  const entries = (await entriesOfVoucher(db, voucherId)).reverse();
  for (const e of entries) {
    const qtyIn = D(e.qty_in);
    const qtyOut = D(e.qty_out);
    const absValue = D(e.value).abs();
    const base = {
      unitId: e.unit_id,
      warehouseId: e.warehouse_id,
      itemId: e.item_id,
      postingDate: context.postingDate,
      voucherType: 'REVERSAL' as const,
      voucherId,
      voucherNo: context.voucherNo,
      createdById: context.createdById,
      reversesId: e.id,
    };
    if (qtyIn.greaterThan(0)) {
      // The original was an inflow: take the same quantity and value back out.
      await postMovement(db, { ...base, qtyOut: qtyIn, outValue: absValue, outRate: D(e.rate) });
    } else {
      await postMovement(db, { ...base, qtyIn: qtyOut, rate: D(e.rate), value: absValue });
    }
  }
  return entries.length;
}

/** How many ledger rows (any voucher) touch this item in this warehouse. */
export async function countLedgerRows(
  db: Db,
  itemId: string,
  warehouseId?: string,
): Promise<number> {
  const rows = warehouseId
    ? await db.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM stock_ledger
        WHERE item_id = ${itemId}::uuid AND warehouse_id = ${warehouseId}::uuid`
    : await db.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM stock_ledger WHERE item_id = ${itemId}::uuid`;
  return rows[0]?.n ?? 0;
}
