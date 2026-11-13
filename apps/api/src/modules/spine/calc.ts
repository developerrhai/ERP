// Phase 26 pure rules: 360 progress weights, gate readiness text, test pass/fail against a spec.

/** Weights of the stage groups of the 360 view (they add up to 100). */
export const PROGRESS_WEIGHTS = {
  order: 5,
  material: 25,
  production: 35,
  quality: 10,
  dispatch: 15,
  billing: 5,
  collection: 5,
} as const;

export type ProgressGroup = keyof typeof PROGRESS_WEIGHTS;

/** Each group is a fraction 0..1 (order is 0 or 1). Example: 1, 1, 0.5 -> 5 + 25 + 17.5 = 47.5. */
export function progressPct(parts: Partial<Record<ProgressGroup, number>>): number {
  let total = 0;
  for (const g of Object.keys(PROGRESS_WEIGHTS) as ProgressGroup[]) {
    const f = Math.min(1, Math.max(0, Number(parts[g] ?? 0)));
    total += PROGRESS_WEIGHTS[g] * f;
  }
  return Math.round(total * 10) / 10;
}

export interface GateFacts {
  code: string;
  deliverableDocType: string | null;
  deliverableApproved: boolean;
  testsTotal: number;
  testsNotPassed: number;
  /** Codes of predecessor gates that are not approved yet. */
  blockedBy: string[];
}

/** What a gate still needs before it can be submitted (empty = ready). */
export function gateMissing(f: GateFacts): string[] {
  const out: string[] = [];
  if (f.blockedBy.length > 0) out.push(`gates ${f.blockedBy.join(', ')} approved`);
  if (f.deliverableDocType && !f.deliverableApproved) out.push(`approved ${f.deliverableDocType}`);
  if (f.testsNotPassed > 0) out.push(`${f.testsNotPassed} test${f.testsNotPassed === 1 ? '' : 's'} passed`);
  return out;
}

export function gateMessage(code: string, missing: string[]): string {
  return `Gate ${code} needs: ${missing.join(', ')}.`;
}

/** Readiness 0..100 for the ring on the gate card: each requirement counts equally. */
export function readinessPct(f: GateFacts): number {
  const reqs = 1 + (f.deliverableDocType ? 1 : 0) + (f.testsTotal > 0 ? 1 : 0);
  let done = f.blockedBy.length === 0 ? 1 : 0;
  if (f.deliverableDocType && f.deliverableApproved) done += 1;
  if (f.testsTotal > 0) done += (f.testsTotal - f.testsNotPassed) / f.testsTotal;
  return Math.round((done / reqs) * 100);
}

/** OK when target - tol_minus <= value <= target + tol_plus; NG otherwise. Without a target there is no automatic result. */
export function testResult(value: number, spec: { target: number | null; tolMinus: number | null; tolPlus: number | null }): 'OK' | 'NG' | null {
  if (spec.target === null) return null;
  const lo = spec.target - Math.abs(spec.tolMinus ?? 0);
  const hi = spec.target + Math.abs(spec.tolPlus ?? 0);
  return value >= lo - 1e-9 && value <= hi + 1e-9 ? 'OK' : 'NG';
}

/** Gates that become OPEN after `approvedCode` is approved: locked gates whose dependencies are all approved. */
export function gatesToOpen(
  gates: { code: string; state: string; dependsOn: string[] }[],
  approvedCode: string,
): string[] {
  const approved = new Set(gates.filter((g) => g.state === 'APPROVED').map((g) => g.code));
  approved.add(approvedCode);
  return gates
    .filter((g) => g.state === 'LOCKED' && g.dependsOn.includes(approvedCode) && g.dependsOn.every((d) => approved.has(d)))
    .map((g) => g.code);
}

/** Exception rule keys with the SQL that finds the offending documents (id, no, unit, project). */
export const EXCEPTION_CHECKS: Record<string, string> = {
  so_no_flow: `SELECT so.id, so.number AS doc_no, so.unit_id, so.project_id, 'sales_orders' AS doc_type, 'Approved over ' || $1 || ' h with no project, production order or material flow' AS detail
    FROM sales_orders so
   WHERE so.status = 'Approved' AND so.deleted_at IS NULL AND so.created_at < now() - ($1 || ' hours')::interval
     AND so.project_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM mfg_orders m JOIN sales_order_lines l ON l.id = m.so_line_id WHERE l.order_id = so.id AND m.deleted_at IS NULL)`,
  po_late: `SELECT po.id, po.number AS doc_no, po.unit_id, po.project_id, 'purchase_orders' AS doc_type, 'Delivery date passed with quantity still open' AS detail
    FROM purchase_orders po
   WHERE po.deleted_at IS NULL AND po.status IN ('Approved','Partially Received','Open')
     AND EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.po_id = po.id AND l.delivery_date < CURRENT_DATE AND l.received_qty < l.qty)`,
  grn_qc_hold: `SELECT g.id, g.number AS doc_no, g.unit_id, g.project_id, 'goods_receipts' AS doc_type, 'In quality hold for more than ' || $1 || ' h' AS detail
    FROM goods_receipts g
   WHERE g.deleted_at IS NULL AND g.qc_status = 'Pending' AND g.created_at < now() - ($1 || ' hours')::interval`,
  movement_late: `SELECT m.id, m.number AS doc_no, m.unit_id, m.project_id, 'work_movements' AS doc_type, 'Department movement is late' AS detail
    FROM work_movements m
   WHERE m.late = true AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK')`,
  dc_no_invoice: `SELECT d.id, d.number AS doc_no, d.unit_id, d.project_id, 'sales_dispatches' AS doc_type, 'Delivery challan with no invoice for more than ' || $1 || ' h' AS detail
    FROM sales_dispatches d
   WHERE d.status = 'Posted' AND d.deleted_at IS NULL AND d.posted_at < now() - ($1 || ' hours')::interval
     AND NOT EXISTS (SELECT 1 FROM sales_invoices i WHERE i.order_id = d.order_id AND i.deleted_at IS NULL AND i.status <> 'Cancelled')`,
  invoice_overdue: `SELECT i.id, i.number AS doc_no, i.unit_id, i.project_id, 'sales_invoices' AS doc_type, 'Overdue by more than 30 days' AS detail
    FROM sales_invoices i
   WHERE i.status = 'Posted' AND i.deleted_at IS NULL AND i.due_date < CURRENT_DATE - 30
     AND coalesce(i.received_amount, 0) < i.grand_total`,
  gate_late: `SELECT g.id, p.code || '/' || g.code AS doc_no, p.unit_id, g.project_id, 'project_gates' AS doc_type, 'Gate is past its due date' AS detail
    FROM project_gates g JOIN projects p ON p.id = g.project_id
   WHERE g.state IN ('OPEN','IN_WORK','SUBMITTED') AND g.due_date IS NOT NULL AND g.due_date < CURRENT_DATE`,
};
