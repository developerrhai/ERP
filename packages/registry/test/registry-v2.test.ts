// Phase 22-B: registry v2 diff test. The 248 pages already built keep their id and title; every new
// V40 page is planned with an owner phase (23-31). Re-generate with `npm run extract:v2`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
interface P {
  id: string;
  title: string;
  family: string;
  tabs: string[];
  fields: string[];
  buttons: string[];
  dynamic: boolean;
  status: "built" | "planned";
  ownerPhase: number | null;
  changedOnPurpose?: string;
  legacyTitle?: string;
}
const v2 = JSON.parse(readFileSync(resolve(here, "../registry.v2.json"), "utf8")) as {
  version: number;
  sha256: string;
  families: { name: string; pageCount: number }[];
  pages: P[];
};
const v1 = JSON.parse(readFileSync(resolve(here, "../registry.json"), "utf8")) as {
  families: { items: { id: string; title: string }[] }[];
};

describe("registry v2", () => {
  const byId = new Map(v2.pages.map((p) => [p.id, p]));
  const old = v1.families.flatMap((f) => f.items);

  it("has unique page ids and consistent family counts", () => {
    expect(byId.size).toBe(v2.pages.length);
    for (const f of v2.families) {
      expect(v2.pages.filter((p) => p.family === f.name)).toHaveLength(f.pageCount);
    }
  });

  it("keeps every old page id, with the same title unless changed on purpose", () => {
    expect(old.length).toBeGreaterThanOrEqual(246);
    for (const o of old) {
      const p = byId.get(o.id);
      expect(p, `old page ${o.id} is missing`).toBeDefined();
      if (p && p.title !== o.title) {
        expect(p.changedOnPurpose, `${o.id} title changed without a reason`).toBeTruthy();
        expect(p.legacyTitle).toBe(o.title);
      }
      expect(p?.status).toBe("built");
    }
  });

  it("plans every new V40 page with an owner phase 23-31", () => {
    const oldIds = new Set(old.map((o) => o.id));
    const fresh = v2.pages.filter((p) => !oldIds.has(p.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const p of fresh) {
      expect(p.status, p.id).toBe("planned");
      expect(p.ownerPhase, p.id).toBeGreaterThanOrEqual(23);
      expect(p.ownerPhase, p.id).toBeLessThanOrEqual(31);
    }
  });

  it("lists tabs, fields and buttons for the 31 screens built in this phase", () => {
    for (const id of ["wms-racks", "pay-loan", "proj-budget", "qms-5why", "tax-hsn", "service-history"]) {
      const p = byId.get(id);
      expect(p?.tabs.length, id).toBeGreaterThan(0);
      expect(p?.fields.length, id).toBeGreaterThan(0);
      expect(p?.buttons, id).toContain("Edit");
    }
  });

  it("carries the dynamic families flagged", () => {
    expect(v2.pages.some((p) => p.dynamic && p.id.startsWith("dept-inbox-"))).toBe(true);
    expect(v2.pages.filter((p) => p.family === "Contract Labour Management")).toHaveLength(17);
  });
});
