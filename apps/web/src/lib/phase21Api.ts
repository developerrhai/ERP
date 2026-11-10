import { api } from './api';

export type NotifyChannel = 'IN_APP' | 'PUSH' | 'EMAIL' | 'SMS';
export type NotifyPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type NotifyCategory =
  | 'APPROVAL'
  | 'ALERT'
  | 'DOCUMENT'
  | 'ANNOUNCEMENT'
  | 'SECURITY'
  | 'REMINDER'
  | 'DIGEST'
  | 'MARKETING';

export interface NotificationV2Item {
  id: string;
  type: string;
  typeCode: string | null;
  category?: NotifyCategory;
  priority: NotifyPriority;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  seq?: string;
  createdAt: string;
  readAt: string | null;
  archivedAt?: string | null;
}

export interface UserPrefRow {
  code: string;
  module: string;
  category: NotifyCategory;
  label: string;
  labelHi: string;
  priority: NotifyPriority;
  enabled: boolean;
  digestAllowed: boolean;
  channels: Record<
    NotifyChannel,
    { allowed: boolean; mandatory: boolean; enabled: boolean; mode: 'IMMEDIATE' | 'DIGEST' }
  >;
}

export interface ActiveBroadcastBanner {
  id: string;
  number: string;
  title: string;
  body_md: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  pin_banner: boolean;
  require_ack: boolean;
  sent_at: string | null;
  expires_at: string | null;
  read_at: string | null;
  acked_at: string | null;
}

export const phase21Api = {
  listNotificationsCursor(params: {
    unread?: boolean;
    category?: NotifyCategory;
    cursor?: string;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params.unread !== undefined) qs.set('unread', String(params.unread));
    if (params.category) qs.set('category', params.category);
    if (params.cursor) qs.set('cursor', params.cursor);
    qs.set('limit', String(params.limit ?? 20));
    return api<NotificationV2Item[]>(`/notifications?${qs.toString()}`);
  },
  markNotificationsRead(body: { ids?: string[]; all?: boolean }) {
    return api<{ updated: number }>('/notifications/read', { method: 'POST', body });
  },
  archiveNotification(id: string) {
    return api<{ ok: boolean }>(`/notifications/${id}/archive`, { method: 'POST' });
  },

  getMyPrefs() {
    return api<UserPrefRow[]>('/me/notification-prefs');
  },
  saveMyPrefs(
    items: { typeCode: string; channel: NotifyChannel; enabled: boolean; mode?: 'IMMEDIATE' | 'DIGEST' }[],
  ) {
    return api<UserPrefRow[]>('/me/notification-prefs', { method: 'PUT', body: { items } });
  },
  getMySettings() {
    return api<{
      quietStart: string;
      quietEnd: string;
      quietCustomised: boolean;
      digestEnabled: boolean;
      language: 'en' | 'hi';
      softAskDismissedAt: string | null;
    }>('/me/notification-settings');
  },
  saveMySettings(patch: {
    quietStart?: string | null;
    quietEnd?: string | null;
    digestEnabled?: boolean;
    language?: 'en' | 'hi';
    dismissSoftAsk?: boolean;
  }) {
    return api('/me/notification-settings', { method: 'PUT', body: patch });
  },

  getVapidPublicKey() {
    return api<{ publicKey: string | null }>('/push/vapid-public-key');
  },
  subscribePush(body: {
    endpoint: string;
    p256dh: string;
    auth: string;
    platform: 'ANDROID' | 'IOS' | 'DESKTOP' | 'OTHER';
    browser: string;
    deviceLabel?: string;
    standalone?: boolean;
  }) {
    return api('/push/subscriptions', { method: 'POST', body });
  },
  listMyDevices() {
    return api<
      {
        id: string;
        platform: string;
        browser: string;
        device_label: string;
        standalone: boolean;
        created_at: string;
        last_success_at: string | null;
        failure_count: number;
      }[]
    >('/me/devices');
  },
  renameDevice(id: string, label: string) {
    return api(`/me/devices/${id}`, { method: 'PATCH', body: { label } });
  },
  revokeDevice(id: string) {
    return api<{ ok: boolean }>(`/me/devices/${id}`, { method: 'DELETE' });
  },
  sendTestPush() {
    return api<{ sent: number; failed: number; revoked: number }>('/push/test', { method: 'POST' });
  },

  // Active Broadcasts
  listActiveBroadcasts() {
    return api<ActiveBroadcastBanner[]>('/broadcasts/active');
  },
  acknowledgeBroadcast(id: string) {
    return api<{ ok: boolean }>(`/broadcasts/${id}/ack`, { method: 'POST' });
  },

  // Admin: Notification Types & Settings
  listAdminTypes() {
    return api<any[]>('/admin/notification-types');
  },
  updateAdminType(code: string, patch: Record<string, unknown>) {
    return api(`/admin/notification-types/${code}`, { method: 'PATCH', body: patch });
  },
  testAdminType(code: string) {
    return api<{ sentCount: number }>(`/admin/notification-types/${code}/test`, { method: 'POST' });
  },
  getAdminSettings() {
    return api<any>('/admin/notification-settings');
  },
  updateAdminSettings(patch: Record<string, unknown>) {
    return api('/admin/notification-settings', { method: 'PUT', body: patch });
  },
  resetAdminSettings() {
    return api('/admin/notification-settings/reset', { method: 'POST' });
  },

  // Admin: Broadcasts
  listBroadcasts() {
    return api<any[]>('/admin/broadcasts');
  },
  previewAudience(audience: Record<string, unknown>) {
    return api<{ count: number; byUnit: { unitCode: string; count: number }[] }>(
      '/admin/broadcasts/preview-audience',
      { method: 'POST', body: audience },
    );
  },
  createBroadcast(body: Record<string, unknown>) {
    return api<any>('/admin/broadcasts', { method: 'POST', body });
  },
  submitBroadcast(id: string) {
    return api<any>(`/admin/broadcasts/${id}/submit`, { method: 'POST' });
  },
  approveBroadcast(id: string, comment?: string) {
    return api<any>(`/admin/broadcasts/${id}/approve`, { method: 'POST', body: { comment } });
  },
  sendBroadcastNow(id: string) {
    return api<any>(`/admin/broadcasts/${id}/send-now`, { method: 'POST' });
  },
  cancelBroadcast(id: string, reason?: string) {
    return api<any>(`/admin/broadcasts/${id}/cancel`, { method: 'POST', body: { reason } });
  },
  withdrawBroadcast(id: string, reason?: string) {
    return api<any>(`/admin/broadcasts/${id}/withdraw`, { method: 'POST', body: { reason } });
  },
  getBroadcastReport(id: string) {
    return api<{
      broadcast: any;
      totals: { delivered: number; read: number; acked: number };
      byUnit: { unit_code: string; delivered: number; read: number; acked: number }[];
    }>(`/admin/broadcasts/${id}/report`);
  },

  // Admin: Email Rules, Doc Send, Logs, Suppressions, Health
  listEmailRules() {
    return api<any[]>('/admin/email-rules');
  },
  updateEmailRule(id: string, patch: Record<string, unknown>) {
    return api<any>(`/admin/email-rules/${id}`, { method: 'PATCH', body: patch });
  },
  previewDocEmail(docType: string, docId: string) {
    return api<{
      docType: string;
      docId: string;
      docNo: string;
      to: string[];
      cc: string[];
      subject: string;
      html: string;
      attachmentFilename: string;
    }>(`/documents/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}/email-preview`);
  },
  sendDocEmail(
    docType: string,
    docId: string,
    body: { to: string[]; cc?: string[]; message?: string; attachMode?: 'ATTACH' | 'LINK' | 'AUTO' },
  ) {
    return api(`/documents/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}/email`, {
      method: 'POST',
      body,
    });
  },
  listCommMessages(params?: { channel?: string; doc?: string }) {
    const qs = new URLSearchParams();
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.doc) qs.set('doc', params.doc);
    return api<any[]>(`/comm/messages?${qs.toString()}`);
  },
  resendCommMessage(id: string, body: { to?: string[]; cc?: string[]; reason: string }) {
    return api(`/comm/messages/${id}/resend`, { method: 'POST', body });
  },
  listSuppressions(all = false) {
    return api<any[]>(`/admin/email-suppressions?all=${String(all)}`);
  },
  addSuppression(email: string, reason: 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL' | 'UNSUBSCRIBE') {
    return api('/admin/email-suppressions', { method: 'POST', body: { email, reason } });
  },
  removeSuppression(email: string, note?: string) {
    return api(`/admin/email-suppressions/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      body: { note },
    });
  },
  getHealth() {
    return api<any>('/admin/notif-health');
  },
};

