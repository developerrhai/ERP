// "End must not be before start" for the obvious date pairs of a page (docs/phase3-4 fix round):
// Start/End, From/To, Valid From/Till, Effective From/To, Planned Start/End, Issue/Expiry,
// Mfg/Expiry, Joining/Confirmation, Resignation/Last Working, Start Date/Due|Close|Closing|Target.
// The error is reported on the later field.
import { Errors } from '../core/http/errors';
import type { FieldErrors } from '../core/http/errors';
import type { PageSchema } from './field-schema';
import type { FieldMeta } from './field-types';

const START = /^(.*?)\s*(start|from)(\s+date)?$/i;
const END = /^(.*?)\s*(end|to|till|until)(\s+date)?$/i;

/** Explicit pairs: [start label, end label], lower case. */
const EXPLICIT_PAIRS: readonly (readonly [string, string])[] = [
  ['issue date', 'expiry date'],
  ['mfg date', 'expiry date'],
  ['joining date', 'confirmation date'],
  ['resignation date', 'last working date'],
  ['start date', 'due date'],
  ['start date', 'close date'],
  ['start date', 'closing date'],
  ['start date', 'target date'],
];

export interface DatePair {
  start: FieldMeta;
  end: FieldMeta;
}

const isDateField = (f: FieldMeta) => f.type === 'date' || f.type === 'datetime';

/** The start/end pairs of a page (cached by the caller through the schema object). */
export function datePairsOf(schema: PageSchema): DatePair[] {
  const dates = schema.fields.filter(isDateField);
  const byLabel = new Map(dates.map((f) => [f.label.toLowerCase().trim(), f]));
  const pairs: DatePair[] = [];
  const seen = new Set<string>();
  const add = (start: FieldMeta | undefined, end: FieldMeta | undefined) => {
    if (!start || !end || start.key === end.key) return;
    const id = `${start.key}>${end.key}`;
    if (seen.has(id)) return;
    seen.add(id);
    pairs.push({ start, end });
  };
  for (const f of dates) {
    const start = START.exec(f.label.trim());
    if (!start) continue;
    const prefix = (start[1] ?? '').toLowerCase().trim();
    const end = dates.find((g) => {
      const m = END.exec(g.label.trim());
      return m !== null && (m[1] ?? '').toLowerCase().trim() === prefix && g.key !== f.key;
    });
    add(f, end);
  }
  for (const [s, e] of EXPLICIT_PAIRS) add(byLabel.get(s), byLabel.get(e));
  return pairs;
}

const pairCache = new WeakMap<PageSchema, DatePair[]>();

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * 422 on the later field when an end value is before its start value. Only pairs that involve a
 * field in `touched` are checked, so an old inconsistent record can still be edited elsewhere.
 */
export function assertDateOrder(
  schema: PageSchema,
  data: Record<string, unknown>,
  touched: ReadonlySet<string>,
): void {
  let pairs = pairCache.get(schema);
  if (!pairs) {
    pairs = datePairsOf(schema);
    pairCache.set(schema, pairs);
  }
  const errors: FieldErrors = {};
  for (const { start, end } of pairs) {
    if (!touched.has(start.key) && !touched.has(end.key)) continue;
    const from = time(data[start.key]);
    const to = time(data[end.key]);
    if (from !== null && to !== null && to < from) {
      errors[end.key] = `Must not be before ${start.label}.`;
    }
  }
  if (Object.keys(errors).length > 0) throw Errors.validation(errors);
}
