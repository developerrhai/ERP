// apps/web/src/lib/payrollApi.ts
import { request } from './api';

export interface PayComponent {
  id: string;
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIB';
  calc_type: 'FIXED' | 'FORMULA' | 'ATTENDANCE' | 'INPUT' | 'STATUTORY';
  formula?: string;
  prorate: boolean;
  taxable: boolean;
  code_wage_class: 'INCLUDED' | 'EXCLUDED';
  payslip_order: number;
  payslip_label_hi?: string;
  gl_key: string;
  active: boolean;
}

export interface PayrollPeriod {
  id: string;
  month: string;
  start_date: string;
  end_date: string;
  days_basis: number;
  status: 'OPEN' | 'CLOSED';
}

export interface PayrollRun {
  id: string;
  run_no: string;
  period_id: string;
  period_month: string;
  unit_name?: string;
  run_type: string;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_employer_cost: number;
  employee_count: number;
  journal_id?: string;
  created_at: string;
}

export async function getPayComponents() {
  const res = await request<PayComponent[]>('/payroll/components');
  return res.data;
}

export async function createPayComponent(data: any) {
  const res = await request<any>('/payroll/components', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getPayStructures() {
  const res = await request<any[]>('/payroll/structures');
  return res.data;
}

export async function createPayStructure(data: any) {
  const res = await request<any>('/payroll/structures', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function assignSalary(data: any) {
  const res = await request<any>('/payroll/assignments', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getStatutoryRates() {
  const res = await request<any[]>('/payroll/statutory-rates');
  return res.data;
}

export async function reviewStatutoryRate(id: string) {
  const res = await request<any>(`/payroll/statutory-rates/${id}/review`, {
    method: 'PATCH',
  });
  return res.data;
}

export async function getPayrollPeriods() {
  const res = await request<PayrollPeriod[]>('/payroll/periods');
  return res.data;
}

export async function createPayrollPeriod(data: any) {
  const res = await request<any>('/payroll/periods', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getPayrollRuns(params: { period_id?: string; unit_id?: string } = {}) {
  const q = new URLSearchParams();
  if (params.period_id) q.set('period_id', params.period_id);
  if (params.unit_id) q.set('unit_id', params.unit_id);
  const res = await request<PayrollRun[]>(`/payroll/runs?${q.toString()}`);
  return res.data;
}

export async function getPayrollRun(id: string) {
  const res = await request<any>(`/payroll/runs/${id}`);
  return res.data;
}

export async function createPayrollRun(data: any) {
  const res = await request<any>('/payroll/runs', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function calculatePayrollRun(id: string) {
  const res = await request<any>(`/payroll/runs/${id}/calculate`, {
    method: 'POST',
  });
  return res.data;
}

export async function lockPayrollRun(id: string) {
  const res = await request<any>(`/payroll/runs/${id}/lock`, {
    method: 'POST',
  });
  return res.data;
}

export async function postPayrollRun(id: string) {
  const res = await request<any>(`/payroll/runs/${id}/post`, {
    method: 'POST',
  });
  return res.data;
}

export async function getBankTemplates() {
  const res = await request<any[]>('/payroll/bank-templates');
  return res.data;
}

export async function getBankBatches(runId?: string) {
  const url = runId ? `/payroll/bank-batches?run_id=${runId}` : '/payroll/bank-batches';
  const res = await request<any[]>(url);
  return res.data;
}

export async function generateBankBatch(data: { payroll_run_id: string; bank_template_id: string }) {
  const res = await request<any>('/payroll/bank-batches/generate', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

export async function getPayslip(runEmployeeId: string) {
  const res = await request<any>(`/payroll/payslips/${runEmployeeId}`);
  return res.data;
}

export async function releasePayslips(runId: string) {
  const res = await request<any>(`/payroll/runs/${runId}/payslips/release`, {
    method: 'POST',
  });
  return res.data;
}

