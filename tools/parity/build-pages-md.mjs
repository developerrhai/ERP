// Builds docs/build/PAGES.md (one row per V40 page + dept-movement-inbox) from packages/registry/registry.v2.json.
// Re-runnable: rows that already exist keep their progress cells; new pages are added as TODO.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reg = JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8'));
const file = path.join(root, 'docs/build/PAGES.md');
const head = '| page id | family | V40 tabs | ERP tabs ok | columns ok | fields ok | buttons ok | real data | roles checked | status |';
const sep = '|---|---|---|---|---|---|---|---|---|---|';

const old = new Map();
if (existsSync(file)) {
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    const c = l.split('|').map((s) => s.trim());
    if (c.length >= 12 && c[1] && c[1] !== 'page id' && !c[1].startsWith('---')) old.set(c[1], c.slice(1, 11));
  }
}
const FIRST = ['my-approvals', 'document-movement-center'];
const order = (p) => (FIRST.includes(p.id) ? 0 : /^dept-(inbox|work)-/.test(p.id) ? 1 : 2);
const pages = [...reg.pages].sort((a, b) => order(a) - order(b));
pages.splice(pages.findIndex((p) => p.id === 'document-movement-center') + 1 || 2, 0, { id: 'dept-movement-inbox', family: 'Department Inbox', tabs: ['Received', 'Accepted'] });

const rows = pages.map((p) => {
  const o = old.get(p.id);
  if (o) return `| ${o.join(' | ')} |`;
  const tabs = (p.tabs ?? []).length;
  return `| ${p.id} | ${p.family} | ${tabs} | - | - | - | - | - | - | TODO |`;
});
const done = rows.filter((r) => r.endsWith('| DONE |')).length;
writeFileSync(file, `# PAGES.md - page-by-page V40 build progress\n\nStatus: TODO -> BUILDING -> CHECK -> DONE. Updated by tools/parity/compare-page.mjs and by hand. DONE ${done} / ${rows.length}.\n\n${head}\n${sep}\n${rows.join('\n')}\n`);
console.log(`PAGES.md: ${rows.length} rows, ${done} DONE`);
