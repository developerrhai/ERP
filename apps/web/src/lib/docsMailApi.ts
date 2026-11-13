// Phase 27 client: print in 5 formats, Document Center, department mail, mail automation, letters, quality certificates.
import { api, download } from './api';

type Row = Record<string, unknown>;

export type PrintKind = 'standard' | 'letterhead' | 'commercial' | 'word' | 'excel';
export const PRINT_CHOICES: { kind: PrintKind; label: string }[] = [
  { kind: 'standard', label: 'Standard PDF' },
  { kind: 'letterhead', label: 'Letterhead PDF' },
  { kind: 'commercial', label: 'Commercial PDF' },
  { kind: 'word', label: 'Word' },
  { kind: 'excel', label: 'Excel' },
];

export interface CatalogEntry { pageId: string; title: string; group: string; count: number }
export interface CatalogRecord { id: string; number: string; status: string; date: string | null }
export interface MailRow { id: string; subject: string; body?: string; from_department: string | null; from_name?: string; to_department?: string | null; created_at: string; read?: boolean; attachments: number | { label: string; page_id: string | null; record_id: string | null; format: string | null }[]; recipients?: number; read_by?: number }
export interface Automation {
  code: string; seq: number; name: string; module: string; trigger_kind: 'EVENT' | 'DATE' | 'SCHEDULE'; trigger_text: string; recipients_text: string; attachment_text: string | null;
  enabled: boolean; default_on: boolean; wired: boolean; p21_rule_code: string | null; subject_tpl: string | null; body_tpl: string | null; run_time: string | null; offset_days: number | null;
  sent_count: number; last_run: string | null; plants: { unitId: string; enabled: boolean }[]; defaults: { subject: string; body: string } | null;
}
export interface Letter { id: string; number: string; template_code: string; person_name: string; person_email: string | null; status: 'Draft' | 'Approved' | 'Issued'; issued_at: string | null; emailed_at: string | null; created_at: string }
export interface Certificate {
  id: string; number: string; job_card_no: string | null; part_code: string | null; part_name: string; inspection_date: string; sample_qty: string; accepted_qty: string; rejected_qty: string;
  drawing_revision: string | null; inspector: string | null; result: 'Pass' | 'Fail' | 'Conditional'; ncr_no: string | null; quality_approval: 'Pending' | 'Approved' | 'Rejected'; remarks: string | null;
}

const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const docsMailApi = {
  print: (pageId: string, id: string, kind: PrintKind) => download(`/print/${pageId}/${id}?kind=${kind}`),
  catalog: () => api<CatalogEntry[]>('/doc-center/catalog'),
  records: (pageId: string, q: string) => api<CatalogRecord[]>(`/doc-center/catalog/${pageId}/records${qs({ q })}`),
  sendToDept: (b: { pageId: string; recordId: string; docNo?: string; toDepartmentId: string; note?: string; fromDepartmentId?: string | null }) => api<Row>('/doc-center/send', { method: 'POST', body: b }),
  departments: () => api<{ id: string; name: string }[]>('/mail/departments'),
  inbox: () => api<MailRow[]>('/mail/inbox'),
  sent: () => api<MailRow[]>('/mail/sent'),
  open: (id: string) => api<MailRow>(`/mail/${id}`),
  sendInternal: (b: Row) => api<MailRow>('/mail/internal', { method: 'POST', body: b }),
  sendExternal: (b: Row) => api<{ queued: number }>('/mail/external', { method: 'POST', body: b }),
  automations: () => api<Automation[]>('/admin/mail-automation'),
  updateAutomation: (code: string, b: Row) => api<Automation>(`/admin/mail-automation/${code}`, { method: 'PUT', body: b }),
  setPlant: (code: string, unitId: string, enabled: boolean) => api<Row>(`/admin/mail-automation/${code}/plants/${unitId}`, { method: 'PUT', body: { enabled } }),
  testAutomation: (code: string) => api<{ queued: boolean; to: string }>(`/admin/mail-automation/${code}/test`, { method: 'POST', body: {} }),
  runs: (code: string) => api<{ id: string; status: string; reason: string | null; recipients: number; doc_no: string | null; at: string; unit_code: string | null }[]>(`/admin/mail-automation/${code}/runs`),
  letterTemplates: () => api<{ code: string; name: string; merge_fields: string[] }[]>('/hr/letter-templates'),
  letters: () => api<Letter[]>('/hr/letters'),
  addLetter: (b: Row) => api<Letter>('/hr/letters', { method: 'POST', body: b }),
  letterAction: (id: string, action: 'approve' | 'issue' | 'email') => api<Letter>(`/hr/letters/${id}/${action}`, { method: 'POST', body: {} }),
  certificates: (q?: string) => api<Certificate[]>(`/qms/certificates${qs({ q })}`),
  addCertificate: (b: Row) => api<Certificate>('/qms/certificates', { method: 'POST', body: b }),
  certAction: (id: string, action: 'approve' | 'reject') => api<Certificate>(`/qms/certificates/${id}/${action}`, { method: 'POST', body: {} }),
};

export function saveFile(file: { blob: Blob; filename: string | null }, fallback: string): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename ?? fallback;
  a.click();
  URL.revokeObjectURL(url);
}
