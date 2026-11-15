// Shared helpers for the ops demo-data seeders (mfg, qms, maint, finance, logistics, dms). Local API only.
// SEED_API defaults to http://localhost:4100/api/v1. The owner password comes from the git-ignored tests/feed/ui/state.json and is never printed.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
export const B = process.env.SEED_API || 'http://localhost:4100/api/v1';
if (!/^http:\/\/(localhost|127\.0\.0\.1):4100\//.test(B + '/')) throw new Error('Refusing to seed anything but the local API on port 4100');
const st = JSON.parse(readFileSync(new URL('../../tests/feed/ui/state.json', import.meta.url), 'utf8'));
const H = { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
let token = '';
export const ctx = {};
export const stats = { created: 0, skipped: 0, failed: 0 };
export async function login() {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ identifier: st.ownerId, password: st.ownerPassword }) });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error(`login failed ${r.status}`);
  token = j.data.accessToken;
  const d = (await call('GET', '/me/context')).data;
  ctx.units = d.units; ctx.fys = d.fys; ctx.fyId = d.current?.fyId ?? d.fys.find((f) => f.isCurrent)?.id;
  ctx.unitId = d.current?.unitId;
  return ctx;
}
export function plant(nameLike) {
  const u = ctx.units.find((x) => (x.name + ' ' + x.code).toLowerCase().includes(nameLike.toLowerCase()));
  if (!u) throw new Error('plant not found ' + nameLike);
  ctx.unitId = u.id; return u;
}
export async function call(method, path, body, extra = {}) {
  const h = { ...H, authorization: `Bearer ${token}`, ...(ctx.fyId ? { 'x-fy-id': ctx.fyId } : {}), ...(ctx.unitId ? { 'x-unit-id': ctx.unitId } : {}), ...extra };
  if (method !== 'GET') h['idempotency-key'] = randomUUID();
  const r = await fetch(B + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.status < 300, data: j.data, meta: j.meta, err: j.error?.message ?? j.message, details: j.error?.details ?? j.error?.fields ?? (j.error ? { ...j.error, message: undefined } : undefined) };
}
export const rowsOf = (d) => (Array.isArray(d) ? d : (d?.rows ?? d?.items ?? []));
export const list = async (path) => {
  const all = [];
  for (let page = 1; page < 20; page++) {
    let r = await call('GET', path + (path.includes('?') ? '&' : '?') + `size=100&page=${page}`);
    if (r.status === 422 && page === 1) { r = await call('GET', path); all.push(...rowsOf(r.data)); break; } // endpoint takes no paging
    const rows = rowsOf(r.data); all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
};
const fmt = (r) => `${r.status} ${r.err ?? ''} ${JSON.stringify(r.details ?? '').slice(0, 220)}`;
/** Create unless a row already matches `exists`. Returns the row (existing or new) or null. */
export async function ensure(label, listPath, exists, createPath, body, rows) {
  const have = rows ?? await list(listPath);
  const hit = have.find(exists);
  if (hit) { stats.skipped++; return hit; }
  const r = await call('POST', createPath, body);
  if (!r.ok) { stats.failed++; console.log(`FAIL ${label}: ${fmt(r)}`); return null; }
  stats.created++; console.log(`ok   ${label}`); return r.data;
}
/** A follow-up step (submit/approve/...). Never fatal. */
export async function step(label, method, path, body = {}, headers = {}) {
  const r = await call(method, path, body, headers);
  if (!r.ok) console.log(`warn ${label}: ${fmt(r)}`);
  return r;
}
export const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;
export const summary = (name) => console.log(`${name}: created ${stats.created}, skipped ${stats.skipped}, failed ${stats.failed}`);

// ---- Admin "module controls" approval switch: turned off for the named pages while a seeder runs, then restored to the original value.
// The originals are also written to a temp file first, so a crashed run is repaired by the next run (restoreApprovals()).
import { writeFileSync, existsSync, readFileSync as rf, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
const BK = `${tmpdir()}/seed-ops-approval-backup.json`;
async function setApproval(pageId, value) {
  const cur = rowsOf((await call('GET', '/module-controls')).data).find((x) => x.pageId === pageId);
  if (!cur || cur.approvalRequired === value) return;
  const r = await call('PATCH', `/module-controls/${pageId}`, { approvalRequired: value }, { 'if-match': `"${cur.version}"` });
  if (!r.ok) console.log(`warn approval switch ${pageId}: ${r.status} ${r.err}`);
}
export async function restoreApprovals() {
  if (!existsSync(BK)) return;
  const saved = JSON.parse(rf(BK, 'utf8'));
  for (const [pageId, v] of Object.entries(saved)) await setApproval(pageId, v);
  unlinkSync(BK);
  console.log(`approval switch restored on ${Object.keys(saved).length} page(s)`);
}
/** Run fn with approvalRequired=false on every page whose id starts with one of `prefixes` (or equals an exact id). */
export async function withApprovalsOff(prefixes, fn) {
  await restoreApprovals();
  const rows = rowsOf((await call('GET', '/module-controls')).data).filter((x) => x.approvalRequired && prefixes.some((p) => x.pageId === p || (p.endsWith('-') && x.pageId.startsWith(p))));
  const saved = Object.fromEntries(rows.map((x) => [x.pageId, true]));
  writeFileSync(BK, JSON.stringify(saved));
  try {
    for (const x of rows) await setApproval(x.pageId, false);
    return await fn();
  } finally {
    await restoreApprovals();
  }
}
