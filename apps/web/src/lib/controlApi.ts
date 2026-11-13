// Phase 31 client: custom fields, form rules, modules per plant, numbering, sessions, login policies, View as, API keys, health.
import { api } from './api';

type Row = Record<string, unknown>;
const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface FieldDef { id: string; page_id: string; key: string; label: string; type: string; required: boolean; options: string[]; unit_ids: string[]; in_list: boolean; in_filter: boolean; in_pdf: boolean; in_excel: boolean; active: boolean }
export interface FormRule { id: string; page_id: string; field_key: string; effect: string; role: string | null; status: string | null; unit_code: string | null }
export interface ModuleRow { id: string; page_id: string; unit_code: string; role: string | null; enabled: boolean }
export interface SessionRow { id: string; name: string; login_id: string; ip: string | null; user_agent: string | null; created_at: string; last_used_at: string | null }
export interface LoginPolicy { role_id: string; role: string; hours_from: string | null; hours_to: string | null; ip_cidrs: string[]; mfa_required: boolean; inactive_days: number | null }
export interface ApiKeyRow { id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }

export const controlApi = {
  fields: (pageId: string) => api<FieldDef[]>(`/admin/custom-fields${qs({ pageId })}`),
  addField: (b: Row) => api<FieldDef>('/admin/custom-fields', { method: 'POST', body: b }),
  updateField: (id: string, b: Row) => api<FieldDef>(`/admin/custom-fields/${id}`, { method: 'PUT', body: b }),
  rules: (pageId?: string) => api<FormRule[]>(`/admin/form-rules${qs({ pageId })}`),
  addRule: (b: Row) => api<FormRule>('/admin/form-rules', { method: 'POST', body: b }),
  deleteRule: (id: string) => api<Row>(`/admin/form-rules/${id}`, { method: 'DELETE' }),
  modules: () => api<ModuleRow[]>('/admin/module-plants'),
  setModule: (b: Row) => api<ModuleRow>('/admin/module-plants', { method: 'PUT', body: b }),
  series: () => api<Row[]>('/admin/numbering'),
  previewSeries: (b: Row) => api<{ preview: string; length: number; ok: boolean }>('/admin/numbering/preview', { method: 'POST', body: b }),
  sessions: () => api<SessionRow[]>('/admin/sessions'),
  logout: (id: string) => api<Row>(`/admin/sessions/${id}`, { method: 'DELETE' }),
  policies: () => api<LoginPolicy[]>('/admin/login-policies'),
  setPolicy: (b: Row) => api<Row>('/admin/login-policies', { method: 'PUT', body: b }),
  startViewAs: (targetUserId: string, reason: string) => api<{ id: string; banner: string; targetName: string }>('/owner/view-as', { method: 'POST', body: { targetUserId, reason } }),
  endViewAs: (id: string) => api<Row>(`/owner/view-as/${id}`, { method: 'DELETE' }),
  keys: () => api<ApiKeyRow[]>('/admin/api-keys'),
  addKey: (b: Row) => api<{ id: string; key: string }>('/admin/api-keys', { method: 'POST', body: b }),
  revokeKey: (id: string) => api<Row>(`/admin/api-keys/${id}`, { method: 'DELETE' }),
  console: () => api<Record<string, number>>('/owner/console'),
  health: () => api<{ dbMs: number; emailPending: number; queues: { name: string; failed: number; waiting: number }[]; time: string }>('/admin/health'),
  users: () => api<{ id: string; name: string; loginId: string }[]>('/users?size=100'),
  roles: () => api<{ id: string; name: string }[]>('/roles'),
  plants: () => api<{ allowed: { id: string; code: string; name: string }[] }>('/me/plants'),
};
