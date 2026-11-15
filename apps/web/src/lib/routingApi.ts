// Phase 41 client: /api/v1/routing (plant route builder, live multi-unit routing, BOM & material approval, material transfer note).
// Quantities arrive as decimal strings; every row is read from the database.
import { api } from './api';

const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const post = <T>(path: string, body: unknown = {}) => api<T>(`/routing${path}`, { method: 'POST', body });

export interface Unit {
  id: string;
  code: string;
  name: string;
}
export interface Dept {
  id: string;
  name: string;
}
export interface RouteStep {
  id?: string;
  seq?: number;
  unitId: string;
  unitCode?: string;
  unitName?: string;
  processName: string;
  departmentId: string | null;
  department?: string | null;
  workCentreId: string | null;
  workCentreName?: string | null;
  stdHours: string | null;
  qcRequired: boolean;
  approvalRequired: boolean;
  movementType?: string;
}
export interface RouteRow {
  id: string;
  code: string;
  name: string;
  itemOrFamily: string | null;
  active: boolean;
  stepCount: number;
  jobCount: number;
}
export interface RouteCards {
  templates: number;
  steps: number;
  activeDeptHandover: number;
  physicalMoves: number;
}
export interface RouteDetail {
  id: string;
  code: string;
  name: string;
  itemOrFamily: string | null;
  active: boolean;
  steps: RouteStep[];
}
export interface RouteSave {
  code?: string;
  name: string;
  itemOrFamily: string | null;
  active?: boolean;
  steps: {
    unitId: string;
    processName: string;
    departmentId: string | null;
    workCentreId: string | null;
    stdHours: number | null;
    qcRequired: boolean;
    approvalRequired: boolean;
  }[];
}
export interface PlantCard extends Unit {
  processes: string[];
  jobs: number;
  wipBalance: string;
}
export interface LiveRow {
  id: string;
  orderId: string;
  jobNo: string;
  partCode: string;
  partName: string;
  routeCode: string;
  currentStep: number;
  currentProcess: string;
  currentUnitCode: string;
  currentUnitName: string;
  nextProcess: string | null;
  nextUnitName: string | null;
  planned: string;
  good: string;
  rejected: string;
  scrap: string;
  transferred: string;
  balance: string;
  yield: string | null;
  routeStatus: string;
  qualityApproval: string | null;
  dcStatus: string | null;
  transferNo: string | null;
  transferStatus: string | null;
}
export interface FlowLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: string;
  requiredQty: string;
  availableQty: string;
  shortageQty: string;
}
export interface Flow {
  id: string;
  flowNo: string;
  unitCode: string;
  salesOrderNo: string | null;
  bomNumber: string | null;
  partCode: string | null;
  partName: string | null;
  bomRevision: string | null;
  qty: string | null;
  salesApproval: 'PENDING' | 'APPROVED' | 'REJECTED';
  purchaseStatus: string;
  manufacturingRelease: boolean;
  status: string;
  prId: string | null;
  prNumber: string | null;
  salesApprovedBy: string | null;
  salesApprovedAt: string | null;
  releasedBy: string | null;
  releasedAt: string | null;
  lineCount: number;
  shortLines: number;
  lines?: FlowLine[];
}
export interface FlowTrace {
  flow: Flow;
  events: { action: string; at: string; actor: string | null }[];
  orders: { id: string; number: string; status: string; qty: string }[];
}
export interface Note {
  id: string;
  noteNo: string;
  jobCardNo: string | null;
  partCode: string | null;
  partName: string | null;
  fromUnitCode: string | null;
  fromUnitName: string | null;
  fromProcess: string | null;
  toUnitCode: string | null;
  toUnitName: string | null;
  toProcess: string | null;
  transferDate: string;
  sentQty: string;
  receivedQty: string | null;
  shortQty: string;
  shortReason: string | null;
  receiptStatus: 'PENDING' | 'RECEIVED' | 'SHORT';
  stockState: 'NONE' | 'IN_TRANSIT' | 'RECEIVED' | 'RETURNED';
  vehiclePerson: string | null;
  sentBy: string | null;
  receivedBy: string | null;
  reconciledAt: string | null;
  openDisputes: number;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  itemId: string | null;
}
export interface Dispute {
  id: string;
  disputeNo: string;
  noteNo: string;
  qty: string;
  reason: string;
  status: 'OPEN' | 'RETURNED';
  createdBy: string | null;
  createdAt: string;
  resolutionNote: string | null;
}
export interface AuditEvent {
  id: string;
  action: string;
  at: string;
  actor: string | null;
  noteNo: string;
}
export interface NoteOptions {
  units: Unit[];
  warehouses: { id: string; code: string; name: string; unitId: string }[];
  items: { id: string; code: string; name: string; baseUom: string }[];
  defaultUnitId: string | null;
}
export interface NoteCards {
  pendingReceipt: number;
  inTransit: number;
  received: number;
  openDisputes: number;
}
export interface NoteCreate {
  toUnitId: string;
  quantity: string;
  itemId: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  jobCardNo: string | null;
  vehiclePerson: string | null;
  remarks: string | null;
  dispatch: boolean;
}

export const routingApi = {
  lookups: () => api<{ units: Unit[]; departments: Dept[] }>('/routing/lookups'),
  workCentres: (unitId: string) => api<{ id: string; code: string; name: string }[]>(`/routing/work-centres${qs({ unitId })}`),
  routes: () => api<{ routes: RouteRow[]; cards: RouteCards }>('/routing/routes'),
  route: (id: string) => api<RouteDetail>(`/routing/routes/${id}`),
  createRoute: (b: RouteSave) => post<RouteDetail>('/routes', b),
  updateRoute: (id: string, b: RouteSave) => api<RouteDetail>(`/routing/routes/${id}`, { method: 'PUT', body: b }),
  duplicateRoute: (id: string) => post<RouteDetail>(`/routes/${id}/duplicate`),
  deleteRoute: (id: string) => api<{ deleted: boolean; deactivated: boolean }>(`/routing/routes/${id}`, { method: 'DELETE' }),
  resetSketch: () => post<RouteDetail>('/routes/reset-sketch'),

  plants: () => api<PlantCard[]>('/routing/plants'),
  live: (p: { view?: string; unitId?: string; q?: string } = {}) => api<LiveRow[]>(`/routing/live${qs(p)}`),
  assignable: () => api<{ orders: { id: string; number: string; partName: string; qty: string }[]; routes: { id: string; code: string; name: string }[] }>('/routing/assignable'),
  assign: (orderId: string, routeId: string) => post<{ id: string }>('/job-routes', { orderId, routeId }),
  record: (id: string, b: { good?: number; scrap?: number; rejected?: number }) => post<{ balance: string }>(`/job-routes/${id}/record`, b),
  advance: (id: string) => post<{ routeStatus: string; transferNo: string | null }>(`/job-routes/${id}/advance`),

  flowOptions: () => api<{ boms: { id: string; number: string | null; versionNo: number; itemCode: string; itemName: string }[]; salesOrders: { id: string; number: string }[] }>('/routing/bom-flows/options'),
  flows: (p: { tab?: string; q?: string } = {}) => api<Flow[]>(`/routing/bom-flows${qs(p)}`),
  flow: (id: string) => api<Flow>(`/routing/bom-flows/${id}`),
  trace: (id: string) => api<FlowTrace>(`/routing/bom-flows/${id}/trace`),
  createFlow: (b: { bomId: string; qty: string; salesOrderId: string | null }) => post<Flow>('/bom-flows', b),
  verify: (id: string) => post<Flow>(`/bom-flows/${id}/verify`),
  salesDecision: (id: string, approve: boolean) => post<Flow>(`/bom-flows/${id}/sales-decision`, { approve }),
  raisePr: (id: string) => post<Flow & { pr: { id: string; number: string } }>(`/bom-flows/${id}/raise-pr`),
  release: (id: string) => post<Flow>(`/bom-flows/${id}/release`),

  noteOptions: () => api<NoteOptions>('/routing/transfers/options'),
  noteCards: () => api<NoteCards>('/routing/transfers/cards'),
  notes: (p: { tab?: string; q?: string } = {}) => api<Note[]>(`/routing/transfers${qs(p)}`),
  disputes: () => api<Dispute[]>('/routing/transfers/disputes'),
  noteAudit: () => api<AuditEvent[]>('/routing/transfers/audit'),
  createNote: (b: NoteCreate) => post<{ id: string; noteNo: string }>('/transfers', b),
  sendNote: (id: string) => post<Note>(`/transfers/${id}/send`),
  receiveNote: (id: string, b: { receivedQty?: string; shortReason?: string | null }) => post<Note>(`/transfers/${id}/receive`, b),
  reconcileNote: (id: string, note?: string) => post<Note>(`/transfers/${id}/reconcile`, { note: note ?? null }),
};
