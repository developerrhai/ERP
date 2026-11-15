// Before -> after: reads pages.csv (baseline) and super-after-pages.csv, writes docs/ui-audit/BEFORE-AFTER.md
// and gallery-compare.html (git-ignored): V40 | Before | After side by side for every page.
// Run after:  node tests/ui-audit/build-report.mjs super && node tests/ui-audit/build-report.mjs super-after && node tests/ui-audit/compare.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/ui-audit');
const parse = (f) => {
  const file = path.join(out, f);
  if (!existsSync(file)) return new Map();
  const [head, ...rows] = readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  const m = new Map();
  for (const r of rows) {
    const cells = r.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const o = {};
    cols.forEach((c, i) => (o[c] = cells[i]));
    m.set(o.id, o);
  }
  return m;
};
const before = parse('pages.csv');
const after = parse('super-after-pages.csv');
const ids = [...after.keys()].filter((id) => before.has(id));
const num = (v) => Number(v) || 0;
const sum = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0);
const B = ids.map((i) => before.get(i)), A = ids.map((i) => after.get(i));
const avg = (rows) => (rows.length ? (sum(rows, 'score') / rows.length).toFixed(1) : '0');
const cnt = (rows, f) => rows.filter(f).length;
const L = ['# BEFORE -> AFTER (Phase 36, Super User)', '', `Pages compared: ${ids.length} (same pages in both runs). Before = first full audit; after = audit of the same pages after the Part C changes.`, '',
  '| Measure | Before | After |', '|---|---|---|',
  `| Average UI score (/30) | ${avg(B)} | ${avg(A)} |`,
  `| Pages below 18/30 | ${cnt(B, (r) => num(r.score) < 18)} | ${cnt(A, (r) => num(r.score) < 18)} |`,
  `| Pages "not found" | ${cnt(B, (r) => r.opens === 'NOT-FOUND')} | ${cnt(A, (r) => r.opens === 'NOT-FOUND')} |`,
  `| V40 buttons missing | ${sum(B, 'buttons_missing')} | ${sum(A, 'buttons_missing')} |`,
  `| V40 buttons present | ${sum(B, 'buttons_present')} | ${sum(A, 'buttons_present')} |`,
  `| V40 buttons greyed (placeholder, with reason) | ${sum(B, 'buttons_placeholder')} | ${sum(A, 'buttons_placeholder')} |`,
  `| Pages with a missing V40 button | ${cnt(B, (r) => num(r.buttons_missing) > 0)} | ${cnt(A, (r) => num(r.buttons_missing) > 0)} |`,
  `| Pages with "Arrives in Phase" | ${cnt(B, (r) => r.bad_text === 'Arrives in Phase')} | ${cnt(A, (r) => r.bad_text === 'Arrives in Phase')} |`,
  `| Sideways scroll at 1440 | ${cnt(B, (r) => r.overflow_1440 === 'true')} | ${cnt(A, (r) => r.overflow_1440 === 'true')} |`,
  `| Sideways scroll at 1024 | ${cnt(B, (r) => r.overflow_1024 === 'true')} | ${cnt(A, (r) => r.overflow_1024 === 'true')} |`,
  `| Sideways scroll at 390 | ${cnt(B, (r) => r.overflow_390 === 'true')} | ${cnt(A, (r) => r.overflow_390 === 'true')} |`,
  `| Console errors (sum) | ${sum(B, 'console_errors')} | ${sum(A, 'console_errors')} |`,
  `| Inline style attributes on screens (sum) | ${sum(B, 'inline_styles')} | ${sum(A, 'inline_styles')} |`, '',
  '## Per family (average score before -> after)', '', '| Family | Pages | Score | Missing buttons | Sideways @390 |', '|---|---|---|---|---|'];
for (const f of [...new Set(B.map((r) => r.family))]) {
  const b = B.filter((r) => r.family === f), a = A.filter((r) => r.family === f);
  L.push(`| ${f} | ${b.length} | ${avg(b)} -> ${avg(a)} | ${sum(b, 'buttons_missing')} -> ${sum(a, 'buttons_missing')} | ${cnt(b, (r) => r.overflow_390 === 'true')} -> ${cnt(a, (r) => r.overflow_390 === 'true')} |`);
}
const better = ids.filter((i) => num(after.get(i).score) > num(before.get(i).score)).length;
const worse = ids.filter((i) => num(after.get(i).score) < num(before.get(i).score));
L.push('', `Pages with a better score: ${better}; worse: ${worse.length}${worse.length ? ` (${worse.slice(0, 15).join(', ')})` : ''}.`);
writeFileSync(path.join(out, 'BEFORE-AFTER.md'), L.join('\n') + '\n');

const fam = (i) => before.get(i).family.replace(/[^a-z0-9]+/gi, '_');
const data = ids.map((i) => ({ id: i, title: before.get(i).title, family: before.get(i).family, d: fam(i), sb: num(before.get(i).score), sa: num(after.get(i).score), mb: num(before.get(i).buttons_missing), ma: num(after.get(i).buttons_missing) }));
writeFileSync(path.join(out, 'gallery-compare.html'), `<!doctype html><meta charset="utf-8"><title>Before | After | V40</title><style>body{font:13px Inter,Arial;margin:0;background:#f4f7fb;color:#172033}header{position:sticky;top:0;background:#fff;padding:10px 16px;border-bottom:1px solid #e2e8f0;display:flex;gap:12px;align-items:center;z-index:5}.row{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin:12px 16px;padding:12px}.imgs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.imgs img{width:100%;border:1px solid #e2e8f0;border-radius:8px}figcaption{color:#64748b;font-size:11px}figure{margin:0}</style><header><b>Before | After | V40</b><select id=w><option>1440</option><option>1024</option><option>390</option></select><select id=f><option value="">All families</option>${[...new Set(data.map((d) => d.family))].map((f) => `<option>${f}</option>`).join('')}</select><label><input type=checkbox id=m> still missing buttons</label><span id=c></span></header><div id=l></div><script>const D=${JSON.stringify(data)};function draw(){const w=document.getElementById('w').value,f=document.getElementById('f').value,m=document.getElementById('m').checked;const r=D.filter(p=>(!f||p.family===f)&&(!m||p.ma>0));document.getElementById('c').textContent=r.length+' pages';document.getElementById('l').innerHTML=r.map(p=>{const b='shots/'+p.d+'/'+p.id+'__main__';return '<div class=row><h3>'+p.title+' <small>('+p.id+') score '+p.sb+' -> '+p.sa+' · missing buttons '+p.mb+' -> '+p.ma+'</small></h3><div class=imgs><figure><img loading=lazy src="'+b+'erp__'+w+'.png"><figcaption>Before ('+w+')</figcaption></figure><figure><img loading=lazy src="'+b+'erp-after__'+w+'.png"><figcaption>After ('+w+')</figcaption></figure><figure><img loading=lazy src="'+b+'v40__1440.png"><figcaption>V40 (1440)</figcaption></figure></div></div>'}).join('')}['w','f','m'].forEach(i=>document.getElementById(i).onchange=draw);draw()</script>`);
console.log(`compared ${ids.length} pages`);
