// RuleEngine (docs/phases/PHASE-06B.md §3.3, §5): a rule set is DATA (inputs, named parameters, rate
// tables and output formulas). validateDefinition() checks it before it can be saved or published;
// evaluate() is pure: no network, no I/O, deterministic, Decimal maths only.
import { z } from 'zod';
import { Errors } from '../http/errors';
import { compile, Dec, ExpressionError, evaluateNumber } from './expression';
import type { CompiledExpression, DecimalValue, TableData } from './expression';

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const RESERVED = new Set(['true', 'false', 'and', 'or', 'not']);
const DECIMAL_RE = /^-?\d{1,18}(\.\d{1,8})?$/;

const nameSchema = z
  .string()
  .trim()
  .regex(NAME_RE, 'Use letters, digits and underscore, starting with a letter (max 40).');
const labelSchema = z.string().trim().max(120).optional();
const decimalString = z.string().trim().regex(DECIMAL_RE, 'Enter a number such as 12.5');

export const ruleDefinitionSchema = z
  .object({
    inputs: z
      .array(
        z
          .object({ name: nameSchema, label: labelSchema, default: decimalString.optional() })
          .strict(),
      )
      .max(60)
      .default([]),
    parameters: z
      .array(
        z
          .object({
            name: nameSchema,
            label: labelSchema,
            value: decimalString,
            unit: z.enum(['amount', 'percent', 'rate', 'number']).optional(),
          })
          .strict(),
      )
      .max(120)
      .default([]),
    tables: z
      .array(
        z
          .object({
            name: nameSchema,
            label: labelSchema,
            columns: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
            rows: z.array(z.array(z.string().trim().max(120)).min(1).max(12)).max(500),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    outputs: z
      .array(
        z
          .object({
            name: nameSchema,
            label: labelSchema,
            expression: z.string().trim().min(1).max(1000),
            places: z.number().int().min(0).max(6).optional(),
          })
          .strict(),
      )
      .min(1, 'Add at least one result.')
      .max(80),
    /** How a generic document page uses the rule set (all optional). */
    bindings: z
      .object({
        inputs: z.record(nameSchema, z.string().trim().min(1).max(60)).default({}),
        amountOutput: nameSchema.optional(),
        fieldOutputs: z.record(nameSchema, z.string().trim().min(1).max(60)).default({}),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

/** FORMULA_INVALID 422: "The formula for {name} is not valid: {reason}." */
export function formulaInvalid(name: string, reason: string) {
  return Errors.formulaInvalid(name, reason);
}

interface Prepared {
  def: RuleDefinition;
  compiled: Map<string, CompiledExpression>;
  tables: Map<string, TableData>;
}

/** Throws FORMULA_INVALID / VALIDATION_ERROR when the rule set cannot be trusted. */
export function validateDefinition(raw: unknown): RuleDefinition {
  const parsed = ruleDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Errors.validation({
      definition: `${issue?.path.join('.') || 'definition'}: ${issue?.message ?? 'is not valid'}`,
    });
  }
  prepare(parsed.data);
  return parsed.data;
}

function prepare(def: RuleDefinition): Prepared {
  const known = new Set<string>();
  const claim = (name: string, what: string): void => {
    if (RESERVED.has(name.toLowerCase())) {
      throw Errors.validation({ definition: `"${name}" cannot be used as a name.` });
    }
    const key = name.toLowerCase();
    if (known.has(key)) {
      throw Errors.validation({ definition: `The name "${name}" is used twice (${what}).` });
    }
    known.add(key);
  };
  def.inputs.forEach((i) => claim(i.name, 'inputs'));
  def.parameters.forEach((p) => claim(p.name, 'parameters'));
  const tableNames = new Set<string>();
  const tables = new Map<string, TableData>();
  for (const t of def.tables) {
    if (tableNames.has(t.name.toLowerCase())) {
      throw Errors.validation({ definition: `The table "${t.name}" is used twice.` });
    }
    tableNames.add(t.name.toLowerCase());
    for (const row of t.rows) {
      if (row.length !== t.columns.length) {
        throw Errors.validation({
          definition: `Every row of table "${t.name}" needs ${t.columns.length} values.`,
        });
      }
    }
    tables.set(t.name, { columns: t.columns, rows: t.rows });
  }
  const visible = new Set(known);
  const compiled = new Map<string, CompiledExpression>();
  for (const out of def.outputs) {
    claim(out.name, 'results');
    let c: CompiledExpression;
    try {
      c = compile(out.expression);
    } catch (err) {
      if (err instanceof ExpressionError) throw formulaInvalid(out.name, err.reason);
      throw err;
    }
    for (const n of c.names) {
      if (!visible.has(n.toLowerCase())) {
        throw formulaInvalid(out.name, `"${n}" is not an input, a parameter or an earlier result`);
      }
    }
    for (const t of c.tables) {
      if (!tableNames.has(t.toLowerCase())) {
        throw formulaInvalid(out.name, `there is no table named "${t}"`);
      }
    }
    visible.add(out.name.toLowerCase());
    compiled.set(out.name, c);
  }
  const b = def.bindings;
  if (b) {
    const inputNames = new Set(def.inputs.map((i) => i.name));
    const outputNames = new Set(def.outputs.map((o) => o.name));
    for (const k of Object.keys(b.inputs)) {
      if (!inputNames.has(k))
        throw Errors.validation({ definition: `Binding: "${k}" is not an input.` });
    }
    for (const k of [...Object.keys(b.fieldOutputs), ...(b.amountOutput ? [b.amountOutput] : [])]) {
      if (!outputNames.has(k))
        throw Errors.validation({ definition: `Binding: "${k}" is not a result.` });
    }
  }
  return { def, compiled, tables };
}

export interface EvaluationResult {
  outputs: Record<string, string>;
}

export const RuleEngine = {
  /**
   * Deterministic Decimal evaluation. Missing inputs use their default, else 0. Unknown input names
   * are rejected so a typo cannot silently price a document at zero.
   */
  evaluate(
    definition: unknown,
    inputs: Record<string, string | number | null | undefined>,
  ): EvaluationResult {
    const prepared = prepare(ruleDefinitionSchema.parse(definition));
    const { def } = prepared;
    const vars = new Map<string, DecimalValue>();
    const inputNames = new Set(def.inputs.map((i) => i.name));
    for (const key of Object.keys(inputs)) {
      if (!inputNames.has(key))
        throw Errors.validation({ inputs: `"${key}" is not an input of this rule set.` });
    }
    for (const i of def.inputs) {
      const given = inputs[i.name];
      const text =
        given === undefined || given === null || given === '' ? (i.default ?? '0') : String(given);
      if (!DECIMAL_RE.test(text) && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(text)) {
        throw Errors.validation({ inputs: `Enter a number for ${i.label || i.name}.` });
      }
      vars.set(i.name, new Dec(text));
    }
    for (const p of def.parameters) vars.set(p.name, new Dec(p.value));
    // Names are case-insensitive: resolve through a lower-cased view too.
    const outputs: Record<string, string> = {};
    for (const out of def.outputs) {
      const c = prepared.compiled.get(out.name) as CompiledExpression;
      let value: DecimalValue;
      try {
        value = evaluateNumber(c, { vars: caseless(vars), tables: caseless(prepared.tables) });
      } catch (err) {
        if (err instanceof ExpressionError) throw formulaInvalid(out.name, err.reason);
        throw err;
      }
      if (out.places !== undefined) value = value.toDecimalPlaces(out.places, Dec.ROUND_HALF_UP);
      vars.set(out.name, value);
      outputs[out.name] = value.toFixed(out.places ?? undefined);
    }
    return { outputs };
  },
};

function caseless<T>(m: ReadonlyMap<string, T>): ReadonlyMap<string, T> {
  const lower = new Map<string, T>();
  for (const [k, v] of m) {
    lower.set(k, v);
    lower.set(k.toLowerCase(), v);
  }
  return {
    get: (k: string) => lower.get(k) ?? lower.get(k.toLowerCase()),
    has: (k: string) => lower.has(k) || lower.has(k.toLowerCase()),
    get size() {
      return lower.size;
    },
    forEach: (...a: Parameters<Map<string, T>['forEach']>) => lower.forEach(...a),
    entries: () => lower.entries(),
    keys: () => lower.keys(),
    values: () => lower.values(),
    [Symbol.iterator]: () => lower[Symbol.iterator](),
  } as ReadonlyMap<string, T>;
}
