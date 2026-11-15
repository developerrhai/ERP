// Builds the Part B outputs from docs/ui-audit/data/<role>/pages.jsonl:
//   pages.csv api-calls.csv buttons.csv issues.csv parity.csv, UI-AUDIT-REPORT.md and gallery.html (git-ignored).
// Usage: node tests/ui-audit/build-report.mjs [role=super]   (reads the primary role; other roles add an access table)
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'docs/ui-audit');
const role = process.argv[2] ?? 'super';
const pre = role === 'super' ? '' : `${role}-`; // output file prefix (super = the baseline, no prefix)
const imgTag = role.endsWith('-after') ? '-after' : '';
const read = (r) => { const f = path.join(outDir, 'data', r, 'pages.jsonl'); const m = new Map(); if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const o = JSON.parse(l); m.set(o.id, o); } return m; };
const pages = [...read(role).values()];
const registry = JSON.parse(readFileSync(path.join(root, 'packages/registry/registry.v2.json'), 'utf8'));
const order = new Map(registry.pages.map((p, i) => [p.id, i]));
pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

// which pages have their own component in ModulePage.tsx (explicit case) vs the generic fallback
const mp = readFileSync(path.join(root, 'apps/web/src/pages/ModulePage.tsx'), 'utf8');
const ownIds = new Set([...mp.matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]));
const renderer = (id) => (ownIds.has(id) ? 'own page' : 'generic fallback');

const esc = (v) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} &]/gu, '').replace(/\s+/g, ' ').trim();
const IGNORE_V40 = new Set(['reset 25 demo', 'load selected', 'next', 'previous', 'prev', '']);
const isChromeBtn = (t) => /^\d+$/.test(t) || /privacy notice|settings$/i.test(t) || /^[A-Z]{2,6}[\/-][A-Z0-9\/-]*\d/.test(t) || /^[a-z]{2,6}-[a-z0-9-]+-\d+$/i.test(t);
const ALIAS = { 'add new': ['add', 'add new'], 'send email': ['email', 'send email'], email: ['email', 'send email'], pdf: ['pdf', 'industry pdf'], docs: ['docs', 'documents'], submit: ['submit', 'submit approval'], history: ['history', 'project history'] };
const matches = (v40Text, erpSet, erpRaw) => {
  const n = norm(v40Text);
  if (erpSet.has(n)) return true;
  if ((ALIAS[n] ?? []).some((a) => erpSet.has(a))) return true;
  if (n === 'add new' || n === 'add') return erpRaw.some((t) => /^(＋|\+)?\s*(add|new)\b/i.test(t.trim()) || /^＋/.test(t.trim()));
  return false;
};

const buttonRows = [], issues = [], parity = [], apiRows = [], pageRows = [];
let issueNo = 0;
const addIssue = (p, category, severity, owner, detail, evidence = '', tab = '', width = '') => issues.push({ issue: `UI-${String(++issueNo).padStart(4, '0')}`, page: p.id, tab, role, width, category, severity, owner, detail, evidence });

for (const p of pages) {
  const e = p.erp ?? {}, v = p.v40 ?? {};
  const erpBtns = (e.buttons ?? []).filter((b) => !isChromeBtn(b.text));
  const erpRaw = erpBtns.map((b) => b.text);
  const erpSet = new Set(erpRaw.map(norm));
  const v40Texts = [...new Set((v.buttons ?? []).map((b) => b.text))].filter((t) => !IGNORE_V40.has(norm(t)) && !isChromeBtn(t));
  const v40Norm = new Set(v40Texts.map(norm));
  let missing = 0, placeholder = 0, present = 0;
  for (const t of v40Texts) {
    const hit = matches(t, erpSet, erpRaw);
    const b = erpBtns.find((x) => norm(x.text) === norm(t));
    let verdict = 'MISSING';
    if (hit) verdict = b?.disabled ? 'PRESENT-PLACEHOLDER' : 'PRESENT';
    if (verdict === 'MISSING') missing += 1; else if (verdict === 'PRESENT-PLACEHOLDER') placeholder += 1; else present += 1;
    buttonRows.push({ page: p.id, family: p.family, button: t, v40_area: (v.buttons ?? []).find((x) => x.text === t)?.area ?? '', erp_area: b?.area ?? '', verdict });
  }
  const extra = erpBtns.filter((b) => !v40Norm.has(norm(b.text)) && ![...v40Norm].some((n) => matches(n, new Set([norm(b.text)]), [b.text])));
  for (const b of extra) buttonRows.push({ page: p.id, family: p.family, button: b.text, v40_area: '', erp_area: b.area, verdict: 'EXTRA' });

  // tabs / parity
  const v40Tabs = (v.tabs && v.tabs.length ? v.tabs : p.v40Tabs ?? []).map(norm), erpTabs = (e.tabs ?? []).map(norm);
  const tabMissing = v40Tabs.filter((t) => !erpTabs.includes(t));
  for (const t of v40Tabs) parity.push({ page: p.id, kind: 'tab', v40: t, erp: erpTabs.includes(t) ? t : '', verdict: erpTabs.includes(t) ? 'OK' : 'MISSING' });
  for (const t of erpTabs.filter((x) => !v40Tabs.includes(x))) parity.push({ page: p.id, kind: 'tab', v40: '', erp: t, verdict: 'EXTRA' });

  // data verdict
  const apiErr = (p.api ?? []).find((a) => a.status >= 400 && !/permissions|privacy|unread/.test(a.url));
  let data = 'OK-NONTABLE';
  if (e.notFound) data = 'NOT-FOUND'; else if (String(p.status).startsWith('open-failed')) data = 'OPEN-FAILED';
  else if (apiErr) data = 'API-ERROR'; else if (e.tableRows > 0) data = 'OK'; else if (e.empty) data = 'EMPTY-OK'; else if ((v.tableRows ?? 0) > 0 && (e.textLen ?? 0) < 300) data = 'NO-DATA-BUG?';

  // issues
  if (e.notFound) addIssue(p, 'BREAK', 'P0', 'WEB', 'V40 page id shows "Page not found" in the ERP', 'screenshot erp__1440');
  if (String(p.status).startsWith('open-failed')) addIssue(p, 'BREAK', 'P0', 'WEB', p.status);
  for (const m of p.pageErrors ?? []) addIssue(p, 'BREAK', 'P0', 'WEB', `page error: ${m}`);
  if (apiErr) addIssue(p, 'API', apiErr.status >= 500 ? 'P0' : 'P1', 'API', `${apiErr.method} ${apiErr.url} -> ${apiErr.status}`, apiErr.url);
  if (e.badText) addIssue(p, 'TEXT', e.badText === 'Arrives in Phase' ? 'P1' : 'P2', 'WEB', `screen shows "${e.badText}"`, 'screenshot erp__1440');
  for (const m of [...new Set(p.consoleErrors ?? [])].slice(0, 2)) addIssue(p, 'BREAK', 'P2', 'WEB', `console error: ${m}`);
  for (const w of ['1440', '1024', '390']) if (p.overflow?.[w]) addIssue(p, 'RESPONSIVE', w === '390' ? 'P1' : 'P1', 'WEB', `page-wide sideways scroll at ${w}px`, `erp__${w}`, '', w);
  if (missing > 0 && !e.notFound) addIssue(p, 'BUTTON-MISSING', 'P1', 'WEB', `${missing} V40 button(s) missing: ${v40Texts.filter((t) => !matches(t, erpSet, erpRaw)).slice(0, 8).join(', ')}${missing > 8 ? '…' : ''}`, 'buttons.csv');
  if (v40Tabs.length && tabMissing.length) addIssue(p, 'PARITY', 'P1', 'WEB', `${tabMissing.length} of ${v40Tabs.length} V40 tabs missing (ERP has ${erpTabs.length})`, 'parity.csv');
  if ((e.inlineStyles ?? 0) > 0) addIssue(p, 'LAYOUT', 'P3', 'WEB', `${e.inlineStyles} inline style attributes on the page`);
  if (p.loadMs > 4000) addIssue(p, 'SPEED', 'P2', 'API', `page took ${p.loadMs} ms to show`);

  // score 0-3 x 10 (rule-based, see report)
  const frac = v40Texts.length ? present / v40Texts.length : 1;
  const sc = {
    header: e.h1 ? (extra.length ? 2 : 3) : 0,
    buttonPlacement: e.notFound ? 0 : frac > 0.8 ? 3 : frac > 0.5 ? 2 : frac > 0.2 ? 1 : 0,
    table: (v.tableRows ?? 0) === 0 ? 3 : e.tableRows > 0 ? (p.overflow?.['1440'] ? 1 : 3) : 0,
    filters: (e.searchBoxes ?? 0) > 0 ? 3 : (v.tableRows ?? 0) > 0 ? 1 : 3,
    recordView: erpSet.has('edit') || erpSet.has('view') || erpSet.has('open') ? 3 : 1,
    form: [...erpSet].some((t) => /^(add|new)\b/.test(t)) ? 2 : (v.buttons ?? []).some((b) => /add/i.test(b.text)) ? 0 : 3,
    states: e.notFound ? 0 : e.badText ? 1 : (p.consoleErrors ?? []).length ? 2 : 3,
    consistency: (e.inlineStyles ?? 0) > 5 ? 1 : (e.inlineStyles ?? 0) > 0 ? 2 : 3,
    phone: !p.overflow?.['390'] && !p.overflow?.['1024'] ? 3 : !p.overflow?.['390'] ? 2 : 1,
    parity: e.notFound ? 0 : Math.round(3 * (0.5 * frac + 0.5 * (v40Tabs.length ? 1 - tabMissing.length / v40Tabs.length : 1))),
  };
  const score = Object.values(sc).reduce((a, b) => a + b, 0);
  p._m = { missing, placeholder, present, extra: extra.length, tabMissing: tabMissing.length, v40Tabs: v40Tabs.length, data, score, sc, v40Total: v40Texts.length };
  for (const a of p.api ?? []) apiRows.push({ page: p.id, method: a.method, url: a.url, status: a.status, ms: a.ms, bytes: a.bytes });
  pageRows.push({ id: p.id, title: p.title, family: p.family, renderer: renderer(p.id), opens: String(p.status).startsWith('open-failed') ? 'NO' : e.notFound ? 'NOT-FOUND' : 'YES', load_ms: p.loadMs, data_verdict: data, v40_buttons: v40Texts.length, buttons_present: present, buttons_placeholder: placeholder, buttons_missing: missing, buttons_extra: extra.length, v40_tabs: v40Tabs.length, erp_tabs: erpTabs.length, tabs_missing: tabMissing.length, overflow_1440: !!p.overflow?.['1440'], overflow_1024: !!p.overflow?.['1024'], overflow_390: !!p.overflow?.['390'], console_errors: (p.consoleErrors ?? []).length, bad_text: e.badText ?? '', inline_styles: e.inlineStyles ?? 0, score });
}

writeFileSync(path.join(outDir, pre + 'pages.csv'), csv(pageRows, Object.keys(pageRows[0] ?? { id: '' })));
writeFileSync(path.join(outDir, pre + 'api-calls.csv'), csv(apiRows, ['page', 'method', 'url', 'status', 'ms', 'bytes']));
writeFileSync(path.join(outDir, pre + 'buttons.csv'), csv(buttonRows, ['page', 'family', 'button', 'v40_area', 'erp_area', 'verdict']));
writeFileSync(path.join(outDir, pre + 'issues.csv'), csv(issues, ['issue', 'page', 'tab', 'role', 'width', 'category', 'severity', 'owner', 'detail', 'evidence']));
writeFileSync(path.join(outDir, pre + 'parity.csv'), csv(parity, ['page', 'kind', 'v40', 'erp', 'verdict']));

// ---------- report
const n = pages.length, by = (f) => pages.filter(f).length;
const sev = (s) => issues.filter((i) => i.severity === s).length;
const bv = (v) => buttonRows.filter((b) => b.verdict === v).length;
const dataCounts = {}; for (const p of pages) dataCounts[p._m.data] = (dataCounts[p._m.data] ?? 0) + 1;
const avg = n ? (pages.reduce((a, p) => a + p._m.score, 0) / n).toFixed(1) : '0';
const rend = {}; for (const p of pages) rend[renderer(p.id)] = (rend[renderer(p.id)] ?? 0) + 1;
const groups = new Map();
for (const i of issues) { const key = `${i.category}|${i.severity}|${i.detail.replace(/[0-9]+/g, 'N').replace(/:.*$/, '').slice(0, 60)}`; const g = groups.get(key) ?? { i, pages: new Set() }; g.pages.add(i.page); groups.set(key, g); }
const top = [...groups.values()].sort((a, b) => b.pages.size - a.pages.size).slice(0, 25);
const fams = [...new Set(pages.map((p) => p.family))];
const slow = [...pages].sort((a, b) => b.loadMs - a.loadMs).slice(0, 30);
const slowApi = [...apiRows].sort((a, b) => b.ms - a.ms).slice(0, 30);
const L = [];
L.push(`# UI AUDIT REPORT (Phase 36 Part B)`, '', `Role audited: **${role}** · generated ${new Date().toISOString()} · local database rhai_erp_ui · V40 = \`RHAI_ERP_V40_Edit_Update_Fixed.html\` (read-only).`, '',
  '> Method: every page opened in V40 (its own `nav(id)`) and in the ERP at 1440 / 1024 / 390; buttons, tabs, API calls, console, overflow and text problems read from the DOM. Buttons are **not clicked** (no Save/Submit/Approve/Post/Delete/Send); a V40 button counts PRESENT when the ERP shows a button with the same label (or the V40 add/email/pdf alias), PRESENT-PLACEHOLDER when it is disabled, MISSING otherwise; PRESENT-WORKS vs PRESENT-DEAD needs click tests and is reported as PRESENT (untested). Tabs inside pages, record views and add/edit forms are compared by label only (default view screenshots).', '',
  '## Summary', '', `| Measure | Value |`, '|---|---|', `| Pages audited | ${n} of ${registry.pages.length} |`, `| Opened OK | ${by((p) => p.erp && !p.erp.notFound && !String(p.status).startsWith('open-failed'))} (not found: ${by((p) => p.erp?.notFound)}, failed: ${by((p) => String(p.status).startsWith('open-failed'))}) |`,
  `| Issues P0 / P1 / P2 / P3 | ${sev('P0')} / ${sev('P1')} / ${sev('P2')} / ${sev('P3')} |`, `| Data verdicts | ${Object.entries(dataCounts).map(([k, v]) => `${k} ${v}`).join(' · ')} |`,
  `| V40 buttons: missing / placeholder / present | ${bv('MISSING')} / ${bv('PRESENT-PLACEHOLDER')} / ${bv('PRESENT')} (extra ERP-only: ${bv('EXTRA')}) |`, `| Pages with a missing V40 button | ${by((p) => p._m.missing > 0)} |`,
  `| Pages missing V40 tabs | ${by((p) => p._m.tabMissing > 0)} |`, `| Average UI score (rule-based, /30) | ${avg} |`, `| Pages below 18/30 | ${by((p) => p._m.score < 18)} |`, `| Renderer | ${Object.entries(rend).map(([k, v]) => `${k} ${v}`).join(' · ')} |`,
  `| Page-wide sideways scroll 1440 / 1024 / 390 | ${by((p) => p.overflow?.['1440'])} / ${by((p) => p.overflow?.['1024'])} / ${by((p) => p.overflow?.['390'])} |`, `| Pages with "Arrives in Phase" | ${by((p) => p.erp?.badText === 'Arrives in Phase')} |`, `| Inline style attributes (sum over pages) | ${pages.reduce((a, p) => a + (p.erp?.inlineStyles ?? 0), 0)} |`, '',
  '### Score rule (0-3 each, 10 areas)', 'header (title present, no extra clutter) · button placement (share of V40 buttons present) · table (register present, no overflow) · filters (search box) · record view (Edit/View/Open present) · form (Add present) · states (no bad text / console errors) · consistency (few inline styles) · phone & tablet (no sideways scroll at 390/1024) · V40 parity (buttons + tabs). Heuristic, from the DOM only.', '',
  '## Top 25 root causes', '', '| # | Category | Sev | Pages | Example | Fix approach |', '|---|---|---|---|---|---|');
const fix = { 'BUTTON-MISSING': 'C3: one shared head row + record bar (src/ui ActionRow) wired per page', PARITY: 'C5: V36 tabs from the registry on every page (ui Tabs)', TEXT: 'C3: remove "Arrives in Phase" - grey the button with a reason (ui Button reason)', RESPONSIVE: 'C4/C7: tables scroll in their own box, single-column forms', BREAK: 'C4: fix the page / route', API: 'Phase 37 (API) unless wrong URL/field', SPEED: 'Phase 37 / paging', LAYOUT: 'C1: replace inline styles with ui.css classes' };
top.forEach((g, i) => L.push(`| ${i + 1} | ${g.i.category} | ${g.i.severity} | ${g.pages.size} | ${g.i.detail.slice(0, 80).replace(/\|/g, '/')} | ${fix[g.i.category] ?? ''} |`));
L.push('', '## Per family', '', '| Family | Pages | Avg score | P0 | P1 | Missing buttons | Worst 3 pages |', '|---|---|---|---|---|---|---|');
for (const f of fams) { const ps = pages.filter((p) => p.family === f); const ids = new Set(ps.map((p) => p.id)); const is = issues.filter((i) => ids.has(i.page)); L.push(`| ${f} | ${ps.length} | ${(ps.reduce((a, p) => a + p._m.score, 0) / ps.length).toFixed(1)} | ${is.filter((i) => i.severity === 'P0').length} | ${is.filter((i) => i.severity === 'P1').length} | ${ps.reduce((a, p) => a + p._m.missing, 0)} | ${[...ps].sort((a, b) => a._m.score - b._m.score).slice(0, 3).map((p) => `${p.id} (${p._m.score})`).join(', ')} |`); }
L.push('', '## The 30 slowest pages', '', '| Page | Load ms |', '|---|---|', ...slow.map((p) => `| ${p.id} | ${p.loadMs} |`), '', '## The 30 slowest API calls', '', '| Page | Call | Status | ms | bytes |', '|---|---|---|---|---|', ...slowApi.map((a) => `| ${a.page} | ${a.method} ${a.url.slice(0, 70)} | ${a.status} | ${a.ms} | ${a.bytes} |`));
L.push('', '## Needs Phase 37 (API / flow)', '', ...[...new Set(issues.filter((i) => i.owner === 'API').map((i) => `- ${i.page}: ${i.detail}`))].slice(0, 60), '',
  '## Part C plan (order of fixes)', '1. C1 design system: `src/ui` + `ui.css` (built) → migrate pages to it.', '2. C3 one head row (← Return, Excel, Industry PDF, Word, Print, ＋ Add, Edit, Delete, Documents, Submit Approval, Approval Queue, Move Forward, ⇧ Import, ⇩ Export, Duplicates) + record bar; remove the bar above the title; remove "Arrives in Phase".',
  '3. C5 table-first register + V36 tabs on every page; the 12 documents first (Quotation, Sales Order, PR, PO, GRN, Incoming QC, Production Order, Delivery Challan, GST Invoice, Receipt, Purchase Invoice, Payment).', '4. C4 fix overflow/breaks listed in issues.csv.', '5. C6 Home = V39 department workspace; C7 phone/tablet; C8 NO-DATA-BUG; C9 re-audit with before/after.');
writeFileSync(path.join(outDir, pre + 'UI-AUDIT-REPORT.md'), L.join('\n') + '\n');

// ---------- gallery (git-ignored)
const gdata = pages.map((p) => ({ id: p.id, title: p.title, family: p.family, score: p._m.score, data: p._m.data, missing: p._m.missing, tabMissing: p._m.tabMissing, sev: ['P0', 'P1', 'P2', 'P3'].find((s) => issues.some((i) => i.page === p.id && i.severity === s)) ?? '', chips: issues.filter((i) => i.page === p.id).map((i) => `${i.issue} ${i.category} ${i.severity}`).slice(0, 6), miss: buttonRows.filter((b) => b.page === p.id && b.verdict === 'MISSING').map((b) => b.button).slice(0, 12), dir: p.family.replace(/[^a-z0-9]+/gi, '_') }));
writeFileSync(path.join(outDir, pre + 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>UI audit gallery</title><style>body{font:13px Inter,Arial;margin:0;background:#f4f7fb;color:#172033}header{position:sticky;top:0;background:#fff;padding:10px 16px;border-bottom:1px solid #e2e8f0;display:flex;gap:12px;align-items:center;z-index:5}.row{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin:12px 16px;padding:12px}.row h3{margin:0 0 6px}.imgs{display:grid;grid-template-columns:2fr 2fr 1.3fr .8fr;gap:8px}.imgs figure{margin:0}.imgs img{width:100%;border:1px solid #e2e8f0;border-radius:8px}figcaption{color:#64748b;font-size:11px}.chip{display:inline-block;background:#fee2e2;color:#991b1b;border-radius:99px;padding:1px 8px;margin:2px;font-size:11px}.chip.m{background:#fef3c7;color:#92400e}.chip.i{background:#dbeafe;color:#1e40af}</style><header><b>UI audit (${role})</b><select id=f><option value="">All families</option>${fams.map((f) => `<option>${f}</option>`).join('')}</select><select id=s><option value="">All severities</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select><label><input type=checkbox id=m> missing buttons only</label><span id=c></span></header><div id=list></div><script>const T='${imgTag}';const D=${JSON.stringify(gdata)};const el=document.getElementById('list');function draw(){const f=document.getElementById('f').value,s=document.getElementById('s').value,m=document.getElementById('m').checked;const rows=D.filter(p=>(!f||p.family===f)&&(!s||p.sev===s)&&(!m||p.missing>0));document.getElementById('c').textContent=rows.length+' pages';el.innerHTML=rows.map(p=>{const b='shots/'+p.dir+'/'+p.id+'__main__';return '<div class=row><h3>'+p.title+' <small>('+p.id+') score '+p.score+'/30 · '+p.data+'</small></h3><div>'+p.miss.map(x=>'<span class="chip m">missing: '+x+'</span>').join('')+p.chips.map(x=>'<span class="chip i">'+x+'</span>').join('')+'</div><div class=imgs><figure><img loading=lazy src="'+b+'v40'+T+'__1440.png"><figcaption>V40 1440</figcaption></figure><figure><img loading=lazy src="'+b+'erp'+T+'__1440.png"><figcaption>ERP 1440</figcaption></figure><figure><img loading=lazy src="'+b+'erp'+T+'__1024.png"><figcaption>ERP tablet 1024</figcaption></figure><figure><img loading=lazy src="'+b+'erp'+T+'__390.png"><figcaption>ERP phone 390</figcaption></figure></div></div>'}).join('')}['f','s','m'].forEach(i=>document.getElementById(i).onchange=draw);draw()</script>`);
console.log(`built: ${n} pages, ${issues.length} issues, avg score ${avg}`);
