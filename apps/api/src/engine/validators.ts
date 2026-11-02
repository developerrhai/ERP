// Format checks for the Indian identifier field types (docs/plan/04-modules.md §4.0.2): GSTIN with
// its check character, PAN, IFSC, HSN/SAC, mobile, UAN and Aadhaar. Pure functions, shared by the
// record schema builder and the tests.
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;
export const PHONE_RE = /^[6-9]\d{9}$/;
export const UAN_RE = /^\d{12}$/;
export const AADHAAR_RE = /^[2-9]\d{11}$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character of a GSTIN, from its first 14 characters (GSTN checksum algorithm). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = CHARS.indexOf(first14.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return CHARS.charAt((36 - (sum % 36)) % 36);
}

export function isGstin(value: string): boolean {
  return GSTIN_RE.test(value) && gstinCheckChar(value.slice(0, 14)) === value.charAt(14);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Masks an Aadhaar number to its last four digits: XXXXXXXX1234. */
export function maskAadhaar(digits: string): string {
  return `XXXXXXXX${digits.slice(-4)}`;
}
export const MASKED_AADHAAR_RE = /^XXXXXXXX\d{4}$/;
