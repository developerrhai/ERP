// Typed client for the generic / typed record engine (docs/phase3-4/CONTRACT.md B1, B3, C3):
// schema, records CRUD, bulk, actions, lookups, preview, export and the per-page audit rows.
import { api, download, request } from '../../lib/api';
import { saveBlob } from '../../lib/download';
import type { AuditLog, PageMeta } from '../../types';
import { toAuditLog, type AuditLogDto } from '../admin/adminApi';

export type FieldType =
  | 'code'
  | 'status'
  | 'date'
  | 'datetime'
  | 'money'
  | 'pct'
  | 'qty'
  | 'ref'
  | 'email'
  | 'phone'
  | 'gstin'
  | 'pan'
  | 'ifsc'
  | 'hsn'
  | 'aadhaar'
  | 'uan'
  | 'bool'
  | 'enum'
  | 'text'
  | 'longtext';

export interface FieldMeta {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  readOnly: boolean;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
  /** Value is read from the row itself (ledger columns), not from row.data. */
  rootKey?: boolean;
  /** Typed master this ref points to (items / warehouses get a real lookup combobox). */
  refPage?: string;
  lookup?: string;
  suffix?: string;
}

export interface PayloadField {
  key: string;
  label: string;
  type: 'text' | 'longtext' | 'qty' | 'money' | 'date' | 'enum' | 'lookup';
  required: boolean;
  options?: string[];
  lookup?: string;
  min?: number;
  max?: number;
}

export interface TabPanelRef {
  tab: string;
  key: string;
  scope: 'record' | 'page';
  title?: string;
  component?: string;
}

export interface KitCommand {
  key: string;
  label: string;
  variant?: 'primary' | 'default' | 'danger';
  requires?: 'add' | 'edit' | 'delete' | 'approve';
  confirm?: string | null;
  fields?: PayloadField[];
}

export interface PrintTemplateRef {
  key: string;
  label: string;
  kind: 'web' | 'pdf';
  scope: 'record' | 'page';
  default?: boolean;
}

export interface PageAction {
  key: string;
  label: string;
  variant?: string;
  /** A message ("{code}" is replaced), true for a generic confirm, or absent for none. */
  confirm?: string | boolean;
  allowedFrom?: string[];
  /** Page permission the user needs to see this action (cancel of a posted voucher needs delete). */
  requires?: 'add' | 'edit' | 'delete' | 'approve';
  payloadFields?: PayloadField[];
}

export interface PageFilter {
  key: string;
  label: string;
  type: 'bool' | 'select' | 'text' | 'date' | 'month' | 'lookup';
  /** Query parameter the control sets (also its name in the page URL). */
  param: string;
  options?: (string | { value: string; label: string })[];
  lookup?: string;
}

export interface PageTotal {
  key: string;
  label: string;
  format: 'qty' | 'money';
}

export interface PageView {
  key: string;
  label: string;
  /** Present on a read-only list view (the stock ledger); absent on the voucher view. */
  columns?: {
    key: string;
    label: string;
    format?: 'qty' | 'money' | 'date' | 'datetime' | 'text';
  }[];
}

export type PageKind = 'generic' | 'typed' | 'custom';

export interface PageSchema {
  pageId: string;
  title: string;
  family: string;
  purpose?: string;
  tabs: string[];
  fields: FieldMeta[];
  statuses: string[];
  actions: PageAction[];
  kind: PageKind;
  listColumns: string[];
  /** List-only pages (Stock Balance): no Add / Edit / Delete. */
  readOnly?: boolean;
  /** Optional extras for the context chips. */
  ownerDepartment?: string;
  approvalRequired?: boolean;
  /** Optional: statuses in which Edit / Delete are offered (typed vouchers: Draft only). */
  editableStatuses?: string[];
  /** Extra register filters (typed pages), sent as query parameters. */
  filters?: PageFilter[];
  /** Totals bar definitions; the values come from the list response `meta.totals`. */
  totals?: PageTotal[];
  /** Alternative register views (Ledger | Vouchers), shown as a segmented toggle (`?view=`). */
  views?: PageView[];
  tabPanels?: TabPanelRef[];
  commands?: KitCommand[];
  readOnlyCreate?: boolean;
  printTemplates?: PrintTemplateRef[];
}

export interface RecordRow {
  id: string;
  code: string;
  status: string;
  unitId: string | null;
  fyId: string | null;
  department: string | null;
  data: Record<string, unknown>;
  version: number;
  /** First money field of the record, when the page has one. */
  amount?: number | string | null;
  deletedAt?: string | null;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
  updatedAt?: string;
  /** Optional resolved labels for lookup (ref) fields, keyed by field key. */
  refs?: Record<string, { id: string; code?: string; name?: string } | null>;
}

export interface RecordQuery {
  q?: string;
  status?: string;
  sort?: string;
  page?: number;
  size?: number;
  /** Page-specific filters (schema.filters params → value); empty values are dropped. */
  filters?: Record<string, string>;
}

/** `{value,label}` for a select filter option given as a plain string or an object. */
export function filterOption(o: string | { value: string; label: string }): {
  value: string;
  label: string;
} {
  return typeof o === 'string' ? { value: o, label: o } : o;
}

const base = (pageId: string): string => `/pages/${encodeURIComponent(pageId)}`;

export function getSchema(pageId: string): Promise<PageSchema> {
  return api<PageSchema>(`${base(pageId)}/schema`);
}

function queryString(query: RecordQuery, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (query.q?.trim()) p.set('q', query.q.trim());
  if (query.status) p.set('status', query.status);
  if (query.sort) p.set('sort', query.sort);
  if (query.page) p.set('page', String(query.page));
  if (query.size) p.set('size', String(query.size));
  for (const [k, v] of Object.entries(query.filters ?? {})) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface RecordPage {
  rows: RecordRow[];
  meta: PageMeta;
}

export async function listRecords(pageId: string, query: RecordQuery): Promise<RecordPage> {
  const res = await request<RecordRow[]>(`${base(pageId)}/records${queryString(query)}`);
  return {
    rows: res.data,
    meta: res.meta ?? {
      page: query.page ?? 1,
      size: query.size ?? res.data.length,
      total: res.data.length,
    },
  };
}

export function getRecord(pageId: string, id: string): Promise<RecordRow> {
  return api<RecordRow>(`${base(pageId)}/records/${encodeURIComponent(id)}`);
}

export function createRecord(pageId: string, data: Record<string, unknown>): Promise<RecordRow> {
  return api<RecordRow>(`${base(pageId)}/records`, { method: 'POST', body: { data } });
}

export function updateRecord(
  pageId: string,
  row: Pick<RecordRow, 'id' | 'version'>,
  data: Record<string, unknown>,
): Promise<RecordRow> {
  return api<RecordRow>(`${base(pageId)}/records/${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    body: { data },
    headers: { 'If-Match': String(row.version) },
  });
}

export const patchRecord = updateRecord;

/** Soft delete; the returned token lets the Undo toast restore it. */
export async function deleteRecord(
  pageId: string,
  row: Pick<RecordRow, 'id' | 'version'>,
): Promise<{ undoToken?: string }> {
  const data = await api<{ undoToken?: string } | undefined>(
    `${base(pageId)}/records/${encodeURIComponent(row.id)}`,
    { method: 'DELETE', headers: { 'If-Match': String(row.version) } },
  );
  return data ?? {};
}

export function restoreRecord(pageId: string, id: string, undoToken?: string): Promise<RecordRow> {
  return api<RecordRow>(`${base(pageId)}/records/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    ...(undoToken ? { body: { undoToken } } : {}),
  });
}

export interface BulkResult {
  id: string;
  ok: boolean;
  error?: string;
}

export function bulkDelete(pageId: string, ids: string[]): Promise<BulkResult[]> {
  return api<BulkResult[]>(`${base(pageId)}/records/bulk`, {
    method: 'POST',
    body: { action: 'delete', ids },
  });
}

/** One Idempotency-Key per user click, so a retry of the same click never runs the action twice. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function runAction(
  pageId: string,
  id: string,
  action: string,
  idempotencyKey: string,
  payload?: Record<string, unknown>,
): Promise<RecordRow> {
  return api<RecordRow>(
    `${base(pageId)}/records/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      ...(payload !== undefined ? { body: { payload } } : {}),
    },
  );
}

/** Filters and (optionally) the selected ids → export.xlsx saved through the browser. */
export async function exportXlsx(
  pageId: string,
  query: RecordQuery,
  ids?: string[],
): Promise<void> {
  const extra: Record<string, string> = ids?.length ? { ids: ids.join(',') } : {};
  const { blob, filename } = await download(
    `${base(pageId)}/records/export.xlsx${queryString({ ...query, page: undefined, size: undefined }, extra)}`,
  );
  saveBlob(blob, filename ?? `${pageId}.xlsx`);
}

// ---- lookups & preview (typed pages) ---------------------------------------------

export interface LookupItem {
  id: string;
  code: string;
  name: string;
  uom?: string;
}

export function lookupKind(refPage: string | undefined): 'items' | 'warehouses' | null {
  if (refPage === 'inv-items') return 'items';
  if (refPage === 'wms-warehouses') return 'warehouses';
  return null;
}

export function lookup(
  kind: 'items' | 'warehouses' | string,
  q: string,
  unitId?: string | null,
): Promise<LookupItem[]> {
  const p = new URLSearchParams();
  p.set('q', q);
  if (unitId && kind === 'warehouses') p.set('unitId', unitId);
  const slug = kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return api<LookupItem[]>(`/lookups/${slug}?${p.toString()}`);
}

export function getPreview(
  pageId: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const p = new URLSearchParams(params);
  return api<Record<string, unknown>>(`${base(pageId)}/preview?${p.toString()}`);
}

// ---- audit -------------------------------------------------------------------------

export async function listPageAudit(
  pageId: string,
  page: number,
  size: number,
): Promise<{ rows: AuditLog[]; meta: PageMeta }> {
  const res = await request<AuditLogDto[]>(`${base(pageId)}/audit?page=${page}&size=${size}`);
  const rows = res.data.map(toAuditLog);
  return { rows, meta: res.meta ?? { page, size, total: rows.length } };
}

/** Activity of one record (drawer section): the same audit row shape, scoped to that record. */
export async function listRecordAudit(
  pageId: string,
  id: string,
  page = 1,
  size = 10,
): Promise<{ rows: AuditLog[]; meta: PageMeta }> {
  const res = await request<AuditLogDto[]>(
    `${base(pageId)}/records/${encodeURIComponent(id)}/audit?page=${page}&size=${size}`,
  );
  const rows = res.data.map(toAuditLog);
  return { rows, meta: res.meta ?? { page, size, total: rows.length } };
}
