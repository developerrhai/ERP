// Phase 12 pure rules (no database): judging a reading row against its limits, the overall result of a sheet,
// header validation against a template, calibration status and the PPM / quality-cost arithmetic.
// Limits, targets and the reminder window are data (R-16); nothing here knows a customer's tolerance.
import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);

export type RowStatus = 'PENDING' | 'OK' | 'NOT_OK' | 'NA';
export type RowType = 'NUMERIC' | 'ATTRIBUTE';

export interface JudgeInput {
  rowType: RowType;
  lsl: string | null;
  usl: string | null;
  readings: string[];
}
export interface JudgeResult {
  status: RowStatus;
  /** readings that could not be understood, with the reason in plain English */
  invalid: string[];
}

const NUM = /^-?\d+(\.\d+)?$/;

/** One row: every filled reading must be inside [lsl, usl] (numeric) or say OK (attribute). */
export function judgeRow(r: JudgeInput): JudgeResult {
  const filled = r.readings.map((x) => x.trim()).filter((x) => x !== '');
  if (filled.length === 0) return { status: 'PENDING', invalid: [] };
  const invalid: string[] = [];
  let bad = false;
  let judged = 0;
  for (const raw of filled) {
    if (r.rowType === 'ATTRIBUTE') {
      const v = raw.toUpperCase().replace(/\s+/g, ' ');
      if (v === 'OK') judged += 1;
      else if (v === 'NOT OK' || v === 'NOK') {
        judged += 1;
        bad = true;
      } else if (v === 'NA' || v === 'N/A') continue;
      else invalid.push(`"${raw}" is not OK, NOT OK or NA.`);
      continue;
    }
    const n = raw;
    if (!NUM.test(n)) {
      invalid.push(`"${raw}" is not a number.`);
      continue;
    }
    if (r.lsl === null && r.usl === null) continue;
    judged += 1;
    const v = D(n);
    if (r.lsl !== null && v.lt(D(r.lsl))) bad = true;
    if (r.usl !== null && v.gt(D(r.usl))) bad = true;
  }
  if (bad) return { status: 'NOT_OK', invalid };
  return { status: judged > 0 ? 'OK' : 'NA', invalid };
}

/** NOT_OK anywhere -> REJECTED; otherwise ACCEPTED when at least one row was judged; null when nothing is filled in. */
export function overallResult(statuses: RowStatus[]): 'ACCEPTED' | 'REJECTED' | null {
  if (statuses.includes('NOT_OK')) return 'REJECTED';
  if (statuses.some((s) => s === 'OK' || s === 'NA')) return 'ACCEPTED';
  return null;
}

export interface HeaderField {
  key: string;
  label: string;
  type?:
    | 'text'
    | 'textarea'
    | 'date'
    | 'number'
    | 'select'
    | 'item'
    | 'customer'
    | 'supplier'
    | 'instrument';
  required?: boolean;
  options?: string[];
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the values of a form against its template. Returns field -> plain-English message. */
export function headerErrors(
  fields: HeaderField[],
  values: Record<string, unknown>,
  opts: { requireAll?: boolean } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(values)) if (!known.has(k)) out[k] = 'This field is not in the form.';
  for (const f of fields) {
    const raw = values[f.key];
    const v = raw === undefined || raw === null ? '' : String(raw as string).trim();
    if (v === '') {
      if (f.required && opts.requireAll !== false) out[f.key] = `Enter ${f.label.toLowerCase()}.`;
      continue;
    }
    if (v.length > 4000) out[f.key] = 'This is too long.';
    else if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
      out[f.key] = 'Use a date like 2026-11-30.';
    else if (f.type === 'number' && !NUM.test(v)) out[f.key] = 'Enter a number.';
    else if (f.type === 'select' && !(f.options ?? []).includes(v))
      out[f.key] = `Choose one of: ${(f.options ?? []).join(', ')}.`;
    else if (
      (f.type === 'item' ||
        f.type === 'customer' ||
        f.type === 'supplier' ||
        f.type === 'instrument') &&
      !UUID.test(v)
    )
      out[f.key] = `Choose ${f.label.toLowerCase()} from the list.`;
  }
  return out;
}

export type CalStatus = 'NOT_CALIBRATED' | 'EXPIRED' | 'DUE_SOON' | 'VALID';
const dayNo = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

export function calibrationStatus(
  validUntil: string | null,
  today: string,
  reminderDays: number,
): CalStatus {
  if (!validUntil) return 'NOT_CALIBRATED';
  const left = dayNo(validUntil) - dayNo(today);
  if (left < 0) return 'EXPIRED';
  return left <= reminderDays ? 'DUE_SOON' : 'VALID';
}
export const daysLeft = (validUntil: string, today: string): number =>
  dayNo(validUntil) - dayNo(today);

/** date + n calendar months; the day is clamped to the last day of the month (31-Jan + 1 month = 28/29-Feb). */
export function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const d = Number(iso.slice(8, 10));
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** parts per million = rejected / produced x 1,000,000 (2 decimals); null when nothing was produced */
export function ppm(rejected: string, produced: string): string | null {
  const p = D(produced);
  if (p.lte(0)) return null;
  return D(rejected).mul(1_000_000).div(p).toDecimalPlaces(2).toFixed(2);
}
/** quality cost % = total cost / sales value x 100 (2 decimals); null when sales are zero */
export function costPercent(total: string, sales: string): string | null {
  const s = D(sales);
  if (s.lte(0)) return null;
  return D(total).mul(100).div(s).toDecimalPlaces(2).toFixed(2);
}
/** 'OK' when value <= target, 'OVER' when above, null when there is no target or no value */
export function againstTarget(value: string | null, target: string | null): 'OK' | 'OVER' | null {
  if (value === null || target === null) return null;
  return D(value).lte(D(target)) ? 'OK' : 'OVER';
}
