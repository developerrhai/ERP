// npm run ui:audit -- [--family=Sales] [--page=sales-orders,inv-items] [--role=super|admin|mgr-purchase|emp-stores|sales-talsaw] [--width=1440,390] [--force] [--tag=after]
// Runs the audit in batches of 20 pages, one Chromium at a time, resumable (already audited pages are skipped).
// Pauses while free memory is below 1.5 GB. Needs the servers from tests/feed/ui/start-ui-servers.ts on 4100/5180.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const role = args.role ?? 'super';
const tag = args.tag ? `-${args.tag}` : '';
const env = { ...process.env, AUDIT_ROLE: role, AUDIT_TAG: tag, AUDIT_COUNT: '20', AUDIT_FROM: '0' };
if (args.family) env.AUDIT_FAMILY = args.family;
if (args.page) env.AUDIT_PAGE = args.page;
if (args.width) env.AUDIT_WIDTHS = args.width;
if (args.force) env.AUDIT_FORCE = '1';

const registry = JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8'));
let wanted = registry.pages;
if (args.family) wanted = wanted.filter((p) => p.family === args.family);
if (args.page) wanted = wanted.filter((p) => args.page.split(',').includes(p.id));
const out = path.join(root, 'docs/ui-audit/data', role + tag, 'pages.jsonl');
const doneCount = () => (existsSync(out) ? new Set(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id)).size : 0);
const freeGb = () => os.freemem() / 1024 ** 3;

if (args.force) {
  // forced re-audit: walk the wanted pages 20 at a time (AUDIT_FROM is an index into the filtered list)
  for (let from = 0; from < wanted.length; from += 20) {
    while (freeGb() < 1.2) { console.log(`paused: ${freeGb().toFixed(2)} GB free`); await new Promise((r) => setTimeout(r, 30000)); }
    console.log(`forced batch from ${from}/${wanted.length}`);
    spawnSync('npx', ['playwright', 'test', '-c', 'tests/ui-audit/playwright.config.ts'], { cwd: root, env: { ...env, AUDIT_FROM: String(from) }, stdio: 'inherit', shell: true });
  }
  console.log(`forced audit finished: ${wanted.length} pages`);
  process.exit(0);
}

let stalled = 0;
while (true) {
  const before = doneCount();
  if (!args.force && before >= wanted.length) break;
  while (freeGb() < 1.2) { console.log(`paused: ${freeGb().toFixed(2)} GB free (< 1.5 GB rule, hard floor 1.2)`); await new Promise((r) => setTimeout(r, 30000)); }
  console.log(`batch: ${before}/${wanted.length} pages audited, ${freeGb().toFixed(2)} GB free`);
  spawnSync('npx', ['playwright', 'test', '-c', 'tests/ui-audit/playwright.config.ts'], { cwd: root, env, stdio: 'inherit', shell: true });
  if (args.force) { delete env.AUDIT_FORCE; }
  const after = doneCount();
  stalled = after === before ? stalled + 1 : 0;
  if (stalled >= 3) { console.log('no progress in 3 batches, stopping'); break; }
}
console.log(`audit finished: ${doneCount()}/${wanted.length}`);
