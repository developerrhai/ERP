/**
 * Automation JSON AST Pure Condition Evaluator
 * No eval, max depth 5, max 20 nodes.
 */

export type ConditionOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'is_null';

export interface LeafCondition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export interface GroupCondition {
  all?: ConditionAst[];
  any?: ConditionAst[];
}

export type ConditionAst = LeafCondition | GroupCondition;

function getFieldPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let curr: unknown = obj;
  for (const p of parts) {
    if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[p];
  }
  return curr;
}

export function validateConditionAst(ast: ConditionAst, depth = 1, counter = { count: 0 }): void {
  if (depth > 5) {
    throw new Error('Condition tree too deep (max 5).');
  }
  counter.count += 1;
  if (counter.count > 20) {
    throw new Error('Condition tree too large (max 20 nodes).');
  }
  if ('all' in ast && Array.isArray(ast.all)) {
    for (const child of ast.all) validateConditionAst(child, depth + 1, counter);
  } else if ('any' in ast && Array.isArray(ast.any)) {
    for (const child of ast.any) validateConditionAst(child, depth + 1, counter);
  }
}

export function evaluateConditionAst(ast: ConditionAst, context: Record<string, unknown>): boolean {
  validateConditionAst(ast);
  return evalNode(ast, context);
}

function evalNode(ast: ConditionAst, ctx: Record<string, unknown>): boolean {
  if ('all' in ast && Array.isArray(ast.all)) {
    return ast.all.every((c) => evalNode(c, ctx));
  }
  if ('any' in ast && Array.isArray(ast.any)) {
    return ast.any.some((c) => evalNode(c, ctx));
  }
  const leaf = ast as LeafCondition;
  const actual = getFieldPath(ctx, leaf.field);
  const expected = leaf.value;

  switch (leaf.op) {
    case 'is_null':
      return expected === false ? actual !== null && actual !== undefined : actual === null || actual === undefined;
    case 'eq':
      return actual === expected || String(actual) === String(expected);
    case 'ne':
      return actual !== expected && String(actual) !== String(expected);
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
    default:
      return false;
  }
}

