// Procurement arithmetic (Phase 9) with exact Decimal. The formulas are the ones in packages/calc/src/procurement
// (which holds the worked examples as unit tests); tests/phase09-math.test.ts proves both give the same answers.
// The API build has rootDir=src, so it cannot import the calc package: this file is the runtime copy.
import { D, ZERO, round2, round3 } from '../inventory/money';
import type { Dec } from '../inventory/money';

export const HUNDRED = D(100);

export interface LineTax {
  gross: Dec;
  discount: Dec;
  taxable: Dec;
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
  tax: Dec;
  total: Dec;
}

export function lineTax(i: {
  qty: Dec;
  rate: Dec;
  discountPct: Dec;
  gstPct: Dec;
  intra: boolean;
}): LineTax {
  const gross = round2(i.qty.mul(i.rate));
  const discount = round2(gross.mul(i.discountPct).div(HUNDRED));
  const taxable = gross.minus(discount);
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  if (i.intra) {
    cgst = round2(taxable.mul(i.gstPct).div(200));
    sgst = cgst;
  } else igst = round2(taxable.mul(i.gstPct).div(HUNDRED));
  const tax = cgst.plus(sgst).plus(igst);
  return { gross, discount, taxable, cgst, sgst, igst, tax, total: taxable.plus(tax) };
}

export function headerTotals(lines: LineTax[]) {
  const sum = (f: (l: LineTax) => Dec) => lines.reduce((a, l) => a.plus(f(l)), ZERO);
  const taxable = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const before = taxable.plus(cgst).plus(sgst).plus(igst);
  const grand = before.toDecimalPlaces(0, 4);
  return { taxable, cgst, sgst, igst, before, roundOff: grand.minus(before), grand };
}

/** Net rate after discount (what 3-way match compares against). */
export const netRate = (rate: Dec, discountPct: Dec): Dec =>
  rate.mul(HUNDRED.minus(discountPct)).div(HUNDRED).toDecimalPlaces(6, 4);

export function maxReceivable(ordered: Dec, closed: Dec, tolPct: Dec): Dec {
  return round3(ordered.minus(closed).mul(D(1).plus(tolPct.div(HUNDRED))));
}

/** Split `amount` over weights; every share is rounded to 2 dp and the LAST line takes the remainder. */
export function splitAmount(amount: Dec, weights: Dec[]): Dec[] {
  const total = weights.reduce((a, w) => a.plus(w), ZERO);
  if (total.lte(0)) throw new RangeError('Nothing to split the amount over.');
  let used = ZERO;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return amount.minus(used);
    const share = round2(amount.mul(w).div(total));
    used = used.plus(share);
    return share;
  });
}

export type MatchCode = 'QTY_OVER_RECEIPT' | 'PRICE_VARIANCE' | 'TAX_VARIANCE';
export function matchLine(
  i: {
    invoiceQty: Dec;
    invoiceRate: Dec;
    grnAcceptedQty: Dec;
    alreadyBilledQty: Dec;
    poNetRate: Dec;
    invoiceTax?: Dec;
    expectedTax?: Dec;
  },
  tol: { qtyPct: Dec; pricePct: Dec; taxAmount: Dec },
) {
  const billable = i.grnAcceptedQty.minus(i.alreadyBilledQty);
  const limit = billable.mul(D(1).plus(tol.qtyPct.div(HUNDRED)));
  const codes: MatchCode[] = [];
  if (i.invoiceQty.gt(limit)) codes.push('QTY_OVER_RECEIPT');
  const diffPct = i.poNetRate.isZero()
    ? ZERO
    : i.invoiceRate.minus(i.poNetRate).abs().mul(HUNDRED).div(i.poNetRate);
  if (diffPct.gt(tol.pricePct)) codes.push('PRICE_VARIANCE');
  if (i.invoiceTax && i.expectedTax && i.invoiceTax.minus(i.expectedTax).abs().gt(tol.taxAmount))
    codes.push('TAX_VARIANCE');
  const mq = Dec0(i.invoiceQty.lt(billable) ? i.invoiceQty : billable);
  const matchedValue = round2(mq.mul(i.poNetRate));
  const invoiceValue = round2(i.invoiceQty.mul(i.invoiceRate));
  return {
    ok: codes.length === 0,
    codes,
    matchedQty: mq,
    matchedValue,
    invoiceValue,
    variance: invoiceValue.minus(matchedValue),
  };
}
const Dec0 = (v: Dec): Dec => (v.lt(0) ? ZERO : v);

export interface TdsRule {
  mode: 'ON_ALL' | 'ON_EXCESS';
  thresholdSingle: Dec | null;
  thresholdAnnual: Dec | null;
  ratePct: Dec;
  rounding: 'RUPEE' | 'PAISE';
}
export function computeTds(amount: Dec, rule: TdsRule, st: { cumBase: Dec; cumTdsBase: Dec }) {
  const after = st.cumBase.plus(amount);
  let base = ZERO;
  if (amount.gt(0)) {
    if (rule.mode === 'ON_EXCESS') {
      const floor = rule.thresholdAnnual ?? ZERO;
      const start = st.cumTdsBase.gt(floor) ? st.cumTdsBase : floor;
      base = after.gt(start) ? after.minus(start) : ZERO;
    } else {
      const hit =
        (rule.thresholdSingle !== null && amount.gt(rule.thresholdSingle)) ||
        (rule.thresholdAnnual !== null && after.gt(rule.thresholdAnnual)) ||
        (rule.thresholdSingle === null && rule.thresholdAnnual === null);
      base = hit ? after.minus(st.cumTdsBase) : ZERO;
    }
    if (base.lt(0)) base = ZERO;
  }
  const raw = base.mul(rule.ratePct).div(HUNDRED);
  const tds = rule.rounding === 'PAISE' ? round2(raw) : raw.toDecimalPlaces(0, 4);
  let cumTdsAfter = rule.mode === 'ON_EXCESS' && base.gt(0) ? after : st.cumTdsBase.plus(base);
  if (amount.lt(0))
    cumTdsAfter = st.cumTdsBase.plus(amount).lt(0) ? ZERO : st.cumTdsBase.plus(amount);
  return { base, tds, cumBaseAfter: after, cumTdsBaseAfter: cumTdsAfter };
}

// ---- dates ---------------------------------------------------------------------------------------------
export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const msmeDueDate = (lastGrnDate: string, agreedDays: number | null): string =>
  addDays(lastGrnDate, Math.min(agreedDays ?? 15, 45));

export function msmeInterest(principal: Dec, bankRatePct: Dec, daysOverdue: number): Dec {
  if (daysOverdue <= 0) return ZERO;
  const monthly = bankRatePct.mul(3).div(HUNDRED).div(12);
  const months = Math.floor(daysOverdue / 30);
  const rest = daysOverdue - months * 30;
  let f = D(1);
  for (let k = 0; k < months; k += 1) f = f.mul(D(1).plus(monthly));
  if (rest > 0) f = f.mul(D(1).plus(monthly.mul(rest).div(30)));
  return round2(principal.mul(f.minus(1)));
}

export function itc180Reverse(
  itc: { cgst: Dec; sgst: Dec; igst: Dec },
  netPayable: Dec,
  unpaid: Dec,
) {
  const part = (h: Dec) => (netPayable.isZero() ? ZERO : round2(h.mul(unpaid).div(netPayable)));
  return { cgst: part(itc.cgst), sgst: part(itc.sgst), igst: part(itc.igst) };
}

// ---- evaluation ----------------------------------------------------------------------------------------
export const qualityScore = (ppm: Dec): Dec => {
  const q = HUNDRED.minus(ppm.div(500));
  return q.lt(0) ? ZERO : q;
};
export const deliveryScore = (otif: Dec, floor: Dec): Dec => (otif.lt(floor) ? floor : otif);
export const costScore = (benchmark: Dec, price: Dec): Dec => {
  const v = benchmark.mul(HUNDRED).div(price);
  return v.gt(HUNDRED) ? HUNDRED : v;
};
export function overall(
  s: { q: Dec; d: Dec; c: Dec; r: Dec },
  w: { q: Dec; d: Dec; c: Dec; r: Dec },
): Dec {
  return s.q
    .mul(w.q)
    .plus(s.d.mul(w.d))
    .plus(s.c.mul(w.c))
    .plus(s.r.mul(w.r))
    .div(HUNDRED)
    .toDecimalPlaces(4, 4);
}
export const gradeFor = (score: Dec, a: Dec, b: Dec, c: Dec): 'A' | 'B' | 'C' | 'D' =>
  score.gte(a) ? 'A' : score.gte(b) ? 'B' : score.gte(c) ? 'C' : 'D';

/** Open / Partly received / Closed / Delayed (client requirement 1). */
export function deliveryStatus(i: {
  poQty: Dec;
  receivedQty: Dec;
  closedQty: Dec;
  expectedDate: string | null;
  today: string;
}): { status: 'OPEN' | 'PARTLY_RECEIVED' | 'CLOSED' | 'DELAYED'; balance: Dec } {
  const bal = i.poQty.minus(i.receivedQty).minus(i.closedQty);
  if (bal.lte(0)) return { status: 'CLOSED', balance: ZERO };
  if (i.expectedDate && i.today > i.expectedDate) return { status: 'DELAYED', balance: bal };
  return { status: i.receivedQty.gt(0) ? 'PARTLY_RECEIVED' : 'OPEN', balance: bal };
}

export interface ItcHeads {
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
}
export const itc180DueDate = (invoiceDate: string): string => addDays(invoiceDate, 180);
