// Summarises docs/ui-audit/pages/*/data.json (written by compare-page.mjs) into docs/build/GAPS.md:
// per family, how many pages are complete (nothing missing), and for each page what is missing.
// Run: node tools/parity/gap-report.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'docs/ui-audit/pages');
const reg = JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8'));
const family = new Map(reg.pages.map((p) => [p.id, p.family]));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const miss = (v, e) => {
  const have = new Set(e.map(norm));
  return v.filter((x) => !have.has(norm(x)));
};
const KEYS = ['tabs', 'columns', 'fields', 'buttons'];

const rows = [];
for (const id of readdirSync(dir)) {
  const f = path.join(dir, id, 'data.json');
  if (!existsSync(f)) continue;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const m = { tabs: 0, columns: 0, fields: 0, buttons: 0 };
  const names = Object.keys(d.tabs);
  let v40Tabs = 0;
  let notFound = false;
  for (const [name, t] of Object.entries(d.tabs)) {
    if (name.startsWith('erp-only')) continue;
    if (!t.v40 || !t.erp) continue;
    if (t.v40.tabs) v40Tabs = Math.max(v40Tabs, t.v40.tabs.length);
    for (const k of ['columns', 'fields', 'buttons']) m[k] += miss(t.v40[k], t.erp[k]).length;
    if (t.erp.textLen < 80) notFound = true;
  }
  const first = Object.values(d.tabs)[0];
  if (first?.v40 && first?.erp) m.tabs = miss(first.v40.tabs, first.erp.tabs).length;
  const empty = Object.entries(d.tabs).filter(([n, t]) => !n.startsWith('erp-only') && t.erp && t.erp.rows === 0).length;
  rows.push({ id, family: family.get(id) ?? '?', ...m, total: m.tabs + m.columns + m.fields + m.buttons, tabsCount: names.filter((n) => !n.startsWith('erp-only')).length, empty, notFound });
}
rows.sort((a, b) => a.family.localeCompare(b.family) || b.total - a.total);
const byFam = new Map();
for (const r of rows) byFam.set(r.family, [...(byFam.get(r.family) ?? []), r]);
const L = ['# GAPS.md - V40 vs ERP, measured by tools/parity/compare-page.mjs', '', `Pages measured: ${rows.length}. Complete (0 missing): ${rows.filter((r) => r.total === 0).length}.`, '', '| Family | Pages | Complete | Missing tabs | Missing columns | Missing fields | Missing buttons | Pages with no data rows |', '|---|---|---|---|---|---|---|---|'];
for (const [f, rs] of byFam) {
  const s = (k) => rs.reduce((a, r) => a + r[k], 0);
  L.push(`| ${f} | ${rs.length} | ${rs.filter((r) => r.total === 0).length} | ${s('tabs')} | ${s('columns')} | ${s('fields')} | ${s('buttons')} | ${rs.filter((r) => r.empty > 0 && r.empty === r.tabsCount).length} |`);
}
L.push('', '## Pages with the most missing items', '', '| Page | Family | Tabs | Columns | Fields | Buttons | Total |', '|---|---|---|---|---|---|---|');
for (const r of [...rows].sort((a, b) => b.total - a.total).slice(0, 60)) L.push(`| ${r.id} | ${r.family} | ${r.tabs} | ${r.columns} | ${r.fields} | ${r.buttons} | ${r.total} |`);
writeFileSync(path.join(root, 'docs/build/GAPS.md'), L.join('\n') + '\n');
console.log(L.slice(0, 3).join('\n'));
