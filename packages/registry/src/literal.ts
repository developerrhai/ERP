// Safe literal evaluator: turns acorn AST literal nodes into plain JSON values.
// Exists so the prototype's data can be read without eval/new Function/vm on its code.
import type { Node, Expression, Property, SpreadElement, PrivateIdentifier } from "acorn";

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Thrown when a node is not a pure data literal; carries the source offset for diagnostics. */
export class NotALiteralError extends Error {
  constructor(node: Node, reason: string) {
    super(`Not a pure literal at offset ${String(node.start)}: ${reason} (${node.type})`);
    this.name = "NotALiteralError";
  }
}

function propertyKey(prop: Property): string {
  if (prop.computed) throw new NotALiteralError(prop, "computed key");
  if (prop.kind !== "init" || prop.method || prop.shorthand) {
    throw new NotALiteralError(prop, "only `key: value` properties are allowed");
  }
  const key: Expression | PrivateIdentifier = prop.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")) {
    return String(key.value);
  }
  throw new NotALiteralError(key, "unsupported key");
}

export function evaluateLiteral(node: Expression | SpreadElement | null): JsonValue {
  if (node === null) throw new Error("Array holes are not allowed in registry literals");
  switch (node.type) {
    case "Literal": {
      const v = node.value;
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        return v;
      throw new NotALiteralError(node, "regex/bigint literal");
    }
    case "TemplateLiteral": {
      if (node.expressions.length > 0)
        throw new NotALiteralError(node, "template with expressions");
      return node.quasis.map((q) => q.value.cooked ?? "").join("");
    }
    case "UnaryExpression": {
      if (node.operator !== "-") throw new NotALiteralError(node, `operator ${node.operator}`);
      const inner = evaluateLiteral(node.argument);
      if (typeof inner !== "number") throw new NotALiteralError(node, "unary minus on non-number");
      return -inner;
    }
    case "ArrayExpression":
      return node.elements.map((el) => evaluateLiteral(el));
    case "ObjectExpression": {
      const out: { [key: string]: JsonValue } = {};
      for (const prop of node.properties) {
        if (prop.type !== "Property") throw new NotALiteralError(prop, "spread in object");
        // defineProperty so a "__proto__" key is stored as data, never as a prototype.
        Object.defineProperty(out, propertyKey(prop), {
          value: evaluateLiteral(prop.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    default:
      throw new NotALiteralError(node, "unsupported node");
  }
}
