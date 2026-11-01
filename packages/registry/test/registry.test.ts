// Locks the extracted registry to the prototype's known counts (CONTRACT §9) and checks staleness.
// Exists so any drift between reference/index.html, registry.json and REGISTRY.csv fails CI.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registry } from "../index.js";
import { buildRegistry } from "../src/build.js";
import { evaluateLiteral } from "../src/literal.js";
import { parseCsvRecords } from "./csv.js";
import { parse, type ExpressionStatement } from "acorn";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const htmlBytes = readFileSync(resolve(root, "reference/index.html"));
const menuIds = registry.families.flatMap((f) => f.items.map((i) => i.id));
const profiles = Object.values(registry.profiles);

describe("registry.json", () => {
  it("has 22 families and 248 menu items with unique ids", () => {
    expect(registry.families).toHaveLength(22);
    expect(menuIds).toHaveLength(248);
    expect(new Set(menuIds).size).toBe(menuIds.length);
  });

  it("has 244 profiles, each with exactly 6 tabs, 2,773 fields in total", () => {
    expect(profiles).toHaveLength(244);
    for (const p of profiles) expect(p.tabs).toHaveLength(6);
    expect(profiles.reduce((n, p) => n + p.fields.length, 0)).toBe(2773);
  });

  it("has the 11 departments in prototype order", () => {
    expect(registry.departments).toEqual([
      "Administration",
      "Sales",
      "Purchase",
      "Finance",
      "HR",
      "Production",
      "Quality",
      "Maintenance",
      "Warehouse",
      "Projects",
      "Service",
    ]);
  });

  it("has deptFamilies for the 11 departments, Administration = ['*']", () => {
    expect(Object.keys(registry.deptFamilies)).toHaveLength(11);
    expect(registry.deptFamilies["Administration"]).toEqual(["*"]);
    const familyNames = new Set(registry.families.map((f) => f.name));
    for (const [dept, fams] of Object.entries(registry.deptFamilies)) {
      expect(registry.departments).toContain(dept);
      if (dept !== "Administration") for (const f of fams) expect(familyNames).toContain(f);
    }
  });

  it("applies the V9.2 pay-payslip override (37 fields)", () => {
    const p = registry.profiles["pay-payslip"];
    expect(p?.title).toBe("Payslips");
    expect(p?.fields).toHaveLength(37);
  });

  it("has no profile for the 4 Executive system pages", () => {
    for (const id of ["dashboard", "command-center", "notifications", "global-search"]) {
      expect(menuIds).toContain(id);
      expect(registry.profiles[id]).toBeUndefined();
    }
  });

  it("menu ids equal docs/REGISTRY.csv ids where in_menu = yes", () => {
    const rows = parseCsvRecords(readFileSync(resolve(root, "docs/REGISTRY.csv"), "utf8"));
    const csvIds = rows.filter((r) => r["in_menu"] === "yes").map((r) => r["id"]);
    expect(csvIds).toEqual(menuIds);
  });

  it("is up to date with reference/index.html (sha256)", () => {
    const sha = createHash("sha256").update(htmlBytes).digest("hex");
    expect(registry.sha256).toBe(sha);
    expect(registry.generatedFrom).toBe("reference/index.html");
  });

  it("equals a fresh in-memory extraction", () => {
    const fresh = buildRegistry(
      htmlBytes.toString("utf8"),
      registry.generatedFrom,
      registry.sha256,
    );
    expect(fresh).toEqual(registry);
  });
});

describe("literal evaluator", () => {
  const expr = (src: string) =>
    (parse(`(${src})`, { ecmaVersion: "latest" }).body[0] as ExpressionStatement).expression;

  it("evaluates pure data literals", () => {
    expect(evaluateLiteral(expr('{a:[1,-2,"x",`t`,true,null],"b c":{}}'))).toEqual({
      a: [1, -2, "x", "t", true, null],
      "b c": {},
    });
  });

  it("rejects anything that would need code execution", () => {
    for (const src of [
      "foo()",
      "{a:b}",
      "{[k]:1}",
      "`${x}`",
      "{...o}",
      "[...a]",
      "!0",
      "{f(){}}",
    ]) {
      expect(() => evaluateLiteral(expr(src))).toThrow();
    }
  });

  it("stores a __proto__ key as data, not as a prototype", () => {
    const v = evaluateLiteral(expr('{"__proto__":{polluted:1}}'));
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v as object)).toEqual(["__proto__"]);
  });
});
