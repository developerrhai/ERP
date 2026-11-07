// Phase 06B: the safe expression language and the RuleEngine (no DB). Decimal maths, deterministic,
// and no way to run code (PHASE-06B §3.3, §10 "formula safety").
import { describe, expect, it } from 'vitest';
import { RuleEngine, validateDefinition } from '../src/core/settings/rule-engine';
import type { AppError } from '../src/core/http/errors';

/** The plain-English text of an error: its message plus any field messages. */
const textOf = (e: unknown): string => {
  const a = e as AppError;
  return `${a.message} ${JSON.stringify(a.fields ?? {})}`;
};
const thrown = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('should have thrown');
};

const def = (outputs: { name: string; expression: string; places?: number }[], extra = {}) => ({
  inputs: [{ name: 'a' }, { name: 'b' }],
  parameters: [{ name: 'rate', value: '12.5' }],
  tables: [
    {
      name: 'process',
      columns: ['Process', 'Rate'],
      rows: [
        ['Cutting', '450'],
        ['Welding', '600'],
      ],
    },
    {
      name: 'slabs',
      columns: ['From', 'Pct'],
      rows: [
        ['0', '1'],
        ['1000', '2'],
        ['5000', '3.5'],
      ],
    },
  ],
  outputs,
  ...extra,
});

const run = (expression: string, inputs: Record<string, string | number> = {}) =>
  RuleEngine.evaluate(def([{ name: 'r', expression }]), inputs).outputs.r;

function invalid(expression: string): AppError {
  try {
    validateDefinition(def([{ name: 'r', expression }]));
  } catch (e) {
    return e as AppError;
  }
  throw new Error(`"${expression}" should have been refused`);
}

describe('RuleEngine arithmetic (Decimal, never float)', () => {
  it('0.1 + 0.2 is exactly 0.3', () => {
    expect(run('0.1 + 0.2')).toBe('0.3');
  });
  it('follows precedence, unary minus, parentheses and %', () => {
    expect(run('2 + 3 * 4')).toBe('14');
    expect(run('(2 + 3) * 4')).toBe('20');
    expect(run('-a + 10', { a: 3 })).toBe('7');
    expect(run('10 % 4')).toBe('2');
    expect(run('2 ^ 10')).toBe('1024');
  });
  it('uses inputs and named parameters', () => {
    expect(run('a * rate / 100', { a: 2000 })).toBe('250');
  });
  it('keeps big money values exact', () => {
    expect(run('a * b', { a: '123456789012.34', b: '3' })).toBe('370370367037.02');
  });
  it('rounds half up to the places of the result', () => {
    const r = RuleEngine.evaluate(def([{ name: 'r', expression: 'a / 3', places: 2 }]), { a: 10 });
    expect(r.outputs.r).toBe('3.33');
    expect(run('round(2.345, 2)')).toBe('2.35');
    expect(run('round(-2.5)')).toBe('-3');
  });
  it('min, max, abs, floor, ceil, if and comparisons', () => {
    expect(run('min(3, 1, 2)')).toBe('1');
    expect(run('max(3, 1, 2)')).toBe('3');
    expect(run('abs(-4.5)')).toBe('4.5');
    expect(run('floor(2.9) + ceil(2.1)')).toBe('5');
    expect(run('if(a >= 100 and not (b == 0), 1, 2)', { a: 100, b: 1 })).toBe('1');
    expect(run('if(a > 5 or b > 5, 10, 20)', { a: 1, b: 1 })).toBe('20');
  });
  it('looks up rate tables and slabs', () => {
    expect(run('lookup("process", "welding")')).toBe('600');
    expect(run('slab("slabs", 999)')).toBe('1');
    expect(run('slab("slabs", 1000)')).toBe('2');
    expect(run('slab("slabs", a)', { a: 99999 })).toBe('3.5');
  });
  it('later results can use earlier ones, and the same input always gives the same answer', () => {
    const d = def([
      { name: 'x', expression: 'a + 1' },
      { name: 'y', expression: 'x * 2' },
    ]);
    const first = RuleEngine.evaluate(d, { a: 4 }).outputs;
    const second = RuleEngine.evaluate(d, { a: 4 }).outputs;
    expect(first).toEqual({ x: '5', y: '10' });
    expect(second).toEqual(first);
  });
  it('a missing input is 0 (or its default); an unknown input is refused', () => {
    expect(run('a + b')).toBe('0');
    const d = {
      ...def([{ name: 'r', expression: 'a + 1' }]),
      inputs: [{ name: 'a', default: '9' }],
    };
    expect(RuleEngine.evaluate(d, {}).outputs.r).toBe('10');
    expect(textOf(thrown(() => RuleEngine.evaluate(d, { zzz: 1 })))).toMatch(/not an input/);
  });
});

describe('formula errors are plain English (FORMULA_INVALID 422)', () => {
  it('unknown name', () => {
    const e = invalid('a + nope');
    expect(e.status).toBe(422);
    expect(e.code).toBe('FORMULA_INVALID');
    expect(e.message).toBe(
      'The formula for r is not valid: "nope" is not an input, a parameter or an earlier result.',
    );
  });
  it('syntax, functions and tables', () => {
    expect(invalid('a +').message).toMatch(
      /^The formula for r is not valid: unexpected "the end"\.$/,
    );
    expect(invalid('foo(1)').message).toMatch(/"foo" is not a known function/);
    expect(invalid('min(1)').message).toMatch(/min\(\) takes 2 to 12 values/);
    expect(invalid('lookup("nope", 1)').message).toMatch(/there is no table named "nope"/);
    expect(invalid('(1 + 2').message).toMatch(/"\)" is missing/);
  });
  it('a result may not use a later result', () => {
    expect(
      textOf(
        thrown(() =>
          validateDefinition(
            def([
              { name: 'x', expression: 'y + 1' },
              { name: 'y', expression: '1' },
            ]),
          ),
        ),
      ),
    ).toMatch(/"y" is not an input/);
  });
  it('runtime problems: divide by zero, missing row, text where a number is needed', () => {
    expect(() => run('1 / a', { a: 0 })).toThrowError(/divides by zero/);
    expect(() => run('lookup("process", "Grinding")')).toThrowError(/no row for "Grinding"/);
    expect(() => run('"abc" + 1')).toThrowError(/must be a number/);
    expect(() => run('1 < 2')).toThrowError(/must give a number/);
    expect(() => run('2 ^ 100')).toThrowError(/power must be a whole number/);
  });
  it('the same name cannot be used twice or be reserved', () => {
    expect(
      textOf(
        thrown(() =>
          validateDefinition({
            inputs: [{ name: 'a' }, { name: 'A' }],
            outputs: [{ name: 'r', expression: '1' }],
          }),
        ),
      ),
    ).toMatch(/used twice/);
    expect(
      textOf(
        thrown(() =>
          validateDefinition({
            inputs: [{ name: 'and' }],
            outputs: [{ name: 'r', expression: '1' }],
          }),
        ),
      ),
    ).toMatch(/cannot be used/);
  });
});

describe('formula safety: no code can run', () => {
  const attacks = [
    'process.exit(1)',
    'require("fs")',
    'constructor',
    'this.constructor.constructor("return process")()',
    '(function(){})()',
    'a.__proto__',
    '__proto__',
    'globalThis',
    'a["constructor"]',
    '`${1}`',
    'a; b',
    'import("x")',
    '1 => 2',
    'eval("1")',
    'Function("return 1")()',
    'a = 5',
    'toString()',
    '[1,2]',
    '{}',
  ];
  it.each(attacks)('refuses %s', (expression) => {
    expect(() => validateDefinition(def([{ name: 'r', expression }]))).toThrowError();
  });
  it('a name that exists on Object.prototype is just an unknown name', () => {
    const e = invalid('toString + 1');
    expect(e.message).toMatch(/"toString" is not an input/);
  });
  it('very long and very deep formulas are refused', () => {
    expect(textOf(invalid('1+'.repeat(600) + '1'))).toMatch(/at most 1000|longer than 1000/);
    expect(textOf(invalid('('.repeat(60) + '1' + ')'.repeat(60)))).toMatch(
      /nested too deeply|too long/,
    );
  });
});
