// Pure helpers for the schema-driven pages: reading a field's value from a record, display
// formatting per field type, client-side validation mirroring the server rules, the register
// tab pick and the roadmap phase shown on tabs that are not built yet.
import { GSTIN_MESSAGE, GSTIN_RE, PAN_MESSAGE, PAN_RE } from '../../lib/validators';
import { formatDate, formatDateTime } from '../../lib/format';
import type { FieldMeta, PageSchema, PageView, RecordRow } from './engineApi';

export const UNIVERSAL_TABS_AFTER = [
  'Analytics & Graphs',
  'AI Decision Center',
  'Automation Studio',
  'Data Quality',
  'Activity Timeline',
  'Documents',
  'Approvals',
  'Reports',
  'Audit Trail',
] as const;

export const DASHBOARD_TAB = 'Module Dashboard';

/** The 16 prototype tabs (v9ModuleTabs): dashboard, the 6 profile tabs, then the universal ones. */
export function moduleTabs(schema: Pick<PageSchema, 'tabs'>): string[] {
  return [DASHBOARD_TAB, ...schema.tabs, ...UNIVERSAL_TABS_AFTER];
}

const REGISTER_RE = /register|list|directory|master|queue|log/i;

/** The profile tab that carries the register table (label match, otherwise the first tab). */
export function registerTabName(schema: Pick<PageSchema, 'tabs'>): string {
  return schema.tabs.find((t) => REGISTER_RE.test(t)) ?? schema.tabs[0] ?? 'Register';
}

const FAMILY_PHASE: Record<string, number> = {
  Executive: 19,
  CRM: 11,
  Sales: 11,
  'Procurement / SCM': 10,
  Inventory: 9,
  'Warehouse / WMS': 9,
  Manufacturing: 15,
  'Quality / QMS': 15,
  Maintenance: 16,
  'Finance & Accounts': 8,
  'Indian Taxation': 12,
  HRMS: 13,
  Payroll: 14,
  Projects: 17,
  Assets: 16,
  'Service / Support': 17,
  'Logistics / Fleet': 18,
  'Document Management': 18,
  'Business Intelligence': 19,
  'AI & Automation': 19,
  Communication: 19,
  Administration: 20,
};

/** Phase (docs/plan/13-roadmap.md) that builds a tab that is not live yet. */
export function phaseForTab(tab: string, family: string): number {
  if (tab === 'Approvals') return 6;
  if (tab === 'Documents') return 5;
  if (tab === 'AI Decision Center' || tab === 'Automation Studio' || tab === 'Analytics & Graphs') {
    return 19;
  }
  return FAMILY_PHASE[family] ?? 19;
}

/** Tabs backed by real data in this phase (everything else gets the honest notice). */
export function isLiveTab(tab: string, schema: Pick<PageSchema, 'tabs'>): boolean {
  return (
    tab === DASHBOARD_TAB ||
    tab === registerTabName(schema) ||
    tab === 'Data Quality' ||
    tab === 'Activity Timeline' ||
    tab === 'Audit Trail' ||
    tab === 'Reports'
  );
}

// ---- values -------------------------------------------------------------------------

export function valueOf(
  row: RecordRow,
  field: Pick<FieldMeta, 'key' | 'type' | 'rootKey'>,
): unknown {
  if (field.type === 'code') return row.code;
  if (field.type === 'status') return row.status;
  if (field.rootKey && row.data[field.key] === undefined) {
    return (row as unknown as Record<string, unknown>)[field.key];
  }
  return row.data[field.key];
}

/** Plain-text form of a stored value (objects never stringify to [object Object]). */
export function str(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v as string | number | boolean);
}

export function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatQty(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(n);
}

export function formatMoney(n: number): string {
  return `₹ ${inr.format(n)}`;
}

/** Text shown in tables and the drawer for one field of one record. */
export function displayValue(row: RecordRow, field: FieldMeta): string {
  const v = valueOf(row, field);
  if (isEmptyValue(v)) return '—';
  switch (field.type) {
    case 'money':
      return typeof v === 'number' || /^-?\d/.test(String(v)) ? formatMoney(Number(v)) : String(v);
    case 'pct':
      return `${String(v)}%`;
    case 'qty':
      return typeof v === 'number' ? inr.format(v) : String(v);
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    case 'bool':
      return v === true || v === 'true' ? 'Yes' : 'No';
    case 'ref': {
      const ref = row.refs?.[field.key];
      if (ref) return [ref.code, ref.name].filter(Boolean).join(' — ') || String(v);
      return String(v);
    }
    default:
      return String(v);
  }
}

// ---- validation ---------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[0-9][0-9 ()-]{6,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const HSN_RE = /^\d{4}(\d{2}(\d{2})?)?$/;
const DIGITS12_RE = /^\d{12}$/;

/** Types whose text is upper-cased as you type. */
export const UPPERCASE_TYPES: ReadonlySet<string> = new Set(['gstin', 'pan', 'ifsc']);

/** Error text for one field's raw form value, or undefined when it is fine. */
export function validateField(field: FieldMeta, raw: unknown): string | undefined {
  if (field.readOnly || field.type === 'code' || field.type === 'status') return undefined;
  if (field.type === 'bool') return undefined;
  if (isEmptyValue(raw)) return field.required ? `${field.label} is required.` : undefined;
  const text = String(raw).trim();
  switch (field.type) {
    case 'gstin':
      return GSTIN_RE.test(text) ? undefined : GSTIN_MESSAGE;
    case 'pan':
      return PAN_RE.test(text) ? undefined : PAN_MESSAGE;
    case 'ifsc':
      return IFSC_RE.test(text) ? undefined : 'IFSC must look like HDFC0001234.';
    case 'email':
      return EMAIL_RE.test(text) ? undefined : 'Enter a valid email address.';
    case 'phone':
      return PHONE_RE.test(text) ? undefined : 'Enter a valid phone number.';
    case 'hsn':
      return HSN_RE.test(text) ? undefined : 'HSN/SAC must be 4, 6 or 8 digits.';
    case 'aadhaar':
    case 'uan':
      return DIGITS12_RE.test(text.replace(/\s/g, ''))
        ? undefined
        : `${field.label} must be 12 digits.`;
    case 'money':
    case 'pct':
    case 'qty': {
      const n = Number(text);
      if (!Number.isFinite(n)) return 'Enter a number.';
      if (field.min !== undefined && n < field.min) return `Must be at least ${field.min}.`;
      if (field.max !== undefined && n > field.max) return `Must be at most ${field.max}.`;
      if (field.type === 'pct' && field.max === undefined && (n < 0 || n > 100)) {
        return 'Enter a percentage between 0 and 100.';
      }
      return undefined;
    }
    case 'enum':
      return field.options && !field.options.includes(text)
        ? 'Choose one of the options.'
        : undefined;
    default:
      break;
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    return `At most ${field.maxLength} characters.`;
  }
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(text)) return `${field.label} has an invalid format.`;
    } catch {
      return undefined; // a pattern the browser cannot parse is left to the server
    }
  }
  return undefined;
}

/** Form values (strings / booleans) → the typed payload sent to the API; empty values are dropped. */
export function toPayload(
  fields: FieldMeta[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readOnly || f.type === 'code' || f.type === 'status') continue;
    const raw = values[f.key];
    if (f.type === 'bool') {
      if (raw !== undefined) out[f.key] = raw === true;
      continue;
    }
    if (isEmptyValue(raw)) continue;
    const text = String(raw).trim();
    out[f.key] = f.type === 'money' || f.type === 'pct' || f.type === 'qty' ? Number(text) : text;
  }
  return out;
}

/** Initial form values for a record (or empty for Add), as strings so inputs stay controlled. */
export function toFormValues(fields: FieldMeta[], row?: RecordRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readOnly || f.type === 'code' || f.type === 'status') continue;
    const v = row ? row.data[f.key] : undefined;
    if (f.type === 'bool') out[f.key] = v === true || v === 'true';
    else if (isEmptyValue(v)) out[f.key] = '';
    else if (f.type === 'datetime') out[f.key] = String(v).slice(0, 16);
    else if (f.type === 'date') out[f.key] = String(v).slice(0, 10);
    else out[f.key] = String(v);
  }
  return out;
}

/** Only the keys whose payload value differs from the stored one (PATCH is partial). */
export function changedPayload(
  fields: FieldMeta[],
  values: Record<string, unknown>,
  row: RecordRow,
): Record<string, unknown> {
  const next = toPayload(fields, values);
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readOnly || f.type === 'code' || f.type === 'status') continue;
    const before = row.data[f.key];
    if (f.type === 'bool') {
      const was = before === true || before === 'true';
      if ((values[f.key] === true) !== was) out[f.key] = values[f.key] === true;
      continue;
    }
    const had = !isEmptyValue(before);
    const has = f.key in next;
    if (!has && !had) continue;
    if (!has) {
      out[f.key] = null;
      continue;
    }
    const a = next[f.key];
    const same = typeof a === 'number' ? Number(before) === a : str(before) === str(a);
    if (!same) out[f.key] = a;
  }
  return out;
}

export function fieldByKey(schema: PageSchema, key: string): FieldMeta | undefined {
  return schema.fields.find((f) => f.key === key);
}

/** The columns of the register: listColumns resolved to fields (unknown keys are skipped). */
export function listFields(schema: PageSchema): FieldMeta[] {
  const out: FieldMeta[] = [];
  for (const key of schema.listColumns) {
    const f = fieldByKey(schema, key);
    if (f) out.push(f);
  }
  return out.length ? out : schema.fields.slice(0, 12);
}

/** Edit / Delete are offered unless the page is read-only or the status is locked (Posted…). */
export function canChangeRecord(schema: PageSchema, row: RecordRow): boolean {
  if (schema.readOnly) return false;
  if (schema.editableStatuses) return schema.editableStatuses.includes(row.status);
  if (schema.kind === 'typed' && schema.actions.length > 0) return row.status === 'Draft';
  return true;
}

export function confirmText(
  action: { label: string; confirm?: string | boolean },
  code: string,
): string | null {
  if (!action.confirm) return null;
  if (typeof action.confirm === 'string') return action.confirm.split('{code}').join(code);
  return `${action.label} ${code}?`;
}

// ---- computed read-only fields (typed vouchers) ----------------------------------------

const norm = (s: string): string => s.trim().toLowerCase();

/** Server preview value for a read-only field: its own key, else the documented aliases. */
export function serverValue(f: FieldMeta, preview: Record<string, unknown>): unknown {
  if (preview[f.key] !== undefined && preview[f.key] !== null) return preview[f.key];
  const label = norm(f.label);
  if (label === 'system qty') return preview.systemQty ?? preview.available;
  if (label === 'unit cost' || label === 'avg rate') return preview.avgRate;
  if (label === 'available' || label === 'available qty') return preview.available;
  return undefined;
}

const r = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Client-side values for the obvious computed fields so the form updates while typing:
 * opening value = qty × cost, variance = counted − system, value impact = variance × cost,
 * in transit = dispatched − received. The server value wins after save.
 */
export function computeReadOnly(
  schema: Pick<PageSchema, 'fields'>,
  values: Record<string, unknown>,
  row: RecordRow | undefined,
  preview: Record<string, unknown>,
): Record<string, number> {
  const byLabel = new Map(schema.fields.map((f) => [norm(f.label), f]));
  const num = (label: string): number | null => {
    const f = byLabel.get(label);
    if (!f) return null;
    const editable = !f.readOnly && f.type !== 'code' && f.type !== 'status';
    const v = editable ? values[f.key] : (serverValue(f, preview) ?? row?.data[f.key]);
    if (isEmptyValue(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const out: Record<string, number> = {};
  const put = (label: string, value: number | null, digits: number): void => {
    const f = byLabel.get(label);
    if (f?.readOnly && value !== null) out[f.key] = r(value, digits);
  };
  const qty = num('opening qty');
  const cost = num('unit cost');
  put('opening value', qty !== null && cost !== null ? qty * cost : null, 2);
  const counted = num('counted qty');
  const system = num('system qty');
  const variance = counted !== null && system !== null ? counted - system : null;
  put('variance qty', variance, 3);
  put('value impact', variance !== null && cost !== null ? variance * cost : null, 2);
  const dispatched = num('dispatched qty');
  if (dispatched !== null) put('in transit', dispatched - (num('received qty') ?? 0), 3);
  return out;
}

/** Stock Balance rows below their reorder level are highlighted. */
export function isLowRow(row: RecordRow): boolean {
  return (
    row.status === 'Below Reorder' || Object.values(row.data).some((v) => v === 'Below Reorder')
  );
}

// ---- views (Ledger | Vouchers) and action permissions ---------------------------------

/** The view shown now: `?view=` when valid, else the first view. */
export function activeViewOf(schema: PageSchema, param: string | null): PageView | null {
  const views = schema.views;
  if (!views?.length) return null;
  return views.find((v) => v.key === param) ?? (views[0] as PageView);
}

/** The voucher (editable) view: the one without ledger columns, else the second view. */
export function voucherView(schema: PageSchema): PageView | null {
  const views = schema.views ?? [];
  return views.find((v) => !v.columns) ?? views[1] ?? null;
}

/** For a read-only ledger view the schema is replaced by its columns, with no actions. */
export function schemaForView(schema: PageSchema, view: PageView | null): PageSchema {
  if (!view?.columns) return schema;
  const fields: FieldMeta[] = view.columns.map((c) => ({
    key: c.key,
    label: c.label,
    type:
      c.format === 'qty' || c.format === 'money' || c.format === 'date' || c.format === 'datetime'
        ? c.format
        : 'text',
    required: false,
    readOnly: true,
    rootKey: true,
  }));
  return {
    ...schema,
    fields,
    listColumns: fields.map((f) => f.key),
    actions: [],
    readOnly: true,
    editableStatuses: [],
  };
}

/** Query filters a non-register tab (dashboard, data quality) needs so it reads vouchers, not the ledger. */
export function baseFilters(schema: PageSchema): Record<string, string> | undefined {
  const v = voucherView(schema);
  return v ? { view: v.key } : undefined;
}

/**
 * Whether the user may see an action: `requires` names the page permission. A cancel that is also
 * allowed from Draft only needs `edit` while the row is still a Draft.
 */
export function actionVisible(
  a: { requires?: 'edit' | 'delete'; allowedFrom?: string[] },
  status: string,
  perms: Record<string, boolean>,
): boolean {
  if (!a.requires) return true;
  const mixed = !!a.allowedFrom?.includes('Draft') && a.allowedFrom.length > 1;
  const need = a.requires === 'delete' && mixed && status === 'Draft' ? 'edit' : a.requires;
  return perms[need] === true;
}
