// Locates the registry literals inside the prototype's inline <script> using acorn.
// Exists so extraction depends only on the AST, never on executing prototype code.
import { parse, type CallExpression, type Program } from "acorn";
import { simple } from "acorn-walk";
import { evaluateLiteral, type JsonValue } from "./literal.js";

export const LITERAL_NAMES = ["MENU", "PROFILES", "DEPT_FAMILIES", "DEPARTMENTS"] as const;
export type LiteralName = (typeof LITERAL_NAMES)[number];

export interface ProfileOverride {
  readonly profileId: string;
  readonly patch: { [key: string]: JsonValue };
}

export interface ParsedPrototype {
  readonly literals: Record<LiteralName, JsonValue>;
  /** `Object.assign(PROFILES[id], {...})` calls, in source order. */
  readonly overrides: readonly ProfileOverride[];
}

/** Returns the body of the single inline <script> element in the page. */
export function extractInlineScript(html: string): string {
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(
    (m) => !/\ssrc\s*=/i.test(m[1] ?? ""),
  );
  if (scripts.length !== 1) {
    throw new Error(`Expected exactly 1 inline <script>, found ${String(scripts.length)}`);
  }
  const body = scripts[0]?.[2];
  if (body === undefined) throw new Error("Inline <script> has no body");
  return body;
}

function isLiteralName(name: string): name is LiteralName {
  return (LITERAL_NAMES as readonly string[]).includes(name);
}

/** Matches `Object.assign(PROFILES["<id>"], {...})` and returns the override, else null. */
function profileOverride(call: CallExpression): ProfileOverride | null {
  const callee = call.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "Object" ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "assign"
  ) {
    return null;
  }
  const [target, source, ...rest] = call.arguments;
  if (
    target?.type !== "MemberExpression" ||
    target.object.type !== "Identifier" ||
    target.object.name !== "PROFILES"
  ) {
    return null;
  }
  if (
    !target.computed ||
    target.property.type !== "Literal" ||
    typeof target.property.value !== "string"
  ) {
    throw new Error("Object.assign(PROFILES[...]) must use a string-literal key");
  }
  const profileId = target.property.value;
  if (source?.type !== "ObjectExpression" || rest.length > 0) {
    throw new Error(`Object.assign(PROFILES["${profileId}"]) must have one object-literal source`);
  }
  const patch = evaluateLiteral(source);
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new Error(`Object.assign(PROFILES["${profileId}"]) source is not an object`);
  }
  return { profileId, patch };
}

export function parsePrototype(script: string): ParsedPrototype {
  const ast: Program = parse(script, { ecmaVersion: "latest", sourceType: "script" });
  const found = new Map<LiteralName, JsonValue>();
  const overrides: ProfileOverride[] = [];

  // acorn-walk visits nodes in source order, so overrides keep the browser's order.
  simple(ast, {
    VariableDeclarator(decl) {
      if (decl.id.type !== "Identifier" || !isLiteralName(decl.id.name)) return;
      const name = decl.id.name;
      if (found.has(name)) throw new Error(`${name} is declared more than once`);
      if (!decl.init) throw new Error(`${name} has no initializer`);
      found.set(name, evaluateLiteral(decl.init));
    },
    CallExpression(call) {
      const override = profileOverride(call);
      if (override) overrides.push(override);
    },
  });

  const get = (name: LiteralName): JsonValue => {
    const v = found.get(name);
    if (v === undefined) throw new Error(`Literal ${name} not found in the prototype script`);
    return v;
  };
  return {
    literals: {
      MENU: get("MENU"),
      PROFILES: get("PROFILES"),
      DEPT_FAMILIES: get("DEPT_FAMILIES"),
      DEPARTMENTS: get("DEPARTMENTS"),
    },
    overrides,
  };
}
