// Phase 28 client: attendance devices, agents, policies, auto actions, geo sites, live board.
import { api } from './api';

type Row = Record<string, unknown>;

export interface Device { id: string; code: string; name: string; unit_code: string; unit_id: string; connection: 'PUSH' | 'AGENT' | 'MANUAL'; serial_no: string | null; status: 'ONLINE' | 'STALE' | 'OFFLINE'; last_seen_at: string | null; last_punch_at: string | null; today_punches: number; unknown_codes: number }
export interface Agent { id: string; name: string; status: string; last_seen_at: string | null; unit_code: string }
export interface SyncLog { id: string; at: string; device: string | null; received: number; inserted: number; duplicates: number; unknown_codes: number }
export interface Policy { id: string; unit_id: string | null; unit_code: string | null; policy_key: string; enabled: boolean; params: Record<string, number | boolean>; effective_from: string }
export interface AutoAction { id: string; employee: string; emp_code: string; unit_code: string | null; action_date: string; policy_key: string; action: string; reason: string; created_at: string; reversed_at: string | null; reverse_reason: string | null }
export interface Site { id: string; unit_code: string; name: string; lat: number; lng: number; radius_m: number; active: boolean }
export interface LiveRow { unit_code: string; unit_id: string; department: string; expected: number; inside: number; pct: string | null }

export const attApi = {
  devices: () => api<Device[]>('/hr/att/devices'),
  addDevice: (b: Row) => api<Device>('/hr/att/devices', { method: 'POST', body: b }),
  agents: () => api<Agent[]>('/hr/att/agents'),
  addAgent: (b: Row) => api<{ id: string; key: string }>('/hr/att/agents', { method: 'POST', body: b }),
  syncLogs: () => api<SyncLog[]>('/hr/att/sync-logs'),
  policies: () => api<Policy[]>('/hr/att/policies'),
  setPolicy: (b: Row) => api<Policy>('/hr/att/policies', { method: 'PUT', body: b }),
  autoActions: (month?: string) => api<AutoAction[]>(`/hr/att/auto-actions${month ? `?month=${month}` : ''}`),
  reverse: (id: string, reason: string) => api<AutoAction>(`/hr/att/auto-actions/${id}/reverse`, { method: 'POST', body: { reason } }),
  sites: () => api<Site[]>('/hr/att/geo-sites'),
  addSite: (b: Row) => api<Site>('/hr/att/geo-sites', { method: 'POST', body: b }),
  live: (unit?: string) => api<LiveRow[]>(`/hr/att/live${unit ? `?unit=${unit}` : ''}`),
  punch: (b: { lat: number; lng: number; accuracy: number }) => api<Row>('/ess/punch', { method: 'POST', body: b }),
};

/** One plain-English line per policy, shown on its card. */
export function previewOf(key: string, p: Record<string, number | boolean>): string {
  switch (key) {
    case 'LATE_MARK': return `If a person is late ${p.lates ?? 3} times in a month, ${p.deductDays ?? 0.5} day is deducted.`;
    case 'MISSED_PUNCH': return `A missed punch not regularised within ${p.days ?? 3} days becomes a half day.`;
    case 'AUTO_ABSENT': return 'No punch and no leave: a provisional absence, final at the month lock.';
    case 'AUTO_LEAVE': return 'An absence is covered by leave balance as a request for approval (not final).';
    case 'AUTO_OT': return 'Work beyond the shift is sent to the manager as an overtime request.';
    case 'AUTO_COMPOFF': return 'Work on a weekly off or holiday offers a compensatory off.';
    case 'AUTO_SHIFT': return `For flexible rosters the nearest shift start within ${p.withinMinutes ?? 90} minutes is used.`;
    case 'MOBILE_PUNCH': return `Staff may punch from the phone inside a punch site (GPS better than ${p.maxAccuracyM ?? 100} m).`;
    case 'BUDDY_ALERT': return `Different codes within ${p.seconds ?? 3} seconds on one device, ${p.times ?? 3} times, alerts HR (alert only).`;
    case 'AUTO_LOCK': return `The month locks on day ${p.day ?? 2} of the next month at ${p.hour ?? 18}:00 and goes to payroll.`;
    default: return '';
  }
}

export const POLICY_TITLES: Record<string, string> = {
  LATE_MARK: 'Late-mark rule', MISSED_PUNCH: 'Missed punch', AUTO_ABSENT: 'Auto-absent', AUTO_LEAVE: 'Cover absence with leave', AUTO_OT: 'Automatic overtime request',
  AUTO_COMPOFF: 'Compensatory off offer', AUTO_SHIFT: 'Shift detection', MOBILE_PUNCH: 'Mobile punch', BUDDY_ALERT: 'Buddy-punch alert', AUTO_LOCK: 'Month auto-lock',
};
