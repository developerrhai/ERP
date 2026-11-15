// Movement registers for the four V40 sibling pages: maint-part-movement, plant-process-movement,
// plant-department-movement, plant-interplant-movement. All four read real work_movements (+ movement_lines for the
// quantities and transfer_notes for the vehicle). Read only: every action is still the Phase 25 engine in service.ts.
// Scope of a movement (each movement belongs to exactly one page, the first rule that matches):
//   interplant  = physical, or sent to another plant (to_unit_id <> unit_id)
//   maintenance = the document is a maintenance record (MAINTENANCE_DOC_TYPES)
//   process     = route type "Manufacturing Action"
//   department  = every other handover between departments of one plant
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { asyncHandler } from '../../core/http/async-handler';
import { validate, validated } from '../../core/http/validate';
import { accessUserOf } from '../../core/rbac/access';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import { callerOf } from '../inventory/routes-shared';
import { isElevated } from './service';
import type { Caller } from '../records/service';

export const MAINTENANCE_DOC_TYPES = [
  'maint-spares',
  'maint-workorders',
  'maint-breakdown',
  'maint-preventive',
  'maint-equipment',
  'maint-machines',
  'maint-schedule',
  'asset-maintenance',
  'service-spares',
] as const;

export const MOVEMENT_KINDS = ['maintenance', 'process', 'department', 'interplant'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const VIEWS = ['all', 'pending', 'sent', 'received', 'custody', 'accepted', 'waiting', 'returned', 'completed', 'variance', 'late', 'mine'] as const;
type View = (typeof VIEWS)[number];

const OPEN = `('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL')`;
const INTERPLANT = `(m.is_physical OR (m.to_unit_id IS NOT NULL AND m.to_unit_id <> m.unit_id))`;

/** SQL condition of one kind; `maint` is the placeholder that holds MAINTENANCE_DOC_TYPES. */
export function kindCondition(kind: MovementKind, maint: string): string {
  const isMaint = `m.doc_type = ANY(${maint}::text[])`;
  switch (kind) {
    case 'interplant': return INTERPLANT;
    case 'maintenance': return `(NOT ${INTERPLANT} AND ${isMaint})`;
    case 'process': return `(NOT ${INTERPLANT} AND NOT ${isMaint} AND m.route_type = 'Manufacturing Action')`;
    default: return `(NOT ${INTERPLANT} AND NOT ${isMaint} AND m.route_type <> 'Manufacturing Action')`;
  }
}

const listQuery = z
  .object({
    kind: z.enum(MOVEMENT_KINDS),
    view: z.enum(VIEWS).optional(),
    dept: z.string().uuid().optional(),
    q: z.string().max(60).optional(),
    cursor: z.string().max(200).optional(),
    // the global list guard rewrites ?limit= into ?size=
    size: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
const countQuery = z.object({ dept: z.string().uuid().optional(), q: z.string().max(60).optional() }).strict();
const auditQuery = z.object({ kind: z.enum(MOVEMENT_KINDS), dept: z.string().uuid().optional() }).strict();

const SELECT = `
  m.id::text AS id, m.number, m.unit_id::text AS unit_id, m.to_unit_id::text AS to_unit_id,
  uf.code AS from_plant, uf.name AS from_plant_name, ut.code AS to_plant, ut.name AS to_plant_name,
  m.doc_type, m.doc_id::text AS doc_id, m.doc_no,
  m.from_department_id::text AS from_department_id, fd.name AS from_department,
  m.to_department_id::text AS to_department_id, td.name AS to_department,
  m.assigned_manager_id::text AS assigned_manager_id, am.name AS assigned_manager,
  m.route_type, m.priority, m.required_by::text AS required_by, m.work_status, m.handover_note,
  m.state, m.sent_at, m.received_at, m.accepted_at, m.completed_at, m.returned_at, m.return_reason, m.sla_due_at,
  (m.late OR (m.sla_due_at IS NOT NULL AND m.sla_due_at < now() AND m.state IN ${OPEN})) AS is_late,
  m.is_physical, m.version, sb.name AS sent_by, rb.name AS received_by, ab.name AS accepted_by,
  ln.line_count, ln.sent_qty, ln.received_qty, ln.short_qty, ln.part, ln.uom, ln.batch, ln.from_location, ln.to_location,
  tn.note_no AS transfer_note_no, tn.vehicle_person, tn.receipt_status AS transfer_receipt_status`;

const FROM = `
  FROM work_movements m
  JOIN departments fd ON fd.id = m.from_department_id
  JOIN departments td ON td.id = m.to_department_id
  JOIN units uf ON uf.id = m.unit_id
  LEFT JOIN units ut ON ut.id = m.to_unit_id
  LEFT JOIN users am ON am.id = m.assigned_manager_id
  LEFT JOIN users sb ON sb.id = m.sent_by_id
  LEFT JOIN users rb ON rb.id = m.received_by_id
  LEFT JOIN users ab ON ab.id = m.accepted_by_id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS line_count, sum(l.qty)::float8 AS sent_qty, sum(l.received_qty)::float8 AS received_qty,
           sum(l.short_qty)::float8 AS short_qty,
           (array_agg(l.description ORDER BY l.line_no))[1] AS part, (array_agg(l.uom ORDER BY l.line_no))[1] AS uom,
           (array_agg(l.batch ORDER BY l.line_no))[1] AS batch,
           (array_agg(l.from_location ORDER BY l.line_no))[1] AS from_location, (array_agg(l.to_location ORDER BY l.line_no))[1] AS to_location
      FROM movement_lines l WHERE l.movement_id = m.id) ln ON true
  LEFT JOIN LATERAL (
    SELECT t.note_no, t.vehicle_person, t.receipt_status FROM transfer_notes t WHERE t.movement_id = m.id ORDER BY t.created_at DESC LIMIT 1) tn ON true`;

async function myDepartmentIds(caller: Caller): Promise<string[]> {
  const names = accessUserOf(caller.auth.user).departments;
  if (names.length === 0) return [];
  return (await query(prisma, `SELECT id::text AS id FROM departments WHERE name = ANY($1::text[])`, names)).map((r) => String(r.id));
}

/** Plant + department visibility shared by the list, the counters and the audit. Returns the WHERE parts and args. */
async function scope(caller: Caller, dept: string | undefined): Promise<{ conds: string[]; args: unknown[]; mine: string[]; maint: string }> {
  const mine = await myDepartmentIds(caller);
  const args: unknown[] = [caller.ctx.unitIds, [...MAINTENANCE_DOC_TYPES]];
  const conds = [`(m.unit_id = ANY($1::uuid[]) OR m.to_unit_id = ANY($1::uuid[]))`];
  if (!isElevated(caller)) {
    args.push(mine);
    conds.push(`(m.from_department_id = ANY($${args.length}::uuid[]) OR m.to_department_id = ANY($${args.length}::uuid[]))`);
  }
  if (dept) {
    args.push(dept);
    conds.push(`(m.from_department_id = $${args.length}::uuid OR m.to_department_id = $${args.length}::uuid)`);
  }
  return { conds, args, mine, maint: '$2' };
}

function viewCondition(view: View, mineParam: string): string | null {
  switch (view) {
    case 'pending': return `m.state IN ('SENT','RECEIVED')`;
    case 'sent': return `m.state = 'SENT'`;
    case 'received': return `m.state = 'RECEIVED'`;
    case 'custody': return `m.state IN ('RECEIVED','ACCEPTED','IN_WORK')`;
    case 'accepted': return `m.state IN ('ACCEPTED','IN_WORK')`;
    case 'waiting': return `m.state = 'WAITING_APPROVAL'`;
    case 'returned': return `m.state = 'RETURNED'`;
    case 'completed': return `m.state IN ('COMPLETED','FORWARDED')`;
    case 'variance': return `EXISTS (SELECT 1 FROM movement_lines l WHERE l.movement_id = m.id AND l.short_qty > 0)`;
    case 'late': return `(m.late OR (m.sla_due_at < now() AND m.state IN ${OPEN}))`;
    case 'mine': return `m.to_department_id = ANY(${mineParam}::uuid[]) AND m.state IN ${OPEN}`;
    default: return null;
  }
}

export const movementsExt = {
  async list(caller: Caller, p: { kind: MovementKind; view?: View; dept?: string; q?: string; cursor?: string; size?: number }) {
    const limit = Math.min(Math.max(p.size ?? 25, 1), 100);
    const s = await scope(caller, p.dept);
    const { conds, args } = s;
    conds.push(kindCondition(p.kind, s.maint));
    if (p.view === 'mine') {
      args.push(s.mine);
      conds.push(viewCondition('mine', `$${args.length}`) as string);
    } else {
      const v = viewCondition(p.view ?? 'all', '');
      if (v) conds.push(v);
    }
    if (p.q) {
      args.push(`%${p.q.replace(/[%_\\]/g, '\\$&')}%`);
      conds.push(`(m.number ILIKE $${args.length} OR m.doc_no ILIKE $${args.length})`);
    }
    if (p.cursor) {
      const [at, cid] = Buffer.from(p.cursor, 'base64url').toString('utf8').split('|');
      if (!at || !cid || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/i.test(cid)) throw Errors.validation({ cursor: 'The list changed, showing the latest.' });
      args.push(at, cid);
      conds.push(`(m.sent_at, m.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`);
    }
    const rows = await query(prisma, `SELECT ${SELECT} ${FROM} WHERE ${conds.join(' AND ')} ORDER BY m.sent_at DESC, m.id DESC LIMIT ${limit + 1}`, ...args);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      hasMore,
      nextCursor: hasMore && last ? Buffer.from(`${new Date(String(last.sent_at)).toISOString()}|${String(last.id)}`).toString('base64url') : null,
    };
  },

  /** The four "(n)" buttons: how many movements each page holds for the caller's plants (and chosen department). */
  async counts(caller: Caller, p: { dept?: string; q?: string }) {
    const s = await scope(caller, p.dept);
    const { conds, args } = s;
    if (p.q) {
      args.push(`%${p.q.replace(/[%_\\]/g, '\\$&')}%`);
      conds.push(`(m.number ILIKE $${args.length} OR m.doc_no ILIKE $${args.length})`);
    }
    const r = (
      await query(
        prisma,
        `SELECT ${MOVEMENT_KINDS.map((k) => `count(*) FILTER (WHERE ${kindCondition(k, s.maint)})::int AS ${k}`).join(', ')}
           FROM work_movements m WHERE ${conds.join(' AND ')}`,
        ...args,
      )
    )[0] as Record<string, number> | undefined;
    return { maintenance: Number(r?.maintenance ?? 0), process: Number(r?.process ?? 0), department: Number(r?.department ?? 0), interplant: Number(r?.interplant ?? 0) };
  },

  /** Audit tab: latest events of the movements of one kind. */
  async audit(caller: Caller, p: { kind: MovementKind; dept?: string }): Promise<Row[]> {
    const s = await scope(caller, p.dept);
    s.conds.push(kindCondition(p.kind, s.maint));
    return query(
      prisma,
      `SELECT e.event, e.from_state, e.to_state, e.at, e.note, d.name AS department, u.name AS actor, m.number, m.doc_type, m.doc_no
         FROM movement_events e
         JOIN work_movements m ON m.id = e.movement_id
         LEFT JOIN departments d ON d.id = e.department_id
         LEFT JOIN users u ON u.id = e.actor_id
        WHERE ${s.conds.join(' AND ')}
        ORDER BY e.at DESC, e.id DESC LIMIT 100`,
      ...s.args,
    );
  },
};

export function registerMovementRoutes(r: Router): void {
  const ok = (res: Response, data: unknown) => res.status(200).json({ data });
  r.get('/movements', validate({ query: listQuery }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await movementsExt.list(callerOf(req), validated(res, 'query', listQuery)));
  }));
  r.get('/movements/counts', validate({ query: countQuery }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await movementsExt.counts(callerOf(req), validated(res, 'query', countQuery)));
  }));
  r.get('/movements/audit', validate({ query: auditQuery }), asyncHandler(async (req: Request, res: Response) => {
    ok(res, await movementsExt.audit(callerOf(req), validated(res, 'query', auditQuery)));
  }));
}
