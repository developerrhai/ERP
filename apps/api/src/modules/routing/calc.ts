// Phase 41 pure rules: route balance, yield, BOM shortage, short receipt split, movement type. No database here.
import { D, round3 } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { lineRequirement } from '../mfg/calc';

type Num = Dec | string | number;

/** Balance still to do on a route: planned - good - scrap (the job_card_routes generated column, same formula). */
export function routeBalance(planned: Num, good: Num, scrap: Num): Dec {
  return round3(D(planned).minus(D(good)).minus(D(scrap)));
}

/** Good / planned as a percentage with one decimal; null when nothing is planned. */
export function yieldPct(planned: Num, good: Num): string | null {
  const p = D(planned);
  if (p.lessThanOrEqualTo(0)) return null;
  return D(good).div(p).mul(100).toDecimalPlaces(1).toFixed(1);
}

/** Good + scrap may never exceed what was planned. Returns a message, or null when fine. */
export function routeQtyProblem(planned: Num, good: Num, scrap: Num): string | null {
  if (D(good).lessThan(0) || D(scrap).lessThan(0)) return 'Quantities cannot be negative.';
  if (routeBalance(planned, good, scrap).lessThan(0)) {
    return `Good + scrap (${round3(D(good).plus(D(scrap))).toFixed()}) is more than planned (${round3(D(planned)).toFixed()}).`;
  }
  return null;
}

/** Required quantity of one BOM line for `qty` finished pieces: the Phase 13 rule (qty / base x qty per base x conversion x (1 + scrap %)). */
export function bomRequired(qtyPer: Num, scrapPct: Num, qty: Num, baseQty: Num, conversion: Num = 1): Dec {
  return D(lineRequirement(String(qty), String(baseQty), { qtyPerBase: String(qtyPer), conversionFactor: String(conversion), scrapPct: String(scrapPct) }).toFixed());
}

/** Shortage = what is required beyond what the plant has (never below 0). 82.000 required, 60.000 available -> 22.000. */
export function shortageOf(required: Num, available: Num): Dec {
  const s = D(required).minus(D(available));
  return round3(s.lessThan(0) ? D(0) : s);
}

/** Short receipt: what arrived, what stays in transit. 100 sent, 96 received -> 4 short. */
export function receiptSplit(sent: Num, received: Num): { received: Dec; short: Dec } {
  const s = D(sent);
  const r = D(received);
  if (r.lessThan(0) || r.greaterThan(s)) throw new RangeError('Received quantity must be between 0 and the sent quantity.');
  return { received: round3(r), short: round3(s.minus(r)) };
}

/** A step to a different plant is a plant transfer; inside the same plant it is a process transfer. */
export function movementType(fromUnitId: string | null, toUnitId: string | null): 'Plant Transfer' | 'Process Transfer' | 'Final' {
  if (!toUnitId) return 'Final';
  return fromUnitId && fromUnitId !== toUnitId ? 'Plant Transfer' : 'Process Transfer';
}

/** Splits a received quantity over dispatch entries in order (first in, first received). */
export function allocateReceipt<T extends { qty: string }>(entries: T[], received: Num): { entry: T; qty: Dec }[] {
  let left = D(received);
  const out: { entry: T; qty: Dec }[] = [];
  for (const e of entries) {
    if (left.lessThanOrEqualTo(0)) break;
    const q = D(e.qty).lessThan(left) ? D(e.qty) : left;
    out.push({ entry: e, qty: q });
    left = left.minus(q);
  }
  return out;
}
