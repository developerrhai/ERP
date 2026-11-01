// Public entry of the registry package: the extracted registry.json, typed.
// Exists so apps import one typed object instead of reading the JSON themselves.
import data from "./registry.json" with { type: "json" };
import type { Registry } from "./registry.js";

export type { Department, Family, MenuId, MenuItem, Profile, Registry } from "./registry.js";

export const registry: Registry = data;
export default registry;
