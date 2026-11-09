// Phase 13 pure rules (no database): BOM explosion with scrap, cycle detection, MRP netting, the quantity rules of an
// operation, FG receipt limits, cost arithmetic and the job-work balances. Nothing here knows a lead time, a lot size or a
// safety stock: the spec names none, so MRP is lot-for-lot over the chosen date range (see PHASE-13-REPORT).
import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
type DecValue = Prisma.Decimal.Value;
export const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);
const ZERO = D(0);
export const round3 = (v: Dec): Dec => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
const ceil3 = (v: Dec): Dec => v.toDecimalPlaces(3, Prisma.Decimal.ROUND_UP);
export const round2 = (v: Dec): Dec => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export interface BomLine {
  itemId: string;
  qtyPer: string;
  scrapPct: string;
}
export interface Bom {
  itemId: string;
  baseQty: string;
  lines: BomLine[];
}

/** Quantity of one component for `parentQty` of the parent: qty per base quantity, plus the scrap allowance, rounded up. */
export function componentQty(parentQty: DecValue, baseQty: DecValue, line: BomLine): Dec {
  const base = D(baseQty);
  if (base.lte(0)) return ZERO;
  return ceil3(
    D(parentQty)
      .div(base)
      .mul(D(line.qtyPer))
      .mul(D(1).plus(D(line.scrapPct).div(100))),
  );
}
/** The item ids of a loop in the bill-of-materials graph (A needs B needs A), or null. */
export function findCycle(boms: Map<string, Bom>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 2) return null;
    if (s === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const l of boms.get(id)?.lines ?? []) {
      const c = visit(l.itemId);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of boms.keys()) {
    const c = visit(id);
    if (c) return c;
  }
  return null;
}

/** Flat requirement of an order: every direct component with its scrap allowance. */
export function orderMaterials(
  qty: DecValue,
  bom: Bom,
): { itemId: string; requiredQty: string; scrapPct: string }[] {
  return bom.lines.map((l) => ({
    itemId: l.itemId,
    requiredQty: componentQty(qty, bom.baseQty, l).toFixed(3),
    scrapPct: l.scrapPct,
  }));
}

// ------------------------------------------------------------------------------------------------ MRP
export interface Demand {
  itemId: string;
  qty: string;
  date: string;
  type: 'SALES_ORDER' | 'FORECAST' | 'ORDER';
  ref: string;
}
export type Bucket = 'DAY' | 'WEEK' | 'MONTH' | 'RANGE';
export interface Receipt {
  qty: string;
  /** the date the supply is due; null = already available */
  date: string | null;
}
export interface MrpInput {
  demands: Demand[];
  /** active BOM by produced item */
  boms: Map<string, Bom>;
  /** items the customer supplies: never bought, never produced by MRP */
  customerSupplied: Set<string>;
  onHand: Map<string, string>;
  /** open purchase-order lines, open requisition lines and open production orders, per item, with their due dates */
  scheduled: Map<string, Receipt[]>;
  bucket: Bucket;
  /** first day of the range: earlier dates fall into the first bucket */
  rangeStart: string;
}
export interface MrpLine {
  itemId: string;
  level: number;
  /** first day of the time bucket this line belongs to */
  bucketStart: string;
  action: 'PRODUCE' | 'BUY' | 'NONE' | 'CUSTOMER';
  gross: string;
  /** projected stock at the start of the bucket (real stock in the first one, left-over supply after) */
  onHand: string;
  /** supply that arrives in this bucket */
  scheduled: string;
  net: string;
  needDate: string | null;
  sources: { type: string; ref: string; qty: string; date: string | null }[];
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const atDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
/** First day of the bucket that holds `date`; dates before the range start belong to the first bucket. */
export function bucketStart(date: string, bucket: Bucket, rangeStart: string): string {
  const d = date < rangeStart ? rangeStart : date;
  if (bucket === 'RANGE') return rangeStart;
  if (bucket === 'DAY') return d;
  if (bucket === 'MONTH') return `${d.slice(0, 7)}-01`;
  const x = atDay(d);
  const back = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - back);
  return isoDay(x);
}

/**
 * Net requirements, level by level and bucket by bucket. Gross demand of an item in a bucket = independent demand (sales
 * orders, forecasts, material still to be drawn by open orders) + the components that the net production of its parents in
 * the same bucket needs. Stock and receipts that arrive up to a bucket cover the demand of that bucket; what is left over
 * carries into the next one. Net = what is still missing. An item with an active BOM is produced (its net quantity explodes
 * into its components), an item without one is bought, a customer-supplied item is only reported. No lead time is applied:
 * a component is needed in the bucket of the parent.
 */
export function planMrp(input: MrpInput): MrpLine[] {
  const cyc = findCycle(input.boms);
  if (cyc) throw new Error(`BOM_CYCLE:${cyc.join('>')}`);
  // low-level code: the deepest level at which an item appears
  const level = new Map<string, number>();
  const raise = (id: string, lv: number, seen: string[]) => {
    if ((level.get(id) ?? -1) >= lv) return;
    level.set(id, lv);
    if (seen.includes(id)) return;
    for (const l of input.boms.get(id)?.lines ?? []) raise(l.itemId, lv + 1, [...seen, id]);
  };
  for (const d of input.demands) raise(d.itemId, 0, []);
  const items = [...level.keys()].sort(
    (a, b) => level.get(a)! - level.get(b)! || a.localeCompare(b),
  );
  const b0 = (date: string) => bucketStart(date, input.bucket, input.rangeStart);
  interface Cell {
    gross: Dec;
    date: string | null;
    sources: MrpLine['sources'];
  }
  const need = new Map<string, Map<string, Cell>>();
  const add = (id: string, qty: Dec, date: string, src: MrpLine['sources'][number]) => {
    const m = need.get(id) ?? new Map<string, Cell>();
    const key = b0(date);
    const c = m.get(key) ?? { gross: ZERO, date: null, sources: [] };
    c.gross = c.gross.plus(qty);
    if (!c.date || date < c.date) c.date = date;
    c.sources.push(src);
    m.set(key, c);
    need.set(id, m);
  };
  for (const d of input.demands) {
    if (D(d.qty).lte(0)) continue;
    add(d.itemId, D(d.qty), d.date, {
      type: d.type,
      ref: d.ref,
      qty: D(d.qty).toFixed(3),
      date: d.date,
    });
  }
  const out: MrpLine[] = [];
  for (const id of items) {
    const cells = need.get(id) ?? new Map<string, Cell>();
    // receipts by bucket (no date = available from the first bucket)
    const receipts = new Map<string, Dec>();
    for (const r of input.scheduled.get(id) ?? []) {
      const key = b0(r.date ?? input.rangeStart);
      receipts.set(key, (receipts.get(key) ?? ZERO).plus(r.qty));
    }
    const keys = [...new Set([...cells.keys(), ...receipts.keys()])].sort();
    if (keys.length === 0) continue;
    let avail = D(input.onHand.get(id) ?? 0);
    const bom = input.boms.get(id);
    for (const key of keys) {
      const cell = cells.get(key);
      const arriving = receipts.get(key) ?? ZERO;
      const before = avail;
      avail = avail.plus(arriving);
      const g = round3(cell?.gross ?? ZERO);
      avail = avail.minus(g);
      let netQty = ZERO;
      if (avail.lt(0)) {
        netQty = round3(avail.negated());
        avail = ZERO;
      }
      if (!cell) continue; // supply arrives, nobody needs it in this bucket
      const action: MrpLine['action'] = input.customerSupplied.has(id)
        ? 'CUSTOMER'
        : netQty.isZero()
          ? 'NONE'
          : bom
            ? 'PRODUCE'
            : 'BUY';
      out.push({
        itemId: id,
        level: level.get(id)!,
        bucketStart: key,
        action,
        gross: g.toFixed(3),
        onHand: round3(before).toFixed(3),
        scheduled: round3(arriving).toFixed(3),
        net: netQty.toFixed(3),
        needDate: cell.date,
        sources: cell.sources,
      });
      if (action === 'PRODUCE' && bom) {
        for (const l of bom.lines) {
          const q = componentQty(netQty, bom.baseQty, l);
          add(l.itemId, q, cell.date ?? key, {
            type: 'BOM',
            ref: id,
            qty: q.toFixed(3),
            date: cell.date,
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.level - b.level || a.bucketStart.localeCompare(b.bucketStart));
}

// ------------------------------------------------------------------------------------------------ capacity
export interface LoadOp {
  orderId: string;
  orderNo: string;
  opId: string;
  seq: number;
  workCentreId: string;
  /** minutes of work still to do */
  minutes: number;
  /** the order's due date and the earliest day it can start */
  due: string;
  start: string;
}
export interface Capacity {
  /** minutes per working day, by work centre */
  perDay: Map<string, number>;
  /** days of the week that are worked, 0 = Sunday */
  workDays: Set<number>;
}
export interface LoadResult {
  ops: {
    opId: string;
    orderId: string;
    workCentreId: string;
    start: string | null;
    finish: string | null;
  }[];
  orders: { orderId: string; orderNo: string; due: string; finish: string | null; late: boolean }[];
  /** minutes planned, by work centre and day */
  days: { workCentreId: string; day: string; load: number; capacity: number }[];
}
/**
 * Forward finite loading: orders in due-date order, the operations of an order one after the other, each filling the
 * work centre's free minutes day by day. No holiday calendar is applied (Phase 15 owns calendars): only the weekdays given.
 */
export function scheduleLoad(
  ops: LoadOp[],
  cap: Capacity,
  from: string,
  horizonDays = 120,
): LoadResult {
  const used = new Map<string, number>();
  const res: LoadResult = { ops: [], orders: [], days: [] };
  const end = (() => {
    const x = atDay(from);
    x.setUTCDate(x.getUTCDate() + horizonDays);
    return isoDay(x);
  })();
  const nextDay = (d: string): string => {
    const x = atDay(d);
    x.setUTCDate(x.getUTCDate() + 1);
    return isoDay(x);
  };
  const orders = new Map<string, LoadOp[]>();
  for (const o of ops) orders.set(o.orderId, [...(orders.get(o.orderId) ?? []), o]);
  const ordered = [...orders.values()].sort(
    (a, b) => a[0]!.due.localeCompare(b[0]!.due) || a[0]!.orderNo.localeCompare(b[0]!.orderNo),
  );
  for (const list of ordered) {
    list.sort((a, b) => a.seq - b.seq);
    let cursor = list[0]!.start < from ? from : list[0]!.start;
    let finish: string | null = cursor;
    for (const op of list) {
      const perDay = cap.perDay.get(op.workCentreId) ?? 0;
      let remaining = op.minutes;
      let day = cursor;
      let first: string | null = null;
      let last: string | null = null;
      if (remaining <= 0) {
        res.ops.push({
          opId: op.opId,
          orderId: op.orderId,
          workCentreId: op.workCentreId,
          start: cursor,
          finish: cursor,
        });
        continue;
      }
      while (remaining > 0 && day <= end) {
        if (cap.workDays.has(atDay(day).getUTCDay()) && perDay > 0) {
          const k = `${op.workCentreId}|${day}`;
          const free = perDay - (used.get(k) ?? 0);
          if (free > 0) {
            const take = Math.min(free, remaining);
            used.set(k, (used.get(k) ?? 0) + take);
            remaining -= take;
            first ??= day;
            last = day;
          }
        }
        if (remaining > 0) day = nextDay(day);
      }
      if (remaining > 0) {
        res.ops.push({
          opId: op.opId,
          orderId: op.orderId,
          workCentreId: op.workCentreId,
          start: first,
          finish: null,
        });
        finish = null;
        break;
      }
      res.ops.push({
        opId: op.opId,
        orderId: op.orderId,
        workCentreId: op.workCentreId,
        start: first,
        finish: last,
      });
      cursor = last ?? cursor;
      finish = last;
    }
    res.orders.push({
      orderId: list[0]!.orderId,
      orderNo: list[0]!.orderNo,
      due: list[0]!.due,
      finish,
      late: finish === null || finish > list[0]!.due,
    });
  }
  for (const [k, load] of used) {
    const [workCentreId, day] = k.split('|') as [string, string];
    res.days.push({ workCentreId, day, load, capacity: cap.perDay.get(workCentreId) ?? 0 });
  }
  res.days.sort(
    (a, b) => a.day.localeCompare(b.day) || a.workCentreId.localeCompare(b.workCentreId),
  );
  return res;
}

// ------------------------------------------------------------------------------------------------ operations
export interface OpState {
  /** pieces that reached this operation: the order quantity for the first, the previous operation's good pieces after */
  input: string;
  qtyDone: string;
  qtyScrap: string;
  qtyRework: string;
}
/** Pieces still unaccounted for at an operation. */
export function opRemaining(s: OpState): Dec {
  return D(s.input).minus(s.qtyDone).minus(s.qtyScrap).minus(s.qtyRework);
}
/** What a new log line may add: good + scrap + rework cannot exceed the pieces that are left. */
export function logErrors(
  s: OpState,
  add: { good: string; scrap: string; rework: string },
): Record<string, string> {
  const errs: Record<string, string> = {};
  const sum = D(add.good).plus(add.scrap).plus(add.rework);
  const rem = opRemaining(s);
  if (sum.gt(rem))
    errs.qtyGood = `Only ${rem.toFixed(3)} pieces are left at this operation (good + scrap + rework).`;
  return errs;
}
/** An operation can be closed when every piece is a good, a scrapped one, and none is out for rework. */
export function opClosable(s: OpState): string | null {
  if (D(s.qtyRework).gt(0)) return 'Finish the rework first.';
  if (!opRemaining(s).isZero())
    return `${opRemaining(s).toFixed(3)} pieces are not accounted for. Log them as good or scrap.`;
  return null;
}
/** An operation that needs an inspection may only close with the pieces the Usage Decisions accepted. */
export function inspectionBlocks(
  required: boolean,
  sheets: { status: string; acceptedQty: string | null }[],
  qtyDone: DecValue,
): string | null {
  if (!required || D(qtyDone).lte(0)) return null;
  if (sheets.length === 0)
    return 'This operation needs an inspection. Create the inspection sheet and enter the readings first.';
  if (sheets.some((s) => s.status !== 'Decided'))
    return 'An inspection sheet has no Usage Decision yet. The order cannot move on before it.';
  const accepted = sheets.reduce((a2, s) => a2.plus(D(s.acceptedQty ?? 0)), ZERO);
  if (accepted.lt(D(qtyDone)))
    return `The inspections accepted ${accepted.toFixed(3)} of ${D(qtyDone).toFixed(3)} pieces. Move the rejected pieces to scrap or rework.`;
  return null;
}
/** Pieces that may still be put into a final-inspection lot. */
export function lotRoom(completed: string, lotted: string): Dec {
  const r = D(completed).minus(lotted);
  return r.gt(0) ? r : ZERO;
}
/** Pieces a decided lot lets into finished-goods stock. */
export function lotReceivable(lot: {
  status: string;
  acceptedQty: string | null;
  receivedQty: string;
}): Dec {
  if (lot.status !== 'Decided') return ZERO;
  const r = D(lot.acceptedQty ?? 0).minus(lot.receivedQty);
  return r.gt(0) ? r : ZERO;
}

// ------------------------------------------------------------------------------------------------ cost (figures only)
export function materialCost(m: { issuedValue: string; returnedValue: string }): Dec {
  return D(m.issuedValue).minus(m.returnedValue);
}
/** Machine / labour cost of logged minutes at the work centre's hourly rate. */
export function conversionCost(minutes: DecValue, costPerHour: DecValue): Dec {
  return round2(D(minutes).div(60).mul(D(costPerHour)));
}
/** Unit rate of finished goods: material cost carried by the good pieces (scrap cost stays on them). Zero with no good pieces. */
export function fgUnitRate(materialValue: DecValue, goodQty: DecValue): Dec {
  const q = D(goodQty);
  return q.lte(0) ? ZERO : D(materialValue).div(q).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}

// ------------------------------------------------------------------------------------------------ job work
export function jwBalances(poQty: string, inward: string, outward: string) {
  const po = D(poQty);
  const inw = D(inward);
  const out = D(outward);
  const open = po.minus(out);
  return {
    poQty: po.toFixed(3),
    inwardQty: inw.toFixed(3),
    outwardQty: out.toFixed(3),
    openQty: (open.gt(0) ? open : ZERO).toFixed(3),
    heldQty: inw.minus(out).toFixed(3),
  };
}
export const reworkBalance = (challanQty: string, done: string): string => {
  const b = D(challanQty).minus(done);
  return (b.gt(0) ? b : ZERO).toFixed(3);
};
