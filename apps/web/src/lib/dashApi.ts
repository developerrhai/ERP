// Phase 24: dashboards, KPI targets, KPI alerts, emailed dashboards, TV links.
import { api } from './api';

export type Rag = 'GREEN' | 'AMBER' | 'RED' | 'NONE';

export interface KpiCard {
  code: string;
  name: string;
  department: string;
  format: string;
  unitLabel: string;
  value: number | null;
  target: number | null;
  pct: number | null;
  rag: Rag;
  direction: 'HIGHER_GOOD' | 'LOWER_GOOD';
  formulaText: string;
  sourceText: string | null;
  rowCount: number;
  noData: boolean;
  drill: { page: string | null; filters: Record<string, string> };
  refreshedAt: string;
  unitId: string | null;
}
export interface PlantRef {
  id: string;
  code: string;
  name: string;
}
export interface GridRow {
  code: string;
  name: string;
  department: string;
  format: string;
  direction: 'HIGHER_GOOD' | 'LOWER_GOOD';
  cells: KpiCard[];
  total: number | null;
  totalNote: string | null;
}
export interface Grid {
  plants: PlantRef[];
  rows: GridRow[];
}
export interface LayoutItem {
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MyDashboard {
  key: string;
  title: string;
  department: string;
  scopeNote: string;
  queues: { approvalsWaiting: number; approvalsOverdue: number; submittedPending: number };
  myDocumentsByStatus: { status: string; count: number }[];
  cards: KpiCard[];
  override: LayoutItem[] | null;
}
export interface PlantDashboard extends Grid {
  key: string;
  title: string;
  override: LayoutItem[] | null;
}
export interface OwnerDashboard extends Grid {
  key: string;
  title: string;
  approvalsByAge: { label: string; count: number }[];
  needsReview: { gstRates: number; hsnCodes: number };
}
export interface ModuleDashboard extends Grid {
  key: string;
  title: string;
  empty: string | null;
}
export interface TargetRow {
  id: string;
  kpi_code: string;
  kpi_name: string;
  unit_id: string | null;
  unit_code: string | null;
  user_id: string | null;
  user_name: string | null;
  department: string | null;
  period_kind: string;
  period_start: string;
  target: number;
  amber_pct: number;
  red_pct: number;
}
export interface AlertRuleRow {
  id: string;
  kpi_code: string;
  kpi_name: string;
  unit_id: string | null;
  unit_code: string | null;
  condition: 'GT' | 'LT' | 'BELOW_TARGET' | 'ABOVE_TARGET';
  threshold: number | null;
  channels: string[];
  cooldown_hours: number;
  active: boolean;
  last_raised_at: string | null;
}
export interface ScheduleRow {
  id: string;
  dashboard_key: string;
  name: string;
  cron_expr: string;
  active: boolean;
  last_run_at: string | null;
}
export interface TvView extends Grid {
  key: string;
  title: string;
  refreshSeconds: number;
}

export const dashApi = {
  my: () => api<MyDashboard>('/dashboards/my'),
  plant: () => api<PlantDashboard>('/dashboards/plant'),
  owner: () => api<OwnerDashboard>('/dashboards/owner'),
  module: (code: string) => api<ModuleDashboard>(`/dashboards/module/${code}`),
  putLayout: (key: string, layout: LayoutItem[]) =>
    api<unknown>(`/dashboards/${encodeURIComponent(key)}/layout`, { method: 'PUT', body: { layout } }),
  resetLayout: (key: string) => api<unknown>(`/dashboards/${encodeURIComponent(key)}/reset`, { method: 'POST' }),
  tvToken: (key: string, unitId: string | null) =>
    api<{ token: string; expiresAt: string }>(`/dashboards/${encodeURIComponent(key)}/tv-token`, {
      method: 'POST',
      body: unitId ? { unitId } : {},
    }),
  tv: (key: string, token: string) =>
    api<TvView>(`/tv/${encodeURIComponent(key)}?token=${encodeURIComponent(token)}`),
  targets: () => api<TargetRow[]>('/kpi-targets'),
  saveTarget: (body: Record<string, unknown>) => api<{ id: string }>('/kpi-targets', { method: 'POST', body }),
  deleteTarget: (id: string) => api<unknown>(`/kpi-targets/${id}`, { method: 'DELETE' }),
  alerts: () => api<AlertRuleRow[]>('/kpi-alerts'),
  saveAlert: (body: Record<string, unknown>) => api<{ id: string }>('/kpi-alerts', { method: 'POST', body }),
  toggleAlert: (id: string, active: boolean) => api<unknown>(`/kpi-alerts/${id}`, { method: 'PATCH', body: { active } }),
  deleteAlert: (id: string) => api<unknown>(`/kpi-alerts/${id}`, { method: 'DELETE' }),
  schedules: () => api<ScheduleRow[]>('/dashboard-schedules'),
  saveSchedule: (body: Record<string, unknown>) => api<{ id: string }>('/dashboard-schedules', { method: 'POST', body }),
  deleteSchedule: (id: string) => api<unknown>(`/dashboard-schedules/${id}`, { method: 'DELETE' }),
};
