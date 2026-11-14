// apps/web/src/lib/projectsApi.ts
import { request, type RequestOptions } from './api';

async function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  const env = await request<T>(path, opts);
  return env.data;
}

export interface Project {
  id: string;
  project_no: string;
  name: string;
  customer_id?: string;
  customer_name?: string;
  manager_id?: string;
  manager_name?: string;
  unit_id: string;
  start_date: string;
  end_date: string;
  contract_value: number;
  billing_type: string;
  status: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CLOSED';
  approved_budget?: number;
  actual_cost?: number;
  milestones?: any[];
  team?: any[];
}

export interface ProjectTask {
  id: string;
  project_id: string;
  name: string;
  wbs_code: string;
  assigned_to_id?: string;
  assignee_name?: string;
  planned_start: string;
  planned_end: string;
  duration_days: number;
  progress_pct: number;
  estimated_cost: number;
  estimated_hours: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  earlyStart?: number;
  earlyFinish?: number;
  lateStart?: number;
  lateFinish?: number;
  totalFloat?: number;
  isCritical?: boolean;
}

export interface ProjectTimesheet {
  id: string;
  employee_id: string;
  emp_code?: string;
  employee_name?: string;
  week_start_date: string;
  total_hours: number;
  total_billable_hours: number;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  lines?: any[];
}

export interface EvmMetrics {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  cv: number;
  sv: number;
  cpi: number;
  spi: number;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number;
  health: 'GREEN' | 'AMBER' | 'RED';
}

export interface ProfitabilityReport {
  projectId: string;
  revenue: number;
  totalCost: number;
  contribution: number;
  marginPct: string;
  costByHead: {
    labour: number;
    material: number;
    subcontract: number;
    travel: number;
    other: number;
  };
  summary: any[];
  drillDown: any[];
}

export const projectsApi = {
  list: (params?: { status?: string; customerId?: string; page?: number; size?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.page) q.set('page', String(params.page));
    if (params?.size) q.set('size', String(params.size));
    return api<{ rows: Project[]; total: number }>(`/projects?${q.toString()}`);
  },

  get: (id: string) => api<Project>(`/projects/${id}`),

  create: (body: Partial<Project>) =>
    api<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),

  activate: (id: string) =>
    api<Project>(`/projects/${id}/activate`, { method: 'POST' }),

  hold: (id: string) =>
    api<Project>(`/projects/${id}/hold`, { method: 'POST' }),

  complete: (id: string) =>
    api<Project>(`/projects/${id}/complete`, { method: 'POST' }),

  close: (id: string) =>
    api<Project>(`/projects/${id}/close`, { method: 'POST' }),

  setBaseline: (id: string) =>
    api<Project>(`/projects/${id}/set-baseline`, { method: 'POST' }),

  getGantt: (id: string) =>
    api<{
      projectId: string;
      projectDurationDays: number;
      criticalPathTaskIds: string[];
      tasks: ProjectTask[];
      dependencies: any[];
    }>(`/projects/${id}/gantt`),

  getEvm: (id: string) => api<EvmMetrics>(`/projects/${id}/evm`),

  getProfitability: (id: string) => api<ProfitabilityReport>(`/projects/${id}/profitability`),

  getBudgetVsActual: (id: string) => api<any[]>(`/projects/${id}/budget-vs-actual`),

  listTasks: (projectId: string) => api<ProjectTask[]>(`/projects/${projectId}/tasks`),

  createTask: (projectId: string, body: Partial<ProjectTask>) =>
    api<ProjectTask>(`/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateTaskProgress: (taskId: string, progressPct: number) =>
    api<ProjectTask>(`/projects/tasks/${taskId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({ progressPct }),
    }),

  addDependency: (predecessorId: string, body: { successorId: string; type?: string; lagDays?: number }) =>
    api<any>(`/projects/tasks/${predecessorId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listTimesheets: (params?: { employeeId?: string; status?: string; weekStart?: string }) => {
    const q = new URLSearchParams();
    if (params?.employeeId) q.set('employeeId', params.employeeId);
    if (params?.status) q.set('status', params.status);
    if (params?.weekStart) q.set('weekStart', params.weekStart);
    return api<ProjectTimesheet[]>(`/projects/timesheets?${q.toString()}`);
  },

  getApprovalQueue: () => api<ProjectTimesheet[]>('/projects/timesheets/approval-queue'),

  createTimesheet: (body: any) =>
    api<ProjectTimesheet>('/projects/timesheets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  submitTimesheet: (id: string) =>
    api<ProjectTimesheet>(`/projects/timesheets/${id}/submit`, { method: 'POST' }),

  approveTimesheet: (id: string) =>
    api<ProjectTimesheet>(`/projects/timesheets/${id}/approve`, { method: 'POST' }),

  rejectTimesheet: (id: string, reason?: string) =>
    api<ProjectTimesheet>(`/projects/timesheets/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
