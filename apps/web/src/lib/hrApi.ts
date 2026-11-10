// apps/web/src/lib/hrApi.ts
import { request } from './api';

export interface HrEmployee {
  id: string;
  emp_code: string;
  full_name: string;
  gender: string;
  date_of_birth: string;
  date_of_joining: string;
  mobile: string;
  personal_email?: string;
  department?: string;
  designation?: string;
  status: string;
  unit_name?: string;
  has_disability: boolean;
  biometric_pin?: string;
  created_at: string;
}

export async function getHrEmployees(params: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  const res = await request<HrEmployee[]>(`/hr/employees?${q.toString()}`);
  return { rows: res.data, total: (res.meta as any)?.total ?? res.data.length };
}

export async function getHrEmployee(id: string) {
  const res = await request<any>(`/hr/employees/${id}`);
  return res.data;
}

export async function createHrEmployee(data: any) {
  const res = await request<any>('/hr/employees', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function revealSensitiveEmployeeData(id: string, reason: string) {
  const res = await request<any>(`/hr/employees/${id}/sensitive`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getLeaveBalances(employeeId: string) {
  const res = await request<any>(`/hr/leave/balances?employeeId=${employeeId}`);
  return res.data;
}

export async function applyLeave(data: any) {
  const res = await request<any>('/hr/leave/applications', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getAttendanceDays(month: string, employeeId?: string) {
  let url = `/hr/attendance/days?month=${month}`;
  if (employeeId) url += `&employeeId=${employeeId}`;
  const res = await request<any>(url);
  return res.data;
}

export async function getExpenseClaims() {
  const res = await request<any[]>('/hr/expenses/claims');
  return res.data;
}

export async function createExpenseClaim(data: any) {
  const res = await request<any>('/hr/expenses/claims', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getEssDashboard() {
  const res = await request<any>('/hr/ess/me');
  return res.data;
}

export async function acceptPrivacyNotice(noticeId: string) {
  const res = await request<any>('/hr/ess/privacy-notice/accept', {
    method: 'POST',
    body: JSON.stringify({ notice_id: noticeId }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

