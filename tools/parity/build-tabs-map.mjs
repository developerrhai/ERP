// Builds apps/web/src/pages/frame/tabs-map.json: the real V40 tab list of every page, read from what compare-page.mjs
// saw in the approved V40 file (docs/ui-audit/pages/<id>/data.json). Re-run after a compare run.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'docs/ui-audit/pages');
const out = {};
for (const id of readdirSync(dir)) {
  const f = path.join(dir, id, 'data.json');
  if (!existsSync(f)) continue;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const first = Object.entries(d.tabs).find(([n]) => !n.startsWith('erp-only'));
  const tabs = (first?.[1]?.v40?.tabs ?? []).filter(Boolean);
  if (tabs.length > 0) out[id] = tabs;
}
writeFileSync(path.join(root, 'apps/web/src/pages/frame/tabs-map.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`tabs-map.json: ${Object.keys(out).length} pages`);
