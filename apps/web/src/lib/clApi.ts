// Phase 30 client: contract labour.
import { api, download } from './api';

type Row = Record<string, unknown>;
const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface Contractor { id: string; code: string; name: string; labour_licence_no: string | null; licence_valid_until: string | null; agreement_end: string | null; insurance_expiry: string | null; risk_rating: string; status: string; approval_status: string; deployed: number }
export interface WorkOrder { id: string; number: string; contractor: string; unit_code: string; department: string | null; skill_category: string; required_headcount: number; deployed: number; rate: string; budget: string; utilized: string; balance: string; budget_pct: number; budget_level: 'OK' | 'AMBER' | 'BLOCKED'; status: string }
export interface Worker { id: string; worker_no: string; name: string; contractor: string; skill_category: string; wage_rate: string; aadhaar_last4: string | null; status: string; checks: string | null }
export interface WageSheet { id: string; unit_code: string; month: string; contractor: string; status: string; total_gross: string; total_net: string; workers: number }
export interface Bill { id: string; invoice_no: string; contractor: string; billing_month: string; billed_man_days: string; gross_invoice: string; net_payable: string; disputed_amount: string; approved_amount: string; status: string; block_reason: string | null; recon: Row | null }
export interface Compliance { id: string; month: string; contractor: string; scorePct: number; risk: string; passed: number; required: number; checks: { kind: string; label: string; passed: boolean; uploaded: boolean }[]; blocked: boolean; blockReason: string | null; docs: { id: string; kind: string; reference: string | null; verified_at: string | null }[] }
export interface CommandCenter { tiles: Record<string, number>; headcount: { unit_code: string; contractor: string; headcount: number }[]; expiries: { name: string; what: string; on_date: string }[]; blockers: { invoice_no: string; contractor: string; block_reason: string }[] }

export const clApi = {
  command: () => api<CommandCenter>('/cl/command-center'),
  contractors: () => api<Contractor[]>('/cl/contractors'),
  addContractor: (b: Row) => api<Contractor>('/cl/contractors', { method: 'POST', body: b }),
  approveContractor: (id: string) => api<Contractor>(`/cl/contractors/${id}/approve`, { method: 'POST', body: {} }),
  workOrders: () => api<WorkOrder[]>('/cl/work-orders'),
  addWorkOrder: (b: Row) => api<WorkOrder>('/cl/work-orders', { method: 'POST', body: b }),
  activateWorkOrder: (id: string) => api<WorkOrder>(`/cl/work-orders/${id}/activate`, { method: 'POST', body: {} }),
  workers: () => api<Worker[]>('/cl/workers'),
  addWorker: (b: Row) => api<Worker>('/cl/workers', { method: 'POST', body: b }),
  check: (id: string, b: Row) => api<Row>(`/cl/workers/${id}/checks`, { method: 'POST', body: b }),
  deploy: (id: string, b: Row) => api<Row>(`/cl/workers/${id}/deploy`, { method: 'POST', body: b }),
  release: (id: string) => api<Row>(`/cl/workers/${id}/release`, { method: 'POST', body: {} }),
  attendance: (month: string) => api<Row[]>(`/cl/attendance${qs({ month })}`),
  generateMuster: (date: string) => api<{ rows: number }>('/cl/attendance/generate', { method: 'POST', body: { date } }),
  approveDay: (id: string) => api<Row>(`/cl/attendance/${id}/approve`, { method: 'POST', body: {} }),
  wages: () => api<WageSheet[]>('/cl/wages'),
  computeWages: (b: Row) => api<WageSheet>('/cl/wages/compute', { method: 'POST', body: b }),
  wageLines: (id: string) => api<Row[]>(`/cl/wages/${id}/lines`),
  lockWages: (id: string) => api<WageSheet>(`/cl/wages/${id}/lock`, { method: 'POST', body: {} }),
  bankAdvice: (id: string) => download(`/cl/wages/${id}/bank-advice.xlsx`),
  bills: () => api<Bill[]>('/cl/invoices'),
  addBill: (b: Row) => api<Bill>('/cl/invoices', { method: 'POST', body: b }),
  reconcile: (id: string) => api<Bill>(`/cl/invoices/${id}/reconcile`, { method: 'POST', body: {} }),
  approvePayment: (id: string, amount?: number) => api<Bill>(`/cl/invoices/${id}/approve-payment`, { method: 'POST', body: amount !== undefined ? { amount } : {} }),
  compliance: (contractor: string, month: string) => api<Compliance>(`/cl/compliance${qs({ contractor, month })}`),
  uploadDoc: (b: Row) => api<Row>('/cl/compliance/docs', { method: 'POST', body: b }),
  verifyDoc: (id: string) => api<Row>(`/cl/compliance/docs/${id}/verify`, { method: 'POST', body: {} }),
  incidents: () => api<Row[]>('/cl/incidents'),
  addIncident: (b: Row) => api<Row>('/cl/incidents', { method: 'POST', body: b }),
};
