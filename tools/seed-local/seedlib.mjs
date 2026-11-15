// Shared helpers for the local demo-data seeders. Talks to the local API only (SEED_API, default 4100).
// Credentials are read from the git-ignored tests/feed/ui/state.json and are never printed.
import { readFileSync } from 'node:fs';

export const B = process.env.SEED_API || 'http://localhost:4100/api/v1';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(B)) throw new Error('Refusing to run against a non-local API: ' + B);
const state = JSON.parse(readFileSync(new URL('../../tests/feed/ui/state.json', import.meta.url), 'utf8'));
let token = '';
let ownerToken = '';
export const ctx = { unit: '', fy: '', unitCode: '' };
export const stats = { created: 0, skipped: 0, failed: 0 };
export const failures = [];

export async function login() {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: JSON.stringify({ identifier: state.ownerId, password: state.ownerPassword }) });
  const j = await r.json();
  if (!j.data?.accessToken) throw new Error('login failed ' + r.status);
  token = j.data.accessToken; ownerToken = token;
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
  return { status: r.status, ok: r.ok, raw: j, data: j.data ?? (j.id ? { id: j.id } : undefined), meta: j.meta, err: (j.error ?? j.data?.error) ? `${(j.error ?? j.data.error).message}${(j.error ?? j.data.error).fields ? ' ' + JSON.stringify((j.error ?? j.data.error).fields) : ''}` : undefined, etag: r.headers.get('etag') };
}
export const list = async (path, q = '') => {
  const sep = path.includes('?') ? '&' : '?';
  const r1 = await api('GET', `${path}${sep}size=100${q}`);
  if (!r1.ok) return [];
  const pick = (r) => (Array.isArray(r.data) ? r.data : (r.data?.rows ?? r.data?.items ?? []));
  const out = [...pick(r1)]; const total = Number(r1.meta?.total ?? out.length); const cap = out.length;
  for (let p = 2; out.length < total && cap > 0 && p < 40; p++) { const r = await api('GET', `${path}${sep}page=${p}&size=${cap}${q}`); if (!r.ok) break; const rows = pick(r); if (!rows.length) break; out.push(...rows); }
  return out;
};
// create unless exists(); returns the record
export async function ensure(label, existing, method, path, body) {
  if (existing) { stats.skipped++; return existing; }
  const r = await api(method, path, body);
  if (r.ok) { stats.created++; console.log('  + ' + label); return r.data; }
  if (r.status === 409) { stats.skipped++; return null; } // already exists (unique key)
  stats.failed++; failures.push(`${label}: ${r.status} ${r.err}`); console.log(`  ! ${label}: ${r.status} ${r.err}`);
  return null;
}
export async function act(label, method, path, body, headers) {
  const r = await api(method, path, body, headers);
  if (!r.ok) { failures.push(`${label}: ${r.status} ${r.err}`); console.log(`  ! ${label}: ${r.status} ${r.err}`); }
  return r;
}
export const ifm = (v) => ({ 'if-match': `"${v}"` });
// module-controls approval switch
export const controls = {
  async get(pageId) { const r = await api('GET', `/module-controls?q=${encodeURIComponent(pageId)}`); return r.data?.find((x) => x.pageId === pageId); },
  async set(pageId, approvalRequired) { const c = await this.get(pageId); if (!c || c.approvalRequired === approvalRequired) return c; const r = await api('PATCH', `/module-controls/${pageId}`, { approvalRequired }, ifm(c.version)); if (!r.ok) console.log('  ! controls', pageId, r.err); return r.data; },
};
export const pad = (n) => String(n).padStart(2, '0');
export const d = (day) => `2026-11-${pad(day)}`;
export function summary(name) { console.log(`\n${name}: created ${stats.created}, skipped ${stats.skipped}, failed ${stats.failed}`); for (const f of failures) console.log('  FAIL ' + f); }

// ---- helpers for realistic Indian identifiers (valid format) ----
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const VINV = [0,4,3,2,1,5,6,7,8,9];
/** 12-digit Aadhaar (Verhoeff valid) from an 11-digit body. */
export function aadhaar(body11) { let c = 0; const a = String(body11).split('').reverse().map(Number); a.forEach((n, i) => { c = VD[c][VP[(i + 1) % 8][n]]; }); return String(body11) + VINV[c]; }
export const PAN_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Deterministic pseudo random integer from a string seed. */
export function rnd(seed, mod) { let h = 2166136261; for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % mod; }
export function digits(seed, n) { let s = ''; let k = 0; while (s.length < n) { s += String(rnd(seed + ':' + k++, 1000000)).padStart(6, '0'); } return s.slice(0, n); }
export function pan(seed, surnameInitial) { const L = (i) => PAN_LETTERS[rnd(seed + 'L' + i, PAN_LETTERS.length)]; return `${L(1)}${L(2)}${L(3)}P${surnameInitial}${digits(seed + 'P', 4)}${L(9)}`; }
export async function rawPost(path, text, headers = {}) { const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: text }); return { status: r.status, text: await r.text() }; }
export async function listAll(path) { const r = await api('GET', path); return Array.isArray(r.data) ? r.data : (r.data?.rows ?? r.data?.items ?? []); }

/** Maker-checker: act as another demo user (password from state.json, never printed). Call actAsOwner() to switch back. */
export async function actAs(loginId) {
  const H = { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
  const tryLogin = async (pw) => (await (await fetch(`${B}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ identifier: loginId, password: pw }) })).json());
  let j = await tryLogin(state.userPassword);
  if (!j.data?.accessToken && state.tempPassword) {
    j = await tryLogin(state.tempPassword);
    if (j.data?.accessToken) { await fetch(`${B}/auth/change-password`, { method: 'POST', headers: { ...H, authorization: `Bearer ${j.data.accessToken}` }, body: JSON.stringify({ currentPassword: state.tempPassword, newPassword: state.userPassword }) }); j = await tryLogin(state.userPassword); }
  }
  if (!j.data?.accessToken) throw new Error('cannot sign in as ' + loginId);
  token = j.data.accessToken;
}
export function actAsOwner() { token = ownerToken; }
