// packages/calc/src/payroll/formula-parser.ts
// Safe formula parser (NO eval) for payroll components with comparison and arithmetic operators.

export type Context = Record<string, number>;

export class FormulaParser {
  private pos = 0;
  private expr = '';
  private ctx: Context = {};

  eval(expression: string, context: Context): number {
    this.expr = expression.trim();
    this.pos = 0;
    this.ctx = context;
    if (!this.expr) return 0;
    const res = this.parseComparison();
    this.skipWhitespace();
    if (this.pos < this.expr.length) {
      throw new Error(`Unexpected character '${this.expr[this.pos]}' at position ${this.pos}`);
    }
    return res;
  }

  private skipWhitespace() {
    while (this.pos < this.expr.length && /\s/.test(this.expr[this.pos]!)) {
      this.pos++;
    }
  }

  private parseComparison(): number {
    let left = this.parseArithmetic();
    this.skipWhitespace();
    if (this.pos < this.expr.length) {
      const op2 = this.expr.slice(this.pos, this.pos + 2);
      const op1 = this.expr[this.pos];

      if (op2 === '>=' || op2 === '<=' || op2 === '==' || op2 === '!=') {
        this.pos += 2;
        const right = this.parseArithmetic();
        if (op2 === '>=') return left >= right ? 1 : 0;
        if (op2 === '<=') return left <= right ? 1 : 0;
        if (op2 === '==') return left === right ? 1 : 0;
        if (op2 === '!=') return left !== right ? 1 : 0;
      } else if (op1 === '>' || op1 === '<') {
        this.pos += 1;
        const right = this.parseArithmetic();
        if (op1 === '>') return left > right ? 1 : 0;
        if (op1 === '<') return left < right ? 1 : 0;
      }
    }
    return left;
  }

  private parseArithmetic(): number {
    let left = this.parseTerm();
    this.skipWhitespace();
    while (this.pos < this.expr.length) {
      const op = this.expr[this.pos];
      if (op === '+' || op === '-') {
        this.pos++;
        const right = this.parseTerm();
        left = op === '+' ? left + right : left - right;
        this.skipWhitespace();
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();
    this.skipWhitespace();
    while (this.pos < this.expr.length) {
      const op = this.expr[this.pos];
      if (op === '*' || op === '/') {
        this.pos++;
        const right = this.parseFactor();
        if (op === '/' && right === 0) return 0;
        left = op === '*' ? left * right : left / right;
        this.skipWhitespace();
      } else {
        break;
      }
    }
    return left;
  }

  private parseFactor(): number {
    this.skipWhitespace();
    if (this.pos >= this.expr.length) {
      throw new Error('Unexpected end of formula');
    }

    if (this.expr[this.pos] === '-') {
      this.pos++;
      return -this.parseFactor();
    }
    if (this.expr[this.pos] === '+') {
      this.pos++;
      return this.parseFactor();
    }

    if (this.expr[this.pos] === '(') {
      this.pos++;
      const val = this.parseComparison();
      this.skipWhitespace();
      if (this.expr[this.pos] !== ')') {
        throw new Error(`Expected ')' at position ${this.pos}`);
      }
      this.pos++;
      return val;
    }

    if (/[\d.]/.test(this.expr[this.pos]!)) {
      let numStr = '';
      while (this.pos < this.expr.length && /[\d.]/.test(this.expr[this.pos]!)) {
        numStr += this.expr[this.pos++];
      }
      const val = parseFloat(numStr);
      if (isNaN(val)) throw new Error(`Invalid number: ${numStr}`);
      return val;
    }

    if (/[a-zA-Z_]/.test(this.expr[this.pos]!)) {
      let ident = '';
      while (this.pos < this.expr.length && /[a-zA-Z0-9_]/.test(this.expr[this.pos]!)) {
        ident += this.expr[this.pos++];
      }
      this.skipWhitespace();

      if (this.pos < this.expr.length && this.expr[this.pos] === '(') {
        this.pos++;
        const args: number[] = [];
        this.skipWhitespace();
        if (this.pos < this.expr.length && this.expr[this.pos] !== ')') {
          while (true) {
            args.push(this.parseComparison());
            this.skipWhitespace();
            if (this.expr[this.pos] === ',') {
              this.pos++;
              this.skipWhitespace();
            } else if (this.expr[this.pos] === ')') {
              break;
            } else {
              throw new Error(`Expected ',' or ')' at position ${this.pos}`);
            }
          }
        }
        if (this.expr[this.pos] !== ')') {
          throw new Error(`Expected ')' at position ${this.pos}`);
        }
        this.pos++;

        const fn = ident.toLowerCase();
        if (fn === 'min') return Math.min(...args);
        if (fn === 'max') return Math.max(...args);
        if (fn === 'round') return Math.round(args[0] ?? 0);
        if (fn === 'if') {
          const [cond, thenVal, elseVal] = args;
          return (cond ?? 0) > 0 ? (thenVal ?? 0) : (elseVal ?? 0);
        }
        throw new Error(`Unknown function: ${ident}`);
      }

      const keyUpper = ident.toUpperCase();
      const match = Object.keys(this.ctx).find((k) => k.toUpperCase() === keyUpper);
      if (match !== undefined) {
        return this.ctx[match] ?? 0;
      }
      throw new Error(`Formula refers to unknown item '${ident}'`);
    }

    throw new Error(`Unexpected character '${this.expr[this.pos]}' at position ${this.pos}`);
  }
}

export function evalFormula(expr: string, context: Context): number {
  return new FormulaParser().eval(expr, context);
}

export function orderComponentsTopological(
  components: Array<{ code: string; formula?: string | null }>,
): string[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const c of components) {
    const code = c.code.toUpperCase();
    if (!graph.has(code)) graph.set(code, []);
    inDegree.set(code, 0);
  }

  for (const c of components) {
    const code = c.code.toUpperCase();
    if (c.formula) {
      const vars = c.formula.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
      for (const v of vars) {
        const vUpper = v.toUpperCase();
        if (vUpper !== 'MIN' && vUpper !== 'MAX' && vUpper !== 'ROUND' && vUpper !== 'IF') {
          if (graph.has(vUpper) && vUpper !== code) {
            graph.get(vUpper)!.push(code);
            inDegree.set(code, (inDegree.get(code) ?? 0) + 1);
          }
        }
      }
    }
  }

  const queue: string[] = [];
  for (const [code, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(code);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    sorted.push(u);
    for (const v of graph.get(u) ?? []) {
      const newDeg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, newDeg);
      if (newDeg === 0) queue.push(v);
    }
  }

  if (sorted.length < components.length) {
    throw new Error('Circular formula detected in salary structure');
  }

  return sorted;
}
