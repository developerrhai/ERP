// A format is data (docs/phases/PHASE-06B.md §3.1): header fields, line columns, totals, print layout
// and validations, stored as JSON. This file is the one definition of that JSON and a pure helper
// that applies a PRINT format to the Phase 4 print DTO.
import { z } from 'zod';
import { Errors } from '../http/errors';
import { compile, ExpressionError } from './expression';

const key = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z][A-Za-z0-9_]{0,39}$/,
    'Use letters, digits and underscore, starting with a letter.',
  );
const text = (max: number) => z.string().trim().max(max);

export const FIELD_TYPES = [
  'text',
  'number',
  'money',
  'percent',
  'date',
  'select',
  'textarea',
] as const;
export const COLUMN_TYPES = ['text', 'number', 'money', 'percent', 'date'] as const;

const headerField = z
  .object({
    key,
    label: text(80).min(1),
    type: z.enum(FIELD_TYPES).default('text'),
    required: z.boolean().default(false),
    options: z.array(text(60).min(1)).max(50).optional(),
    default: text(120).optional(),
    hidden: z.boolean().default(false),
  })
  .strict();

const column = z
  .object({
    key,
    label: text(80).min(1),
    type: z.enum(COLUMN_TYPES).default('text'),
    required: z.boolean().default(false),
    hidden: z.boolean().default(false),
    align: z.enum(['left', 'right']).optional(),
    /** Row formula over other columns (e.g. qty * rate); evaluated by the same safe language. */
    formula: text(300).optional(),
  })
  .strict();

const total = z
  .object({
    key,
    label: text(80).min(1),
    op: z.enum(['sum', 'expression']).default('sum'),
    column: key.optional(),
    expression: text(300).optional(),
  })
  .strict();

const validation = z
  .object({
    field: key,
    rule: z.enum(['required', 'min', 'max', 'pattern']),
    value: text(120).optional(),
    message: text(200).min(1),
  })
  .strict();

export const formatSchemaZ = z
  .object({
    title: text(120).optional(),
    header: z.array(headerField).max(60).default([]),
    columns: z.array(column).max(40).default([]),
    totals: z.array(total).max(20).default([]),
    print: z
      .object({
        paper: z.enum(['A4', 'A5']).default('A4'),
        orientation: z.enum(['portrait', 'landscape']).default('portrait'),
        showLetterhead: z.boolean().default(true),
        showAmountInWords: z.boolean().default(true),
        footerNote: text(500).optional(),
        signatures: z.array(text(60).min(1)).max(8).default([]),
      })
      .strict()
      .default({}),
    validations: z.array(validation).max(60).default([]),
  })
  .strict();

export type FormatSchema = z.infer<typeof formatSchemaZ>;

function dup(items: { key: string }[], what: string): void {
  const seen = new Set<string>();
  for (const i of items) {
    const k = i.key.toLowerCase();
    if (seen.has(k)) throw Errors.validation({ schema: `The ${what} "${i.key}" is used twice.` });
    seen.add(k);
  }
}

/** Throws a plain-English VALIDATION_ERROR when the format JSON is not usable. */
export function validateFormatSchema(raw: unknown): FormatSchema {
  const parsed = formatSchemaZ.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Errors.validation({
      schema: `${issue?.path.join('.') || 'format'}: ${issue?.message ?? 'is not valid'}`,
    });
  }
  const f = parsed.data;
  dup(f.header, 'field');
  dup(f.columns, 'column');
  dup(f.totals, 'total');
  const columns = new Set(f.columns.map((c) => c.key.toLowerCase()));
  for (const c of f.columns) {
    if (c.formula) {
      try {
        const compiled = compile(c.formula);
        for (const n of compiled.names) {
          if (!columns.has(n.toLowerCase()) || n.toLowerCase() === c.key.toLowerCase()) {
            throw new ExpressionError(`"${n}" is not another column`);
          }
        }
      } catch (err) {
        if (err instanceof ExpressionError) throw Errors.formulaInvalid(c.label, err.reason);
        throw err;
      }
    }
  }
  for (const t of f.totals) {
    if (t.op === 'sum' && !(t.column && columns.has(t.column.toLowerCase()))) {
      throw Errors.validation({ schema: `Total "${t.label}" must add up one of the columns.` });
    }
    if (t.op === 'expression') {
      if (!t.expression) throw Errors.validation({ schema: `Total "${t.label}" needs a formula.` });
      try {
        const compiled = compile(t.expression);
        const totalKeys = new Set(f.totals.map((x) => x.key.toLowerCase()));
        for (const n of compiled.names) {
          if (!totalKeys.has(n.toLowerCase()) || n.toLowerCase() === t.key.toLowerCase()) {
            throw new ExpressionError(`"${n}" is not another total`);
          }
        }
      } catch (err) {
        if (err instanceof ExpressionError) throw Errors.formulaInvalid(t.label, err.reason);
        throw err;
      }
    }
  }
  const fieldKeys = new Set([...f.header, ...f.columns].map((x) => x.key.toLowerCase()));
  for (const v of f.validations) {
    if (!fieldKeys.has(v.field.toLowerCase())) {
      throw Errors.validation({ schema: `Validation: "${v.field}" is not a field or a column.` });
    }
    if (v.rule !== 'required' && !v.value) {
      throw Errors.validation({ schema: `Validation on "${v.field}" needs a value.` });
    }
    if (v.rule === 'pattern') {
      try {
        // Only checks that it compiles; very long or nested patterns are refused (ReDoS guard).
        if ((v.value ?? '').length > 80 || /\([^)]*[+*][^)]*\)[+*]/.test(v.value ?? '')) {
          throw new Error('too complex');
        }
        new RegExp(v.value ?? '');
      } catch {
        throw Errors.validation({
          schema: `Validation on "${v.field}": the pattern is not valid.`,
        });
      }
    }
  }
  return f;
}

/** The slice of the Phase 4 print DTO a PRINT format may restyle. */
export interface PrintLike {
  title: string;
  lines: {
    columns: { key: string; label: string; format: string; align?: 'left' | 'right' }[];
    rows: Record<string, unknown>[];
  } | null;
  amountInWords?: string | undefined;
  notes?: string | undefined;
  signatures: { label: string; name?: string | undefined }[];
  letterhead: Record<string, string>;
  layout?: { paper: string; orientation: string; showLetterhead: boolean } | undefined;
  formatVersion?: { id: string; version: number } | undefined;
}

/** Applies the published PRINT format to a built print document; the data itself never changes. */
export function applyPrintFormat<T extends PrintLike>(
  dto: T,
  schema: FormatSchema,
  info: { id: string; version: number },
): T {
  const out: T = { ...dto };
  if (schema.title) out.title = schema.title;
  if (dto.lines && schema.columns.length > 0) {
    const byKey = new Map(schema.columns.map((c) => [c.key.toLowerCase(), c]));
    const original = dto.lines.columns;
    const ordered = [
      ...schema.columns
        .map((c) => original.find((o) => o.key.toLowerCase() === c.key.toLowerCase()))
        .filter((o): o is (typeof original)[number] => o !== undefined),
      ...original.filter((o) => !byKey.has(o.key.toLowerCase())),
    ];
    out.lines = {
      columns: ordered
        .filter((o) => !byKey.get(o.key.toLowerCase())?.hidden)
        .map((o) => {
          const c = byKey.get(o.key.toLowerCase());
          return c ? { ...o, label: c.label, ...(c.align ? { align: c.align } : {}) } : o;
        }),
      rows: dto.lines.rows,
    };
  }
  if (!schema.print.showAmountInWords) out.amountInWords = undefined;
  if (schema.print.footerNote) out.notes = schema.print.footerNote;
  if (schema.print.signatures.length > 0) {
    out.signatures = schema.print.signatures.map((label) => ({ label }));
  }
  if (!schema.print.showLetterhead) out.letterhead = {};
  out.layout = {
    paper: schema.print.paper,
    orientation: schema.print.orientation,
    showLetterhead: schema.print.showLetterhead,
  };
  out.formatVersion = info;
  return out;
}
