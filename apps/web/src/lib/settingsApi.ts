// Client for the Phase 6B Format & Settings endpoints (docs/phases/PHASE-06B.md §6). Every write sends
// If-Match (the draft's version) and an Idempotency-Key, so a double click can never publish twice.
import { api, request } from './api';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export type SettingsKind = 'PRINT' | 'FORM' | 'REPORT';
export type VersionStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'RETIRED';

export interface FormatField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'percent' | 'date' | 'select' | 'textarea';
  required: boolean;
  options?: string[];
  hidden?: boolean;
}
export interface FormatColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'percent' | 'date';
  required: boolean;
  hidden: boolean;
  formula?: string;
}
export interface FormatTotal {
  key: string;
  label: string;
  op: 'sum' | 'expression';
  column?: string;
  expression?: string;
}
export interface FormatSchema {
  title?: string;
  header: FormatField[];
  columns: FormatColumn[];
  totals: FormatTotal[];
  print: {
    paper: 'A4' | 'A5';
    orientation: 'portrait' | 'landscape';
    showLetterhead: boolean;
    showAmountInWords: boolean;
    footerNote?: string;
    signatures: string[];
  };
  validations: { field: string; rule: string; value?: string; message: string }[];
}

export interface RuleDefinition {
  inputs: { name: string; label?: string; default?: string }[];
  parameters: { name: string; label?: string; value: string; unit?: string }[];
  tables: { name: string; label?: string; columns: string[]; rows: string[][] }[];
  outputs: { name: string; label?: string; expression: string; places?: number }[];
  bindings?: {
    inputs: Record<string, string>;
    amountOutput?: string;
    fieldOutputs: Record<string, string>;
  };
}

export interface SettingsVersion<C = unknown> {
  id: string;
  target: 'FORMAT' | 'RULE_SET';
  pageId: string;
  /** Row version: If-Match. */
  version: number;
  /** The "v3" number people see. */
  versionNo: number;
  status: VersionStatus;
  name: string;
  reason: string | null;
  content: C;
  kind: SettingsKind | null;
  code: string | null;
  moneyAffecting: boolean | null;
  customer: { id: string; name: string } | null;
  unit: { id: string; name: string } | null;
  sourceFileId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: { id: string; name: string } | null;
  retiredAt: string | null;
}

export interface SettingsList<C> {
  items: SettingsVersion<C>[];
  ownerDepartment: string;
  canEdit: boolean;
  approvalRequired?: boolean;
}

const base = (pageId: string): string => `/pages/${encodeURIComponent(pageId)}/settings`;
const ifMatch = (v: number): Record<string, string> => ({ 'If-Match': String(v) });
const write = (v: number): Record<string, string> => ({
  ...ifMatch(v),
  'Idempotency-Key': newKey(),
});

export async function listFormats(pageId: string): Promise<SettingsList<FormatSchema>> {
  const res = await request<SettingsVersion<FormatSchema>[]>(`${base(pageId)}/formats`);
  const meta = res.meta as unknown as { ownerDepartment: string; canEdit: boolean };
  return { items: res.data, ownerDepartment: meta.ownerDepartment, canEdit: meta.canEdit };
}

export async function listRules(pageId: string): Promise<SettingsList<RuleDefinition>> {
  const res = await request<SettingsVersion<RuleDefinition>[]>(`${base(pageId)}/rules`);
  const meta = res.meta as unknown as {
    ownerDepartment: string;
    canEdit: boolean;
    approvalRequired: boolean;
  };
  return {
    items: res.data,
    ownerDepartment: meta.ownerDepartment,
    canEdit: meta.canEdit,
    approvalRequired: meta.approvalRequired,
  };
}

export interface FormatKey {
  kind: SettingsKind;
  customerId?: string | null;
  unitId?: string | null;
}

export function saveFormat(
  pageId: string,
  key: FormatKey,
  name: string,
  schema: FormatSchema,
  rowVersion: number,
): Promise<SettingsVersion<FormatSchema>> {
  return api(`${base(pageId)}/formats`, {
    method: 'PUT',
    body: { ...key, name, schema },
    headers: write(rowVersion),
  });
}

export function saveRule(
  pageId: string,
  input: { code: string; name: string; moneyAffecting: boolean; definition: RuleDefinition },
  rowVersion: number,
): Promise<SettingsVersion<RuleDefinition>> {
  return api(`${base(pageId)}/rules`, { method: 'PUT', body: input, headers: write(rowVersion) });
}

type Part = 'formats' | 'rules';

export function publish(pageId: string, part: Part, v: SettingsVersion, reason: string) {
  return api<SettingsVersion>(`${base(pageId)}/${part}/${v.id}/publish`, {
    method: 'POST',
    body: { reason },
    headers: write(v.version),
  });
}

export function retire(pageId: string, part: Part, v: SettingsVersion, reason: string) {
  return api<SettingsVersion>(`${base(pageId)}/${part}/${v.id}/retire`, {
    method: 'POST',
    body: { reason },
    headers: write(v.version),
  });
}

export function restore(pageId: string, part: Part, v: SettingsVersion, reason?: string) {
  return api<SettingsVersion>(`${base(pageId)}/${part}/${v.id}/restore`, {
    method: 'POST',
    body: reason ? { reason } : {},
    headers: { 'Idempotency-Key': newKey() },
  });
}

export function discard(pageId: string, part: Part, v: SettingsVersion) {
  return api<void>(`${base(pageId)}/${part}/${v.id}`, { method: 'DELETE', headers: ifMatch(v.version) });
}

export function formatVersions(pageId: string, key: FormatKey) {
  const p = new URLSearchParams({ kind: key.kind });
  if (key.customerId) p.set('customerId', key.customerId);
  if (key.unitId) p.set('unitId', key.unitId);
  return api<SettingsVersion<FormatSchema>[]>(`${base(pageId)}/formats/versions?${p.toString()}`);
}

export function ruleVersions(pageId: string, code: string) {
  return api<SettingsVersion<RuleDefinition>[]>(
    `${base(pageId)}/rules/${encodeURIComponent(code)}/versions`,
  );
}

export interface ResolvedFormat {
  id: string;
  versionNo: number;
  kind: SettingsKind;
  name: string;
  matchedBy: 'customer' | 'unit' | 'customer+unit' | 'default';
  schema: FormatSchema;
}

/** The format a form should render now; call again whenever the customer changes. */
export function resolveFormat(
  pageId: string,
  kind: SettingsKind,
  ctx: { customerId?: string | null; unitId?: string | null } = {},
) {
  const p = new URLSearchParams({ kind });
  if (ctx.customerId) p.set('customerId', ctx.customerId);
  if (ctx.unitId) p.set('unitId', ctx.unitId);
  return api<ResolvedFormat | null>(`${base(pageId)}/formats/resolve?${p.toString()}`);
}

export function evaluateRule(
  pageId: string,
  target: { id?: string; code?: string },
  inputs: Record<string, string>,
) {
  return api<{ ruleSetId: string; versionNo: number; status: string; outputs: Record<string, string> }>(
    `${base(pageId)}/rules/evaluate`,
    { method: 'POST', body: { ...target, inputs } },
  );
}

export interface ImportReport {
  valid: boolean;
  errors: { row: number | null; message: string }[];
  warnings: { row: number | null; message: string }[];
  summary: string;
}

export function importExcel(
  pageId: string,
  q: { target: 'format' | 'rate-table'; kind?: SettingsKind; code?: string; tableName?: string },
  file: File,
) {
  const p = new URLSearchParams({ target: q.target });
  if (q.kind) p.set('kind', q.kind);
  if (q.code) p.set('code', q.code);
  if (q.tableName) p.set('tableName', q.tableName);
  const form = new FormData();
  form.append('file', file);
  return api<{ report: ImportReport; draft: SettingsVersion | null }>(
    `${base(pageId)}/import?${p.toString()}`,
    { method: 'POST', body: form },
  );
}

// ---- admin-formats ---------------------------------------------------------------------

export interface AllQuery {
  q?: string;
  pageId?: string;
  type?: 'format' | 'rule';
  status?: VersionStatus;
  page?: number;
  size?: number;
}

export async function listAll(query: AllQuery = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v));
  const res = await request<SettingsVersion[]>(`/formats?${p.toString()}`);
  const meta = res.meta as unknown as { page: number; size: number; total: number };
  return { items: res.data, total: meta.total, page: meta.page, size: meta.size };
}

export const versionsOf = (id: string) => api<SettingsVersion[]>(`/formats/${id}/versions`);

export interface SettingsChange {
  id: string;
  targetType: 'FORMAT' | 'RULE_SET';
  targetId: string;
  pageId: string;
  versionNo: number;
  action: string;
  reason: string | null;
  changedBy: { id: string; name: string } | null;
  at: string;
}

export async function listChanges(pageId?: string, page = 1) {
  const p = new URLSearchParams({ page: String(page), size: '20' });
  if (pageId) p.set('pageId', pageId);
  const res = await request<SettingsChange[]>(`/formats/changes?${p.toString()}`);
  const meta = res.meta as unknown as { total: number };
  return { items: res.data, total: meta.total };
}

export async function downloadTemplate(pageId: string, target: 'format' | 'rate-table') {
  const { download } = await import('./api');
  return download(`${base(pageId)}/import-template?target=${target}`);
}
