// Finance calculators (Phase 07). Pure functions, no database, no floating point: money is handled as
// integer paise in BigInt, so 0.1 + 0.2 is exactly 0.30 and a journal either balances or it does not.
// Money crosses this boundary as decimal STRINGS ("1234.50"), never as JS numbers.

export type Paise = bigint;

const MONEY = /^-?\d+(\.\d{1,2})?$/;

/** "1234.5" -> 123450n. More than 2 decimals is refused (AMOUNT_PRECISION), never rounded silently. */
export function toPaise(value: string): Paise {
  const s = value.trim();
  if (!MONEY.test(s)) throw new RangeError(`Not a money amount with at most 2 decimals: "${value}"`);
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  const p = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0') || '0');
  return neg ? -p : p;
}

/** 123450n -> "1234.50" */
export function fromPaise(p: Paise): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  const s = `${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export interface LedgerLine {
  unitId: string;
  debit: string;
  credit: string;
}

/** Rule BR-FIN-01 for one line: exactly one side is greater than zero. */
export function lineIsOneSided(l: { debit: string; credit: string }): boolean {
  const d = toPaise(l.debit);
  const c = toPaise(l.credit);
  return d >= 0n && c >= 0n && ((d > 0n && c === 0n) || (c > 0n && d === 0n));
}

export interface BalanceResult {
  totalDebit: string;
  totalCredit: string;
  difference: string;
  /** per unit: debit - credit (every entry must be "0.00" for the journal to post) */
  byUnit: Record<string, string>;
  balanced: boolean;
}

/** A journal balances when debit = credit overall AND inside every unit (owner rule), with at least 2 lines. */
export function checkBalance(lines: readonly LedgerLine[]): BalanceResult {
  let d = 0n;
  let c = 0n;
  const per = new Map<string, bigint>();
  for (const l of lines) {
    const ld = toPaise(l.debit);
    const lc = toPaise(l.credit);
    d += ld;
    c += lc;
    per.set(l.unitId, (per.get(l.unitId) ?? 0n) + ld - lc);
  }
  const byUnit: Record<string, string> = {};
  let unitsBalanced = true;
  for (const [u, v] of per) {
    byUnit[u] = fromPaise(v);
    if (v !== 0n) unitsBalanced = false;
  }
  return {
    totalDebit: fromPaise(d),
    totalCredit: fromPaise(c),
    difference: fromPaise(d - c),
    byUnit,
    balanced: lines.length >= 2 && d === c && unitsBalanced && d > 0n,
  };
}

/** Swap debit and credit of every line (a reversal journal). Dimensions are copied by the caller. */
export function reverseLines<T extends { debit: string; credit: string }>(lines: readonly T[]): T[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/** BR-FIN-06: invoice round-off = round-half-up(total to the rupee) - total. Returned as a signed money string. */
export function roundOff(total: string): string {
  const p = toPaise(total);
  const neg = p < 0n;
  const a = neg ? -p : p;
  const rupees = (a + 50n) / 100n; // half-up on the magnitude
  const rounded = (neg ? -rupees : rupees) * 100n;
  return fromPaise(rounded - p);
}

export interface OpenItemLike {
  id: string;
  outstanding: string; // > 0
  dueDate: string | null; // ISO date
  docDate: string; // ISO date
  docNo: string;
}

export interface AllocationPart {
  itemId: string;
  amount: string;
}

/**
 * BR-FIN-10 (a): FIFO suggestion. Items are ordered by due date (none last), then document date, then
 * document number; the amount is poured in until exhausted. Returns the parts and the unallocated rest.
 */
export function fifoAllocate(
  items: readonly OpenItemLike[],
  amount: string,
): { parts: AllocationPart[]; unallocated: string } {
  let left = toPaise(amount);
  const sorted = [...items].sort((a, b) => {
    const da = a.dueDate ?? '9999-12-31';
    const db = b.dueDate ?? '9999-12-31';
    return da < db ? -1 : da > db ? 1 : a.docDate < b.docDate ? -1 : a.docDate > b.docDate ? 1 : a.docNo < b.docNo ? -1 : a.docNo > b.docNo ? 1 : 0;
  });
  const parts: AllocationPart[] = [];
  for (const it of sorted) {
    if (left <= 0n) break;
    const out = toPaise(it.outstanding);
    if (out <= 0n) continue;
    const take = left < out ? left : out;
    parts.push({ itemId: it.id, amount: fromPaise(take) });
    left -= take;
  }
  return { parts, unallocated: fromPaise(left) };
}

export type AgeBucket = 'NOT_DUE' | '1-30' | '31-60' | '61-90' | '90+';

const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** Days past due on `asOf` (negative = not yet due). No due date = due on the document date. */
export function daysPastDue(dueDate: string | null, docDate: string, asOf: string): number {
  return dayNumber(asOf) - dayNumber(dueDate ?? docDate);
}

export function ageBucket(daysPast: number): AgeBucket {
  if (daysPast <= 0) return 'NOT_DUE';
  if (daysPast <= 30) return '1-30';
  if (daysPast <= 60) return '31-60';
  if (daysPast <= 90) return '61-90';
  return '90+';
}

/** The natural-sign balance of an account: assets and expenses by debit - credit, the rest by credit - debit. */
export function naturalBalance(
  rootType: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense',
  debit: string,
  credit: string,
): string {
  const d = toPaise(debit);
  const c = toPaise(credit);
  return fromPaise(rootType === 'Asset' || rootType === 'Expense' ? d - c : c - d);
}

export interface RecoInput {
  /** closing balance of the bank account in the books (debit - credit of the ledger account) */
  bookBalance: string;
  /** closing balance printed on the bank statement */
  statementClosing: string;
  /** books entries (cheques issued, deposits) that the bank has not cleared yet: signed, + = adds to the book */
  unclearedBook: readonly string[];
  /** bank lines (charges, interest) that the books do not have yet: signed, + = adds to the bank balance */
  unrecordedBank: readonly string[];
}

/**
 * Bank reconciliation proof: bookBalance - Σ unclearedBook(net of outstanding items) must equal
 * statementClosing - Σ unrecordedBank. `difference` must be "0.00" to reconcile (RECON_DIFFERENCE otherwise).
 */
export function reconciliationDifference(r: RecoInput): string {
  const sum = (xs: readonly string[]) => xs.reduce((a, x) => a + toPaise(x), 0n);
  const adjustedBook = toPaise(r.bookBalance) - sum(r.unclearedBook);
  const adjustedBank = toPaise(r.statementClosing) - sum(r.unrecordedBank);
  return fromPaise(adjustedBook - adjustedBank);
}

/** 4.11 budget check: would `spend` take the year-to-date actual over the year-to-date budget? */
export function budgetCheck(
  budgetToDate: string,
  actualToDate: string,
  spend: string,
): { exceeded: boolean; available: string; over: string } {
  const b = toPaise(budgetToDate);
  const a = toPaise(actualToDate);
  const s = toPaise(spend);
  const after = a + s;
  return {
    exceeded: after > b,
    available: fromPaise(b - a),
    over: fromPaise(after > b ? after - b : 0n),
  };
}

/** Deterministic PRNG for the property tests (the seed is printed in PHASE-07-REPORT.md). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
