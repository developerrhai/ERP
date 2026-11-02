// Indian tax-ID formats (GSTIN, PAN, CIN) shared by Letterhead, Company and Unit forms so the
// client mirrors the server rules in one place (the server still re-validates).
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
export const CODE_RE = /^[A-Z0-9]{2,10}$/;

export const GSTIN_MESSAGE = 'GSTIN must be 15 characters, e.g. 27ABCDE1234F1Z5.';
export const PAN_MESSAGE = 'PAN must look like ABCDE1234F.';
export const CIN_MESSAGE = 'CIN must be 21 characters, e.g. U12345MH2020PTC123456.';
export const CODE_MESSAGE = 'Code: 2–10 capital letters or digits.';

/** Error text for an optional tax ID: empty is fine, otherwise it must match. */
export function taxIdError(kind: 'gstin' | 'pan' | 'cin', value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (kind === 'gstin') return GSTIN_RE.test(v) ? undefined : GSTIN_MESSAGE;
  if (kind === 'pan') return PAN_RE.test(v) ? undefined : PAN_MESSAGE;
  return CIN_RE.test(v) ? undefined : CIN_MESSAGE;
}
