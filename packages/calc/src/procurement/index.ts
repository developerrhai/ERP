// Procurement calculators (Phase 09). Pure functions, no database, no floating point.
// Numbers cross this boundary as decimal STRINGS. Inside, values are BigInt scaled by 1e6.
// Rounding is half-up (away from zero), the same as the Phase 07 money helpers.

const SCALE = 1_000_000n;
const NUM = /^-?\d+(\.\d{1,6})?$/;

export type Fixed = bigint;

export function toFixed(value: string | number): Fixed {
  const s = String(value).trim();
  if (!NUM.test(s)) throw new RangeError(`Not a number with at most 6 decimals: "${s}"`);
  const neg = s.startsWith('-');
  const [w = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = BigInt(w) * SCALE + BigInt(f.padEnd(6, '0'));
  return neg ? -v : v;
}

/** Round half-up (away from zero) to `dp` places and print. */
export function fmt(v: Fixed, dp: number): string {
  const unit = 10n ** BigInt(6 - dp);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const r = (a + unit / 2n) / unit;
  const d = 10n ** BigInt(dp);
  const s = dp === 0 ? `${r}` : `${r / d}.${String(r % d).padStart(dp, '0')}`;
  return neg && r !== 0n ? `-${s}` : s;
}

/** a * b (both scaled) -> scaled, rounded half-up. */
function mul(a: Fixed, b: Fixed): Fixed {
  const p = a * b;
  const neg = p < 0n;
  const x = neg ? -p : p;
  const r = (x + SCALE / 2n) / SCALE;
  return neg ? -r : r;
}
function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0n) throw new RangeError('Division by zero');
  const neg = a < 0n !== b < 0n;
  const x = (a < 0n ? -a : a) * SCALE;
  const y = b < 0n ? -b : b;
  const r = (x + y / 2n) / y;
  return neg ? -r : r;
}
/** Round a scaled value to dp places and keep it scaled. */
function round(v: Fixed, dp: number): Fixed {
  return toFixed(fmt(v, dp));
}
export const r2 = (s: string): string => fmt(toFixed(s), 2);
export const r3 = (s: string): string => fmt(toFixed(s), 3);

// ---------------------------------------------------------------- tax
export interface TaxLineInput {
  qty: string;
  rate: string;
  discountPct: string;
  gstPct: string;
  intraState: boolean;
}
export interface TaxLine {
  gross: string;
  discount: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
}

/** Intra-state: CGST = SGST = r2(taxable x rate/2 %). Inter-state: IGST = r2(taxable x rate %). */
export function lineTax(i: TaxLineInput): TaxLine {
  const gross = round(mul(toFixed(i.qty), toFixed(i.rate)), 2);
  const discount = round(mul(gross, div(toFixed(i.discountPct), 100n * SCALE)), 2);
  const taxable = gross - discount;
  const pct = toFixed(i.gstPct);
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  if (i.intraState) {
    const half = round(mul(taxable, div(pct, 200n * SCALE)), 2);
    cgst = half;
    sgst = half;
  } else {
    igst = round(mul(taxable, div(pct, 100n * SCALE)), 2);
  }
  const tax = cgst + sgst + igst;
  return {
    gross: fmt(gross, 2),
    discount: fmt(discount, 2),
    taxable: fmt(taxable, 2),
    cgst: fmt(cgst, 2),
    sgst: fmt(sgst, 2),
    igst: fmt(igst, 2),
    tax: fmt(tax, 2),
    total: fmt(taxable + tax, 2),
  };
}

export interface HeaderTotals {
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  beforeRound: string;
  roundOff: string;
  grandTotal: string;
}
/** Header total is rounded to the rupee; roundOff = grandTotal - beforeRound. */
export function headerTotals(lines: readonly TaxLine[]): HeaderTotals {
  let t = 0n;
  let c = 0n;
  let s = 0n;
  let g = 0n;
  for (const l of lines) {
    t += toFixed(l.taxable);
    c += toFixed(l.cgst);
    s += toFixed(l.sgst);
    g += toFixed(l.igst);
  }
  const before = t + c + s + g;
  const grand = round(before, 0);
  return {
    taxable: fmt(t, 2),
    cgst: fmt(c, 2),
    sgst: fmt(s, 2),
    igst: fmt(g, 2),
    tax: fmt(c + s + g, 2),
    beforeRound: fmt(before, 2),
    roundOff: fmt(grand - before, 2),
    grandTotal: fmt(grand, 2),
  };
}

// ---------------------------------------------------------------- over-receipt
/** max = r3((ordered - closed) x (1 + pct/100)) */
export function maxReceivable(ordered: string, closed: string, tolerancePct: string): string {
  const open = toFixed(ordered) - toFixed(closed);
  const factor = SCALE + div(toFixed(tolerancePct), 100n * SCALE);
  return fmt(mul(open, factor), 3);
}
export interface OverReceiptResult {
  ok: boolean;
  max: string;
  after: string;
}
export function checkOverReceipt(i: {
  ordered: string;
  closed: string;
  receivedBefore: string;
  newQty: string;
  tolerancePct: string;
}): OverReceiptResult {
  const max = maxReceivable(i.ordered, i.closed, i.tolerancePct);
  const after = toFixed(i.receivedBefore) + toFixed(i.newQty);
  return { ok: after <= toFixed(max), max, after: fmt(after, 3) };
}

// ---------------------------------------------------------------- landed cost
export type LandedBasis = 'VALUE' | 'QTY' | 'WEIGHT';
export interface LandedLine {
  key: string;
  value: string;
  qty: string;
  weight?: string;
}
/** Split `amount` over the lines by value, qty or weight. Every share is rounded to 2 dp;
 *  the LAST line takes the remainder, so the shares always add up to the amount. */
export function allocateLandedCost(
  amount: string,
  lines: readonly LandedLine[],
  basis: LandedBasis,
): { key: string; share: string }[] {
  if (lines.length === 0) return [];
  const weights = lines.map((l) => toFixed(basis === 'VALUE' ? l.value : basis === 'QTY' ? l.qty : (l.weight ?? '0')));
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total <= 0n) throw new RangeError('Landed cost basis total must be greater than zero');
  const amt = toFixed(amount);
  let used = 0n;
  return lines.map((l, idx) => {
    let share: Fixed;
    if (idx === lines.length - 1) share = amt - used;
    else {
      share = round(mul(amt, div(weights[idx] as Fixed, total)), 2);
      used += share;
    }
    return { key: l.key, share: fmt(share, 2) };
  });
}

// ---------------------------------------------------------------- 3-way match
export interface MatchTolerance {
  qtyPct: string;
  pricePct: string;
  taxAmount: string;
}
export interface MatchInput {
  invoiceQty: string;
  invoiceRate: string;
  grnAcceptedQty: string;
  alreadyBilledQty: string;
  poNetRate: string;
  invoiceTax?: string;
  expectedTax?: string;
}
export type MatchCode = 'QTY_OVER_RECEIPT' | 'PRICE_VARIANCE' | 'TAX_VARIANCE';
export interface MatchResult {
  ok: boolean;
  codes: MatchCode[];
  matchedQty: string;
  matchedValue: string;
  invoiceValue: string;
  variance: string;
  priceDiffPct: string;
}
/** Per line. Qty is checked against the GRN accepted qty (less what was billed before) + tolerance,
 *  price against the PO net rate. Matched value = min(invoice qty, billable qty) x PO rate. */
export function matchLine(i: MatchInput, tol: MatchTolerance): MatchResult {
  const invQty = toFixed(i.invoiceQty);
  const billable = toFixed(i.grnAcceptedQty) - toFixed(i.alreadyBilledQty);
  const qtyLimit = mul(billable, SCALE + div(toFixed(tol.qtyPct), 100n * SCALE));
  const poRate = toFixed(i.poNetRate);
  const invRate = toFixed(i.invoiceRate);
  const codes: MatchCode[] = [];
  if (invQty > qtyLimit) codes.push('QTY_OVER_RECEIPT');
  const rateDiff = invRate > poRate ? invRate - poRate : poRate - invRate;
  const diffPct = poRate === 0n ? 0n : div(rateDiff * 100n, poRate);
  if (diffPct > toFixed(tol.pricePct)) codes.push('PRICE_VARIANCE');
  if (i.invoiceTax !== undefined && i.expectedTax !== undefined) {
    const d = toFixed(i.invoiceTax) - toFixed(i.expectedTax);
    if ((d < 0n ? -d : d) > toFixed(tol.taxAmount)) codes.push('TAX_VARIANCE');
  }
  const matchedQtyRaw = invQty < billable ? invQty : billable;
  const matchedQty = matchedQtyRaw < 0n ? 0n : matchedQtyRaw;
  const matchedValue = round(mul(matchedQty, poRate), 2);
  const invoiceValue = round(mul(invQty, invRate), 2);
  return {
    ok: codes.length === 0,
    codes,
    matchedQty: fmt(matchedQty, 3),
    matchedValue: fmt(matchedValue, 2),
    invoiceValue: fmt(invoiceValue, 2),
    variance: fmt(invoiceValue - matchedValue, 2),
    priceDiffPct: fmt(diffPct, 4),
  };
}

// ---------------------------------------------------------------- TDS
export interface TdsSection {
  mode: 'ON_ALL' | 'ON_EXCESS';
  thresholdSingle: string | null;
  thresholdAnnual: string | null;
  ratePct: string;
  /** 'RUPEE' (nearest rupee, default) or 'PAISE' */
  rounding?: 'RUPEE' | 'PAISE';
}
export interface TdsState {
  /** cumulative base for supplier + year + section BEFORE this document (net of debit notes) */
  cumBaseBefore: string;
  /** part of that cumulative on which TDS has already been deducted */
  cumTdsBaseBefore: string;
}
export interface TdsResult {
  base: string;
  tds: string;
  cumBaseAfter: string;
  cumTdsBaseAfter: string;
  triggered: boolean;
}
/** ON_ALL (194C/J/H): taxed when this document exceeds the single limit OR the cumulative exceeds the
 *     annual limit. Base = everything not yet taxed (cumAfter - cumTdsBaseBefore).
 *  ON_EXCESS (194Q): base = cumAfter - max(annual threshold, cumTdsBaseBefore).
 *  A negative amount (debit note) only moves the cumulative; the next invoice is computed net. */
export function computeTds(amount: string, sec: TdsSection, st: TdsState): TdsResult {
  const amt = toFixed(amount);
  const before = toFixed(st.cumBaseBefore);
  const taxedBefore = toFixed(st.cumTdsBaseBefore);
  const after = before + amt;
  const single = sec.thresholdSingle === null ? null : toFixed(sec.thresholdSingle);
  const annual = sec.thresholdAnnual === null ? null : toFixed(sec.thresholdAnnual);
  let base = 0n;
  let triggered = false;
  if (amt > 0n) {
    if (sec.mode === 'ON_EXCESS') {
      const floor = annual ?? 0n;
      const start = taxedBefore > floor ? taxedBefore : floor;
      base = after > start ? after - start : 0n;
    } else {
      const hit = (single !== null && amt > single) || (annual !== null && after > annual) || (single === null && annual === null);
      base = hit ? after - taxedBefore : 0n;
    }
    if (base < 0n) base = 0n;
    triggered = base > 0n;
  }
  const raw = mul(base, div(toFixed(sec.ratePct), 100n * SCALE));
  const tds = round(raw, sec.rounding === 'PAISE' ? 2 : 0);
  let cumTdsAfter = sec.mode === 'ON_EXCESS' && base > 0n ? after : taxedBefore + base;
  if (amt < 0n) {
    cumTdsAfter = taxedBefore + amt;
    if (cumTdsAfter < 0n) cumTdsAfter = 0n;
  }
  return {
    base: fmt(base, 2),
    tds: fmt(tds, 2),
    cumBaseAfter: fmt(after, 2),
    cumTdsBaseAfter: fmt(cumTdsAfter, 2),
    triggered,
  };
}

// ---------------------------------------------------------------- dates, MSME
function parseDate(d: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new RangeError(`Bad date ${d}`);
  return new Date(`${d}T00:00:00Z`);
}
export function addDays(date: string, days: number): string {
  const t = parseDate(date);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}
export function earlierDate(a: string, b: string): string {
  return a <= b ? a : b;
}
/** msme_due = last GRN date + min(agreed days or 15, 45). */
export function msmeDueDate(lastGrnDate: string, agreedDays: number | null): string {
  return addDays(lastGrnDate, Math.min(agreedDays ?? 15, 45));
}
/** Interest (information only) = P x ((1 + 3b/12)^(d/30) - 1). Whole months compound; a part month
 *  is added as simple interest on the compounded amount. */
export function msmeInterest(principal: string, bankRatePct: string, daysOverdue: number): string {
  if (daysOverdue <= 0) return '0.00';
  const HI = 10n ** 24n; // high-precision scale so compounding does not lose paise
  const monthly = (3n * toFixed(bankRatePct) * (HI / SCALE)) / 1200n; // 3b/12 as a fraction of HI
  const months = Math.floor(daysOverdue / 30);
  const restDays = daysOverdue - months * 30;
  let factor = HI;
  for (let k = 0; k < months; k += 1) factor = (factor * (HI + monthly)) / HI;
  if (restDays > 0) factor = (factor * (HI + (monthly * BigInt(restDays)) / 30n)) / HI;
  const interest = (toFixed(principal) * (factor - HI)) / HI; // scaled by SCALE
  return fmt(interest, 2);
}

// ---------------------------------------------------------------- ITC 180 (Rule 37)
export interface ItcHeads {
  cgst: string;
  sgst: string;
  igst: string;
}
/** reverse = ITC x unpaid / netPayable, per head, 2 dp. */
export function itc180Reverse(itc: ItcHeads, netPayable: string, unpaid: string): ItcHeads {
  const net = toFixed(netPayable);
  const un = toFixed(unpaid);
  const part = (h: string): string => (net === 0n ? '0.00' : fmt(mul(toFixed(h), div(un, net)), 2));
  return { cgst: part(itc.cgst), sgst: part(itc.sgst), igst: part(itc.igst) };
}
export function itc180DueDate(invoiceDate: string): string {
  return addDays(invoiceDate, 180);
}

// ---------------------------------------------------------------- supplier evaluation
export interface EvalWeights {
  quality: string;
  delivery: string;
  cost: string;
  response: string;
}
export const DEFAULT_EVAL_WEIGHTS: EvalWeights = { quality: '40', delivery: '30', cost: '20', response: '10' };
/** Q = max(0, 100 - PPM/500) */
export function qualityScore(ppm: string): string {
  const q = 100n * SCALE - div(toFixed(ppm), 500n * SCALE);
  return fmt(q < 0n ? 0n : q, 4);
}
/** D = OTIF %, never below the floor (70). */
export function deliveryScore(otifPct: string, floor = '70'): string {
  const v = toFixed(otifPct);
  const f = toFixed(floor);
  return fmt(v < f ? f : v, 4);
}
/** C = 100 x benchmark price / this supplier's price (cost index), capped at 100. */
export function costScore(benchmarkPrice: string, supplierPrice: string): string {
  const v = div(toFixed(benchmarkPrice) * 100n, toFixed(supplierPrice));
  return fmt(v > 100n * SCALE ? 100n * SCALE : v, 2);
}
export function overallScore(s: { q: string; d: string; c: string; r: string }, w: EvalWeights = DEFAULT_EVAL_WEIGHTS): string {
  const total =
    mul(toFixed(s.q), toFixed(w.quality)) +
    mul(toFixed(s.d), toFixed(w.delivery)) +
    mul(toFixed(s.c), toFixed(w.cost)) +
    mul(toFixed(s.r), toFixed(w.response));
  return fmt(div(total, 100n * SCALE), 4);
}
export type Grade = 'A' | 'B' | 'C' | 'D';
/** Grade bands are DATA (scm_settings); the defaults A>=85, B>=70, C>=50 are needs_review. */
export function gradeFor(score: string, bands = { a: '85', b: '70', c: '50' }): Grade {
  const s = toFixed(score);
  if (s >= toFixed(bands.a)) return 'A';
  if (s >= toFixed(bands.b)) return 'B';
  if (s >= toFixed(bands.c)) return 'C';
  return 'D';
}

// ---------------------------------------------------------------- PO delivery tracking (client req 1)
export type DeliveryStatus = 'OPEN' | 'PARTLY_RECEIVED' | 'CLOSED' | 'DELAYED';
export function deliveryStatus(i: {
  poQty: string;
  receivedQty: string;
  closedQty?: string;
  expectedDate: string;
  today: string;
}): { status: DeliveryStatus; balance: string } {
  const bal = toFixed(i.poQty) - toFixed(i.receivedQty) - toFixed(i.closedQty ?? '0');
  const balance = fmt(bal < 0n ? 0n : bal, 3);
  if (bal <= 0n) return { status: 'CLOSED', balance };
  if (i.today > i.expectedDate) return { status: 'DELAYED', balance };
  return { status: toFixed(i.receivedQty) > 0n ? 'PARTLY_RECEIVED' : 'OPEN', balance };
}
