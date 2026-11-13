// Phase 25: Department Work Movement client.
import { api } from './api';

export type MovementState =
  | 'SENT'
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'IN_WORK'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FORWARDED'
  | 'RETURNED'
  | 'RECALLED'
  | 'CANCELLED';

export interface Movement {
  id: string;
  number: string;
  unit_id: string;
  to_unit_id: string | null;
  doc_type: string;
  doc_id: string;
  doc_no: string | null;
  from_department_id: string;
  from_department: string;
  to_department_id: string;
  to_department: string;
  assigned_manager_id: string | null;
  assigned_manager: string | null;
  route_type: string;
  priority: 'Normal' | 'High' | 'Critical';
  required_by: string | null;
  work_status: string;
  handover_note: string | null;
  state: MovementState;
  sent_at: string;
  received_at: string | null;
  accepted_at: string | null;
  return_reason: string | null;
  sla_due_at: string | null;
  is_late: boolean;
  is_physical: boolean;
  version: number;
  sent_by: string | null;
  received_by: string | null;
  accepted_by: string | null;
}

export interface InboxPage {
  rows: Movement[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface HistoryEvent {
  event: string;
  from_state: string | null;
  to_state: string | null;
  at: string;
  note: string | null;
  department: string | null;
  actor: string | null;
  number: string;
}

export interface DocMovement {
  holder: { id: string; state: MovementState; department: string; department_id: string; sent_at: string } | null;
  events: HistoryEvent[];
  movements: Movement[];
}

export interface WorkRule {
  module_id: string;
  owner_department_id: string | null;
  owner_department: string | null;
  next_department_id: string | null;
  next_department: string | null;
  approval_department_id: string | null;
  approval_department: string | null;
  route_mode: 'MANUAL' | 'SUGGEST';
  sla_days: number;
  routed_edit: boolean;
  active: boolean;
  required_attachment_types: string[];
  required_fields: string[];
}

export interface Dept {
  id: string;
  name: string;
}

export interface ForwardBody {
  docType: string;
  docId: string;
  docNo?: string;
  toDepartmentId: string;
  assignedManagerId?: string | null;
  routeType?: string;
  priority?: string;
  requiredBy?: string | null;
  workStatus?: string;
  handoverNote?: string | null;
  toUnitId?: string | null;
  isPhysical?: boolean;
  lines?: { description?: string; qty: number; uom?: string }[];
}

export const ROUTE_TYPES = [
  'Department Work Handover',
  'Technical Work',
  'Purchase',
  'Material Action',
  'Manufacturing Action',
  'Quality Action',
  'Finance',
  'Commercial Action',
  'Project Action',
  'Correction',
  'Rework',
] as const;

export const WORK_STATUSES = [
  'Work Required',
  'Review Required',
  'Material Action Required',
  'Manufacturing Required',
  'Quality Check Required',
  'Dispatch Action Required',
  'Finance Action Required',
  'Correction Required',
] as const;

const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const workApi = {
  departments: () => api<Dept[]>('/work/departments'),
  managers: (dept: string) => api<{ id: string; name: string }[]>(`/work/managers?dept=${dept}`),
  inbox: (p: { dept?: string; tab?: string; docType?: string; late?: boolean; q?: string; cursor?: string }) =>
    api<InboxPage>(`/work/inbox${qs({ dept: p.dept, tab: p.tab, docType: p.docType, late: p.late ? 'true' : undefined, q: p.q, cursor: p.cursor })}`),
  workCenter: (dept?: string) => api<{ groups: { docType: string; items: Movement[] }[] }>(`/work/work-center${qs({ dept })}`),
  forward: (body: ForwardBody) => api<Movement>('/work/movements', { method: 'POST', body }),
  act: (id: string, action: 'receive' | 'accept' | 'return' | 'recall' | 'complete', body: Record<string, unknown> = {}) =>
    api<Movement>(`/work/movements/${id}/${action}`, { method: 'POST', body }),
  doc: (docType: string, docId: string) => api<DocMovement>(`/work/docs/${docType}/${docId}/movement`),
  suggest: (docType: string) =>
    api<{ departmentId: string | null; department: string | null; source: string }>(`/work/workflow-rules/suggest?docType=${encodeURIComponent(docType)}`),
  rules: () => api<WorkRule[]>('/work/workflow-rules'),
  saveRule: (moduleId: string, body: Record<string, unknown>) =>
    api<unknown>(`/work/workflow-rules/${encodeURIComponent(moduleId)}`, { method: 'PUT', body }),
};
