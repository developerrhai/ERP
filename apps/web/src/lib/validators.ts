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

// ---------------------------------------------------------------------------------------------------------------
// Shared form rules (QA ERP-VAL-01 / ERP-VAL-02): one place decides what kind of input a form field is and whether
// its value is acceptable, so every Add / Edit modal blocks blank, wrong-format and negative entries the same way.
// ---------------------------------------------------------------------------------------------------------------
export const MOBILE_RE = /^\d{10}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MOBILE_MESSAGE = 'Mobile must be exactly 10 digits.';
export const DATE_MESSAGE = 'Pick a date from the calendar (YYYY-MM-DD).';

/** The controlled status list of the Demo ERP: a status is always picked, never typed. */
export const STATUS_OPTIONS: readonly string[] = [
  'Active',
  'Pending',
  'In Transit',
  'Calculated',
  'Waiting',
  'Completed',
  'Closed',
];
/** Asset records use the asset life-cycle list. */
export const ASSET_STATUS_OPTIONS: readonly string[] = [
  'Active',
  'In Use',
  'Pending',
  'Under Maintenance',
  'Completed',
  'Disposed',
  'Closed',
];

export type FieldKind =
  | 'text'
  | 'name'
  | 'place'
  | 'date'
  | 'status'
  | 'number'
  | 'quantity'
  | 'gstin'
  | 'pan'
  | 'mobile'
  | 'email';

/** Guess the input kind from a column / field label (and its declared type, when the page knows it). */
export function inferFieldKind(label: string, declaredType?: string): FieldKind {
  const l = label.toLowerCase();
  if (/\bgstin\b|gst\s*(no|number|in)\b/.test(l)) return 'gstin';
  if (/\bpan\b/.test(l)) return 'pan';
  if (/\b(mobile|phone|contact\s*no|contact\s*number|cell)\b/.test(l)) return 'mobile';
  if (/\be-?mail\b/.test(l)) return 'email';
  if (/\bstatus\b/.test(l)) return 'status';
  if (
    declaredType === 'date' ||
    /\bdate\b|\bvalid\s*(till|upto|to|from)\b|\bexpiry\b|\bdue\b(?!\s*(amount|balance))|\bdob\b|\bscheduled\b/.test(
      l,
    )
  )
    return 'date';
  if (/\b(qty|quantity|units|count|pcs|nos)\b/.test(l)) return 'quantity';
  if (
    declaredType === 'num' ||
    declaredType === 'inr' ||
    /\b(amount|cost|value|price|rate|weight|km|distance|score|rating|freight|depreciation|salary|balance|capacity|life|hours|percent|%)\b/.test(
      l,
    )
  )
    return 'number';
  if (/\b(city|town|state|country|district|location\s*city)\b/.test(l)) return 'place';
  if (
    /\b(name|party|customer|supplier|vendor|driver|employee|owner|custodian|transporter|contact\s*person)\b/.test(
      l,
    )
  )
    return 'name';
  return 'text';
}

/** True when the value is a real calendar date written YYYY-MM-DD. */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export interface FieldRule {
  label: string;
  kind: FieldKind;
  required: boolean;
  /** For a status kind: the controlled list the value must come from. */
  options?: readonly string[];
}

/** Error text for one value under its rule; undefined = fine. Empty is only an error when the field is required. */
export function fieldRuleError(rule: FieldRule, raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return rule.required ? `${rule.label} is required.` : undefined;
  switch (rule.kind) {
    case 'gstin':
      return GSTIN_RE.test(v.toUpperCase()) ? undefined : GSTIN_MESSAGE;
    case 'pan':
      return PAN_RE.test(v.toUpperCase()) ? undefined : PAN_MESSAGE;
    case 'mobile':
      return MOBILE_RE.test(v) ? undefined : MOBILE_MESSAGE;
    case 'email':
      return EMAIL_RE.test(v) ? undefined : 'Enter a valid email address.';
    case 'date':
      return isIsoDate(v) ? undefined : DATE_MESSAGE;
    case 'status': {
      const list = rule.options ?? STATUS_OPTIONS;
      return list.includes(v) ? undefined : `${rule.label}: choose one of ${list.join(', ')}.`;
    }
    case 'number':
    case 'quantity': {
      if (!/^-?\d+(\.\d+)?$/.test(v)) return `${rule.label} must be a number (digits only).`;
      return Number(v) < 0 ? `${rule.label} cannot be negative.` : undefined;
    }
    case 'place':
      return /^[A-Za-z][A-Za-z .'-]*$/.test(v)
        ? undefined
        : `${rule.label} must contain letters only.`;
    case 'name':
      return /[A-Za-z]/.test(v)
        ? undefined
        : `${rule.label} must contain letters, not only digits or symbols.`;
    default:
      return undefined;
  }
}
