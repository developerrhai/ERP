// Client of the four V40 movement registers (GET /work/movements?kind=...). Actions use workApi (Phase 25 engine).
import { api } from './api';
import type { AuditRow, Movement } from './workApi';

export type MovementKind = 'maintenance' | 'process' | 'department' | 'interplant';
export type MovementView =
  | 'all' | 'pending' | 'sent' | 'received' | 'custody' | 'accepted' | 'waiting' | 'returned' | 'completed' | 'variance' | 'late' | 'mine';

export interface MovementRow extends Movement {
  from_plant: string;
  from_plant_name: string;
  to_plant: string | null;
  to_plant_name: string | null;
  completed_at: string | null;
  returned_at: string | null;
  line_count: number | null;
  sent_qty: number | null;
  received_qty: number | null;
  short_qty: number | null;
  part: string | null;
  uom: string | null;
  batch: string | null;
  from_location: string | null;
  to_location: string | null;
  transfer_note_no: string | null;
  vehicle_person: string | null;
  transfer_receipt_status: string | null;
}

export interface MovementPage {
  rows: MovementRow[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface MovementCounts {
  maintenance: number;
  process: number;
  department: number;
  interplant: number;
}

export interface MovementLine {
  line_no: number;
  description: string | null;
  qty: number;
  uom: string | null;
  received_qty: number | null;
  short_qty: number | null;
  short_reason: string | null;
}

const qs = (o: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const movementApi = {
  list: (p: { kind: MovementKind; view?: MovementView; dept?: string; q?: string; cursor?: string }) =>
    api<MovementPage>(`/work/movements${qs({ kind: p.kind, view: p.view, dept: p.dept, q: p.q, cursor: p.cursor })}`),
  counts: (p: { dept?: string; q?: string } = {}) => api<MovementCounts>(`/work/movements/counts${qs({ dept: p.dept, q: p.q })}`),
  audit: (kind: MovementKind, dept?: string) => api<AuditRow[]>(`/work/movements/audit${qs({ kind, dept })}`),
  lines: (id: string) => api<MovementLine[]>(`/work/movements/${id}/lines`),
};
