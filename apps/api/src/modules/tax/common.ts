// Shared helpers for the Phase 11 tax services: the GSTIN of a unit, month arithmetic, dated statutory rules.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { validateGstin } from '../masters/party-rules';
import { knownStates } from '../masters/tax-service';
import { D, ZERO, money } from '../finance/money';
import type { Dec } from '../finance/money';

export type Row = Record<string, unknown>;
export const S = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  // Decimals and Dates have their own toString; only plain objects are JSON
  if (typeof v === 'object' && v.toString === Object.prototype.toString) return JSON.stringify(v);
  return String(v as string);
};
export const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : S(v).slice(0, 10);
export { D, ZERO, money };
export type { Dec };

export function parseMonth(m: string): { start: string; end: string; label: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))
    throw Errors.validation({ month: 'Use the month as YYYY-MM.' });
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${m}-01`, end: `${m}-${String(last).padStart(2, '0')}`, label: m };
}

/** DD-MM-YYYY as the GSTN offline tool wants it */
export const ddmmyyyy = (isoDate: string): string =>
  `${isoDate.slice(8, 10)}-${isoDate.slice(5, 7)}-${isoDate.slice(0, 4)}`;

export interface UnitGst {
  unitId: string;
  unitName: string;
  gstin: string;
  stateCode: string;
  legalName: string;
  address: string;
  city: string;
  pincode: string;
  minHsnDigits: number;
  einvoiceEnabled: boolean;
  filingFrequency: string;
}

/** The GSTIN a unit files under. A unit with no valid GSTIN cannot prepare a return (E-31: set per unit as data). */
export async function unitGst(unitId: string | null, db: Db = prisma): Promise<UnitGst> {
  if (!unitId)
    throw Errors.validation({ unit: 'Choose one unit in the top bar. Returns are per GSTIN.' });
  const u = (
    // unpaginated: rows of one parent (id)
    await db.$queryRawUnsafe<Row[]>(
      `SELECT id::text, name, gstin, state_code, city, pincode, state FROM units WHERE id=$1::uuid`,
      unitId,
    )
  )[0];
  if (!u) throw Errors.notFound('Unit not found.');
  const gstin = S(u.gstin);
  const states = await knownStates(db);
  const v = gstin ? validateGstin(gstin, states.codes) : null;
  if (!v || !v.ok)
    throw new AppError(
      422,
      'GSTIN_REQUIRED',
      `Unit ${S(u.name)} has no valid GSTIN. Enter it in Unit Master first.`,
      { unit: 'No valid GSTIN.' },
    );
  const reg = (
    await db.$queryRawUnsafe<Row[]>(
      `SELECT legal_name, min_hsn_digits, einvoice_enabled, filing_frequency FROM gst_registrations
        WHERE gstin=$1 AND deleted_at IS NULL AND status='ACTIVE' LIMIT 1`,
      gstin,
    )
  )[0];
  return {
    unitId,
    unitName: S(u.name),
    gstin,
    stateCode: S(u.state_code || gstin.slice(0, 2)),
    legalName: S(reg?.legal_name || u.name),
    address: S(u.state),
    city: S(u.city),
    pincode: S(u.pincode),
    minHsnDigits: Number(reg?.min_hsn_digits ?? 6),
    einvoiceEnabled: reg?.einvoice_enabled === true,
    filingFrequency: S(reg?.filing_frequency || 'MONTHLY'),
  };
}

/** A dated statutory number (tax_rules). Returns null when the rule has no row valid on the date. */
export async function taxRule(
  key: string,
  on: string,
  db: Db = prisma,
): Promise<{ num: Dec | null; text: string | null; needsReview: boolean } | null> {
  const r = (
    await db.$queryRawUnsafe<Row[]>(
      `SELECT value_num::text, value_text, needs_review FROM tax_rules
        WHERE rule_key=$1 AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC LIMIT 1`,
      key,
      on,
    )
  )[0];
  if (!r) return null;
  return {
    num: r.value_num === null ? null : D(S(r.value_num)),
    text: r.value_text === null ? null : S(r.value_text),
    needsReview: r.needs_review === true,
  };
}

export async function ruleNum(key: string, on: string, db: Db = prisma): Promise<Dec> {
  const r = await taxRule(key, on, db);
  if (!r || r.num === null)
    throw Errors.validation({
      rule: `The statutory rule ${key} has no value for ${on}. Add it in Tax Rules.`,
    });
  return r.num;
}

export const num2 = (v: Dec): number => Number(v.toFixed(2));

/** an active, non-group cost centre of the unit (statutory journals need one on expense lines) */
export async function costCenterOf(db: Db, unitId: string): Promise<string | null> {
  const r = (
    await db.$queryRawUnsafe<Row[]>(
      `SELECT id::text FROM cost_centers WHERE unit_id=$1::uuid AND NOT is_group AND status='Active'
        ORDER BY (code LIKE '%-STORE') DESC, code LIMIT 1`,
      unitId,
    )
  )[0];
  return r ? S(r.id) : null;
}
