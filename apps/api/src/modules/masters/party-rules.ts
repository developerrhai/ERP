// Pure rules of the shared business masters (docs/phases/PHASE-06.md §3, §5, §8): GSTIN / PAN / Udyam /
// IFSC checks with the exact §8 messages, name normalisation, place of supply and the payment-term
// schedule. No database and no network here (R-12): the list of known state codes is passed in, loaded
// from the gst_states table by the service.
import { Prisma } from '@prisma/client';
import { HSN_RE, IFSC_RE, PAN_RE, gstinCheckChar } from '../../engine/validators';

export interface RuleError {
  code: string;
  field: string;
  message: string;
}

export type Checked<T> = ({ ok: true } & T) | ({ ok: false } & RuleError);

const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const MESSAGES = {
  GSTIN_LENGTH: 'GSTIN must be exactly 15 characters.',
  GSTIN_FORMAT: 'GSTIN format is wrong. Example: 27AAPFU0939F1ZV.',
  GSTIN_STATE: 'The first two digits are not a valid GST state code.',
  GSTIN_CHECKSUM:
    'This GSTIN has a typing mistake (last character does not match). Please re-check.',
  GSTIN_REQUIRED: 'Enter the GSTIN for a Regular, Composition or SEZ party.',
  GSTIN_NOT_ALLOWED:
    'Remove the GSTIN or change the registration type — Unregistered/Overseas parties have none.',
  PAN_FORMAT: 'PAN must be 5 letters, 4 digits, 1 letter (e.g. AAPFU0939F).',
  UDYAM_FORMAT: 'Udyam number looks like UDYAM-MH-26-0012345.',
  MSME_DAYS: 'Agreed days for an MSME supplier must be between 1 and 45.',
  IFSC_FORMAT: 'IFSC is 11 characters: 4 letters, 0, then 6 letters/digits.',
  ACCOUNT_CONFIRM: 'The two account numbers do not match.',
  BANK_SELF_VERIFY: 'Another user must verify a bank account you changed.',
  HSN_REQUIRED: 'Choose the HSN/SAC code for this item.',
  CREDIT_PENDING: 'A credit-limit change is already waiting for approval.',
  PRICE_DATES: 'Valid To must be on or after Valid From.',
} as const;

export const gstinPanMismatch = (pan: string): string =>
  `PAN must match characters 3–12 of the GSTIN (${pan}).`;
export const gstinStateMismatch = (state: string, code: string): string =>
  `State must be ${state} because the GSTIN starts with ${code}.`;
export const gstinDuplicate = (code: string, name: string): string =>
  `Customer ${code} – ${name} already has this GSTIN.`;
export const supplierNotApproved = (code: string): string =>
  `Supplier ${code} is not approved yet.`;
export const hsnDigits = (n: number): string =>
  `Use at least ${n} digits of HSN (your turnover rule).`;
export const noGstRate = (code: string, date: string): string =>
  `No GST rate is set for HSN ${code} on ${date}. Ask accounts to add one.`;
export const rateOverlap = (from: string, to: string): string =>
  `This date overlaps the rate valid ${from}–${to}.`;
export const termsSum = (sum: string): string =>
  `Instalment percentages must add up to 100 % (now ${sum} %).`;

/** Removes spaces and upper-cases ("27 aapfu0939f1zv" -> "27AAPFU0939F1ZV"). */
export function normaliseGstin(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Offline GSTIN check, in the spec order: length -> format -> known state -> embedded PAN -> checksum.
 * `knownStates` = the codes of the gst_states table.
 */
export function validateGstin(
  value: string,
  knownStates: ReadonlySet<string>,
): Checked<{ gstin: string; stateCode: string; pan: string }> {
  const gstin = normaliseGstin(value);
  const fail = (code: keyof typeof MESSAGES): Checked<never> => ({
    ok: false,
    code,
    field: 'gstin',
    message: MESSAGES[code],
  });
  if (gstin.length !== 15) return fail('GSTIN_LENGTH');
  if (!GSTIN_FORMAT.test(gstin)) return fail('GSTIN_FORMAT');
  const stateCode = gstin.slice(0, 2);
  if (!knownStates.has(stateCode)) return fail('GSTIN_STATE');
  const pan = gstin.slice(2, 12);
  if (!PAN_RE.test(pan)) return fail('GSTIN_FORMAT');
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin.charAt(14)) return fail('GSTIN_CHECKSUM');
  return { ok: true, gstin, stateCode, pan };
}

/** PAN holder types by the 4th character (the PAN's own check letter is not public and is not checked). */
export const PAN_HOLDER: Readonly<Record<string, string>> = {
  P: 'Individual',
  C: 'Company',
  H: 'HUF',
  F: 'Firm / LLP',
  A: 'AOP',
  T: 'Trust',
  B: 'BOI',
  L: 'Local authority',
  J: 'Artificial juridical person',
  G: 'Government',
};

export function validatePan(value: string): Checked<{ pan: string; holder: string }> {
  const pan = value.replace(/\s+/g, '').toUpperCase();
  const holder = PAN_HOLDER[pan.charAt(3)];
  if (!PAN_RE.test(pan) || !holder) {
    return { ok: false, code: 'PAN_FORMAT', field: 'pan', message: MESSAGES.PAN_FORMAT };
  }
  return { ok: true, pan, holder };
}

export const UDYAM_RE = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const isUdyam = (v: string): boolean => UDYAM_RE.test(v);
export const isIfsc = (v: string): boolean => IFSC_RE.test(v);
export const isHsn = (v: string): boolean => HSN_RE.test(v);

export interface PartyKindFields {
  gstRegistrationType: 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED' | 'SEZ' | 'OVERSEAS';
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
}

/**
 * Registration-type and consistency rules for a customer or supplier (spec §3.4, §5 "Consistency rules").
 * Returns every problem keyed by field; empty = fine. The PAN is filled from the GSTIN when blank.
 */
export function checkPartyIdentity(
  p: PartyKindFields,
  knownStates: ReadonlySet<string>,
  stateNames: ReadonlyMap<string, string>,
): { errors: Record<string, RuleError>; derived: { pan?: string; stateCode?: string } } {
  const errors: Record<string, RuleError> = {};
  const derived: { pan?: string; stateCode?: string } = {};
  const needsGstin = ['REGULAR', 'COMPOSITION', 'SEZ'].includes(p.gstRegistrationType);
  const gstin = p.gstin ? normaliseGstin(p.gstin) : '';
  if (needsGstin && !gstin) {
    errors.gstin = { code: 'GSTIN_REQUIRED', field: 'gstin', message: MESSAGES.GSTIN_REQUIRED };
  } else if (!needsGstin && gstin) {
    errors.gstin = {
      code: 'GSTIN_NOT_ALLOWED',
      field: 'gstin',
      message: MESSAGES.GSTIN_NOT_ALLOWED,
    };
  } else if (gstin) {
    const r = validateGstin(gstin, knownStates);
    if (!r.ok) {
      errors.gstin = r;
    } else {
      derived.stateCode = r.stateCode;
      if (p.pan) {
        const pan = validatePan(p.pan);
        if (!pan.ok) errors.pan = pan;
        else if (pan.pan !== r.pan) {
          errors.pan = {
            code: 'GSTIN_PAN_MISMATCH',
            field: 'pan',
            message: gstinPanMismatch(r.pan),
          };
        }
      } else {
        derived.pan = r.pan;
      }
      if (p.stateCode && p.stateCode !== r.stateCode) {
        errors.stateCode = {
          code: 'GSTIN_STATE_MISMATCH',
          field: 'stateCode',
          message: gstinStateMismatch(stateNames.get(r.stateCode) ?? r.stateCode, r.stateCode),
        };
      }
    }
  } else if (p.pan) {
    const pan = validatePan(p.pan);
    if (!pan.ok) errors.pan = pan;
  }
  return { errors, derived };
}

const NOISE = /\b(m\/s|messrs|pvt|private|ltd|limited|llp|and|co)\b/g;

/**
 * Normalised name used for duplicate matching: lower case, then drop m/s, messrs, pvt, private, ltd,
 * limited, llp, "&", and, co, punctuation and repeated spaces.
 * "M/s. Sawant Engg. Pvt. Ltd." -> "sawant engg".
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/m\/s/g, ' ')
    .replace(/&/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type PosKind = 'GOODS' | 'SERVICES';
export interface PosInput {
  kind: PosKind;
  supplierState: string;
  shipToState?: string | null;
  billToState: string;
  billToRegType: PartyKindFields['gstRegistrationType'];
  /** Goods in a bill-to / ship-to case: the bill-to party's place applies. */
  billToShipTo?: boolean;
}
export interface PosResult {
  posState: string;
  regime: 'INTRA' | 'INTER' | 'EXPORT';
}

/** Place of supply (IGST Act s.10 goods, s.12(2) B2B services); same state as the supplier unit -> CGST + SGST. */
export function placeOfSupply(i: PosInput): PosResult {
  if (i.billToRegType === 'OVERSEAS') return { posState: i.billToState, regime: 'EXPORT' };
  if (i.billToRegType === 'SEZ') return { posState: i.billToState, regime: 'INTER' };
  const posState =
    i.kind === 'SERVICES' || i.billToShipTo || !i.shipToState ? i.billToState : i.shipToState;
  return { posState, regime: posState === i.supplierState ? 'INTRA' : 'INTER' };
}

export interface TermLine {
  portionPct: Prisma.Decimal.Value;
  dueBasis: 'ADVANCE' | 'INVOICE_DATE' | 'END_OF_INVOICE_MONTH' | 'RECEIPT_OF_GOODS';
  days: number;
  discountPct?: Prisma.Decimal.Value;
  discountDays?: number;
}

/** The percentages of a payment term must add up to exactly 100. */
export function checkTermsSum(lines: readonly TermLine[]): string | null {
  const sum = lines.reduce((s, l) => s.plus(l.portionPct), new Prisma.Decimal(0));
  return sum.eq(100) ? null : termsSum(sum.toString());
}

export interface Instalment {
  lineNo: number;
  amount: string;
  dueDate: string;
  discountPct: string;
  discountUntil: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Instalments of an invoice amount; the rounding remainder goes to the last one. Amounts are 2-decimal strings. */
export function paymentSchedule(
  lines: readonly TermLine[],
  total: Prisma.Decimal.Value,
  invoiceDate: string,
  receiptDate?: string,
): Instalment[] {
  const sum = new Prisma.Decimal(total);
  const out: Instalment[] = [];
  let allocated = new Prisma.Decimal(0);
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    const amount = last
      ? sum.minus(allocated)
      : sum.mul(l.portionPct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    allocated = allocated.plus(amount);
    const base = l.dueBasis === 'RECEIPT_OF_GOODS' ? (receiptDate ?? invoiceDate) : invoiceDate;
    const dueDate =
      l.dueBasis === 'ADVANCE'
        ? invoiceDate
        : l.dueBasis === 'END_OF_INVOICE_MONTH'
          ? addDays(endOfMonth(base), l.days)
          : addDays(base, l.days);
    out.push({
      lineNo: i + 1,
      amount: amount.toFixed(2),
      dueDate,
      discountPct: new Prisma.Decimal(l.discountPct ?? 0).toString(),
      discountUntil: l.discountDays ? addDays(invoiceDate, l.discountDays) : null,
    });
  });
  return out;
}

export interface PriceRow {
  id: string;
  itemId: string;
  uomCode: string;
  minQty: Prisma.Decimal.Value;
  rate: Prisma.Decimal.Value;
  discountPct: Prisma.Decimal.Value;
  validFrom: string | null;
  validTo: string | null;
}

/** The row with the largest min_qty <= qty that is valid on `date`; a tie goes to the latest valid_from. */
export function pickPriceRow(
  rows: readonly PriceRow[],
  qtyInRowUom: Prisma.Decimal.Value,
  date: string,
): PriceRow | null {
  const qty = new Prisma.Decimal(qtyInRowUom);
  const valid = rows.filter(
    (r) =>
      new Prisma.Decimal(r.minQty).lte(qty) &&
      (!r.validFrom || r.validFrom <= date) &&
      (!r.validTo || r.validTo >= date),
  );
  valid.sort((a, b) => {
    const byQty = new Prisma.Decimal(b.minQty).comparedTo(a.minQty);
    if (byQty !== 0) return byQty;
    return (b.validFrom ?? '').localeCompare(a.validFrom ?? '');
  });
  return valid[0] ?? null;
}

/** Net rate = rate x (1 - discount / 100), 6 decimals like the rate column. */
export function netRate(rate: Prisma.Decimal.Value, discountPct: Prisma.Decimal.Value): string {
  return new Prisma.Decimal(rate)
    .mul(new Prisma.Decimal(100).minus(discountPct))
    .div(100)
    .toDecimalPlaces(6)
    .toString();
}
