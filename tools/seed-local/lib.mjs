// Shared helpers for the local demo-data seeders. Talks to the local API only (SEED_API, default 4100).
// Credentials are read from the git-ignored tests/feed/ui/state.json and are never printed.
import { readFileSync } from 'node:fs';

export const B = process.env.SEED_API || 'http://localhost:4100/api/v1';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(B)) throw new Error('Refusing to run against a non-local API: ' + B);
const state = JSON.parse(readFileSync(new URL('../../tests/feed/ui/state.json', import.meta.url), 'utf8'));
let token = '';
export const ctx = { unit: '', fy: '', unitCode: '' };
export const stats = { created: 0, skipped: 0, failed: 0 };
export const failures = [];

export async function login() {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify({ identifier: state.ownerId, password: state.ownerPassword }) });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error('login failed ' + r.status);
  token = j.data.accessToken;
  const fys = await api('GET', '/financial-years');
  ctx.fy = (fys.data.find((f) => f.isCurrent) ?? fys.data[0]).id;
}
export async function setUnit(code) {
  const units = await api('GET', '/units');
  const u = units.data.find((x) => x.code === code);
  ctx.unit = u.id; ctx.unitCode = code;
}
export async function api(method, path, body, extra = {}) {
  const headers = { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', authorization: `Bearer ${token}`, ...extra };
  if (ctx.fy) headers['x-fy-id'] = ctx.fy;
  if (ctx.unit) headers['x-unit-id'] = ctx.unit;
  if (method !== 'GET' && !headers['idempotency-key']) headers['idempotency-key'] = crypto.randomUUID();
  const r = await fetch(B + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, data: j.data, meta: j.meta, err: j.error ? `${j.error.message}${j.error.fields ? ' ' + JSON.stringify(j.error.fields) : ''}` : undefined, etag: r.headers.get('etag') };
}
export const list = async (path, q = '') => {
  const out = []; for (let p = 1; p < 20; p++) { const r = await api('GET', `${path}${path.includes('?') ? '&' : '?'}page=${p}&size=100${q}`); if (!r.ok) return out; const rows = Array.isArray(r.data) ? r.data : (r.data?.rows ?? r.data?.items ?? []); out.push(...rows); if (rows.length < 100) break; } return out;
};
// create unless exists(); returns the record
export async function ensure(label, existing, method, path, body) {
  if (existing) { stats.skipped++; return existing; }
  const r = await api(method, path, body);
  if (r.ok) { stats.created++; console.log('  + ' + label); return r.data; }
  stats.failed++; failures.push(`${label}: ${r.status} ${r.err}`); console.log(`  ! ${label}: ${r.status} ${r.err}`);
  return null;
}
export async function act(label, method, path, body, headers) {
  const r = await api(method, path, body, headers);
  if (!r.ok) { failures.push(`${label}: ${r.status} ${r.err}`); console.log(`  ! ${label}: ${r.status} ${r.err}`); }
  return r;
}
export const ifm = (v) => ({ 'if-match': `"${v}"` });
export const pad = (n) => String(n).padStart(2, '0');
export const d = (day) => `2026-11-${pad(day)}`;
export function summary(name) { console.log(`\n${name}: created ${stats.created}, skipped ${stats.skipped}, failed ${stats.failed}`); for (const f of failures) console.log('  FAIL ' + f); }

// ---- module-controls approval switch -------------------------------------------------------------
// withApprovalOff turns "approval required" off for the given pages, runs fn, and ALWAYS restores the
// original values (also on error / Ctrl-C). The originals are parked in the OS temp dir so that a hard
// crash is healed by the next run (restoreLeftovers).
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
const PARK = `${tmpdir()}/rhai-seed-approval-state.json`;
export const controls = {
  async get(pageId) { const r = await api('GET', `/module-controls?q=${encodeURIComponent(pageId)}`); return r.data?.find((x) => x.pageId === pageId); },
  async set(pageId, approvalRequired) {
    const c = await this.get(pageId); if (!c || c.approvalRequired === approvalRequired) return c;
    const r = await api('PATCH', `/module-controls/${pageId}`, { approvalRequired }, { 'if-match': `"${c.version}"` });
    if (!r.ok) console.log('  ! module-controls', pageId, r.err); return r.data;
  },
};
export async function restoreLeftovers() {
  if (!existsSync(PARK)) return;
  const saved = JSON.parse(readFileSync(PARK, 'utf8'));
  for (const [p, v] of Object.entries(saved)) await controls.set(p, v);
  unlinkSync(PARK);
  console.log('restored approval switches left over from an interrupted run');
}
export async function withApprovalOff(pageIds, fn) {
  await restoreLeftovers();
  const orig = {};
  for (const p of pageIds) { const c = await controls.get(p); if (c) orig[p] = c.approvalRequired; }
  writeFileSync(PARK, JSON.stringify(orig));
  const restore = async () => { for (const [p, v] of Object.entries(orig)) await controls.set(p, v); try { unlinkSync(PARK); } catch {} };
  const onSig = () => restore().finally(() => process.exit(130));
  process.once('SIGINT', onSig);
  try {
    for (const p of Object.keys(orig)) await controls.set(p, false);
    return await fn();
  } finally {
    await restore();
    process.off('SIGINT', onSig);
    const left = [];
    for (const [p, v] of Object.entries(orig)) { const c = await controls.get(p); if (c && c.approvalRequired !== v) left.push(p); }
    console.log(left.length ? `WARNING approval switch NOT restored for: ${left.join(', ')}` : `approval switches restored (${Object.keys(orig).length} pages)`);
  }
}

// ---- /screens/:pageId helpers (keyset-paginated list + generic form create) -----------------------
export async function screenRows(page) {
  const out = []; let cursor;
  for (let i = 0; i < 40; i++) {
    const r = await api('GET', `/screens/${page}?size=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    if (!r.ok || !Array.isArray(r.data)) break;
    out.push(...r.data); cursor = r.meta?.nextCursor; if (!cursor) break;
  }
  return out;
}
export async function screenCreate(label, page, values, lines) {
  const r = await api('POST', `/screens/${page}`, lines ? { values, lines } : { values });
  if (r.ok) { stats.created++; console.log('  + ' + label); return r.data; }
  stats.failed++; failures.push(`${label}: ${r.status} ${r.err}`); console.log(`  ! ${label}: ${r.status} ${r.err}`); return null;
}

// Run fn as another seeded user (e.g. a second counter). Password = the shared feed password from state.json.
export async function withUser(identifier, fn) {
  const saved = token;
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify({ identifier, password: state.userPassword }) });
  const j = await r.json();
  if (!j.data?.accessToken) { console.log(`  ! cannot sign in as ${identifier}: ${r.status}`); return null; }
  token = j.data.accessToken;
  try { return await fn(); } finally { token = saved; }
}
