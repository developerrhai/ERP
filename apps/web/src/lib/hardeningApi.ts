// Phase 20 Hardening Frontend API client (DPDP Privacy, Cut-Over, Audit Partitions, User Locale).
import { request, type RequestOptions } from './api';

async function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  const env = await request<T>(path, opts);
  return env.data;
}

export interface PrivacyNoticeDto {
  id: string;
  version: string;
  locale: 'en' | 'hi' | 'mr';
  localizedTitle: string;
  localizedTextMd: string;
  grievanceOfficerName: string;
  grievanceOfficerEmail: string;
  grievanceOfficerPhone: string;
  needsReview: boolean;
  accepted: boolean;
  acceptedAt: string | null;
}

export const hardeningApi = {
  getLocale: () => api<{ locale: 'en' | 'hi' }>('/me/locale'),
  setLocale: (locale: 'en' | 'hi') =>
    api<{ locale: 'en' | 'hi' }>('/me/locale', { method: 'PUT', body: { locale } }),

  getPrivacyNotice: (locale: 'en' | 'hi' | 'mr' = 'en') =>
    api<PrivacyNoticeDto>(`/hardening/privacy/notice?locale=${encodeURIComponent(locale)}`),
  acknowledgePrivacy: (noticeId: string) =>
    api<{ accepted: boolean }>('/hardening/privacy/acknowledge', {
      method: 'POST',
      body: { noticeId },
    }),

  listDpdpRequests: (status?: string) =>
    api<any[]>(`/hardening/privacy/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  createDpdpRequest: (body: any) =>
    api<any>('/hardening/privacy/requests', { method: 'POST', body }),
  updateDpdpRequest: (id: string, body: any) =>
    api<any>(`/hardening/privacy/requests/${id}`, { method: 'PATCH', body }),
  listRetentionPolicies: () => api<any[]>('/hardening/privacy/retention'),
  runRetentionSweep: () => api<any>('/hardening/privacy/retention/run', { method: 'POST' }),

  getAuditPartitions: () => api<{ partitions: any[]; defaultRows: number }>('/hardening/audit-partitions'),
  maintainAuditPartitions: () => api<any>('/hardening/audit-partitions/maintain', { method: 'POST' }),

  getCutoverTemplate: (dataset: string) => api<any>(`/hardening/cutover/templates/${dataset}`),
  listCutoverBatches: () => api<any[]>('/hardening/cutover/batches'),
  runCutoverDryRun: (body: any) =>
    api<any>('/hardening/cutover/dry-run', { method: 'POST', body }),
  commitCutoverBatch: (batchId: string) =>
    api<any>(`/hardening/cutover/${batchId}/commit`, { method: 'POST' }),
  signOffCutoverBatch: (batchId: string, body: any) =>
    api<any>(`/hardening/cutover/${batchId}/signoff`, { method: 'POST', body }),
};

