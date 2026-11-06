// Client for the Phase 5 endpoints: approval matrix, Approval Center, delegations, notifications
// and preferences (docs/phases/PHASE-05.md §6). Every verb sends If-Match (the request version) and
// an Idempotency-Key, so a double click can never approve a second level.
import { api, request } from './api';
import type { PageMeta } from '../types';

/** Fired after any approval action so the bell badge updates at once (it also polls every 60 s). */
export const BELL_REFRESH_EVENT = 'rhai:notifications-changed';
export function refreshBell(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
}

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ---- matrix --------------------------------------------------------------------------

export interface MatrixLevel {
  level: number;
  threshold: string;
  approverRoleId: string | null;
  approverRoleName: string | null;
  approverUserId: string | null;
  approverUserName: string | null;
  slaHours: number;
  escalateRoleId: string | null;
  escalateRoleName: string | null;
  escalateUserId: string | null;
  escalateUserName: string | null;
}

export interface RuleSet {
  id: string;
  department: string;
  departmentId: string;
  docType: string | null;
  docTitle: string | null;
  unitId: string | null;
  unitCode: string | null;
  noAmountLevels: number;
  active: boolean;
  version: number;
  isDefault: boolean;
  levels: MatrixLevel[];
}

export interface MatrixFilter {
  department?: string;
  docType?: string;
  unit?: string;
}

export function listMatrix(filter: MatrixFilter = {}): Promise<RuleSet[]> {
  const params = new URLSearchParams();
  if (filter.department) params.set('department', filter.department);
  if (filter.docType) params.set('docType', filter.docType);
  if (filter.unit) params.set('unit', filter.unit);
  const qs = params.toString();
  return api<RuleSet[]>(`/approval-matrix${qs ? `?${qs}` : ''}`);
}

export interface LevelInput {
  level: number;
  threshold: number;
  approverRoleId: string | null;
  approverUserId: string | null;
  slaHours: number;
  escalateRoleId: string | null;
  escalateUserId: string | null;
}

export interface SetInput {
  id?: string;
  version?: number;
  department: string;
  docType: string | null;
  unitId: string | null;
  noAmountLevels: number;
  levels: LevelInput[];
}

export function saveRuleSet(input: SetInput): Promise<RuleSet> {
  return api<RuleSet>('/approval-matrix/sets', { method: 'PUT', body: input });
}

export function deleteRuleSet(id: string): Promise<void> {
  return api<void>(`/approval-matrix/sets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface PreviewResult {
  set: { id: string; docType: string | null; unitId: string | null; version: number } | null;
  department: string;
  amount: string | null;
  levels: {
    level: number;
    threshold: string;
    approver: string | null;
    slaHours: number;
    approvers: { id: string; name: string; role: string; limit: string | null }[];
  }[];
}

export function previewMatrix(input: {
  department: string;
  docType?: string;
  unitId?: string;
  amount?: number | null;
}): Promise<PreviewResult> {
  return api<PreviewResult>('/approval-matrix/preview', { method: 'POST', body: input });
}

// ---- requests ---------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
}

export interface StepView {
  id: string;
  level: number;
  status: string;
  threshold: string;
  approver: string;
  limitRequired: string | null;
  slaHours: number;
  activatedAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  escalatedAt: string | null;
  assignees: { id: string; name: string; via: string; onBehalfOf: string | null }[];
  actedBy: Person | null;
  onBehalfOf: Person | null;
  actedAt: string | null;
  comment: string | null;
}

export interface TimelineEntry {
  id: string;
  action: string;
  level: number | null;
  actor: Person | null;
  onBehalfOf: Person | null;
  comment: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  at: string;
}

export interface ApprovalRequest {
  id: string;
  docType: string;
  moduleTitle: string;
  docId: string;
  docCode: string;
  docTitle: string;
  unitId: string;
  department: string;
  amount: string | null;
  cycle: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'WITHDRAWN' | 'CANCELLED';
  currentLevel: number;
  totalLevels: number;
  requestedBy: Person;
  requestedAt: string;
  decidedAt: string | null;
  version: number;
  waitingOn: string | null;
  dueAt: string | null;
  overdue: boolean;
  steps: StepView[];
  timeline: TimelineEntry[];
  can: { approve: boolean; reject: boolean; return: boolean; withdraw: boolean };
}

export interface Page<T> {
  rows: T[];
  meta: PageMeta;
}

async function pageOf<T>(path: string): Promise<Page<T>> {
  const res = await request<T[]>(path);
  return {
    rows: res.data,
    meta: res.meta ?? { page: 1, size: res.data.length, total: res.data.length },
  };
}

export function getInbox(q: { docType?: string; q?: string; page: number; size?: number }) {
  const p = new URLSearchParams({ page: String(q.page), size: String(q.size ?? 20) });
  if (q.docType) p.set('docType', q.docType);
  if (q.q) p.set('q', q.q);
  return pageOf<ApprovalRequest>(`/approvals/inbox?${p.toString()}`);
}

export function getRequests(q: {
  status?: string;
  docType?: string;
  department?: string;
  mine?: boolean;
  q?: string;
  page: number;
  size?: number;
}) {
  const p = new URLSearchParams({ page: String(q.page), size: String(q.size ?? 20) });
  if (q.status) p.set('status', q.status);
  if (q.docType) p.set('docType', q.docType);
  if (q.department) p.set('department', q.department);
  if (q.mine) p.set('mine', 'submitted');
  if (q.q) p.set('q', q.q);
  return pageOf<ApprovalRequest>(`/approvals/requests?${p.toString()}`);
}

export function getRequest(id: string): Promise<ApprovalRequest> {
  return api<ApprovalRequest>(`/approvals/requests/${encodeURIComponent(id)}`);
}

export interface DocApprovals {
  latest: ApprovalRequest | null;
  history: ApprovalRequest[];
}

export function getDocApprovals(docType: string, docId: string): Promise<DocApprovals> {
  return api<DocApprovals>(
    `/approvals/doc/${encodeURIComponent(docType)}/${encodeURIComponent(docId)}`,
  );
}

export interface ApprovalCounts {
  waitingForMe: number;
  submittedPending: number;
  overdue: number;
}

export function getApprovalCounts(): Promise<ApprovalCounts> {
  return api<ApprovalCounts>('/approvals/counts');
}

export type Verb = 'approve' | 'reject' | 'return' | 'withdraw';

export function decideRequest(
  request_: Pick<ApprovalRequest, 'id' | 'version'>,
  verb: Verb,
  comment?: string,
  key: string = newKey(),
): Promise<ApprovalRequest> {
  return api<ApprovalRequest>(`/approvals/requests/${encodeURIComponent(request_.id)}/${verb}`, {
    method: 'POST',
    headers: { 'If-Match': String(request_.version), 'Idempotency-Key': key },
    body: verb === 'withdraw' ? {} : { comment: comment ?? '' },
  }).then((r) => {
    refreshBell();
    return r;
  });
}

export function reassignStep(
  stepId: string,
  userId: string,
  reason: string,
): Promise<ApprovalRequest> {
  return api<ApprovalRequest>(`/approvals/steps/${encodeURIComponent(stepId)}/reassign`, {
    method: 'POST',
    headers: { 'Idempotency-Key': newKey() },
    body: { userId, reason },
  });
}

// ---- delegations -------------------------------------------------------------------------

export interface Delegation {
  id: string;
  direction: 'given' | 'received';
  fromUser: Person;
  toUser: Person;
  department: string | null;
  fromDate: string;
  toDate: string;
  reason: string | null;
  status: 'ACTIVE' | 'REVOKED';
  inEffect: boolean;
}

export const listDelegations = (): Promise<Delegation[]> =>
  api<Delegation[]>('/approvals/delegations');

export function createDelegation(input: {
  toUserId: string;
  fromDate: string;
  toDate: string;
  department?: string;
  reason?: string;
}): Promise<Delegation> {
  return api<Delegation>('/approvals/delegations', { method: 'POST', body: input });
}

export const revokeDelegation = (id: string): Promise<Delegation> =>
  api<Delegation>(`/approvals/delegations/${encodeURIComponent(id)}/revoke`, { method: 'POST' });

// ---- notifications -------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  type: string;
  severity: 'INFO' | 'ACTION' | 'WARN';
  title: string;
  body: string;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

export async function listNotifications(q: {
  unread?: boolean;
  group?: 'Approvals' | 'System';
  page: number;
  size?: number;
}): Promise<Page<NotificationItem> & { unread: number }> {
  const p = new URLSearchParams({ page: String(q.page), size: String(q.size ?? 20) });
  if (q.unread) p.set('unread', 'true');
  if (q.group) p.set('group', q.group);
  const res = await request<NotificationItem[]>(`/notifications?${p.toString()}`);
  const meta = (res.meta ?? {
    page: 1,
    size: res.data.length,
    total: res.data.length,
  }) as PageMeta & {
    unread?: number;
  };
  return { rows: res.data, meta, unread: meta.unread ?? 0 };
}

export async function getUnreadCount(): Promise<number> {
  return (await api<{ count: number }>('/notifications/unread-count')).count;
}

export const markNotificationRead = (id: string): Promise<NotificationItem> =>
  api<NotificationItem>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });

export const markAllNotificationsRead = (): Promise<{ updated: number }> =>
  api<{ updated: number }>('/notifications/read-all', { method: 'POST' });

export interface NotificationPreference {
  type: string;
  label: string;
  description: string;
  group: 'Approvals' | 'System';
  inApp: boolean;
  inAppLocked: boolean;
  email: 'OFF' | 'INSTANT' | 'DIGEST';
}

export const getNotificationPreferences = (): Promise<NotificationPreference[]> =>
  api<NotificationPreference[]>('/notification-preferences');

export function saveNotificationPreferences(
  items: { type: string; inApp: boolean; email: 'OFF' | 'INSTANT' | 'DIGEST' }[],
): Promise<NotificationPreference[]> {
  return api<NotificationPreference[]>('/notification-preferences', {
    method: 'PUT',
    body: { items },
  });
}

// ---- display helpers -------------------------------------------------------------------------

/** 75000 -> "₹ 75,000" in the Indian grouping. */
export function inr(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** "Pending L2/4 · Department Head" for the chip on a document. */
export function pendingChip(req: ApprovalRequest | null | undefined): string | null {
  if (!req || req.status !== 'PENDING') return null;
  const step = req.steps.find((s) => s.status === 'PENDING');
  return `Pending L${req.currentLevel}/${req.totalLevels}${step ? ` · ${step.approver}` : ''}`;
}

export const STATUS_LABEL: Record<ApprovalRequest['status'], string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
};

export const ACTION_LABEL: Record<string, string> = {
  SUBMIT: 'Submitted',
  AUTO_APPROVED: 'Auto-approved (no approval needed)',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  RETURN: 'Returned for changes',
  WITHDRAW: 'Withdrawn',
  ESCALATE: 'Escalated (overdue)',
  REMIND: 'Reminder sent',
  REASSIGN: 'Reassigned',
  CANCEL: 'Cancelled',
};

/** Colleagues the caller may delegate to (any signed-in user, not only administrators). */
export function searchDelegationTargets(q: string): Promise<Person[]> {
  return api<Person[]>(`/approvals/delegation-targets?q=${encodeURIComponent(q)}`);
}
