// Client for the Phase 4 endpoints: documents, summary / quality, submit, CSV / PDF, background
// export and the import wizard (docs/phases/PHASE-04.md §6, §9). Every number shown comes from here.
import { api, download } from '../../lib/api';
import { saveBlob } from '../../lib/download';
import { newIdempotencyKey, type RecordRow } from './engineApi';
import { refreshBell } from '../../lib/approvalsApi';

const base = (pageId: string) => `/pages/${encodeURIComponent(pageId)}`;

// ---- lock matrix ----------------------------------------------------------------

export type LockOp = 'update' | 'remove' | 'restore' | 'status' | 'submit' | 'documents';
export type LockTable = Record<string, Record<LockOp, boolean>>;

/** What the server allows for a record in `status`; unknown tables / statuses allow nothing. */
export function lockAllows(lock: LockTable | undefined, status: string, op: LockOp): boolean {
  return lock?.[status]?.[op] === true;
}

// ---- summary / quality ----------------------------------------------------------

export interface PageSummary {
  pageId: string;
  total: number;
  amountTotal: number;
  byStatus: { status: string; count: number; amount: number }[];
  createdThisMonth: number;
  staleDrafts: number;
  hasAmount: boolean;
}

export interface PageQuality {
  pageId: string;
  total: number;
  staleDrafts: number;
  missingRequired: { field: string; label: string; count: number }[];
  duplicateField: { field: string; label: string } | null;
  duplicates: { value: string; count: number }[];
}

export const getSummary = (pageId: string) => api<PageSummary>(`${base(pageId)}/records/summary`);
export const getQuality = (pageId: string) => api<PageQuality>(`${base(pageId)}/records/quality`);

// ---- submit ----------------------------------------------------------------------

export function submitRecord(pageId: string, row: Pick<RecordRow, 'id' | 'version'>) {
  return api<RecordRow>(`${base(pageId)}/records/${encodeURIComponent(row.id)}/submit`, {
    method: 'POST',
    headers: { 'If-Match': String(row.version), 'Idempotency-Key': newIdempotencyKey() },
  }).then((r) => {
    refreshBell();
    return r;
  });
}

export interface SubmitReport {
  id: string;
  ok: boolean;
  error?: { code: string; message: string };
}

export function submitBulk(pageId: string, ids: string[]) {
  return api<SubmitReport[]>(`${base(pageId)}/records/submit-bulk`, {
    method: 'POST',
    body: { ids },
  });
}

// ---- documents -------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  recordId: string;
  title: string;
  docType: string;
  fileName: string;
  mimeType: string;
  size: number;
  scanStatus: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export const DOC_TYPES = ['GENERAL', 'INVOICE', 'CONTRACT', 'CERTIFICATE', 'DRAWING', 'OTHER'];
export const MAX_FILE_MB = 10;
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.xlsx,.docx,.csv';

const docsBase = (pageId: string, id: string) =>
  `${base(pageId)}/records/${encodeURIComponent(id)}/documents`;

export const listDocuments = (pageId: string, id: string) =>
  api<DocumentRow[]>(docsBase(pageId, id));

export function uploadDocument(
  pageId: string,
  id: string,
  file: File,
  fields: { title?: string; docType?: string },
) {
  const form = new FormData();
  if (fields.title) form.set('title', fields.title);
  if (fields.docType) form.set('docType', fields.docType);
  form.set('file', file);
  return api<DocumentRow>(docsBase(pageId, id), {
    method: 'POST',
    body: form,
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  });
}

export const deleteDocument = (pageId: string, id: string, docId: string) =>
  api<{ id: string }>(`${docsBase(pageId, id)}/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });

export async function downloadDocument(pageId: string, id: string, doc: DocumentRow) {
  const { blob, filename } = await download(
    `${docsBase(pageId, id)}/${encodeURIComponent(doc.id)}/download`,
  );
  saveBlob(blob, filename ?? doc.fileName);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---- CSV / PDF -------------------------------------------------------------------

function queryOf(filters: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
  return q.toString() ? `?${q.toString()}` : '';
}

export interface ExportFilters {
  q?: string;
  status?: string;
  sort?: string;
  ids?: string[];
}

const filterParams = (f: ExportFilters) => ({
  q: f.q,
  status: f.status,
  sort: f.sort,
  ids: f.ids?.length ? f.ids.join(',') : undefined,
});

export async function exportCsv(pageId: string, f: ExportFilters = {}) {
  const { blob, filename } = await download(
    `${base(pageId)}/records/export.csv${queryOf(filterParams(f))}`,
  );
  saveBlob(blob, filename ?? `${pageId}.csv`);
}

/** Opens the PDF in a new tab (the browser's viewer prints / saves it). */
async function openPdf(path: string, name: string) {
  const { blob } = await download(path);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) saveBlob(blob, name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const openRecordPdf = (pageId: string, id: string) =>
  openPdf(`${base(pageId)}/records/${encodeURIComponent(id)}/pdf`, `${pageId}-${id}.pdf`);

export const openListPdf = (pageId: string, f: ExportFilters = {}) =>
  openPdf(`${base(pageId)}/records/export.pdf${queryOf(filterParams(f))}`, `${pageId}.pdf`);

// ---- jobs ------------------------------------------------------------------------

export interface JobRow {
  id: string;
  kind: 'EXPORT' | 'IMPORT_VALIDATE' | 'IMPORT_COMMIT';
  pageId: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  totalRows: number | null;
  okRows: number | null;
  errorRows: number | null;
  errors: unknown;
  hasOutput: boolean;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
}

export const isJobFinished = (j: Pick<JobRow, 'status'>) =>
  j.status === 'DONE' || j.status === 'FAILED' || j.status === 'CANCELLED';

export const startExportJob = (pageId: string, body: ExportFilters & { format: 'xlsx' | 'csv' }) =>
  api<JobRow>(`${base(pageId)}/exports`, {
    method: 'POST',
    body: { ...body, ids: body.ids?.length ? body.ids : undefined },
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  });

export const getJob = (jobId: string) => api<JobRow>(`/jobs/${encodeURIComponent(jobId)}`);
export const listJobs = (pageId: string) => api<JobRow[]>(`/jobs${queryOf({ pageId })}`);

export async function downloadJob(job: JobRow) {
  const { blob, filename } = await download(`/jobs/${encodeURIComponent(job.id)}/download`);
  saveBlob(blob, filename ?? `${job.pageId}-export`);
}

// ---- import wizard ---------------------------------------------------------------

export interface ImportField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface ImportUpload {
  job: JobRow;
  headers: string[];
  sample: (string | number | boolean | null)[][];
  suggestedMapping: Record<string, number>;
  fields: ImportField[];
  totalRows: number;
}

export interface ImportCheck {
  errors: { row: number; fields: Record<string, string> }[];
  warnings: { row: number; message: string }[];
  preview: { row: number; values: Record<string, unknown> }[];
}

export function uploadImport(pageId: string, file: File) {
  const form = new FormData();
  form.set('file', file);
  return api<ImportUpload>(`${base(pageId)}/imports`, { method: 'POST', body: form });
}

export const validateImport = (jobId: string, mapping: Record<string, number>) =>
  api<JobRow>(`/imports/${encodeURIComponent(jobId)}/validate`, {
    method: 'POST',
    body: { mapping },
  });

export const commitImport = (jobId: string) =>
  api<JobRow>(`/imports/${encodeURIComponent(jobId)}/commit`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newIdempotencyKey() },
  });

export async function downloadImportTemplate(pageId: string) {
  const { blob, filename } = await download(`${base(pageId)}/import-template.xlsx`);
  saveBlob(blob, filename ?? `${pageId}-import-template.xlsx`);
}
