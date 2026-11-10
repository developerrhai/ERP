// apps/web/src/lib/biApi.ts
import { request, type RequestOptions } from './api';

async function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  const env = await request<T>(path, opts);
  return env.data;
}

export const biApi = {
  // Dashboards & KPIs
  getDepartmentDashboard: (dept: string) => api<any>(`/dashboards/department/${encodeURIComponent(dept)}`),
  getCommandCenter: () => api<any>('/command-center'),
  getKpi: (code: string) => api<any>(`/kpis/${encodeURIComponent(code)}`),

  // BI Report Builder & Datasets
  listDatasets: () => api<any[]>('/bi/datasets'),
  queryDataset: (body: any) => api<any>('/bi/query', { method: 'POST', body: JSON.stringify(body) }),
  listReports: () => api<any[]>('/bi/reports'),
  createReport: (body: any) => api<any>('/bi/reports', { method: 'POST', body: JSON.stringify(body) }),
  runReport: (id: string) => api<any>(`/bi/reports/${id}/run`, { method: 'POST' }),
  listSchedules: () => api<any[]>('/bi/schedules'),
  createSchedule: (body: any) => api<any>('/bi/schedules', { method: 'POST', body: JSON.stringify(body) }),

  // Global Search
  search: (q: string, types?: string) => {
    const p = new URLSearchParams({ q });
    if (types) p.set('types', types);
    return api<any[]>(`/search?${p.toString()}`);
  },

  // AI Copilot, Insights & Forecasts
  getAiSettings: () => api<any>('/ai/settings'),
  updateAiSettings: (body: any) => api<any>('/ai/settings', { method: 'PUT', body: JSON.stringify(body) }),
  getAiUsage: () => api<any>('/ai/usage'),
  createConversation: (body?: any) =>
    api<any>('/ai/conversations', { method: 'POST', body: JSON.stringify(body ?? {}) }),
  getConversationMessages: (id: string) => api<any[]>(`/ai/conversations/${id}`),
  askCopilot: (convId: string, content: string, datasetHint?: string) =>
    api<any>(`/ai/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, datasetHint }),
    }),
  listInsights: () => api<any[]>('/ai/insights'),
  runForecast: (body: any) => api<any>('/ai/forecasts/run', { method: 'POST', body: JSON.stringify(body) }),
  whatIf: (body: any) => api<any>('/ai/what-if', { method: 'POST', body: JSON.stringify(body) }),

  // Automation & Jobs
  listEvents: () => api<any[]>('/automation/events'),
  listRules: () => api<any[]>('/automation/rules'),
  createRule: (body: any) => api<any>('/automation/rules', { method: 'POST', body: JSON.stringify(body) }),
  activateRule: (id: string, approved = false) =>
    api<any>(`/automation/rules/${id}/activate`, { method: 'POST', body: JSON.stringify({ approved }) }),
  listRuleRuns: () => api<any[]>('/automation/runs'),
  listJobs: () => api<any[]>('/jobs'),

  // Webhooks
  listWebhooks: () => api<any[]>('/webhooks/endpoints'),
  createWebhook: (body: any) => api<any>('/webhooks/endpoints', { method: 'POST', body: JSON.stringify(body) }),
  rotateWebhookSecret: (id: string) => api<any>(`/webhooks/endpoints/${id}/rotate-secret`, { method: 'POST' }),
  listDeliveries: () => api<any[]>('/webhooks/deliveries'),

  // Communication & Payment Links
  listTemplates: () => api<any[]>('/comm/templates'),
  createTemplate: (body: any) => api<any>('/comm/templates', { method: 'POST', body: JSON.stringify(body) }),
  listConsents: () => api<any[]>('/comm/consents'),
  upsertConsent: (body: any) => api<any>('/comm/consents', { method: 'POST', body: JSON.stringify(body) }),
  listMessages: () => api<any[]>('/comm/messages'),
  sendMessage: (body: any) => api<any>('/comm/send', { method: 'POST', body: JSON.stringify(body) }),
  listPaymentLinks: () => api<any[]>('/payment-links'),
  createPaymentLink: (body: any) => api<any>('/payment-links', { method: 'POST', body: JSON.stringify(body) }),
};

