// V40 Integrated Plant Flow (plant-flow-command, plant-project-forward): one project's journey across departments.
// Read only. Gates come from project_gates (Phase 26), movements from work_movements (Phase 25): those tagged with the project
// plus those of the project's own sales / manufacturing / purchase documents. Plants: only the caller's selected plants (ctx.unitIds).
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { query } from '../procurement/core';

import type { Caller } from '../records/service';

const S = (v: unknown): string => String(v ?? '');
const OPEN = ['SENT', 'RECEIVED', 'ACCEPTED', 'IN_WORK', 'WAITING_APPROVAL'];

export interface PlantFlowGate {
  id: string;
  seq: number;
  code: string;
  name: string;
  state: string;
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

export const plantFlowService = {
  async overview(caller: Caller, projectId: string): Promise<Record<string, unknown>> {
    const p = (
      await query(
        prisma,
        `SELECT p.id::text AS id, p.code, p.name, p.unit_id::text AS unit_id, p.status, c.name AS customer
           FROM projects p LEFT JOIN customers c ON c.id = p.customer_id WHERE p.id = $1::uuid`,
        projectId,
      )
    )[0];
    if (!p || !caller.ctx.unitIds.includes(S(p.unit_id))) throw Errors.notFound('Project not found.');

    const gateRows = await query(
      prisma,
      `SELECT g.id::text AS id, g.seq, g.code, g.name, g.state, g.owner_department_id::text AS owner_department_id, d.name AS owner_department,
              g.exit_criteria, g.deliverable_name, s.linked_page, g.depends_on, g.due_date::text AS due_date, g.approved_at
         FROM project_gates g
         LEFT JOIN departments d ON d.id = g.owner_department_id
         LEFT JOIN gate_template_steps s ON s.id = g.step_id
        WHERE g.project_id = $1::uuid ORDER BY g.seq`,
      projectId,
    );
    const gates: PlantFlowGate[] = gateRows.map((g, i) => {
      const next = gateRows[i + 1];
      return {
        id: S(g.id),
        seq: Number(g.seq),
        code: S(g.code),
        name: S(g.name),
        state: S(g.state),
        ownerDepartmentId: g.owner_department_id ? S(g.owner_department_id) : null,
        ownerDepartment: g.owner_department ? S(g.owner_department) : null,
        exitCriteria: g.exit_criteria ? S(g.exit_criteria) : null,
        deliverableName: g.deliverable_name ? S(g.deliverable_name) : null,
        linkedPage: g.linked_page ? S(g.linked_page) : null,
        dependsOn: (g.depends_on as string[] | null) ?? [],
        dueDate: g.due_date ? S(g.due_date) : null,
        approvedAt: g.approved_at ? new Date(S(g.approved_at)).toISOString() : null,
        nextGateCode: next ? S(next.code) : null,
        nextGateDepartment: next?.owner_department ? S(next.owner_department) : null,
      };
    });

    // documents that belong to the project (project_id was added to these headers in Phase 26)
    const docIds = new Set<string>([projectId]);
    const numbers: Record<string, string | null> = { salesOrder: null, manufacturingOrder: null, purchaseOrder: null };
    for (const [key, table] of [['salesOrder', 'sales_orders'], ['manufacturingOrder', 'mfg_orders'], ['purchaseOrder', 'purchase_orders']] as const) {
      const rows = await query(prisma, `SELECT id::text AS id, number FROM ${table} WHERE project_id = $1::uuid ORDER BY created_at LIMIT 50`, projectId);
      for (const r of rows) docIds.add(S(r.id));
      numbers[key] = rows[0]?.number ? S(rows[0].number) : null;
    }

    const movements = await query(
      prisma,
      `SELECT m.id::text AS id, m.number, m.doc_type, m.doc_id::text AS doc_id, m.doc_no, m.state, m.work_status, m.sent_at,
              m.from_department_id::text AS from_department_id, fd.name AS from_department,
              m.to_department_id::text AS to_department_id, td.name AS to_department
         FROM work_movements m
         JOIN departments fd ON fd.id = m.from_department_id
         JOIN departments td ON td.id = m.to_department_id
        WHERE (m.project_id = $1::uuid OR m.doc_id = ANY($2::uuid[]))
          AND (m.unit_id = ANY($3::uuid[]) OR m.to_unit_id = ANY($3::uuid[]))
        ORDER BY m.sent_at DESC LIMIT 200`,
      projectId,
      [...docIds],
      caller.ctx.unitIds,
    );
    const open = movements.filter((m) => OPEN.includes(S(m.state)));
    const activeGate = gates.find((g) => g.state !== 'APPROVED') ?? null;
    const current = open[0] ? { id: S(open[0].to_department_id), name: S(open[0].to_department) } : activeGate?.ownerDepartmentId ? { id: activeGate.ownerDepartmentId, name: S(activeGate.ownerDepartment) } : null;
    const done = gates.filter((g) => g.state === 'APPROVED').length;
    const lastApproved = [...gates].reverse().find((g) => g.state === 'APPROVED') ?? null;

    return {
      project: { id: p.id, code: p.code, name: p.name, customer: p.customer, status: p.status, ...numbers },
      progress: { gatesTotal: gates.length, gatesDone: done, progressPct: gates.length > 0 ? Math.round((done / gates.length) * 100) : null },
      pendingReceipt: movements.filter((m) => m.state === 'SENT').length,
      pendingAcceptance: movements.filter((m) => m.state === 'RECEIVED').length,
      openMovements: open.length,
      currentDepartment: current,
      currentGate: activeGate,
      lastApprovedGate: lastApproved,
      gates,
      movements: movements.slice(0, 50).map((m) => ({ ...m, open: OPEN.includes(S(m.state)) })),
    };
  },
};

