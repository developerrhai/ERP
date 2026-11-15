// V40 Integrated Plant Flow client: GET /work/plant-flow/:projectId (one project's gates, movements and counters).
import { api } from './api';

export interface FlowGate {
  id: string;
  seq: number;
  code: string;
  name: string;
  state: 'LOCKED' | 'OPEN' | 'IN_WORK' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  ownerDepartmentId: string | null;
  ownerDepartment: string | null;
  exitCriteria: string | null;
  deliverableName: string | null;
  linkedPage: string | null;
  dependsOn: string[];
  dueDate: string | null;
  approvedAt: string | null;
  nextGateCode: string | null;
  nextGateDepartment: string | null;
}

export interface FlowMovement {
  id: string;
  number: string;
  doc_type: string;
  doc_id: string;
  doc_no: string | null;
  state: string;
  work_status: string;
  sent_at: string;
  from_department_id: string;
  from_department: string;
  to_department_id: string;
  to_department: string;
  open: boolean;
}

export interface PlantFlow {
  project: { id: string; code: string; name: string; customer: string | null; status: string; salesOrder: string | null; manufacturingOrder: string | null; purchaseOrder: string | null };
  progress: { gatesTotal: number; gatesDone: number; progressPct: number | null };
  pendingReceipt: number;
  pendingAcceptance: number;
  openMovements: number;
  currentDepartment: { id: string; name: string } | null;
  currentGate: FlowGate | null;
  lastApprovedGate: FlowGate | null;
  gates: FlowGate[];
  movements: FlowMovement[];
}

export const plantFlowApi = {
  overview: (projectId: string) => api<PlantFlow>(`/work/plant-flow/${projectId}`),
};
