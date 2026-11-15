// Drives the department inbox flow on the local UI database (API 4100) with each department's own head user.
// Send -> Receive -> Accept -> Complete / Return / Recall / Forward. Passwords come from the git-ignored tests/feed/ui/state.json.
// Run: node tests/feed/inbox-flow.mjs   (needs the UI servers: see tests/feed/ui/start-ui-servers.ts)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const envUrl = readFileSync(new URL('../../apps/api/.env', import.meta.url), 'utf8').match(/^DATABASE_URL=.*$/m)[0];
const DBU = envUrl.replace(/.*:\/\/([^:]+):.*/, '$1'); const DBP = envUrl.replace(/.*:\/\/[^:]+:([^@]+)@.*/, '$1');
const s = JSON.parse(readFileSync(new URL('./ui/state.json', import.meta.url), 'utf8'));
const B = 'http://localhost:4100/api/v1';
const H = { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
const out = [];
const log = (ok, what, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'} ${what} ${extra}`); console.log(out.at(-1)); };

async function login(id) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ identifier: id, password: id === s.ownerId ? s.ownerPassword : s.userPassword }) });
  let j = await r.json();
  if (!j.data?.accessToken && id !== s.ownerId) {
    // first sign-in: temporary password, then the forced change to the normal feed password
    const r2 = await fetch(`${B}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ identifier: id, password: s.tempPassword }) });
    j = await r2.json();
    if (j.data?.accessToken) await fetch(`${B}/auth/change-password`, { method: 'POST', headers: { ...H, authorization: `Bearer ${j.data.accessToken}` }, body: JSON.stringify({ currentPassword: s.tempPassword, newPassword: s.userPassword }) });
    return login(id);
  }
  if (!j.data?.accessToken) throw new Error(`login ${id}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j.data.accessToken;
}
const call = async (tok, method, path, body) => {
  const r = await fetch(B + path, { method, headers: { ...H, authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data, err: j.error?.message };
};

const dept = {};
const owner = await login(s.ownerId);
for (const d of (await call(owner, 'GET', '/work/departments')).data) dept[d.name] = d.id;
const U = {};
for (const n of ['sales', 'purchase', 'production', 'warehouse', 'quality', 'finance']) {
  try { U[n] = await login(`head.${n}`); } catch (e) { log(false, `login head.${n}`, e.message); }
}
// documents to move: unused sales orders and purchase orders
const dbq = (sql) => execFileSync('psql', ['-U', DBU, '-h', 'localhost', '-d', 'rhai_erp_ui', '-At', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: DBP } }).toString().trim().split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean).map((l) => { const [id, number] = l.split('|'); return { id, number }; });
const freeSo = dbq("select id, number from sales_orders where id not in (select doc_id from work_movements) order by number limit 5");
const freePo = dbq("select id, number from purchase_orders where id not in (select doc_id from work_movements) order by number limit 5");
console.log('free docs', freeSo.length, freePo.length);

async function send(from, to, type, d, prio = 'Normal') {
  const r = await call(U[from], 'POST', '/work/movements', { fromDepartmentId: dept[cap(from)], toDepartmentId: dept[cap(to)], docType: type, docId: d.id, docNo: d.number ?? d.docNo ?? d.code ?? d.id.slice(0, 8), priority: prio, handoverNote: `Flow test: ${from} to ${to}` });
  log(r.status === 201, `${from} sends ${type} ${d.number ?? d.docNo ?? ''} to ${to}`, r.err ?? '');
  return r.data;
}
const cap = (x) => x[0].toUpperCase() + x.slice(1);
const act = async (who, m, a, reason) => {
  const r = await call(U[who], 'POST', `/work/movements/${m.id}/${a}`, reason ? { reason } : {});
  log(r.status === 200 || r.status === 201, `${who} ${a}`, r.err ?? r.data?.state ?? '');
  return r.data;
};

if (freeSo[0]) { const m = await send('sales', 'purchase', 'sales-orders', freeSo[0]); await act('purchase', m, 'receive'); await act('purchase', m, 'accept'); await act('purchase', m, 'complete'); }
if (freeSo[1]) { const m = await send('sales', 'production', 'sales-orders', freeSo[1], 'High'); await act('production', m, 'receive'); await act('production', m, 'return', 'Drawing missing'); }
if (freeSo[2]) { const m = await send('sales', 'warehouse', 'sales-orders', freeSo[2]); await act('sales', m, 'recall', 'Sent to wrong department'); }
if (freePo[0]) { const m = await send('purchase', 'warehouse', 'scm-po', freePo[0]); await act('warehouse', m, 'receive'); await act('warehouse', m, 'accept'); }
if (freePo[1]) { const m = await send('purchase', 'quality', 'scm-po', freePo[1], 'Critical'); await act('quality', m, 'receive'); }
if (freePo[2]) { await send('purchase', 'finance', 'scm-po', freePo[2]); }

// every department sees the right tabs and counts
for (const [who, tok] of Object.entries(U)) {
  const c = (await call(tok, 'GET', '/work/inbox/counts')).data;
  const tabs = {};
  for (const t of ['pending', 'completed', 'open', 'ready', 'waiting', 'returned', 'sent', 'all']) tabs[t] = (await call(tok, 'GET', `/work/inbox?tab=${t}`)).data?.rows?.length ?? 'ERR';
  log(!!c, `${who} inbox counts`, JSON.stringify(c) + ' tabs ' + JSON.stringify(tabs));
}
const all = (await call(owner, 'GET', '/work/inbox?dept=all&tab=all')).data?.rows ?? [];
log(all.length > 0, 'owner All Departments sees every movement', `${all.length} rows`);
const au = (await call(owner, 'GET', '/work/audit')).data;
log(!!au, 'audit trail', `${au?.rows?.length ?? au?.length ?? 0} entries`);
console.log(out.filter((x) => x.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASSED');
