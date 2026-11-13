// Phase 31 pure rules: custom field value validation, form rule resolution, login hours and IP, numbering preview, module switches.

export type FieldType = 'text' | 'number' | 'decimal' | 'date' | 'bool' | 'select' | 'multiselect' | 'lookup' | 'file';
export interface FieldDef { key: string; label: string; type: FieldType; options: string[]; required: boolean; lookupKind?: string | null }

/** Checks one value against its definition. Returns the normalised value or an error text. */
export function checkValue(def: FieldDef, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
  if (empty) return def.required ? { ok: false, error: `${def.label} is required.` } : { ok: true, value: null };
  switch (def.type) {
    case 'text':
      return typeof raw === 'string' && raw.length <= 500 ? { ok: true, value: raw.trim() } : { ok: false, error: `${def.label} must be text up to 500 characters.` };
    case 'number': {
      const n = Number(raw);
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, error: `${def.label} must be a whole number.` };
    }
    case 'decimal': {
      const n = Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `${def.label} must be a number.` };
    }
    case 'date':
      return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? { ok: true, value: raw } : { ok: false, error: `${def.label} must be a date like 2026-11-30.` };
    case 'bool':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, error: `${def.label} must be yes or no.` };
    case 'select':
      return typeof raw === 'string' && def.options.includes(raw) ? { ok: true, value: raw } : { ok: false, error: `${def.label} must be one of: ${def.options.join(', ')}.` };
    case 'multiselect':
      return Array.isArray(raw) && raw.every((v) => typeof v === 'string' && def.options.includes(v)) ? { ok: true, value: raw } : { ok: false, error: `${def.label} must be some of: ${def.options.join(', ')}.` };
    case 'lookup':
    case 'file':
      return typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? { ok: true, value: raw } : { ok: false, error: `${def.label} must be a record from the list.` };
  }
}

export type Effect = 'HIDDEN' | 'READONLY' | 'REQUIRED';
export interface RuleRow { fieldKey: string; effect: Effect; roleId: string | null; status: string | null; unitId: string | null }

/** Keys the system itself needs: a rule cannot hide them or make them read-only (REQUIRED is always fine). */
export const SYSTEM_KEYS = new Set(['code', 'number', 'status', 'customerId', 'supplierId', 'itemId', 'unitId', 'fyId']);

/** The rules that apply for a role, status and plant; the strictest effect per field wins (HIDDEN > READONLY > REQUIRED). */
export function effectiveRules(rows: RuleRow[], ctx: { roleId: string; status: string | null; unitId: string | null }): Map<string, Effect> {
  const rank: Record<Effect, number> = { HIDDEN: 3, READONLY: 2, REQUIRED: 1 };
  const out = new Map<string, Effect>();
  for (const r of rows) {
    if (r.roleId && r.roleId !== ctx.roleId) continue;
    if (r.status && r.status !== ctx.status) continue;
    if (r.unitId && r.unitId !== ctx.unitId) continue;
    const cur = out.get(r.fieldKey);
    if (!cur || rank[r.effect] > rank[cur]) out.set(r.fieldKey, r.effect);
  }
  return out;
}

/** What a write may not do: change a HIDDEN or READONLY field, or leave a REQUIRED field empty. */
export function ruleViolations(rules: Map<string, Effect>, changed: string[], values: Record<string, unknown>, labels: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const name = (k: string) => labels[k] ?? k;
  for (const k of changed) {
    const e = rules.get(k);
    if (e === 'HIDDEN' || e === 'READONLY') out[k] = `${name(k)} is read-only here.`;
  }
  for (const [k, e] of rules) {
    if (e !== 'REQUIRED') continue;
    const v = values[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) out[k] = `${name(k)} is required.`;
  }
  return out;
}

const mins = (t: string): number => {
  const [h, m] = t.slice(0, 5).split(':').map(Number) as [number, number];
  return h * 60 + m;
};
/** Sign-in hours in IST; a window that crosses midnight (22:00-06:00) is supported. */
export function withinHours(now: Date, from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  const l = new Date(now.getTime() + 330 * 60_000);
  const cur = l.getUTCHours() * 60 + l.getUTCMinutes();
  const a = mins(from);
  const b = mins(to);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}
export const hoursMessage = (from: string, to: string): string => `Sign-in is allowed ${from.slice(0, 5)}–${to.slice(0, 5)} for your role.`;

function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}
/** IPv4 CIDR allow-list; an empty list allows everyone. ::1 and ::ffff:a.b.c.d are read as IPv4. */
export function ipAllowed(ip: string | null | undefined, cidrs: string[]): boolean {
  if (cidrs.length === 0) return true;
  let addr = (ip ?? '').replace(/^::ffff:/, '');
  if (addr === '::1') addr = '127.0.0.1';
  const n = ipToInt(addr);
  if (n === null) return false;
  return cidrs.some((c) => {
    const [base, bitsText] = c.split('/');
    const b = ipToInt(base ?? '');
    const bits = bitsText === undefined ? 32 : Number(bitsText);
    if (b === null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  });
}
export function validCidr(c: string): boolean {
  const [base, bits] = c.split('/');
  return ipToInt(base ?? '') !== null && (bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= 32));
}

/** A series preview: prefix + padded number + suffix. GST documents must stay within 16 characters. */
export function previewNumber(s: { prefix: string; suffix?: string | null; padding: number; next: number; plant?: string; fy?: string }): string {
  const mid = [s.plant, s.fy].filter(Boolean).join('/');
  return `${s.prefix}${mid ? `${mid}/` : ''}${String(s.next).padStart(s.padding, '0')}${s.suffix ?? ''}`;
}
export function numberLengthOk(preview: string, gstDocument: boolean): boolean {
  return !gstDocument || preview.length <= 16;
}

/** The page is on for a plant unless an OFF row matches; a narrower ON row (a role) re-enables it. */
export function moduleOn(rows: { unitId: string; roleId: string | null; enabled: boolean }[], unitId: string, roleId: string): boolean {
  const mine = rows.filter((r) => r.unitId === unitId && (r.roleId === null || r.roleId === roleId));
  if (mine.length === 0) return true;
  const specific = mine.find((r) => r.roleId === roleId);
  if (specific) return specific.enabled;
  return mine.find((r) => r.roleId === null)?.enabled ?? true;
}
