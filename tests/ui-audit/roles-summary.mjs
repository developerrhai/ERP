// Markdown table of the 5-role audit (Super User = super-after, other roles at 1440 only) for the Phase 36 report.
// Usage: node tests/ui-audit/roles-summary.mjs > docs/ui-audit/ROLES-SUMMARY.md
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roles = [['Super User', 'super-after'], ['Administrator', 'admin'], ['Department Manager Purchase TAL', 'mgr-purchase'], ['Employee Stores TAL', 'emp-stores'], ['Sales user TAL+SAW', 'sales-talsaw']];
const read = (d) => {
  const f = path.join(root, 'docs/ui-audit/data', d, 'pages.jsonl');
  const m = new Map();
  if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const o = JSON.parse(l); m.set(o.id, o); }
  return [...m.values()];
};
const L = ['# ROLES SUMMARY (Phase 36 Part B)', '', 'Each role opened every V40 page id in the ERP. "Access denied" for a restricted role is correct; for the Super User it would be a bug. Non-Super roles were audited at 1440 px only.', '',
  '| Role | Pages audited | Opened with content | Access denied | Not found | Page errors | Console errors | API errors (4xx/5xx) | Avg buttons shown |', '|---|---|---|---|---|---|---|---|---|'];
for (const [name, dir] of roles) {
  const p = read(dir);
  if (!p.length) { L.push(`| ${name} | not audited | | | | | | | |`); continue; }
  const denied = p.filter((x) => x.erp?.denied).length;
  const nf = p.filter((x) => x.erp?.notFound).length;
  const ok = p.filter((x) => x.erp && !x.erp.denied && !x.erp.notFound && !String(x.status).startsWith('open-failed')).length;
  const pe = p.reduce((a, x) => a + (x.pageErrors?.length ?? 0), 0);
  const ce = p.reduce((a, x) => a + (x.consoleErrors?.length ?? 0), 0);
  const ae = p.reduce((a, x) => a + (x.api ?? []).filter((c) => c.status >= 400 && !/permissions|privacy|unread/.test(c.url)).length, 0);
  const btn = (p.reduce((a, x) => a + new Set((x.erp?.buttons ?? []).map((b) => b.text)).size, 0) / p.length).toFixed(1);
  L.push(`| ${name} | ${p.length} | ${ok} | ${denied} | ${nf} | ${pe} | ${ce} | ${ae} | ${btn} |`);
}
const sup = new Map(read('super-after').map((x) => [x.id, x]));
L.push('', '## Pages a non-admin role can open that look admin-only (to review)', '');
for (const [name, dir] of roles.slice(1)) {
  const open = read(dir).filter((x) => x.erp && !x.erp.denied && !x.erp.notFound && /^admin-|^hardening|-security$/.test(x.id));
  L.push(`* ${name}: ${open.length ? open.map((x) => x.id).slice(0, 15).join(', ') : 'none'}`);
}
void sup;
process.stdout.write(L.join('\n') + '\n');
