// Shape checks that turn untyped extracted JSON into the typed registry structures.
// Exists so a change in the prototype's data layout fails loudly at extract time.
import type { JsonValue } from "./literal.js";
import type { Family, MenuItem, Profile } from "../registry.js";

type JsonObject = { [key: string]: JsonValue };

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asString(v: JsonValue | undefined, where: string): string {
  if (typeof v !== "string") throw new Error(`${where}: expected string`);
  return v;
}

export function asStringArray(v: JsonValue | undefined, where: string): string[] {
  if (!Array.isArray(v)) throw new Error(`${where}: expected array`);
  return v.map((x, i) => asString(x, `${where}[${String(i)}]`));
}

export function asObject(v: JsonValue | undefined, where: string): JsonObject {
  if (!isObject(v)) throw new Error(`${where}: expected object`);
  return v;
}

function exactKeys(o: JsonObject, keys: readonly string[], where: string): void {
  const got = Object.keys(o).sort().join(",");
  const want = [...keys].sort().join(",");
  if (got !== want) throw new Error(`${where}: expected keys {${want}}, got {${got}}`);
}

export function toFamilies(menu: JsonValue): Family[] {
  if (!Array.isArray(menu)) throw new Error("MENU: expected array");
  return menu.map((entry, fi) => {
    const where = `MENU[${String(fi)}]`;
    const o = asObject(entry, where);
    exactKeys(o, ["icon", "name", "items"], where);
    const itemsRaw = o["items"];
    if (!Array.isArray(itemsRaw)) throw new Error(`${where}.items: expected array`);
    const items: MenuItem[] = itemsRaw.map((pair, ii) => {
      const [id, title] = asStringArray(pair, `${where}.items[${String(ii)}]`);
      if (id === undefined || title === undefined || !Array.isArray(pair) || pair.length !== 2) {
        throw new Error(`${where}.items[${String(ii)}]: expected [id, title]`);
      }
      return { id, title };
    });
    return {
      name: asString(o["name"], `${where}.name`),
      icon: asString(o["icon"], `${where}.icon`),
      items,
    };
  });
}

export function toProfile(v: JsonValue | undefined, where: string): Profile {
  const o = asObject(v, where);
  exactKeys(o, ["title", "family", "purpose", "tabs", "fields"], where);
  // Rebuild in the prototype's key order (title, family, purpose, tabs, fields).
  const out: Profile = {
    title: asString(o["title"], `${where}.title`),
    family: asString(o["family"], `${where}.family`),
    purpose: asString(o["purpose"], `${where}.purpose`),
    tabs: asStringArray(o["tabs"], `${where}.tabs`),
    fields: asStringArray(o["fields"], `${where}.fields`),
  };
  return out;
}

export function toStringArrayRecord(v: JsonValue, where: string): Record<string, string[]> {
  const o = asObject(v, where);
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(o)) out[k] = asStringArray(val, `${where}.${k}`);
  return out;
}
