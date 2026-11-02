// Validates a record's `data` against its page schema (docs/phase3-4 B3): one zod schema per field
// type, built from the field metadata. Unknown keys -> 422, read-only keys (code, status) are
// ignored, blank optional values are cleared, required fields must be present on create. Also
// derives the list columns amount (first money) and doc_date (first date) and masks Aadhaar.
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { Errors } from '../core/http/errors';
import type { FieldErrors } from '../core/http/errors';
import type { PageSchema } from './field-schema';
import { LONGTEXT_MAX, TEXT_MAX } from './field-schema';
import type { FieldMeta } from './field-types';
import {
  AADHAAR_RE,
  HSN_RE,
  IFSC_RE,
  MASKED_AADHAAR_RE,
  PAN_RE,
  PHONE_RE,
  UAN_RE,
  isGstin,
  isIsoDate,
  maskAadhaar,
} from './validators';

/** Prefix of the hidden per-record hash key stored next to a masked Aadhaar value. */
export const HASH_KEY_PREFIX = '_h_';

const stripHtml = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : value;
const upper = (value: unknown): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const compact = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;
const numeric = (value: unknown): unknown =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;

const cache = new WeakMap<FieldMeta, z.ZodTypeAny>();

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numberSchema(f: FieldMeta, places: number): z.ZodTypeAny {
  return z.preprocess(
    numeric,
    z
      .number({ invalid_type_error: 'Enter a number.' })
      .finite('Enter a number.')
      .min(f.min ?? 0, f.min === 0 ? 'Must not be negative.' : `Must be at least ${f.min}.`)
      .max(f.max ?? Number.MAX_SAFE_INTEGER, `Must be at most ${f.max}.`)
      .transform((n) => roundTo(n, places)),
  );
}

function buildFieldSchema(f: FieldMeta): z.ZodTypeAny {
  const text = (max: number) =>
    z.preprocess(
      stripHtml,
      z
        .string({ invalid_type_error: 'Enter text.' })
        .min(f.minLength ?? 0, `At least ${f.minLength} characters.`)
        .max(max, `At most ${max} characters.`),
    );
  switch (f.type) {
    case 'money':
      return numberSchema(f, 2);
    case 'pct':
      return numberSchema(f, 2).refine((n) => (n as number) <= 100, 'Must be at most 100.');
    case 'qty':
      return numberSchema(f, 3);
    case 'bool':
      return z.boolean({ invalid_type_error: 'Choose Yes or No.' });
    case 'date':
      return z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD).'),
      );
    case 'datetime':
      return z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z
          .string()
          .refine(
            (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)),
            'Enter a valid date and time (YYYY-MM-DDTHH:mm).',
          ),
      );
    case 'email':
      return z.preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.string().max(254).email('Enter a valid email address.'),
      );
    case 'phone':
      return z.preprocess(
        compact,
        z.string().regex(PHONE_RE, 'Enter a 10-digit Indian mobile number.'),
      );
    case 'gstin':
      return z.preprocess(upper, z.string().refine(isGstin, 'Enter a valid 15-character GSTIN.'));
    case 'pan':
      return z.preprocess(upper, z.string().regex(PAN_RE, 'Enter a valid PAN (e.g. ABCDE1234F).'));
    case 'ifsc':
      return z.preprocess(
        upper,
        z.string().regex(IFSC_RE, 'Enter a valid IFSC (e.g. HDFC0001234).'),
      );
    case 'hsn':
      return z.preprocess(compact, z.string().regex(HSN_RE, 'Enter a 4, 6 or 8 digit HSN/SAC.'));
    case 'uan':
      return z.preprocess(compact, z.string().regex(UAN_RE, 'Enter a 12-digit UAN.'));
    case 'aadhaar':
      return z.preprocess(
        compact,
        z
          .string()
          .refine(
            (v) => AADHAAR_RE.test(v) || MASKED_AADHAAR_RE.test(v),
            'Enter a valid 12-digit Aadhaar number.',
          ),
      );
    case 'enum':
      return f.options && f.options.length > 0
        ? z.preprocess(
            stripHtml,
            z
              .string()
              .refine((v) => f.options?.includes(v), `Choose one of: ${f.options.join(', ')}.`),
          )
        : text(TEXT_MAX);
    case 'longtext':
      return text(LONGTEXT_MAX);
    case 'ref':
      if (f.lookup) {
        return z
          .string({ invalid_type_error: 'Choose from the list.' })
          .uuid('Choose from the list.');
      }
      return text(f.maxLength ?? TEXT_MAX);
    default:
      return text(f.maxLength ?? TEXT_MAX);
  }
}

function schemaOf(f: FieldMeta): z.ZodTypeAny {
  let schema = cache.get(f);
  if (!schema) {
    schema = buildFieldSchema(f);
    cache.set(f, schema);
  }
  return schema;
}

export interface ValidatedInput {
  /** Values to store (create: all given; patch: only the given keys). */
  values: Record<string, unknown>;
  /** Optional keys the caller blanked (null / ''): to remove from data. */
  cleared: string[];
  /** Aadhaar fields whose value is a new full number: key -> 12 digits. */
  aadhaar: Record<string, string>;
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function validateRecordInput(
  schema: PageSchema,
  input: Record<string, unknown>,
  mode: 'create' | 'patch',
): ValidatedInput {
  const byKey = new Map(schema.fields.map((f) => [f.key, f]));
  const errors: FieldErrors = {};
  const values: Record<string, unknown> = {};
  const cleared: string[] = [];
  const aadhaar: Record<string, string> = {};

  for (const [key, raw] of Object.entries(input)) {
    const field = byKey.get(key);
    if (!field) {
      errors[key] = 'Unknown field.';
      continue;
    }
    if (field.readOnly) continue;
    if (isBlank(raw)) {
      if (field.required) errors[key] = 'This field is required.';
      else cleared.push(key);
      continue;
    }
    const parsed = schemaOf(field).safeParse(raw);
    if (!parsed.success) {
      errors[key] = parsed.error.issues[0]?.message ?? 'Invalid value.';
      continue;
    }
    values[key] = parsed.data;
    if (field.type === 'aadhaar' && AADHAAR_RE.test(String(parsed.data))) {
      aadhaar[key] = String(parsed.data);
    }
  }
  if (mode === 'create') {
    for (const field of schema.fields) {
      if (field.required && !field.readOnly && values[field.key] === undefined) {
        errors[field.key] ??= 'This field is required.';
      }
    }
  }
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
  return { values, cleared, aadhaar };
}

/** HMAC-SHA256 of an Aadhaar number, keyed with the server secret (never returned by the API). */
export function aadhaarHash(digits: string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(`aadhaar:${digits}`).digest('hex');
}

/** Replaces full Aadhaar numbers by the masked value + hash entry, in place. */
export function applyAadhaar(
  data: Record<string, unknown>,
  numbers: Record<string, string>,
): Record<string, unknown> {
  for (const [key, digits] of Object.entries(numbers)) {
    data[key] = maskAadhaar(digits);
    data[`${HASH_KEY_PREFIX}${key}`] = aadhaarHash(digits);
  }
  return data;
}

/** A masked Aadhaar value sent back unchanged must equal what is stored; otherwise it is invalid. */
export function assertMaskedUnchanged(
  schema: PageSchema,
  values: Record<string, unknown>,
  existing: Record<string, unknown>,
): void {
  const errors: FieldErrors = {};
  for (const field of schema.fields) {
    const value = values[field.key];
    if (field.type === 'aadhaar' && typeof value === 'string' && MASKED_AADHAAR_RE.test(value)) {
      if (existing[field.key] !== value)
        errors[field.key] = 'Enter the full 12-digit Aadhaar number.';
      else delete values[field.key];
    }
  }
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
}

/** The list columns derived from data: first money field -> amount, first date field -> doc_date. */
export function deriveColumns(
  schema: PageSchema,
  data: Record<string, unknown>,
): { amount: number | null; docDate: string | null } {
  const money = schema.fields.find((f) => f.type === 'money');
  const date = schema.fields.find((f) => f.type === 'date');
  const amount = money ? data[money.key] : undefined;
  const docDate = date ? data[date.key] : undefined;
  return {
    amount: typeof amount === 'number' ? amount : null,
    docDate: typeof docDate === 'string' ? docDate : null,
  };
}

/** Removes the hidden hash entries before a record leaves the API. */
export function publicData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith(HASH_KEY_PREFIX)));
}
