// Phase 14 pure calculators (no database): Schedule II book depreciation (SLM / WDV, pro-rata by days, extra-shift factor),
// the AS 10 cost of an asset, the Income-tax block WDV with the half-rate rule, and the GST s.18(6) amount on a sale of capital
// goods. Decimal throughout; the numbers of the spec's rules are inputs, never constants here (rates and lives are data).
import { Prisma } from '@prisma/client';

export type Dec = Prisma.Decimal;
type V = string | number | Dec;
export const D = (v: V): Dec => new Prisma.Decimal(v);
export const r2 = (v: Dec): Dec => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const ZERO = D(0);

const DAY = 86_400_000;
const ms = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
/** Days from a to b, both included. */
export const daysIncl = (a: string, b: string): number => Math.round((ms(b) - ms(a)) / DAY) + 1;
export const addMonths = (iso: string, m: number): string => {
  const d = new Date(ms(iso));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
export const addDays = (iso: string, n: number): string =>
  new Date(ms(iso) + n * DAY).toISOString().slice(0, 10);
export const monthBounds = (period: string): { from: string; to: string } => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return {
    from: `${period}-01`,
    to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  };
};
const daysInYearOf = (iso: string): number => {
  const y = Number(iso.slice(0, 4));
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
};

/** Residual value may not exceed 5 % of cost without a written reason (Schedule II). */
export const MAX_RESIDUAL_PCT = 5;

export interface BookDepInput {
  cost: V;
  residual: V;
  method: 'SLM' | 'WDV';
  lifeMonths: number;
  depStart: string;
  from: string;
  to: string;
  openingAccum: V;
  /** 1 for a normal month; see shiftFactor() */
  shiftFactor?: V;
}
export interface BookDepResult {
  amount: Dec;
  days: number;
  base: Dec;
  /** WDV: the yearly rate that takes cost to residual over the life; SLM: the yearly percentage of the depreciable amount */
  rate: Dec;
}

/** Depreciation of one asset for the dates from..to (both included), never taking the book value below the residual. */
export function bookDepreciation(i: BookDepInput): BookDepResult {
  const cost = D(i.cost);
  const residual = D(i.residual);
  const opening = D(i.openingAccum);
  const factor = D(i.shiftFactor ?? 1);
  if (cost.lte(0)) return { amount: ZERO, days: 0, base: ZERO, rate: ZERO };
  const lifeEnd = addDays(addMonths(i.depStart, i.lifeMonths), -1);
  const start = i.from > i.depStart ? i.from : i.depStart;
  const end = i.to < lifeEnd ? i.to : lifeEnd;
  const days = end >= start ? daysIncl(start, end) : 0;
  const room = cost.minus(residual).minus(opening);
  if (days === 0 || room.lte(0)) {
    return { amount: ZERO, days, base: cost.minus(residual), rate: ZERO };
  }
  let amount: Dec;
  let base: Dec;
  let rate: Dec;
  if (i.method === 'SLM') {
    base = cost.minus(residual);
    const lifeDays = daysIncl(i.depStart, lifeEnd);
    amount = base.mul(days).div(lifeDays).mul(factor);
    rate = base
      .div(i.lifeMonths / 12)
      .div(cost)
      .mul(100);
  } else {
    if (residual.lte(0)) throw new Error('WDV_NEEDS_RESIDUAL');
    const years = i.lifeMonths / 12;
    const r = D(1).minus(Prisma.Decimal.pow(residual.div(cost), D(1).div(years)));
    base = cost.minus(opening);
    amount = base.mul(r).mul(days).div(daysInYearOf(end)).mul(factor);
    rate = r.mul(100);
  }
  amount = r2(amount);
  if (amount.gt(room)) amount = r2(room);
  return { amount, days, base: r2(base), rate: rate.toDecimalPlaces(4) };
}

/** Extra shift (Schedule II): plant and machinery unless NESD, +50 % for double-shift days and +100 % for triple. */
export function shiftFactor(
  cls: string,
  nesd: boolean,
  usage: { single: number; double: number; triple: number } | null,
  periodDays: number,
): Dec {
  if (cls !== 'PM' || nesd || !usage || periodDays <= 0) return D(1);
  const dbl = Math.min(usage.double, periodDays);
  const tri = Math.min(usage.triple, periodDays - dbl);
  const plain = periodDays - dbl - tri;
  return D(plain).plus(D(dbl).mul(1.5)).plus(D(tri).mul(2)).div(periodDays).toDecimalPlaces(4);
}

export interface CostLine {
  component: string;
  amount: V;
  gst?: V;
  /** GST that is part of the cost (not claimed) */
  gstInCost?: boolean;
}
/** AS 10: price (without claimed GST) + freight + installation + testing + professional fees. GST is added only when not claimed. */
export function capitalCost(
  lines: CostLine[],
  itcEligible: boolean,
): { cost: Dec; itcClaim: Dec; gstCapitalised: Dec } {
  let cost = ZERO;
  let itc = ZERO;
  let cap = ZERO;
  for (const l of lines) {
    const amt = D(l.amount);
    const gst = D(l.gst ?? 0);
    cost = cost.plus(amt);
    if (gst.gt(0)) {
      if (!itcEligible || l.gstInCost) {
        cost = cost.plus(gst);
        cap = cap.plus(gst);
      } else itc = itc.plus(gst);
    }
  }
  return { cost: r2(cost), itcClaim: r2(itc), gstCapitalised: r2(cap) };
}

/** A block addition put to use in fewer than 180 days of the year gets half rate. */
export const isHalfRate = (putToUse: string, fyEnd: string): boolean =>
  daysIncl(putToUse, fyEnd) < 180;

export interface BlockInput {
  opening: V;
  addGe180: V;
  addLt180: V;
  deletions: V;
  ratePct: V;
}
/** WDV of a block: opening + additions - sale proceeds; depreciation on the whole, half rate on the late additions. */
export function blockDepreciation(i: BlockInput): { depreciation: Dec; closing: Dec } {
  const opening = D(i.opening);
  const ge = D(i.addGe180);
  const lt = D(i.addLt180);
  const del = D(i.deletions);
  const rate = D(i.ratePct).div(100);
  const fullBase = Prisma.Decimal.max(ZERO, opening.plus(ge).minus(del));
  const spill = Prisma.Decimal.max(ZERO, del.minus(opening).minus(ge));
  const halfBase = Prisma.Decimal.max(ZERO, lt.minus(spill));
  const dep = r2(fullBase.mul(rate).plus(halfBase.mul(rate).div(2)));
  const closing = Prisma.Decimal.max(ZERO, opening.plus(ge).plus(lt).minus(del).minus(dep));
  return { depreciation: dep, closing: r2(closing) };
}

/** GST s.18(6): on a sale of capital goods pay the higher of (ITC reduced by 5 points per quarter used) and the tax on the sale. */
export function s18_6(i: { itc: V; quarters: number; taxOnSale: V }): {
  reversal: Dec;
  payable: Dec;
  extra: Dec;
} {
  const itc = D(i.itc);
  const left = Prisma.Decimal.max(ZERO, D(100).minus(D(5).mul(i.quarters))).div(100);
  const reversal = r2(itc.mul(left));
  const tax = D(i.taxOnSale);
  const payable = Prisma.Decimal.max(reversal, tax);
  return { reversal, payable: r2(payable), extra: r2(payable.minus(tax)) };
}

export const gainLoss = (saleValue: V, nbv: V): Dec => r2(D(saleValue).minus(nbv));
