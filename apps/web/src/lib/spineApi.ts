// Phase 26 client: project spine, gates, specs, tests, documents, history, 360, exceptions, enquiries.
import { api, download } from './api';

type Row = Record<string, unknown>;

const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface ProjectOption { id: string; code: string; name: string; status: string }
export interface Gate {
  id: string; seq: number; code: string; name: string; state: 'LOCKED' | 'OPEN' | 'IN_WORK' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  owner_department: string | null; deliverable_name: string | null; deliverable_doc_type: string | null; exit_criteria: string | null;
  due_date: string | null; reject_comment: string | null; readinessPct: number; missing: string[];
}
export interface Spec { id: string; spec_no: string; parameter: string; target: string | null; tol_minus: string | null; tol_plus: string | null; unit: string | null; revision: number; status: string }
export interface TestRow { id: string; test_name: string; gate_code: string | null; spec_no: string | null; value: string | null; result: 'OK' | 'NG' | null; tested_at: string | null }
export interface ProjectDoc { id: string; doc_type: string; title: string; revision: number; status: string; gate_code: string | null }
export interface HistoryRow { id: string; at: string; kind: string | null; department: string | null; actor: string | null; doc_no: string | null; text: string | null; masked: boolean }
export interface Stage { key: string; label: string; docs: { id: string; number: string; status: string }[]; done: number; total: number | null; state: 'NOT_STARTED' | 'ACTIVE' | 'DONE' }
export interface Order360 {
  order: { id: string; number: string; status: string; customer: string; customerPo: string | null; value: string | null; project: string | null; plant: string };
  progressPct: number;
  stages: Stage[];
  lines: { lineNo: number; item: string | null; ordered: number; dispatched: number; invoiced: number; progressPct: number }[];
  heldBy: { docType: string; docNo: string | null; department: string; since: string }[];
}
export interface ExceptionRow {
  id: string; rule_code: string; rule_name: string; severity: 'Low' | 'Medium' | 'High'; owner_department: string; doc_type: string; doc_id: string;
  doc_no: string | null; detail: string | null; raised_at: string; resolved_at: string | null; note: string | null; assigned_to: string | null;
}
export interface Enquiry {
  id: string; number: string; enq_date: string; customer_id: string | null; customer_name: string | null; prospect_name: string | null; product: string;
  qty: string | null; status: 'New' | 'Qualified' | 'Quoted' | 'Won' | 'Lost'; lost_reason: string | null; quotation_id: string | null; project_id: string | null;
  project_template: 'BLDC' | 'SPPM' | 'CUSTOM' | null; assigned_to: string | null; source: string | null;
}

export const spineApi = {
  options: (q: string) => api<ProjectOption[]>(`/projects/options${qs({ q })}`),
  gates: (pid: string) => api<Gate[]>(`/projects/${pid}/gates`),
  applyTemplate: (pid: string, template: string) => api<Gate[]>(`/projects/${pid}/gates`, { method: 'POST', body: { template } }),
  startGate: (pid: string, gid: string) => api<Row>(`/projects/${pid}/gates/${gid}/start`, { method: 'POST', body: {} }),
  setDue: (pid: string, gid: string, dueDate: string | null) => api<Row>(`/projects/${pid}/gates/${gid}/due`, { method: 'PUT', body: { dueDate } }),
  submitGate: (pid: string, gid: string) => api<Row>(`/projects/${pid}/gates/${gid}/submit`, { method: 'POST', body: {} }),
  specs: (pid: string) => api<Spec[]>(`/projects/${pid}/specs`),
  addSpec: (pid: string, b: Row) => api<Spec>(`/projects/${pid}/specs`, { method: 'POST', body: b }),
  approveSpec: (pid: string, id: string) => api<Spec>(`/projects/${pid}/specs/${id}/approve`, { method: 'POST', body: {} }),
  tests: (pid: string) => api<TestRow[]>(`/projects/${pid}/tests`),
  addTest: (pid: string, b: Row) => api<TestRow>(`/projects/${pid}/tests`, { method: 'POST', body: b }),
  docs: (pid: string) => api<ProjectDoc[]>(`/projects/${pid}/documents`),
  addDoc: (pid: string, b: Row) => api<ProjectDoc>(`/projects/${pid}/documents`, { method: 'POST', body: b }),
  approveDoc: (pid: string, id: string) => api<ProjectDoc>(`/projects/${pid}/documents/${id}/approve`, { method: 'POST', body: {} }),
  history: (pid: string, p: { kind?: string; cursor?: string }) => api<HistoryRow[]>(`/projects/${pid}/history${qs({ kind: p.kind, cursor: p.cursor, limit: 50 })}`),
  dossier: (pid: string) => download(`/projects/${pid}/dossier.pdf`),
  historyXlsx: (pid: string) => download(`/projects/${pid}/history/export.xlsx`),
  order360: (soId: string) => api<Order360>(`/orders/${soId}/360`),
  orders: (q: string) => api<{ id: string; number: string; status: string }[]>(`/sales/orders${qs({ q, size: 20 })}`),
  exceptions: (p: { dept?: string; severity?: string; state?: string }) => api<ExceptionRow[]>(`/exceptions${qs(p)}`),
  exceptionAction: (id: string, action: 'note' | 'assign' | 'resolve', body: Row) => api<ExceptionRow>(`/exceptions/${id}/${action}`, { method: 'POST', body }),
  runExceptions: () => api<{ raised: number; resolved: number }>('/exceptions/run', { method: 'POST', body: {} }),
  enquiries: (p: { status?: string; q?: string }) => api<Enquiry[]>(`/sales/enquiries${qs({ status: p.status, q: p.q, size: 100 })}`),
  addEnquiry: (b: Row) => api<Enquiry>('/sales/enquiries', { method: 'POST', body: b }),
  qualify: (id: string) => api<Enquiry>(`/sales/enquiries/${id}/qualify`, { method: 'POST', body: {} }),
  won: (id: string) => api<Enquiry>(`/sales/enquiries/${id}/won`, { method: 'POST', body: {} }),
  toQuotation: (id: string) => api<Row>(`/sales/enquiries/${id}/to-quotation`, { method: 'POST', body: {} }),
  toProject: (id: string, template?: string) => api<Row>(`/sales/enquiries/${id}/to-project`, { method: 'POST', body: template ? { template } : {} }),
  markLost: (id: string, lostReason: string) => api<Enquiry>(`/sales/enquiries/${id}/mark-lost`, { method: 'POST', body: { lostReason } }),
};

/** Save a downloaded blob under its filename. */
export function saveBlob(file: { blob: Blob; filename: string | null }, fallback: string): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename ?? fallback;
  a.click();
  URL.revokeObjectURL(url);
}
