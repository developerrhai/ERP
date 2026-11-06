// Turns one spreadsheet row into the `input` object of the record engine, and checks it with the SAME
// rules as the API (validateRecordInput + date order), so an imported row can never be worse than a
// typed one.
import { AppError } from '../../core/http/errors';
import type { FieldErrors } from '../../core/http/errors';
import { assertDateOrder } from '../../engine/date-order';
import type { PageSchema } from '../../engine/field-schema';
import type { FieldMeta } from '../../engine/field-types';
import { NUMERIC_TYPES } from '../../engine/field-types';
import { applyAadhaar, validateRecordInput } from '../../engine/record-input';
import type { Cell } from './parse';

/** field key -> 0-based column index in the uploaded sheet. */
export type ColumnMapping = Record<string, number>;

export function importableFields(schema: PageSchema): FieldMeta[] {
  return schema.fields.filter((f) => f.type !== 'code' && f.type !== 'status' && !f.readOnly);
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Header text -> field, by label or key, ignoring case and punctuation. */
export function suggestMapping(schema: PageSchema, headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const f of importableFields(schema)) {
    const idx = headers.findIndex(
      (h, i) => !used.has(i) && [norm(f.label), norm(f.key)].includes(norm(h)),
    );
    if (idx >= 0) {
      mapping[f.key] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

function toIsoDate(text: string): string {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text.trim());
  if (!m) return text.trim();
  return `${m[3]}-${m[2]?.padStart(2, '0')}-${m[1]?.padStart(2, '0')}`;
}

function convert(field: FieldMeta, raw: Cell): unknown {
  if (raw === null) return null;
  if (typeof raw === 'boolean') return raw;
  const text = typeof raw === 'number' ? raw : raw.trim();
  if (text === '') return null;
  if (field.type === 'bool' && typeof text === 'string') {
    if (/^(yes|y|true|1)$/i.test(text)) return true;
    if (/^(no|n|false|0)$/i.test(text)) return false;
    return text;
  }
  if (NUMERIC_TYPES.has(field.type) && typeof text === 'string') {
    const cleaned = text.replace(/[₹,\s%]/g, '');
    return cleaned !== '' && !Number.isNaN(Number(cleaned)) ? Number(cleaned) : text;
  }
  if (field.type === 'date' && typeof text === 'string') return toIsoDate(text);
  return text;
}

export function rowInput(
  schema: PageSchema,
  mapping: ColumnMapping,
  row: readonly Cell[],
): Record<string, unknown> {
  const byKey = new Map(schema.fields.map((f) => [f.key, f]));
  const input: Record<string, unknown> = {};
  for (const [key, index] of Object.entries(mapping)) {
    const field = byKey.get(key);
    if (!field) continue;
    const value = convert(field, row[index] ?? null);
    if (value !== null) input[key] = value;
  }
  return input;
}

/** null = the row is valid; otherwise field -> message. */
export function checkRow(schema: PageSchema, input: Record<string, unknown>): FieldErrors | null {
  try {
    const v = validateRecordInput(schema, input, 'create');
    const data = applyAadhaar({ ...v.values }, v.aadhaar);
    assertDateOrder(schema, data, new Set(Object.keys(v.values)));
    return null;
  } catch (err) {
    if (err instanceof AppError) return err.fields ?? { _: err.message };
    throw err;
  }
}

export function duplicateKey(input: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

/** The field that identifies a record to a human: the first required text field. */
export function naturalKeyField(schema: PageSchema): FieldMeta | undefined {
  const text = importableFields(schema).filter((f) => f.type === 'text');
  return text.find((f) => f.required) ?? text[0];
}
