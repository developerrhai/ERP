// Phase 41: plant route builder (plant-unit-routing) and live multi-unit part routing (mfg-unit-route).
// Routes are company-wide templates (plant_routes / plant_route_steps); a job card (a production order) follows one route
// (job_card_routes). Moving to a step in another plant raises a Material Transfer Note (transfer-service.ts). All raw SQL
// runs through the Phase 9 helpers; every number shown is read from the database.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering/numbering-service';
import { query, TX } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D } from '../inventory/money';
import { movementType, routeBalance, routeQtyProblem, yieldPct } from './calc';
import { assertPhase41Schema, phase41Ready, transferService } from './transfer-service';

export interface StepInput {
  unitId: string;
  processName: string;
  departmentId?: string | null;
  workCentreId?: string | null;
  stdHours?: number | null;
  qcRequired?: boolean;
  approvalRequired?: boolean;
}
export interface RouteInput {
  code?: string;
  name: string;
  itemOrFamily?: string | null;
  active?: boolean;
  steps: StepInput[];
}

const SKETCH_CODE = 'ROUTE-SKETCH';

/** The plants a caller may see: the chosen plants, or null (no filter) for an all-units admin. */
export function scopeUnits(caller: Caller): string[] | null {
  if (caller.ctx.unitIds.length > 0) return caller.ctx.unitIds;
  if (caller.ctx.unitId) return [caller.ctx.unitId];
  return caller.ctx.allUnits ? null : [];
}

const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

async function stepsOf(db: Db, routeId: string): Promise<Row[]> {
  const approval = (await phase41Ready(db)) ? 's.approval_required' : 'false AS approval_required';
  const rows = await query(
    db,
    `SELECT s.id::text AS id, s.seq, s.unit_id::text AS unit_id, u.code AS unit_code, u.name AS unit_name, s.process_name,
            s.department_id::text AS department_id, d.name AS department, s.work_centre_id::text AS work_centre_id,
            w.code AS work_centre_code, w.name AS work_centre_name, s.std_hours::text AS std_hours, s.qc_required, ${approval}
       FROM plant_route_steps s
       JOIN units u ON u.id = s.unit_id
       LEFT JOIN departments d ON d.id = s.department_id
       LEFT JOIN mfg_work_centres w ON w.id = s.work_centre_id
      WHERE s.route_id = $1::uuid ORDER BY s.seq`,
    routeId,
  );
  return rows.map((r, i) => ({
    ...r,
    movementType: movementType(S(r.unit_id), rows[i + 1] ? S(rows[i + 1]?.unit_id) : null),
  }));
}

async function validateSteps(db: Db, steps: StepInput[]): Promise<void> {
  if (steps.length === 0) throw Errors.validation({ steps: 'Add at least one step.' });
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    if (!s.processName.trim()) throw Errors.validation({ steps: `Step ${n}: enter the process.` });
    const u = await query(db, `SELECT status FROM units WHERE id = $1::uuid`, s.unitId);
    if (!u[0]) throw Errors.validation({ steps: `Step ${n}: choose a plant.` });
    if (u[0].status !== 'ACTIVE') throw Errors.validation({ steps: `Step ${n}: the plant is inactive.` });
    if (s.stdHours !== null && s.stdHours !== undefined && (s.stdHours < 0 || s.stdHours > 999999.99)) {
      throw Errors.validation({ steps: `Step ${n}: standard hours must be between 0 and 999999.99.` });
    }
    if (s.workCentreId) {
      const w = await query(db, `SELECT 1 FROM mfg_work_centres WHERE id = $1::uuid AND unit_id = $2::uuid AND deleted_at IS NULL`, s.workCentreId, s.unitId);
      if (!w[0]) throw Errors.validation({ steps: `Step ${n}: that work centre does not belong to the chosen plant.` });
    }
  }
}

async function writeSteps(db: Db, routeId: string, steps: StepInput[]): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM plant_route_steps WHERE route_id = $1::uuid`, routeId);
  const ready = await phase41Ready(db);
  let seq = 0;
  for (const s of steps) {
    seq += 1;
    await db.$executeRawUnsafe(
      `INSERT INTO plant_route_steps (route_id, seq, unit_id, process_name, department_id, work_centre_id, std_hours, qc_required${ready ? ', approval_required' : ''})
       VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6::uuid, $7::numeric, $8${ready ? ', $9' : ''})`,
      routeId,
      seq,
      s.unitId,
      s.processName.trim(),
      s.departmentId ?? null,
      s.workCentreId ?? null,
      s.stdHours ?? null,
      s.qcRequired ?? false,
      ...(ready ? [s.approvalRequired ?? false] : []),
    );
  }
}

async function nextCode(tx: Db, caller: Caller, unitId: string): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const code = await NumberingService.allocate(tx, { pageId: 'plant-unit-routing', unitId, fyId: caller.ctx.fyId, prefix: 'ROUTE', padding: 4 });
    const clash = await query(tx, `SELECT 1 FROM plant_routes WHERE code = $1`, code);
    if (!clash[0]) return code;
  }
  throw Errors.conflict('Could not allocate a route number. Try again.');
}

export const routingService = {
  /** Plants as Unit 1..4 tabs: our units by code, active ones only. */
  async units(): Promise<Row[]> {
    return query(prisma, `SELECT id::text AS id, code, name FROM units WHERE status = 'ACTIVE' ORDER BY code`);
  },
  async departments(): Promise<Row[]> {
    return query(prisma, `SELECT id::text AS id, name FROM departments WHERE status = 'ACTIVE' ORDER BY name`);
  },
  async workCentres(unitId: string): Promise<Row[]> {
    return query(prisma, `SELECT id::text AS id, code, name FROM mfg_work_centres WHERE unit_id = $1::uuid AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code`, unitId);
  },

  async list(caller: Caller) {
    const scope = scopeUnits(caller);
    const routes = await query(
      prisma,
      `SELECT r.id::text AS id, r.code, r.name, r.item_or_family, r.active,
              (SELECT count(*)::int FROM plant_route_steps s WHERE s.route_id = r.id) AS step_count,
              (SELECT count(*)::int FROM job_card_routes j WHERE j.route_id = r.id) AS job_count
         FROM plant_routes r ORDER BY r.created_at DESC, r.code`,
    );
    const args: unknown[] = [];
    let w = '';
    if (scope) {
      args.push(scope);
      w = `AND (m.unit_id = ANY($1::uuid[]) OR m.to_unit_id = ANY($1::uuid[]))`;
    }
    const cards = await query(
      prisma,
      `SELECT (SELECT count(*)::int FROM plant_routes WHERE active) AS templates,
              (SELECT count(*)::int FROM plant_route_steps s JOIN plant_routes r ON r.id = s.route_id WHERE r.active) AS steps,
              (SELECT count(*)::int FROM work_movements m WHERE NOT m.is_physical AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL') ${w}) AS active_dept_handover,
              (SELECT count(*)::int FROM work_movements m WHERE m.is_physical AND m.state IN ('SENT','RECEIVED','ACCEPTED','IN_WORK','WAITING_APPROVAL') ${w}) AS physical_moves`,
      ...args,
    );
    return { routes, cards: cards[0] ?? {} };
  },

  async get(id: string): Promise<Row> {
    const r = (await query(prisma, `SELECT id::text AS id, code, name, item_or_family, active FROM plant_routes WHERE id = $1::uuid`, id))[0];
    if (!r) throw Errors.notFound('Route not found.');
    return { ...r, steps: await stepsOf(prisma, id) };
  },

  async create(caller: Caller, input: RouteInput): Promise<Row> {
    if (!input.name.trim()) throw Errors.validation({ name: 'Enter the route name.' });
    const id = await prisma.$transaction(async (tx) => {
      await validateSteps(tx, input.steps);
      const code = input.code?.trim() || (await nextCode(tx, caller, input.steps[0]!.unitId));
      if ((await query(tx, `SELECT 1 FROM plant_routes WHERE code = $1`, code))[0]) {
        throw Errors.duplicate({ code: 'This Route ID is already used.' });
      }
      const rows = await query(
        tx,
        `INSERT INTO plant_routes (code, name, item_or_family, active, created_by_id) VALUES ($1, $2, $3, $4, $5::uuid) RETURNING id::text AS id`,
        code,
        input.name.trim(),
        input.itemOrFamily?.trim() || null,
        input.active ?? true,
        caller.auth.userId,
      );
      const rid = S(rows[0]?.id);
      await writeSteps(tx, rid, input.steps);
      await recordAudit({ action: 'routing.route.create', actorId: caller.auth.userId, targetType: 'plant_route', targetId: rid, detail: { code, steps: input.steps.length } }, tx);
      return rid;
    }, TX);
    return routingService.get(id);
  },

  async update(caller: Caller, id: string, input: RouteInput): Promise<Row> {
    await prisma.$transaction(async (tx) => {
      const cur = (await query(tx, `SELECT code FROM plant_routes WHERE id = $1::uuid FOR UPDATE`, id))[0];
      if (!cur) throw Errors.notFound('Route not found.');
      if (!input.name.trim()) throw Errors.validation({ name: 'Enter the route name.' });
      await validateSteps(tx, input.steps);
      const inUse = (await query(tx, `SELECT COALESCE(max(current_step),0)::int AS m, count(*)::int AS n FROM job_card_routes WHERE route_id = $1::uuid`, id))[0];
      if (Number(inUse?.n) > 0 && input.steps.length < Number(inUse?.m)) {
        throw Errors.conflict(`${S(inUse?.n)} job card(s) already run this route up to step ${S(inUse?.m)}. Keep at least ${S(inUse?.m)} steps, or duplicate the route.`);
      }
      const code = input.code?.trim() || S(cur.code);
      if (code !== cur.code && (await query(tx, `SELECT 1 FROM plant_routes WHERE code = $1 AND id <> $2::uuid`, code, id))[0]) {
        throw Errors.duplicate({ code: 'This Route ID is already used.' });
      }
      await tx.$executeRawUnsafe(
        `UPDATE plant_routes SET code = $2, name = $3, item_or_family = $4, active = $5 WHERE id = $1::uuid`,
        id,
        code,
        input.name.trim(),
        input.itemOrFamily?.trim() || null,
        input.active ?? true,
      );
      await writeSteps(tx, id, input.steps);
      await recordAudit({ action: 'routing.route.update', actorId: caller.auth.userId, targetType: 'plant_route', targetId: id, detail: { code, steps: input.steps.length } }, tx);
    }, TX);
    return routingService.get(id);
  },

  async duplicate(caller: Caller, id: string): Promise<Row> {
    const src = await routingService.get(id);
    const steps = (src.steps as Row[]).map((s) => ({
      unitId: S(s.unit_id),
      processName: S(s.process_name),
      departmentId: s.department_id ? S(s.department_id) : null,
      workCentreId: s.work_centre_id ? S(s.work_centre_id) : null,
      stdHours: s.std_hours === null || s.std_hours === undefined ? null : Number(s.std_hours),
      qcRequired: Boolean(s.qc_required),
      approvalRequired: Boolean(s.approval_required),
    }));
    return routingService.create(caller, { name: `${S(src.name)} (copy)`.slice(0, 120), itemOrFamily: src.item_or_family ? S(src.item_or_family) : null, steps });
  },

  /** Delete when nothing runs on the route; otherwise switch it off so history stays readable. */
  async remove(caller: Caller, id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
    return prisma.$transaction(async (tx) => {
      const cur = (await query(tx, `SELECT code FROM plant_routes WHERE id = $1::uuid FOR UPDATE`, id))[0];
      if (!cur) throw Errors.notFound('Route not found.');
      const used = Number((await query(tx, `SELECT count(*)::int AS n FROM job_card_routes WHERE route_id = $1::uuid`, id))[0]?.n);
      if (used > 0) {
        await tx.$executeRawUnsafe(`UPDATE plant_routes SET active = false WHERE id = $1::uuid`, id);
        await recordAudit({ action: 'routing.route.deactivate', actorId: caller.auth.userId, targetType: 'plant_route', targetId: id, detail: { jobs: used } }, tx);
        return { deleted: false, deactivated: true };
      }
      await tx.$executeRawUnsafe(`DELETE FROM plant_routes WHERE id = $1::uuid`, id);
      await recordAudit({ action: 'routing.route.delete', actorId: caller.auth.userId, targetType: 'plant_route', targetId: id, detail: { code: S(cur.code) } }, tx);
      return { deleted: true, deactivated: false };
    }, TX);
  },

  /** Reset Sketch Template: rebuilds the handwritten sketch route (Plant 1 -> Unit 2 -> Unit 4 -> Unit 1) on our plants by code order. */
  async resetSketch(caller: Caller): Promise<Row> {
    const units = await routingService.units();
    if (units.length === 0) throw Errors.conflict('Add a plant before building a route.');
    const at = (n: number): string => S(units[Math.min(n, units.length) - 1]?.id);
    const dept = async (name: string): Promise<string | null> => S((await query(prisma, `SELECT id::text AS id FROM departments WHERE lower(name) = lower($1) LIMIT 1`, name))[0]?.id) || null;
    const [sales, prod, wh] = [await dept('Sales'), await dept('Production'), await dept('Warehouse')];
    const steps: StepInput[] = [
      { unitId: at(1), processName: 'Sales Order & Product Release', departmentId: sales },
      { unitId: at(2), processName: 'Laser Cutting', departmentId: prod },
      { unitId: at(4), processName: 'Drilling & Tapping', departmentId: prod },
      { unitId: at(4), processName: 'Bending', departmentId: prod },
      { unitId: at(4), processName: 'Welding', departmentId: prod, approvalRequired: true },
      { unitId: at(1), processName: 'Dispatch to Unit 1', departmentId: wh },
    ];
    const cur = (await query(prisma, `SELECT id::text AS id FROM plant_routes WHERE code = $1`, SKETCH_CODE))[0];
    if (cur) return routingService.update(caller, S(cur.id), { code: SKETCH_CODE, name: 'Plant 1 • Fabrication → Powder Coating', itemOrFamily: 'Fabricated Product', steps });
    return routingService.create(caller, { code: SKETCH_CODE, name: 'Plant 1 • Fabrication → Powder Coating', itemOrFamily: 'Fabricated Product', steps });
  },

  // ---------------------------------------------------------------------------------------- live routing (mfg-unit-route)
  /** The four plant cards on top of the plant-flow pages: process list from the routes, jobs and WIP balance from job_card_routes. */
  async plantStrip(caller: Caller): Promise<Row[]> {
    const scope = scopeUnits(caller);
    const units = (await routingService.units()).slice(0, 4);
    const out: Row[] = [];
    for (const u of units) {
      const procs = await query(
        prisma,
        `SELECT s.process_name, min(s.seq) AS first_seq FROM plant_route_steps s JOIN plant_routes r ON r.id = s.route_id AND r.active
          WHERE s.unit_id = $1::uuid GROUP BY s.process_name ORDER BY min(s.seq), s.process_name`,
        u.id,
      );
      const live = (
        await query(
          prisma,
          `SELECT count(*)::int AS jobs, COALESCE(sum(j.balance),0)::text AS wip
             FROM job_card_routes j JOIN plant_route_steps s ON s.route_id = j.route_id AND s.seq = j.current_step
            WHERE s.unit_id = $1::uuid AND j.route_status = 'IN_PROGRESS'`,
          u.id,
        )
      )[0];
      const visible = !scope || scope.includes(S(u.id));
      out.push({ ...u, processes: procs.map((p) => S(p.process_name)), jobs: visible ? Number(live?.jobs ?? 0) : 0, wipBalance: visible ? S(live?.wip ?? '0') : '0' });
    }
    return out;
  },

  async live(caller: Caller, p: { view?: string; unitId?: string; q?: string }): Promise<Row[]> {
    const scope = scopeUnits(caller);
    const args: unknown[] = [];
    const where: string[] = [];
    if (scope) {
      args.push(scope);
      where.push(`(cs.unit_id = ANY($${args.length}::uuid[]) OR o.unit_id = ANY($${args.length}::uuid[]))`);
    }
    if (p.unitId) {
      args.push(p.unitId);
      where.push(`cs.unit_id = $${args.length}::uuid`);
    }
    const view = p.view ?? 'live';
    if (view === 'wip') where.push(`j.route_status = 'IN_PROGRESS' AND j.balance > 0`);
    if (view === 'transfers') where.push(`tn.receipt_status IN ('PENDING','SHORT')`);
    if (view === 'quality') where.push(`(j.quality_approval IS NOT NULL OR cs.qc_required)`);
    if (view === 'dispatch') where.push(`ns.id IS NULL`);
    if (p.q) {
      args.push(`%${p.q}%`);
      where.push(`(o.number ILIKE $${args.length} OR i.name ILIKE $${args.length} OR i.code ILIKE $${args.length})`);
    }
    const lateral = (await phase41Ready(prisma))
      ? `LEFT JOIN LATERAL (SELECT t.note_no, t.receipt_status FROM transfer_notes t WHERE t.order_id = o.id ORDER BY t.created_at DESC LIMIT 1) tn ON true`
      : `LEFT JOIN LATERAL (SELECT NULL::text AS note_no, NULL::text AS receipt_status) tn ON true`;
    const rows = await query(
      prisma,
      `SELECT j.id::text AS id, j.job_card_id::text AS order_id, o.number AS job_no, i.code AS part_code, i.name AS part_name,
              r.id::text AS route_id, r.code AS route_code, r.name AS route_name, j.current_step,
              cs.process_name AS current_process, cu.code AS current_unit_code, cu.name AS current_unit_name, cs.unit_id::text AS current_unit_id, cs.qc_required,
              ns.process_name AS next_process, nu.code AS next_unit_code, nu.name AS next_unit_name,
              j.planned::text, j.good::text, j.rejected::text, j.scrap::text, j.transferred::text, j.balance::text,
              j.route_status, j.quality_approval, j.dc_status, j.payment_status, j.updated_at,
              tn.note_no AS transfer_no, tn.receipt_status AS transfer_status
         FROM job_card_routes j
         JOIN mfg_orders o ON o.id = j.job_card_id
         JOIN items i ON i.id = o.item_id
         JOIN plant_routes r ON r.id = j.route_id
         JOIN plant_route_steps cs ON cs.route_id = j.route_id AND cs.seq = j.current_step
         JOIN units cu ON cu.id = cs.unit_id
         LEFT JOIN plant_route_steps ns ON ns.route_id = j.route_id AND ns.seq = j.current_step + 1
         LEFT JOIN units nu ON nu.id = ns.unit_id
         ${lateral}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY j.updated_at DESC LIMIT 200`,
      ...args,
    );
    return rows.map((r) => ({ ...r, yield: yieldPct(S(r.planned), S(r.good)) }));
  },

  /** Orders that can start a route (not cancelled, no route yet) and the active routes, for the "Assign route" dialog. */
  async assignable(caller: Caller): Promise<{ orders: Row[]; routes: Row[] }> {
    const scope = scopeUnits(caller);
    const args: unknown[] = [];
    let w = '';
    if (scope) {
      args.push(scope);
      w = `AND o.unit_id = ANY($1::uuid[])`;
    }
    const orders = await query(
      prisma,
      `SELECT o.id::text AS id, o.number, i.name AS part_name, o.qty::text AS qty
         FROM mfg_orders o JOIN items i ON i.id = o.item_id
        WHERE o.deleted_at IS NULL AND o.status IN ('Planned','Released','In Progress') ${w}
          AND NOT EXISTS (SELECT 1 FROM job_card_routes j WHERE j.job_card_id = o.id)
        ORDER BY o.created_at DESC LIMIT 100`,
      ...args,
    );
    const routes = await query(prisma, `SELECT id::text AS id, code, name FROM plant_routes WHERE active ORDER BY code`);
    return { orders, routes };
  },

  async assign(caller: Caller, input: { orderId: string; routeId: string }): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const o = (await query(tx, `SELECT id::text AS id, number, unit_id::text AS unit_id, qty::text AS qty, status FROM mfg_orders WHERE id = $1::uuid AND deleted_at IS NULL FOR UPDATE`, input.orderId))[0];
      if (!o) throw Errors.notFound('Production order not found.');
      const scope = scopeUnits(caller);
      if (scope && !scope.includes(S(o.unit_id))) throw Errors.forbidden('This order belongs to another plant.');
      if (!['Planned', 'Released', 'In Progress'].includes(S(o.status))) throw Errors.conflict(`A ${S(o.status)} order cannot start a route.`);
      const r = (await query(tx, `SELECT active, (SELECT count(*)::int FROM plant_route_steps WHERE route_id = plant_routes.id) AS n FROM plant_routes WHERE id = $1::uuid`, input.routeId))[0];
      if (!r) throw Errors.notFound('Route not found.');
      if (!r.active) throw Errors.conflict('This route is switched off.');
      if (Number(r.n) === 0) throw Errors.conflict('This route has no steps.');
      if ((await query(tx, `SELECT 1 FROM job_card_routes WHERE job_card_id = $1::uuid`, input.orderId))[0]) throw Errors.conflict('This job card already follows a route.');
      const rows = await query(tx, `INSERT INTO job_card_routes (job_card_id, route_id, planned) VALUES ($1::uuid, $2::uuid, $3::numeric) RETURNING id::text AS id`, input.orderId, input.routeId, S(o.qty));
      const id = S(rows[0]?.id);
      await recordAudit({ action: 'routing.job.assign', actorId: caller.auth.userId, targetType: 'job_card_route', targetId: id, detail: { order: S(o.number) } }, tx);
      return { id };
    }, TX);
  },

  async loadJob(tx: Db, caller: Caller, id: string): Promise<Row> {
    const j = (
      await query(
        tx,
        `SELECT j.id::text AS id, j.route_id::text AS route_id, j.current_step, j.planned::text AS planned, j.good::text AS good, j.rejected::text AS rejected,
                j.scrap::text AS scrap, j.transferred::text AS transferred, j.route_status, o.id::text AS order_id, o.number AS job_no, o.unit_id::text AS order_unit_id,
                o.item_id::text AS item_id, o.warehouse_id::text AS warehouse_id, i.code AS part_code, i.name AS part_name, i.base_uom
           FROM job_card_routes j JOIN mfg_orders o ON o.id = j.job_card_id JOIN items i ON i.id = o.item_id
          WHERE j.id = $1::uuid FOR UPDATE OF j`,
        id,
      )
    )[0];
    if (!j) throw Errors.notFound('Job route not found.');
    const scope = scopeUnits(caller);
    if (scope && !scope.includes(S(j.order_unit_id))) throw Errors.notFound('Job route not found.');
    return j;
  },

  /** Adds good / scrap / rejected quantities of the current step. Good + scrap can never pass planned. */
  async record(caller: Caller, id: string, input: { good?: number; scrap?: number; rejected?: number }): Promise<Row> {
    return prisma.$transaction(async (tx) => {
      const j = await routingService.loadJob(tx, caller, id);
      if (j.route_status !== 'IN_PROGRESS') throw Errors.conflict(`This route is ${S(j.route_status).toLowerCase()}.`);
      const good = D(S(j.good)).plus(D(input.good ?? 0));
      const scrap = D(S(j.scrap)).plus(D(input.scrap ?? 0));
      const rejected = D(S(j.rejected)).plus(D(input.rejected ?? 0));
      if ((input.good ?? 0) < 0 || (input.scrap ?? 0) < 0 || (input.rejected ?? 0) < 0) throw Errors.validation({ good: 'Quantities cannot be negative.' });
      const problem = routeQtyProblem(S(j.planned), good, scrap);
      if (problem) throw Errors.validation({ good: problem });
      await tx.$executeRawUnsafe(
        `UPDATE job_card_routes SET good = $2::numeric, scrap = $3::numeric, rejected = $4::numeric, updated_at = now() WHERE id = $1::uuid`,
        id,
        good.toFixed(),
        scrap.toFixed(),
        rejected.toFixed(),
      );
      await recordAudit({ action: 'routing.job.record', actorId: caller.auth.userId, targetType: 'job_card_route', targetId: id, detail: { good: good.toFixed(), scrap: scrap.toFixed() } }, tx);
      return { id, good: good.toFixed(), scrap: scrap.toFixed(), rejected: rejected.toFixed(), balance: routeBalance(S(j.planned), good, scrap).toFixed() };
    }, TX);
  },

  /** Move Next Controlled Step. A step in another plant raises a Material Transfer Note for good - already transferred. */
  async advance(caller: Caller, id: string): Promise<Row> {
    await assertPhase41Schema(prisma);
    return prisma.$transaction(async (tx) => {
      const j = await routingService.loadJob(tx, caller, id);
      if (j.route_status !== 'IN_PROGRESS') throw Errors.conflict(`This route is ${S(j.route_status).toLowerCase()}.`);
      const pending = (await query(tx, `SELECT note_no FROM transfer_notes WHERE order_id = $1::uuid AND receipt_status = 'PENDING' LIMIT 1`, S(j.order_id)))[0];
      if (pending) throw Errors.conflict(`Transfer note ${S(pending.note_no)} is not received yet. The receiving plant must receive it before the route advances.`);
      const steps = await stepsOf(tx, S(j.route_id));
      const cur = steps.find((s) => Number(s.seq) === Number(j.current_step));
      const next = steps.find((s) => Number(s.seq) === Number(j.current_step) + 1);
      if (!cur) throw Errors.conflict('The current step no longer exists on this route.');
      if (!next) {
        if (routeBalance(S(j.planned), S(j.good), S(j.scrap)).greaterThan(0)) {
          throw Errors.conflict(`Balance ${routeBalance(S(j.planned), S(j.good), S(j.scrap)).toFixed()} is still open. Record good or scrap quantity first.`);
        }
        await tx.$executeRawUnsafe(`UPDATE job_card_routes SET route_status = 'COMPLETED', updated_at = now() WHERE id = $1::uuid`, id);
        await recordAudit({ action: 'routing.job.complete', actorId: caller.auth.userId, targetType: 'job_card_route', targetId: id, detail: { job: S(j.job_no) } }, tx);
        return { id, routeStatus: 'COMPLETED', transferNo: null };
      }
      let transferNo: string | null = null;
      let transferred = D(S(j.transferred));
      if (S(next.unit_id) !== S(cur.unit_id)) {
        const qty = D(S(j.good)).minus(transferred);
        if (qty.lessThanOrEqualTo(0)) throw Errors.conflict('No good quantity is waiting to move. Record the good quantity of this step first.');
        const note = await transferService.createInTx(tx, caller, {
          fromUnitId: S(cur.unit_id),
          toUnitId: S(next.unit_id),
          quantity: qty.toFixed(),
          jobCardNo: S(j.job_no),
          orderId: S(j.order_id),
          itemId: S(j.item_id),
          partCode: S(j.part_code),
          partName: S(j.part_name),
          uom: S(j.base_uom),
          fromProcess: S(cur.process_name),
          toProcess: S(next.process_name),
          fromWarehouseId: S(j.warehouse_id),
        });
        transferNo = S(note.noteNo);
        transferred = transferred.plus(qty);
      }
      await tx.$executeRawUnsafe(`UPDATE job_card_routes SET current_step = current_step + 1, transferred = $2::numeric, updated_at = now() WHERE id = $1::uuid`, id, transferred.toFixed());
      await recordAudit({ action: 'routing.job.advance', actorId: caller.auth.userId, targetType: 'job_card_route', targetId: id, detail: { to: Number(j.current_step) + 1, transferNo } }, tx);
      return { id, routeStatus: 'IN_PROGRESS', currentStep: Number(j.current_step) + 1, transferNo };
    }, TX);
  },
};
