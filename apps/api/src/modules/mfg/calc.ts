// Phase 13 (spec section 5) pure calculators: multi-level BOM explosion with phantoms, effectivity and units of measure, low-level
// codes, time-phased MRP netting with safety stock / lot sizing / lead time, OEE, FG unit cost and variances. No database, no
// floating point: every number is a Decimal and results are rounded half-up as the spec says.
import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
type V = Prisma.Decimal.Value;
export const D = (v: V): Dec => new Prisma.Decimal(v);
const ZERO = D(0);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
export const r3 = (v: Dec): Dec => v.toDecimalPlaces(3, HALF_UP);
export const r2 = (v: Dec): Dec => v.toDecimalPlaces(2, HALF_UP);
export const r4 = (v: Dec): Dec => v.toDecimalPlaces(4, HALF_UP);

// ------------------------------------------------------------------------------------------------ BOM explosion
export interface BomLineIn {
  itemId: string;
  qtyPerBase: string;
  conversionFactor: string;
  scrapPct: string;
  isPhantom: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  issueMethod: 'MANUAL' | 'BACKFLUSH';
  operationSeq: number | null;
}
export interface BomIn {
  itemId: string;
  baseQty: string;
  lines: BomLineIn[];
}
export interface Requirement {
  itemId: string;
  qty: string;
  issueMethod: 'MANUAL' | 'BACKFLUSH';
  operationSeq: number | null;
}
const valid = (
  l: { effectiveFrom: string | null; effectiveTo: string | null },
  date: string,
): boolean =>
  (!l.effectiveFrom || l.effectiveFrom <= date) && (!l.effectiveTo || l.effectiveTo >= date);

/** The required quantity of one line: qty / base x qty per base x conversion x (1 + scrap %), 3 decimals half-up. */
export function lineRequirement(
  qty: V,
  baseQty: V,
  l: Pick<BomLineIn, 'qtyPerBase' | 'conversionFactor' | 'scrapPct'>,
): Dec {
  const base = D(baseQty);
  if (base.lte(0)) return ZERO;
  return r3(
    D(qty)
      .div(base)
      .mul(D(l.qtyPerBase))
      .mul(D(l.conversionFactor))
      .mul(D(1).plus(D(l.scrapPct).div(100))),
  );
}

/**
 * Explodes `qty` of an item into purchased / made components on `date`. Phantom lines explode straight through (they are never
 * required themselves); a component that has its own released BOM and is not phantom is a real sub-assembly and stays a
 * requirement. A loop is reported with its path.
 */
export function explode(
  item: string,
  qty: V,
  date: string,
  boms: Map<string, BomIn>,
  stack: string[] = [],
): Requirement[] {
  if (stack.includes(item)) throw new Error(`BOM_CYCLE:${[...stack, item].join(' > ')}`);
  const bom = boms.get(item);
  if (!bom) return [];
  const out = new Map<string, Requirement>();
  const add = (r: Requirement) => {
    const key = `${r.itemId}|${r.issueMethod}|${r.operationSeq ?? ''}`;
    const cur = out.get(key);
    out.set(key, cur ? { ...cur, qty: D(cur.qty).plus(r.qty).toFixed(3) } : r);
  };
  for (const l of bom.lines) {
    if (!valid(l, date)) continue;
    const need = lineRequirement(qty, bom.baseQty, l);
    if (l.isPhantom) {
      for (const r of explode(l.itemId, need, date, boms, [...stack, item])) add(r);
    } else
      add({
        itemId: l.itemId,
        qty: need.toFixed(3),
        issueMethod: l.issueMethod,
        operationSeq: l.operationSeq,
      });
  }
  return [...out.values()];
}

/** A loop anywhere in the released BOMs: the path of item ids, or null. */
export function detectCycle(boms: Map<string, BomIn>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 2) return null;
    if (s === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const l of boms.get(id)?.lines ?? []) {
      const c = visit(l.itemId);
      if (c) return c;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of boms.keys()) {
    const c = visit(id);
    if (c) return c;
  }
  return null;
}

/** Low-level codes: 0 for end items, llc = max(parent llc + 1) for components. Breadth-first from every BOM root. */
export function lowLevelCodes(boms: Map<string, BomIn>): Map<string, number> {
  const cyc = detectCycle(boms);
  if (cyc) throw new Error(`BOM_CYCLE:${cyc.join(' > ')}`);
  const llc = new Map<string, number>();
  const isChild = new Set<string>();
  for (const b of boms.values()) for (const l of b.lines) isChild.add(l.itemId);
  const queue: [string, number][] = [];
  for (const id of boms.keys()) if (!isChild.has(id)) queue.push([id, 0]);
  while (queue.length) {
    const [id, lv] = queue.shift()!;
    if ((llc.get(id) ?? -1) >= lv) continue;
    llc.set(id, lv);
    for (const l of boms.get(id)?.lines ?? []) queue.push([l.itemId, lv + 1]);
  }
  return llc;
}

// ------------------------------------------------------------------------------------------------ MRP (spec section 5)
export type LotSizing = 'LFL' | 'FIXED' | 'EOQ';
export interface Planning {
  leadTimeDays: number;
  safetyStock: string;
  lotSizing: LotSizing;
  fixedLotQty: string | null;
  minOrderQty: string | null;
  orderMultiple: string | null;
  eoq: string | null;
}
/** lot-for-lot / fixed lots / EOQ, then the minimum order quantity and the order multiple. */
export function lotSize(
  net: V,
  p: Pick<Planning, 'lotSizing' | 'fixedLotQty' | 'minOrderQty' | 'orderMultiple' | 'eoq'>,
): Dec {
  let q = D(net);
  if (q.lte(0)) return ZERO;
  if (p.lotSizing === 'FIXED' && p.fixedLotQty && D(p.fixedLotQty).gt(0))
    q = D(p.fixedLotQty).mul(q.div(p.fixedLotQty).ceil());
  else if (p.lotSizing === 'EOQ' && p.eoq) q = Prisma.Decimal.max(q, D(p.eoq));
  if (p.minOrderQty && D(p.minOrderQty).gt(q)) q = D(p.minOrderQty);
  if (p.orderMultiple && D(p.orderMultiple).gt(0))
    q = D(p.orderMultiple).mul(q.div(p.orderMultiple).ceil());
  return r3(q);
}

export interface BucketDemand {
  bucket: string;
  gross: string;
  receipts: string;
}
export interface BucketRow {
  bucket: string;
  gross: string;
  receipts: string;
  pohBefore: string;
  net: string;
  plannedReceipt: string;
  pohAfter: string;
  releaseDate: string | null;
  pastDueRelease: boolean;
}
const addDays = (iso: string, d: number): string => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};
/**
 * One item over its buckets: POH = previous POH + receipts - gross; below the safety stock the shortfall is a net requirement,
 * ordered in lots; the release date is the due date minus the lead time (a release before `today` is past due).
 */
export function mrpNet(
  onHand: V,
  buckets: BucketDemand[],
  p: Planning,
  today: string,
): BucketRow[] {
  let poh = D(onHand);
  const ss = D(p.safetyStock);
  const rows: BucketRow[] = [];
  for (const b of [...buckets].sort((a, c) => a.bucket.localeCompare(c.bucket))) {
    poh = poh.plus(b.receipts).minus(b.gross);
    const pohBefore = poh;
    let net = ZERO;
    let planned = ZERO;
    if (poh.lt(ss)) {
      net = r3(ss.minus(poh));
      planned = lotSize(net, p);
      poh = poh.plus(planned);
    }
    const release = planned.gt(0) ? addDays(b.bucket, -p.leadTimeDays) : null;
    rows.push({
      bucket: b.bucket,
      gross: D(b.gross).toFixed(3),
      receipts: D(b.receipts).toFixed(3),
      pohBefore: r3(pohBefore).toFixed(3),
      net: net.toFixed(3),
      plannedReceipt: planned.toFixed(3),
      pohAfter: r3(poh).toFixed(3),
      releaseDate: release,
      pastDueRelease: release !== null && release < today,
    });
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ OEE, FG cost, variances
export interface OeeInput {
  shiftMinutes: V;
  plannedDowntimeMinutes: V;
  unplannedDowntimeMinutes: V;
  idealCycleMinutes: V;
  totalPieces: V;
  goodPieces: V;
}
export function oee(i: OeeInput): {
  availability: string;
  performance: string;
  quality: string;
  oee: string;
  cycleTimeSuspect: boolean;
} {
  const planned = D(i.shiftMinutes).minus(i.plannedDowntimeMinutes);
  const run = planned.minus(i.unplannedDowntimeMinutes);
  const a = planned.gt(0) ? run.div(planned) : ZERO;
  let p = run.gt(0) ? D(i.idealCycleMinutes).mul(i.totalPieces).div(run) : ZERO;
  const suspect = p.gt(1);
  if (suspect) p = D(1);
  const q = D(i.totalPieces).gt(0) ? D(i.goodPieces).div(i.totalPieces) : ZERO;
  const o = a.mul(p).mul(q);
  return {
    availability: a.toDecimalPlaces(4, HALF_UP).toFixed(4),
    performance: p.toDecimalPlaces(4, HALF_UP).toFixed(4),
    quality: q.toDecimalPlaces(4, HALF_UP).toFixed(4),
    oee: o.toDecimalPlaces(4, HALF_UP).toFixed(4),
    cycleTimeSuspect: suspect,
  };
}

/** FG cost = material + labour + overhead - abnormal scrap - recovery, spread over the cumulative good quantity. */
export function fgCost(c: {
  material: V;
  labour: V;
  overhead: V;
  abnormalScrap: V;
  recovery: V;
  goodQty: V;
}): { total: string; unitCost: string } {
  const total = r2(
    D(c.material).plus(c.labour).plus(c.overhead).minus(c.abnormalScrap).minus(c.recovery),
  );
  const q = D(c.goodQty);
  return { total: total.toFixed(2), unitCost: q.gt(0) ? r2(total.div(q)).toFixed(2) : '0.00' };
}

export function variances(v: {
  actualQty: V;
  standardQty: V;
  standardRate: V;
  actualRate: V;
  actualHours: V;
  standardHours: V;
  hourRate: V;
  standardInput: V;
  actualOutput: V;
}) {
  return {
    materialUsage: r2(D(v.actualQty).minus(v.standardQty).mul(v.standardRate)).toFixed(2),
    materialPrice: r2(D(v.actualQty).mul(D(v.actualRate).minus(v.standardRate))).toFixed(2),
    efficiency: r2(D(v.actualHours).minus(v.standardHours).mul(v.hourRate)).toFixed(2),
    yield: D(v.actualOutput).gt(0)
      ? r4(D(v.standardInput).div(v.actualOutput)).toFixed(4)
      : '0.0000',
  };
}

/** Labour or overhead absorbed by logged hours at a work-centre rate. */
export const absorbed = (hours: V, rate: V): Dec => r2(D(hours).mul(rate));

/** Share of the order's WIP that a receipt takes: the last piece takes the exact balance, so WIP ends at zero. */
export function wipShare(wipBalance: V, receiveQty: V, goodQtyLeft: V): Dec {
  const left = D(goodQtyLeft);
  if (left.lte(0)) return ZERO;
  const q = D(receiveQty);
  return q.gte(left) ? r2(D(wipBalance)) : r2(D(wipBalance).mul(q).div(left));
}
