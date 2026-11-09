// Phase 13 v2 production plans (spec: production_plans, pull-demand, check-capacity, check-material, release, run-mrp). A plan is
// the planner's list of what to make by when; lines come from sales orders or are typed. The capacity check compares the hours the
// routing needs with the calendar hours of each work centre up to the required date; the material check compares the BOM
// requirement with the stock that is free. Releasing a plan lets MRP use it; MRP then turns it into suggestions.
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import {
  TX,
  audit,
  checkVersion,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
  scopeSql,
  todayIst,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { releasedBoms } from './bom-service';
import { D, explode } from './calc';
import { S, dateOf, oneUnit } from './master-service';
import { mrpService } from './mrp-service';
import { capacityCheck } from './order-service';

export interface PlanLineInput {
  demandSource?: 'SALES_ORDER' | 'MANUAL' | 'FORECAST' | undefined;
  soLineId?: string | undefined;
  itemId: string;
  demandQty?: string | number | undefined;
  plannedQty: string | number;
  requiredDate: string;
}

async function lockPlan(
  tx: Parameters<typeof query>[0],
  sc: { sql: string; args: unknown[] },
  id: string,
): Promise<Row> {
  const cur = (
    await query(
      tx,
      `SELECT t.* FROM mfg_production_plans t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
      ...sc.args,
      id,
    )
  )[0];
  if (!cur) throw Errors.notFound('Production plan not found.');
  return cur;
}

export const planService = {
  async list(
    caller: Caller,
    pageId: string,
    q: { status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM mfg_production_plans t WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, (SELECT count(*)::int FROM mfg_production_plan_lines l WHERE l.plan_id=t.id) AS line_count
         FROM mfg_production_plans t WHERE ${w} ORDER BY t.plan_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.* FROM mfg_production_plans t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Production plan not found.');
    const lines = await query(
      prisma,
      `SELECT l.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom, s.number AS so_number
         FROM mfg_production_plan_lines l JOIN items i ON i.id=l.item_id LEFT JOIN sales_order_lines sl ON sl.id=l.so_line_id LEFT JOIN sales_orders s ON s.id=sl.order_id
        WHERE l.plan_id=$1::uuid ORDER BY l.required_date, i.code`,
      id,
    );
    return { ...norm<Row>(h), lines: lines.map((r) => norm<Row>(r)) };
  },

  async create(
    caller: Caller,
    pageId: string,
    b: {
      planDate?: string | undefined;
      horizonDays?: number | undefined;
      notes?: string | undefined;
      lines?: PlanLineInput[] | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:PP',
        unitId,
        fyId: fy.id,
        prefix: 'PP',
      });
      const pid = await insertRow(tx, 'mfg_production_plans', {
        unitId,
        fyId: fy.id,
        number,
        planDate: b.planDate ?? todayIst(),
        horizonDays: b.horizonDays ?? 30,
        status: 'DRAFT',
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      for (const l of b.lines ?? []) await writeLine(tx, pid, l);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_PLAN_CREATED',
        'mfg_production_plan',
        { id: pid, code: number },
        pageId,
        {},
      );
      return pid;
    }, TX);
    return planService.get(caller, pageId, id);
  },

  async update(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: {
      horizonDays?: number | undefined;
      notes?: string | undefined;
      lines?: PlanLineInput[] | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockPlan(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'DRAFT') throw Errors.conflict('Only a draft plan can be edited.');
      if (b.lines) {
        await exec(tx, `DELETE FROM mfg_production_plan_lines WHERE plan_id=$1::uuid`, id);
        for (const l of b.lines) await writeLine(tx, id, l);
      }
      await exec(
        tx,
        `UPDATE mfg_production_plans SET horizon_days=COALESCE($1,horizon_days), notes=COALESCE($2,notes), updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
        b.horizonDays ?? null,
        b.notes ?? null,
        caller.auth.userId,
        id,
      );
    }, TX);
    return planService.get(caller, pageId, id);
  },

  /** Adds the approved sales-order lines still to dispatch (due within the horizon) that are not in this plan yet. */
  async pullDemand(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockPlan(tx, sc, id);
      if (S(cur.status) !== 'DRAFT') throw Errors.conflict('Only a draft plan can be changed.');
      const end = new Date(`${dateOf(cur.plan_date)}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + Number(cur.horizon_days));
      const so = await query(
        tx,
        `SELECT l.id::text AS id, l.item_id::text, (l.qty - l.dispatched_qty - l.closed_qty)::text AS q, COALESCE(l.delivery_date, s.delivery_date, s.order_date)::text AS due
           FROM sales_order_lines l JOIN sales_orders s ON s.id=l.order_id
          WHERE s.unit_id=$1::uuid AND s.deleted_at IS NULL AND s.status='Approved' AND s.closed_at IS NULL AND l.qty - l.dispatched_qty - l.closed_qty > 0
            AND COALESCE(l.delivery_date, s.delivery_date, s.order_date) <= $2::date
            AND NOT EXISTS (SELECT 1 FROM mfg_production_plan_lines x WHERE x.plan_id=$3::uuid AND x.so_line_id=l.id)
            AND EXISTS (SELECT 1 FROM mfg_boms b WHERE b.item_id=l.item_id AND b.unit_id=s.unit_id AND b.status='RELEASED' AND b.is_default)`,
        S(cur.unit_id),
        end.toISOString().slice(0, 10),
        id,
      );
      for (const r of so)
        await writeLine(tx, id, {
          demandSource: 'SALES_ORDER',
          soLineId: S(r.id),
          itemId: S(r.item_id),
          demandQty: S(r.q),
          plannedQty: S(r.q),
          requiredDate: S(r.due),
        });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_PLAN_PULLED',
        'mfg_production_plan',
        { id, code: S(cur.number) },
        pageId,
        { lines: so.length },
      );
    }, TX);
    return planService.get(caller, pageId, id);
  },

  /** Hours the routing needs against the calendar hours of each work centre up to the required date; the load is the worst work centre. */
  async checkCapacity(caller: Caller, pageId: string, id: string): Promise<Row> {
    const plan = await planService.get(caller, pageId, id);
    for (const l of plan.lines as Row[]) {
      const ops = await query(
        prisma,
        `SELECT o.work_centre_id::text AS wc, o.setup_minutes::text AS s, o.run_minutes::text AS r FROM mfg_routing_ops o JOIN mfg_routings g ON g.id=o.routing_id
          WHERE g.item_id=$1::uuid AND g.unit_id=$2::uuid AND g.status='RELEASED' AND g.deleted_at IS NULL`,
        S(l.itemId),
        S(plan.unitId),
      );
      const res = ops.length
        ? await capacityCheck(
            prisma,
            ops.map((o) => ({ workCentreId: S(o.wc), setup: S(o.s), run: S(o.r) })),
            S(l.plannedQty),
            todayIst(),
            dateOf(l.requiredDate),
          )
        : [];
      const worst = res.reduce((m, x) => Math.max(m, Number(x.loadPct)), 0);
      await exec(
        prisma,
        `UPDATE mfg_production_plan_lines SET capacity_load_pct=$1::numeric, checked_at=now() WHERE id=$2::uuid`,
        res.length ? worst.toFixed(2) : null,
        S(l.id),
      );
    }
    return planService.get(caller, pageId, id);
  },

  /** How much of the BOM requirement of each line the free stock covers (lowest component, capped at 100 %). */
  async checkMaterial(caller: Caller, pageId: string, id: string): Promise<Row> {
    const plan = await planService.get(caller, pageId, id);
    const boms = await releasedBoms(prisma, S(plan.unitId));
    for (const l of plan.lines as Row[]) {
      let pct: number | null = null;
      try {
        const req = explode(S(l.itemId), S(l.plannedQty), dateOf(l.requiredDate), boms);
        for (const r of req) {
          const st = (
            await query(
              prisma,
              `SELECT COALESCE(sum(s.qty),0)::text AS q FROM stock_slices s JOIN warehouses w ON w.id=s.warehouse_id WHERE w.unit_id=$1::uuid AND w.is_transit=false AND s.stock_status='UNRESTRICTED' AND s.item_id=$2::uuid`,
              S(plan.unitId),
              r.itemId,
            )
          )[0]!;
          const reserved = (
            await query(
              prisma,
              `SELECT COALESCE(sum(b.reserved_qty),0)::text AS q FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE w.unit_id=$1::uuid AND b.item_id=$2::uuid`,
              S(plan.unitId),
              r.itemId,
            )
          )[0]!;
          const free = D(S(st.q)).minus(S(reserved.q));
          const have = D(r.qty).gt(0)
            ? Math.min(100, Math.max(0, Number(free.div(r.qty).mul(100).toFixed(2))))
            : 100;
          pct = pct === null ? have : Math.min(pct, have);
        }
      } catch {
        pct = null;
      }
      await exec(
        prisma,
        `UPDATE mfg_production_plan_lines SET material_avail_pct=$1::numeric, checked_at=now() WHERE id=$2::uuid`,
        pct === null ? null : pct.toFixed(2),
        S(l.id),
      );
    }
    return planService.get(caller, pageId, id);
  },

  async setStatus(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    from: string[],
    to: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockPlan(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (!from.includes(S(cur.status)))
        throw Errors.conflict(
          `A ${S(cur.status).toLowerCase()} plan cannot become ${to.toLowerCase()}.`,
        );
      if (
        to === 'SUBMITTED' &&
        !(
          await query(
            tx,
            `SELECT 1 FROM mfg_production_plan_lines WHERE plan_id=$1::uuid LIMIT 1`,
            id,
          )
        ).length
      )
        throw Errors.validation({ lines: 'Add at least one line.' });
      await exec(
        tx,
        `UPDATE mfg_production_plans SET status=$1, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        to,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        `MFG_PLAN_${to}`,
        'mfg_production_plan',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return planService.get(caller, pageId, id);
  },

  async runMrp(caller: Caller, pageId: string, id: string): Promise<Row> {
    const plan = await planService.get(caller, pageId, id);
    if (S(plan.status) !== 'RELEASED')
      throw Errors.conflict('Release the plan before running MRP on it.');
    return mrpService.enqueueRun(caller, 'mfg-mrp', {
      planId: id,
      horizonDays: Number(plan.horizonDays),
    });
  },
};

async function writeLine(
  tx: Parameters<typeof insertRow>[0],
  planId: string,
  l: PlanLineInput,
): Promise<void> {
  if (D(String(l.plannedQty)).lte(0))
    throw Errors.validation({ plannedQty: 'Enter a quantity greater than 0.' });
  const b = (
    await query(
      tx,
      `SELECT id::text FROM mfg_boms WHERE item_id=$1::uuid AND status='RELEASED' AND is_default AND deleted_at IS NULL LIMIT 1`,
      l.itemId,
    )
  )[0];
  if (!b) throw Errors.validation({ itemId: 'This item has no released bill of materials.' });
  await insertRow(tx, 'mfg_production_plan_lines', {
    planId,
    demandSource: l.demandSource ?? (l.soLineId ? 'SALES_ORDER' : 'MANUAL'),
    soLineId: l.soLineId ?? null,
    itemId: l.itemId,
    demandQty: D(String(l.demandQty ?? l.plannedQty)).toFixed(3),
    plannedQty: D(String(l.plannedQty)).toFixed(3),
    requiredDate: l.requiredDate,
    bomId: S(b.id),
  });
}
