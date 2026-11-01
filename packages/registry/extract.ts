// CLI entry (`npm run extract`): regenerates registry.json + registry.d.ts from reference/index.html.
// Exists so the menu/profile registry is always derived from the prototype, never hand-edited.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry, renderTypes } from "./src/build.js";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_REL = "reference/index.html";

const bytes = readFileSync(resolve(here, "../..", SOURCE_REL));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const registry = buildRegistry(bytes.toString("utf8"), SOURCE_REL, sha256);

writeFileSync(resolve(here, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
writeFileSync(resolve(here, "registry.d.ts"), renderTypes(registry), "utf8");

const items = registry.families.reduce((n, f) => n + f.items.length, 0);
process.stdout.write(
  `registry.json: ${String(registry.families.length)} families, ${String(items)} items, ` +
    `${String(Object.keys(registry.profiles).length)} profiles, sha256 ${sha256}\n`,
);
