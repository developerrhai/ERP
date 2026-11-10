// apps/web/src/lib/serviceApi.ts
import { request, type RequestOptions } from './api';

async function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  const env = await request<T>(path, opts);
  return env.data;
}

export interface ServiceTicket {
  id: string;
  ticket_no: string;
  customer_id: string;
  customer_name?: string;
  contact_person?: string;
  contact_phone?: string;
  site_address: string;
  serial_number_id?: string;
  serial_number?: string;
  item_name?: string;
  subject: string;
  category: 'BREAKDOWN' | 'INSTALLATION' | 'PM' | 'COMPLAINT';
  channel: string;
  impact: number;
  urgency: number;
  priority: number;
  sla_state: 'ACTIVE' | 'PAUSED' | 'WARNING' | 'BREACHED' | 'MET';
  entitlement: 'WARRANTY' | 'AMC' | 'CHARGEABLE';
  assigned_technician_id?: string;
  technician_name?: string;
  status: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'AWAITING_CUSTOMER' | 'AWAITING_PARTS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';
  response_due_at?: string;
  resolution_due_at?: string;
  first_response_at?: string;
  resolved_at?: string;
  events?: any[];
}

export interface ServiceVisit {
  id: string;
  visit_no: string;
  ticket_id?: string;
  ticket_no?: string;
  ticket_subject?: string;
  customer_name?: string;
  site_address: string;
  technician_name?: string;
  scheduled_start: string;
  scheduled_end: string;
  check_in_at?: string;
  check_out_at?: string;
  travel_km: number;
  findings?: string;
  action_taken?: string;
  signatory_name?: string;
  status: 'SCHEDULED' | 'EN_ROUTE' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  spares?: any[];
}

export interface AmcContract {
  id: string;
  contract_no: string;
  customer_id: string;
  customer_name?: string;
  coverage: 'COMPREHENSIVE' | 'NON_COMPREHENSIVE';
  start_date: string;
  end_date: string;
  visit_frequency: string;
  contract_value: number;
  billing_frequency: string;
  status: 'DRAFT' | 'ACTIVE' | 'TERMINATED' | 'EXPIRED';
  asset_count?: number;
  assets?: any[];
  visitSchedule?: any[];
  billingSchedule?: any[];
  revenueSchedule?: any[];
}

export interface WarrantyCheck {
  serial: string;
  serialId?: string;
  itemCode?: string;
  itemName?: string;
  customerName?: string;
  customerId?: string;
  warrantyStart?: string;
  warrantyEnd?: string;
  result: 'IN_WARRANTY' | 'AMC_COVERED' | 'OUT_OF_WARRANTY' | 'CONDITIONAL';
  reasons: string[];
}

export const serviceApi = {
  listTickets: (params?: { status?: string; customerId?: string; technicianId?: string; priority?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.technicianId) q.set('technicianId', params.technicianId);
    if (params?.priority) q.set('priority', String(params.priority));
    return api<{ rows: ServiceTicket[]; total: number }>(`/service/tickets?${q.toString()}`);
  },

  getTicket: (id: string) => api<ServiceTicket>(`/service/tickets/${id}`),

  createTicket: (body: any) =>
    api<ServiceTicket>('/service/tickets', { method: 'POST', body: JSON.stringify(body) }),

  assignTicket: (id: string, technicianId: string) =>
    api<ServiceTicket>(`/service/tickets/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ technicianId }),
    }),

  autoAssignTicket: (id: string) =>
    api<ServiceTicket>(`/service/tickets/${id}/auto-assign`, { method: 'POST' }),

  respondTicket: (id: string) =>
    api<ServiceTicket>(`/service/tickets/${id}/respond`, { method: 'POST' }),

  pauseTicket: (id: string, pauseStatus: 'AWAITING_CUSTOMER' | 'AWAITING_PARTS', reason?: string) =>
    api<ServiceTicket>(`/service/tickets/${id}/pause`, {
      method: 'POST',
      body: JSON.stringify({ pauseStatus, reason }),
    }),

  resumeTicket: (id: string) =>
    api<ServiceTicket>(`/service/tickets/${id}/resume`, { method: 'POST' }),

  resolveTicket: (id: string, notes?: string) =>
    api<ServiceTicket>(`/service/tickets/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  closeTicket: (id: string, rating?: number) =>
    api<ServiceTicket>(`/service/tickets/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ rating }),
    }),

  getTechnicianBoard: () =>
    api<{ unassignedTickets: ServiceTicket[]; lanes: Array<{ technician: any; assignedTickets: ServiceTicket[] }> }>(
      '/service/technicians/board',
    ),

  listVisits: (params?: { technicianId?: string; date?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.technicianId) q.set('technicianId', params.technicianId);
    if (params?.date) q.set('date', params.date);
    if (params?.status) q.set('status', params.status);
    return api<ServiceVisit[]>(`/service/visits?${q.toString()}`);
  },

  getVisit: (id: string) => api<ServiceVisit>(`/service/visits/${id}`),

  createVisit: (body: any) =>
    api<ServiceVisit>('/service/visits', { method: 'POST', body: JSON.stringify(body) }),

  startTravel: (id: string) =>
    api<ServiceVisit>(`/service/visits/${id}/start-travel`, { method: 'POST' }),

  checkIn: (id: string, body: { lat?: number; lng?: number; travelKm?: number }) =>
    api<ServiceVisit>(`/service/visits/${id}/check-in`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveChecklist: (id: string, body: any) =>
    api<ServiceVisit>(`/service/visits/${id}/checklist`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  issueSpares: (visitId: string, body: any) =>
    api<any>(`/service/visits/${visitId}/spares`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  consumeSpares: (visitId: string, issueId: string, lines: any[]) =>
    api<any>(`/service/visits/${visitId}/consume-spares`, {
      method: 'POST',
      body: JSON.stringify({ issueId, lines }),
    }),

  signAndComplete: (id: string, body: { signatoryName: string; signatureDocId?: string; findings?: string; actionTaken?: string }) =>
    api<ServiceVisit>(`/service/visits/${id}/sign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listAmc: (params?: { customerId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.status) q.set('status', params.status);
    return api<{ rows: AmcContract[]; total: number }>(`/service/amc-contracts?${q.toString()}`);
  },

  getAmc: (id: string) => api<AmcContract>(`/service/amc-contracts/${id}`),

  createAmc: (body: any) =>
    api<AmcContract>('/service/amc-contracts', { method: 'POST', body: JSON.stringify(body) }),

  approveAmc: (id: string) =>
    api<AmcContract>(`/service/amc-contracts/${id}/approve`, { method: 'POST' }),

  activateAmc: (id: string) =>
    api<AmcContract>(`/service/amc-contracts/${id}/activate`, { method: 'POST' }),

  recogniseRevenue: (id: string, period: string) =>
    api<any>(`/service/amc-contracts/${id}/recognise-revenue`, {
      method: 'POST',
      body: JSON.stringify({ period }),
    }),

  getAmcProfitability: (id: string) =>
    api<any>(`/service/amc-contracts/${id}/profitability`),

  checkWarranty: (serial: string, date?: string) => {
    const q = new URLSearchParams({ serial });
    if (date) q.set('date', date);
    return api<WarrantyCheck>(`/service/warranties/check?${q.toString()}`);
  },

  listWarranties: (params?: { customerId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.status) q.set('status', params.status);
    return api<{ rows: any[]; total: number }>(`/service/warranties?${q.toString()}`);
  },

  listClaims: (params?: { customerId?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.status) q.set('status', params.status);
    return api<any[]>(`/service/warranty-claims?${q.toString()}`);
  },

  createClaim: (body: any) =>
    api<any>('/service/warranty-claims', { method: 'POST', body: JSON.stringify(body) }),

  inspectClaim: (id: string, body: any) =>
    api<any>(`/service/warranty-claims/${id}/inspect`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  claimSupplier: (id: string, body: any) =>
    api<any>(`/service/warranty-claims/${id}/claim-supplier`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  settleClaim: (id: string, body: any) =>
    api<any>(`/service/warranty-claims/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getServiceHistory: (params?: { serialNumberId?: string; customerId?: string }) => {
    const q = new URLSearchParams();
    if (params?.serialNumberId) q.set('serialNumberId', params.serialNumberId);
    if (params?.customerId) q.set('customerId', params.customerId);
    return api<any[]>(`/service/service-history?${q.toString()}`);
  },
};
