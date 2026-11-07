// Safe expression language for rule sets (docs/phases/PHASE-06B.md §3.3). A hand-written tokenizer,
// parser and evaluator: there is no eval, no Function(), no property access and no way to reach
// process / require / globals. Names resolve only through the Map the caller passes in. All maths is
// Decimal (never JS floats). Limits on length, depth and node count keep a hostile formula cheap.
import { Prisma } from '@prisma/client';

export const Dec = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
export type DecimalValue = Prisma.Decimal;

export const MAX_EXPRESSION_LENGTH = 1000;
const MAX_NODES = 400;
const MAX_DEPTH = 40;
const MAX_POW = 32;

export class ExpressionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ExpressionError';
  }
}

export type Value = DecimalValue | boolean | string;

export interface TableData {
  columns: string[];
  rows: string[][];
}

export interface EvalScope {
  /** Named numbers: inputs, parameters and earlier outputs. */
  vars: ReadonlyMap<string, DecimalValue>;
  tables: ReadonlyMap<string, TableData>;
}

type Node =
  | { t: 'num'; v: DecimalValue }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'not'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

type Token =
  | { k: 'num'; v: string }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'end' };

const OPS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '(',
  ')',
  ',',
];

function tokenize(src: string): Token[] {
  if (src.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`it is longer than ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`unexpected "${ch}"`);
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      const word = m?.[0] ?? ch;
      out.push({ k: 'id', v: word });
      i += word.length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new ExpressionError('a text value is not closed');
      out.push({ k: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExpressionError(`unexpected "${ch}"`);
    out.push({ k: 'op', v: op });
    i += op.length;
  }
  out.push({ k: 'end' });
  return out;
}

/** Name -> [min args, max args]. */
export const FUNCTIONS: Readonly<Record<string, readonly [number, number]>> = {
  min: [2, 12],
  max: [2, 12],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 2],
  if: [3, 3],
  lookup: [2, 3],
  slab: [2, 3],
};

class Parser {
  private pos = 0;
  private nodes = 0;
  constructor(private readonly toks: Token[]) {}

  parse(): Node {
    const node = this.or(0);
    if (this.peek().k !== 'end')
      throw new ExpressionError(`unexpected "${this.show(this.peek())}"`);
    return node;
  }

  private show(t: Token): string {
    return t.k === 'end' ? 'the end' : t.v;
  }
  private peek(): Token {
    return this.toks[this.pos] ?? { k: 'end' };
  }
  private next(): Token {
    const t = this.peek();
    this.pos += 1;
    return t;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }
  private isWord(v: string): boolean {
    const t = this.peek();
    return t.k === 'id' && t.v.toLowerCase() === v;
  }
  private mk(depth: number, node: Node): Node {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw new ExpressionError('it is too long');
    if (depth > MAX_DEPTH) throw new ExpressionError('it is nested too deeply');
    return node;
  }

  private or(d: number): Node {
    let a = this.and(d);
    while (this.isWord('or') || this.isOp('||')) {
      this.next();
      a = this.mk(d, { t: 'bin', op: 'or', a, b: this.and(d + 1) });
    }
    return a;
  }
  private and(d: number): Node {
    let a = this.not(d);
    while (this.isWord('and') || this.isOp('&&')) {
      this.next();
      a = this.mk(d, { t: 'bin', op: 'and', a, b: this.not(d + 1) });
    }
    return a;
  }
  private not(d: number): Node {
    if (this.isWord('not')) {
      this.next();
      return this.mk(d, { t: 'not', a: this.not(d + 1) });
    }
    return this.cmp(d);
  }
  private cmp(d: number): Node {
    const a = this.add(d);
    const t = this.peek();
    if (t.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      this.next();
      return this.mk(d, { t: 'bin', op: t.v, a, b: this.add(d + 1) });
    }
    return a;
  }
  private add(d: number): Node {
    let a = this.mul(d);
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
        this.next();
        a = this.mk(d, { t: 'bin', op: t.v, a, b: this.mul(d + 1) });
      } else return a;
    }
  }
  private mul(d: number): Node {
    let a = this.unary(d);
    for (;;) {
      const t = this.peek();
      if (t.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.next();
        a = this.mk(d, { t: 'bin', op: t.v, a, b: this.unary(d + 1) });
      } else return a;
    }
  }
  private unary(d: number): Node {
    if (this.isOp('-')) {
      this.next();
      return this.mk(d, { t: 'neg', a: this.unary(d + 1) });
    }
    if (this.isOp('+')) {
      this.next();
      return this.unary(d + 1);
    }
    return this.pow(d);
  }
  private pow(d: number): Node {
    const a = this.primary(d);
    if (this.isOp('^')) {
      this.next();
      return this.mk(d, { t: 'bin', op: '^', a, b: this.unary(d + 1) });
    }
    return a;
  }
  private primary(d: number): Node {
    const t = this.next();
    if (t.k === 'num') {
      let v: DecimalValue;
      try {
        v = new Dec(t.v);
      } catch {
        throw new ExpressionError(`"${t.v}" is not a number`);
      }
      return this.mk(d, { t: 'num', v });
    }
    if (t.k === 'str') return this.mk(d, { t: 'str', v: t.v });
    if (t.k === 'id') {
      const low = t.v.toLowerCase();
      if (low === 'true' || low === 'false') return this.mk(d, { t: 'bool', v: low === 'true' });
      if (this.isOp('(')) {
        const range = FUNCTIONS[low];
        if (!range) throw new ExpressionError(`"${t.v}" is not a known function`);
        this.next();
        const args: Node[] = [];
        if (!this.isOp(')')) {
          args.push(this.or(d + 1));
          while (this.isOp(',')) {
            this.next();
            args.push(this.or(d + 1));
          }
        }
        if (!this.isOp(')')) throw new ExpressionError(`a ")" is missing after ${t.v}(`);
        this.next();
        if (args.length < range[0] || args.length > range[1]) {
          throw new ExpressionError(
            `${low}() takes ${range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`} values`,
          );
        }
        return this.mk(d, { t: 'call', name: low, args });
      }
      return this.mk(d, { t: 'var', name: t.v });
    }
    if (t.k === 'op' && t.v === '(') {
      const inner = this.or(d + 1);
      if (!this.isOp(')')) throw new ExpressionError('a ")" is missing');
      this.next();
      return inner;
    }
    throw new ExpressionError(`unexpected "${this.show(t)}"`);
  }
}

export interface CompiledExpression {
  ast: Node;
  /** Names the formula reads. */
  names: Set<string>;
  /** Table names used as literal first arguments of lookup() / slab(). */
  tables: Set<string>;
}

function walk(n: Node, names: Set<string>, tables: Set<string>): void {
  switch (n.t) {
    case 'var':
      names.add(n.name);
      return;
    case 'neg':
    case 'not':
      walk(n.a, names, tables);
      return;
    case 'bin':
      walk(n.a, names, tables);
      walk(n.b, names, tables);
      return;
    case 'call': {
      if (n.name === 'lookup' || n.name === 'slab') {
        const first = n.args[0];
        if (first?.t !== 'str')
          throw new ExpressionError(`${n.name}() needs the table name in quotes`);
        tables.add(first.v);
        n.args.slice(1).forEach((a) => walk(a, names, tables));
        return;
      }
      n.args.forEach((a) => walk(a, names, tables));
      return;
    }
    default:
  }
}

export function compile(source: string): CompiledExpression {
  if (source.trim() === '') throw new ExpressionError('it is empty');
  const ast = new Parser(tokenize(source)).parse();
  const names = new Set<string>();
  const tables = new Set<string>();
  walk(ast, names, tables);
  return { ast, names, tables };
}

function isDec(v: Value): v is DecimalValue {
  return typeof v === 'object' && v !== null && Prisma.Decimal.isDecimal(v);
}

function asNum(v: Value, what: string): DecimalValue {
  if (isDec(v)) return v;
  throw new ExpressionError(`${what} must be a number`);
}
function asBool(v: Value, what: string): boolean {
  if (typeof v === 'boolean') return v;
  throw new ExpressionError(`${what} must be true or false`);
}

function cellAsDecimal(cell: string | undefined, label: string): DecimalValue {
  const text = (cell ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text))
    throw new ExpressionError(`${label} is not a number ("${text}")`);
  return new Dec(text);
}

function columnIndex(table: TableData, arg: Value | undefined, name: string): number {
  if (arg === undefined) return table.columns.length > 1 ? 1 : 0;
  if (typeof arg === 'string') {
    const at = table.columns.findIndex((c) => c.toLowerCase() === arg.toLowerCase());
    if (at < 0) throw new ExpressionError(`table "${name}" has no column "${arg}"`);
    return at;
  }
  const n = asNum(arg, 'the column').toNumber();
  if (!Number.isInteger(n) || n < 1 || n > table.columns.length) {
    throw new ExpressionError(`table "${name}" has no column ${n}`);
  }
  return n - 1;
}

function evalNode(n: Node, scope: EvalScope): Value {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'str':
      return n.v;
    case 'bool':
      return n.v;
    case 'var': {
      const v = scope.vars.get(n.name);
      if (v === undefined) throw new ExpressionError(`"${n.name}" is not a known name`);
      return v;
    }
    case 'neg':
      return asNum(evalNode(n.a, scope), 'the value after "-"').neg();
    case 'not':
      return !asBool(evalNode(n.a, scope), 'the value after "not"');
    case 'bin': {
      if (n.op === 'and') {
        return (
          asBool(evalNode(n.a, scope), 'the left side of "and"') &&
          asBool(evalNode(n.b, scope), 'the right side of "and"')
        );
      }
      if (n.op === 'or') {
        return (
          asBool(evalNode(n.a, scope), 'the left side of "or"') ||
          asBool(evalNode(n.b, scope), 'the right side of "or"')
        );
      }
      const l = evalNode(n.a, scope);
      const r = evalNode(n.b, scope);
      if (n.op === '==' || n.op === '!=') {
        let same: boolean;
        if (typeof l === 'string' || typeof r === 'string') {
          same =
            typeof l === 'string' && typeof r === 'string' && l.toLowerCase() === r.toLowerCase();
        } else if (typeof l === 'boolean' || typeof r === 'boolean') {
          same = l === r;
        } else same = l.eq(r);
        return n.op === '==' ? same : !same;
      }
      const a = asNum(l, 'the left side');
      const b = asNum(r, 'the right side');
      switch (n.op) {
        case '+':
          return a.plus(b);
        case '-':
          return a.minus(b);
        case '*':
          return a.times(b);
        case '/':
          if (b.isZero()) throw new ExpressionError('it divides by zero');
          return a.div(b);
        case '%':
          if (b.isZero()) throw new ExpressionError('it divides by zero');
          return a.mod(b);
        case '^': {
          if (!b.isInteger() || b.abs().gt(MAX_POW)) {
            throw new ExpressionError(`a power must be a whole number up to ${MAX_POW}`);
          }
          if (a.isZero() && b.isNegative()) throw new ExpressionError('it divides by zero');
          return a.pow(b.toNumber());
        }
        case '<':
          return a.lt(b);
        case '<=':
          return a.lte(b);
        case '>':
          return a.gt(b);
        case '>=':
          return a.gte(b);
        default:
          throw new ExpressionError(`unknown operator "${n.op}"`);
      }
    }
    case 'call':
      return evalCall(n, scope);
  }
}

function evalCall(n: Extract<Node, { t: 'call' }>, scope: EvalScope): Value {
  if (n.name === 'if') {
    const c = asBool(evalNode(n.args[0] as Node, scope), 'the condition of if()');
    return evalNode((c ? n.args[1] : n.args[2]) as Node, scope);
  }
  if (n.name === 'lookup' || n.name === 'slab') {
    const first = n.args[0];
    if (first?.t !== 'str') throw new ExpressionError(`${n.name}() needs the table name in quotes`);
    const table = scope.tables.get(first.v);
    if (!table) throw new ExpressionError(`there is no table named "${first.v}"`);
    const key = evalNode(n.args[1] as Node, scope);
    const colArg = n.args[2] ? evalNode(n.args[2], scope) : undefined;
    const col = columnIndex(table, colArg, first.v);
    if (n.name === 'lookup') {
      const text = typeof key === 'string' ? key.trim().toLowerCase() : null;
      const row = table.rows.find((r) => {
        const cell = (r[0] ?? '').trim();
        if (text !== null) return cell.toLowerCase() === text;
        if (typeof key === 'boolean') return false;
        return /^-?\d+(\.\d+)?$/.test(cell) && new Dec(cell).eq(key);
      });
      if (!row) {
        throw new ExpressionError(
          `table "${first.v}" has no row for ${typeof key === 'string' ? `"${key}"` : key.toString()}`,
        );
      }
      return cellAsDecimal(row[col], `the value in table "${first.v}"`);
    }
    const x = asNum(key, 'the value for slab()');
    let picked: string[] | null = null;
    let best: DecimalValue | null = null;
    for (const r of table.rows) {
      const from = cellAsDecimal(r[0], `the "from" value in table "${first.v}"`);
      if (from.lte(x) && (best === null || from.gt(best))) {
        best = from;
        picked = r;
      }
    }
    if (!picked)
      throw new ExpressionError(`${x.toString()} is below the first slab of "${first.v}"`);
    return cellAsDecimal(picked[col], `the value in table "${first.v}"`);
  }
  const vals = n.args.map((a, i) => asNum(evalNode(a, scope), `value ${i + 1} of ${n.name}()`));
  const v0 = vals[0] as DecimalValue;
  switch (n.name) {
    case 'min':
      return vals.reduce((a, b) => (b.lt(a) ? b : a));
    case 'max':
      return vals.reduce((a, b) => (b.gt(a) ? b : a));
    case 'abs':
      return v0.abs();
    case 'floor':
      return v0.floor();
    case 'ceil':
      return v0.ceil();
    case 'round': {
      const places = vals[1] ? vals[1].toNumber() : 0;
      if (!Number.isInteger(places) || places < 0 || places > 6) {
        throw new ExpressionError('round() keeps 0 to 6 decimal places');
      }
      return v0.toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP);
    }
    default:
      throw new ExpressionError(`"${n.name}" is not a known function`);
  }
}

/** Evaluates to a number; a yes/no or text result is an error (every output is a Decimal). */
export function evaluateNumber(compiled: CompiledExpression, scope: EvalScope): DecimalValue {
  const v = evalNode(compiled.ast, scope);
  if (isDec(v)) return v;
  throw new ExpressionError('it must give a number, not a yes/no or text value');
}
