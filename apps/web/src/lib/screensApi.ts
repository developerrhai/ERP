// Phase 22: client for GET /screens/:pageId, /meta/registry and /admin/page-health.
import { request } from './api';

export type ColType = 'text' | 'date' | 'datetime' | 'money' | 'num' | 'pct' | 'bool' | 'status';
export interface ScreenColumn {
  key: string;
  label: string;
  type: ColType;
}
export interface PagePerms {
  view: boolean;
  edit: boolean;
  delete: boolean;
  submit: boolean;
  approve: boolean;
  print: boolean;
  export: boolean;
}
export interface ScreenMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  totalIsEstimate: boolean;
  columns: ScreenColumn[];
  sort: string;
  sorts: string[];
  things: string;
  can: PagePerms;
  form: FormDef | null;
}
export type ScreenRow = Record<string, unknown> & { id: string; _a: number };
export interface ScreenPage {
  data: ScreenRow[];
  meta: ScreenMeta;
}
export type ActionKey =
  | 'open'
  | 'edit'
  | 'delete'
  | 'pdf'
  | 'excel'
  | 'print'
  | 'documents'
  | 'submit'
  | 'approve'
  | 'word'
  | 'moveForward';
export interface RecordActions {
  allowed: ActionKey[];
  blocked: Partial<Record<ActionKey, string>>;
}

export async function listScreen(
  pageId: string,
  params: { q?: string; status?: string; sort?: string; cursor?: string | null; limit?: number },
): Promise<ScreenPage> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.status) qs.set('status', params.status);
  if (params.sort) qs.set('sort', params.sort);
  if (params.cursor) qs.set('cursor', params.cursor);
  qs.set('size', String(params.limit ?? 25));
  const env = await request<ScreenRow[]>(`/screens/${pageId}?${qs.toString()}`);
  return { data: env.data, meta: env.meta as unknown as ScreenMeta };
}

export async function getScreenRecord(
  pageId: string,
  id: string,
): Promise<{ data: Record<string, unknown> & { actions: RecordActions }; fields: ScreenColumn[] }> {
  const env = await request<Record<string, unknown> & { actions: RecordActions }>(
    `/screens/${pageId}/${id}`,
  );
  const meta = env.meta as unknown as { fields: ScreenColumn[] };
  return { data: env.data, fields: meta.fields };
}

export interface RegistryPage {
  id: string;
  title: string;
  family: string;
  tabs: string[];
  fields: string[];
  buttons: string[];
  dynamic: boolean;
  status: 'built' | 'planned';
  ownerPhase: number | null;
  changedOnPurpose?: string;
  legacyTitle?: string;
}
export interface RegistryV2 {
  version: number;
  families: { name: string; icon: string; pageCount: number }[];
  pages: RegistryPage[];
}

let registryPromise: Promise<RegistryV2> | null = null;
/** Registry v2 is fetched once per page load; it only changes with a deploy. */
export function getRegistryV2(): Promise<RegistryV2> {
  if (!registryPromise) {
    registryPromise = request<RegistryV2>('/meta/registry')
      .then((e) => e.data)
      .catch((err: unknown) => {
        registryPromise = null;
        throw err;
      });
  }
  return registryPromise;
}

export interface HealthRow {
  pageId: string;
  role: string;
  unitCombo: string;
  status: 'OK' | 'ERROR';
  errorKind: string | null;
  errorText: string | null;
  p95Ms: number | null;
  overBudget: boolean;
  checkedAt: string;
}
export interface HealthMeta {
  page: number;
  size: number;
  total: number;
  runId: string | null;
  checkedAt: string | null;
  pagesChecked: number;
  errors: number;
  budgetMs: number;
}
export async function listPageHealth(p: {
  status?: string;
  q?: string;
  page: number;
}): Promise<{ data: HealthRow[]; meta: HealthMeta }> {
  const qs = new URLSearchParams({ page: String(p.page), size: '25' });
  if (p.status) qs.set('status', p.status);
  if (p.q) qs.set('q', p.q);
  const env = await request<HealthRow[]>(`/admin/page-health?${qs.toString()}`);
  return { data: env.data, meta: env.meta as unknown as HealthMeta };
}

// ---- entry forms (Add / Edit / Delete) -------------------------------------------------------------------
export type FieldType = 'text' | 'textarea' | 'number' | 'int' | 'date' | 'bool' | 'select' | 'lookup';
export interface FormFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[] | null;
  lookup: string | null;
  parent: string | null;
  min: number | null;
  max: number | null;
  maxLength: number | null;
  default: string | number | boolean | null;
  editable: boolean;
  help: string | null;
}
export interface FormDef {
  title: string;
  needsPlant: boolean;
  editStatuses: string[] | null;
  noEdit: string | null;
  noDelete: string | null;
  fields: FormFieldDef[];
  lines: { label: string; min: number; max: number; fields: FormFieldDef[] } | null;
}
export type FormValues = Record<string, string | number | boolean | null>;
export interface SavePayload {
  values: FormValues;
  lines?: FormValues[];
}
export interface EditData {
  values: FormValues;
  lines: FormValues[];
  version: number;
  status: string | null;
}
export interface LookupOption {
  id: string;
  label: string;
}

export async function getForm(pageId: string): Promise<FormDef> {
  return (await request<FormDef>(`/screens/${pageId}/form`)).data;
}
export async function getEditData(pageId: string, id: string): Promise<EditData> {
  return (await request<EditData>(`/screens/${pageId}/${id}/edit`)).data;
}
export async function lookupOptions(
  pageId: string,
  name: string,
  p: { q?: string; parent?: string; id?: string },
): Promise<LookupOption[]> {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  if (p.parent) qs.set('parent', p.parent);
  if (p.id) qs.set('id', p.id);
  return (await request<LookupOption[]>(`/screens/${pageId}/lookup/${name}?${qs.toString()}`)).data;
}
export async function createRow(pageId: string, body: SavePayload): Promise<{ id: string; number: string | null }> {
  return (await request<{ id: string; number: string | null }>(`/screens/${pageId}`, { method: 'POST', body })).data;
}
export async function updateRow(pageId: string, id: string, version: number, body: SavePayload): Promise<void> {
  await request(`/screens/${pageId}/${id}`, { method: 'PATCH', body, headers: { 'If-Match': `"${version}"` } });
}
export async function deleteRow(pageId: string, id: string): Promise<void> {
  await request(`/screens/${pageId}/${id}`, { method: 'DELETE' });
}

export interface ShelfBins {
  warehouseId: string;
  bins: { id: string; code: string; name: string; status: string }[];
}
export async function getShelfBins(shelfId: string): Promise<ShelfBins> {
  return (await request<ShelfBins>(`/screens/wms-shelves/${shelfId}/bins`)).data;
}
export async function placeShelfBin(shelfId: string, binId: string): Promise<ShelfBins> {
  return (await request<ShelfBins>(`/screens/wms-shelves/${shelfId}/bins`, { method: 'POST', body: { binId } })).data;
}
export async function removeShelfBin(shelfId: string, binId: string): Promise<ShelfBins> {
  return (await request<ShelfBins>(`/screens/wms-shelves/${shelfId}/bins/${binId}`, { method: 'DELETE' })).data;
}

export interface DetailSectionData {
  title: string;
  columns: ScreenColumn[];
  rows: Record<string, unknown>[];
}
export async function getDetails(pageId: string, id: string): Promise<DetailSectionData[]> {
  return (await request<DetailSectionData[]>(`/screens/${pageId}/${id}/details`)).data;
}
