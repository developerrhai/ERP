// apps/web/src/lib/hrApi.ts
import { api, request } from './api';

export interface HrEmployee {
  id: string;
  empCode: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  gender: string;
  dob: string;
  joiningDate: string;
  mobile: string;
  personalEmail?: string | null;
  officialEmail?: string | null;
  department?: string | null;
  designationId?: string | null;
  designationName?: string | null;
  unitId?: string | null;
  unitName?: string | null;
  status: string;
  biometricCode?: string | null;
  pan?: string | null;
  aadhaarLast4?: string | null;
  uan?: string | null;
  esicIp?: string | null;
  createdAt?: string;
}

export interface CreateHrEmployeeInput {
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dob: string;
  joiningDate: string;
  mobile: string;
  personalEmail?: string;
  pan?: string;
  aadhaar?: string;
  unitId: string;
  department: string;
}

export async function getHrEmployees(params: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  const res = await request<HrEmployee[]>(`/hr/employees?${q.toString()}`);
  return { rows: res.data, total: (res.meta as { total?: number } | undefined)?.total ?? res.data.length };
}

export async function getHrEmployee(id: string) {
  return api<HrEmployee>(`/hr/employees/${encodeURIComponent(id)}`);
}

export async function createHrEmployee(data: CreateHrEmployeeInput) {
  return api<HrEmployee>('/hr/employees', {
    method: 'POST',
    body: data,
  });
}

export async function revealSensitiveEmployeeData(
  id: string,
  field: 'aadhaar' | 'bankAccount',
  purpose: string,
) {
  return api<{ value: string }>(`/hr/employees/${encodeURIComponent(id)}/reveal`, {
    method: 'POST',
    body: { field, purpose },
  });
}

export async function getLeaveBalances(employeeId: string) {
  const res = await request<any>(`/hr/leave/balances?employeeId=${employeeId}`);
  return res.data;
}

export async function applyLeave(data: any) {
  const res = await request<any>('/hr/leave/applications', {
    method: 'POST',
    body: data,
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
    body: data,
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
    body: { notice_id: noticeId },
  });
  return res.data;
}
