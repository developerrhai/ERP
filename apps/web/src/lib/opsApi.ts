// Phase 29 client: tasks, shift handover, visitors, canteen.
import { api } from './api';

type Row = Record<string, unknown>;
const qs = (o: Record<string, string | undefined | boolean>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface Task { id: string; task_no: string; title: string; department: string | null; assigned_to: string | null; assigned_by: string; priority: string; due_date: string | null; progress_pct: number; status: string; approval_status: string; blocked_by_count: number; unit_code: string }
export interface Workload { user_id: string; name: string; open: number; overdue: number; approvals_waiting: number; colour: 'GREEN' | 'AMBER' | 'RED' }
export interface Handover { id: string; unit_code: string; department: string; handover_date: string; outgoing: string; incoming: string | null; status: string; issues: string | null; reject_reason: string | null }
export interface Visitor { id: string; pass_no: string; visitor_name: string; company: string | null; host: string; department: string | null; visit_date: string; planned_out: string | null; purpose: string; status: string; in_time: string | null; out_time: string | null; minutes_inside?: number; overstay?: boolean }
export interface Rate { id: string; unit_code: string; meal: string; meal_type: string; rate: string; gst_pct: string; employee_share_pct: string; effective_from: string }
export interface Coupon { coupon_no: string; person_name: string; meal_type: string; date: string; total: string; employee_share: string; company_share: string; served_at: string }
export interface CanteenMonth { unit_code: string; month: string; status: string; meals: number | null; employee_total: string | null; company_total: string | null }

export const opsApi = {
  tasks: (f: { status?: string; mine?: boolean; overdue?: boolean; dept?: string; q?: string }) => api<Task[]>(`/ops/tasks${qs(f)}`),
  board: (dept?: string) => api<Record<string, Task[]>>(`/ops/tasks/board${qs({ dept })}`),
  workload: (dept?: string) => api<Workload[]>(`/ops/tasks/workload${qs({ dept })}`),
  addTask: (b: Row) => api<Task>('/ops/tasks', { method: 'POST', body: b }),
  taskAction: (id: string, action: 'start' | 'done' | 'approve') => api<Task>(`/ops/tasks/${id}/${action}`, { method: 'POST', body: {} }),
  reopen: (id: string, reason: string) => api<Task>(`/ops/tasks/${id}/reopen`, { method: 'POST', body: { reason } }),
  handovers: () => api<Handover[]>('/ops/handovers'),
  addHandover: (b: Row) => api<Handover>('/ops/handovers', { method: 'POST', body: b }),
  handoverAction: (id: string, action: 'submit' | 'accept') => api<Handover>(`/ops/handovers/${id}/${action}`, { method: 'POST', body: {} }),
  rejectHandover: (id: string, reason: string) => api<Handover>(`/ops/handovers/${id}/reject`, { method: 'POST', body: { reason } }),
  visitors: (f: { status?: string; q?: string }) => api<Visitor[]>(`/ops/visitors${qs(f)}`),
  inside: () => api<Visitor[]>('/ops/visitors/inside'),
  addVisitor: (b: Row) => api<Visitor>('/ops/visitors', { method: 'POST', body: b }),
  visitorAction: (id: string, action: 'approve' | 'reject' | 'check-out') => api<Visitor>(`/ops/visitors/${id}/${action}`, { method: 'POST', body: {} }),
  checkIn: (b: Row) => api<Visitor>('/ops/visitors/check-in', { method: 'POST', body: b }),
  qr: (id: string) => api<{ token: string }>(`/ops/visitors/${id}/qr`, { method: 'POST', body: {} }),
  rates: () => api<Rate[]>('/ops/canteen/rates'),
  setRate: (b: Row) => api<Rate>('/ops/canteen/rates', { method: 'PUT', body: b }),
  scan: (b: Row) => api<Coupon>('/ops/canteen/scan', { method: 'POST', body: b }),
  today: () => api<{ last: Coupon[]; counts: { meal_type: string; n: number }[] }>('/ops/canteen/today'),
  register: (month?: string) => api<Coupon[]>(`/ops/canteen/register${qs({ month })}`),
  months: () => api<CanteenMonth[]>('/ops/canteen/months'),
  closeMonth: (month: string) => api<Row>(`/ops/canteen/months/${month}/close`, { method: 'POST', body: {} }),
  departmentCost: (month: string) => api<{ department: string; meals: number; total: string; employee_share: string; company_share: string }[]>(`/ops/canteen/department-cost?month=${month}`),
};
