// Phase 13 registers and monitors: scrap, rework, WIP, costing and the shop-floor dashboard. All figures are server numbers
// (R-15). Costing is figures only: material from the stock issues, conversion from logged minutes at the work centre's rate
// copied onto the order at release. Nothing here posts to the ledger.
import { prisma } from '../../core/db/prisma';
import { norm, query, scopeSql, todayIst } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D, materialCost, scheduleLoad } from './logic';
import { S } from './master-service';

interface Paged {
  page: number;
  size: number;
}

export const reportsService = {
  async listScrap(
    caller: Caller,
    pageId: string,
    q: Paged & {
      orderId?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
      q?: string | undefined;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql, `t.status='Recorded'`];
    if (q.orderId) {
      args.push(q.orderId);
      where.push(`t.order_id=$${args.length}::uuid`);
    }
    if (q.from) {
      args.push(q.from);
      where.push(`t.scrap_date >= $${args.length}::date`);
    }
    if (q.to) {
      args.push(q.to);
      where.push(`t.scrap_date <= $${args.length}::date`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.number ILIKE $${args.length} OR t.reason ILIKE $${args.length} OR i.name ILIKE $${args.length} OR o.number ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const base = `FROM mfg_scrap t JOIN items i ON i.id=t.item_id JOIN mfg_orders o ON o.id=t.order_id LEFT JOIN mfg_order_ops p ON p.id=t.op_id WHERE ${w}`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n ${base}`, ...args))[0]!.n);
    const sum = (
      await query(prisma, `SELECT COALESCE(sum(t.qty),0)::text AS q ${base}`, ...args)
    )[0]!;
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, o.number AS order_number, p.name AS op_name ${base}
        ORDER BY t.scrap_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total, totalQty: S(sum.q) };
  },

  async listRework(
    caller: Caller,
    pageId: string,
    q: Paged & {
      status?: string | undefined;
      orderId?: string | undefined;
      q?: string | undefined;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.orderId) {
      args.push(q.orderId);
      where.push(`t.order_id=$${args.length}::uuid`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.number ILIKE $${args.length} OR t.reason ILIKE $${args.length} OR i.name ILIKE $${args.length} OR o.number ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const base = `FROM mfg_rework t JOIN items i ON i.id=t.item_id JOIN mfg_orders o ON o.id=t.order_id JOIN mfg_order_ops p ON p.id=t.op_id WHERE ${w}`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n ${base}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, o.number AS order_number, p.name AS op_name ${base}
        ORDER BY t.status, t.rework_date DESC, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  /** Orders that still hold material: issued value less the value already received as finished goods. */
  async wip(caller: Caller, pageId: string, q: Paged) {
    const sc = await scopeSql(caller, pageId);
    const base = `FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE ${sc.sql} AND t.status IN ('Released','In Progress','Completed')`;
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n ${base}`, ...sc.args))[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.id::text, t.number, t.status, t.qty, t.qty_completed, t.qty_scrapped, t.qty_received, t.due_date, i.code AS item_code, i.name AS item_name,
              COALESCE((SELECT sum(m.issued_value - m.returned_value) FROM mfg_order_materials m WHERE m.order_id=t.id),0) AS material_value,
              COALESCE((SELECT sum(v.total_value) FROM mfg_order_moves v WHERE v.order_id=t.id AND v.kind='FG_RECEIPT'),0) AS received_value,
              COALESCE((SELECT sum(o.qty_rework) FROM mfg_order_ops o WHERE o.order_id=t.id),0) AS qty_rework,
              (SELECT o.name FROM mfg_order_ops o WHERE o.order_id=t.id AND o.status <> 'Done' ORDER BY o.seq LIMIT 1) AS current_op
         ${base} ORDER BY t.due_date, t.number LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...sc.args,
    );
    const out = rows.map((r) => {
      const n = norm<Row>(r);
      const wip = D(S(n.materialValue)).minus(S(n.receivedValue));
      return { ...n, wipValue: (wip.gt(0) ? wip : D(0)).toFixed(2) };
    });
    // the figure covers every live order, not only the rows of this page
    const sum = (
      await query(
        prisma,
        `SELECT COALESCE(sum(GREATEST(
            COALESCE((SELECT sum(m.issued_value - m.returned_value) FROM mfg_order_materials m WHERE m.order_id=t.id),0)
          - COALESCE((SELECT sum(v.total_value) FROM mfg_order_moves v WHERE v.order_id=t.id AND v.kind='FG_RECEIPT'),0), 0)),0)::text AS v
           ${base}`,
        ...sc.args,
      )
    )[0]!;
    return { rows: out, total, totalValue: D(S(sum.v)).toFixed(2) };
  },

  async costing(
    caller: Caller,
    pageId: string,
    q: Paged & { status?: string | undefined; q?: string | undefined },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql, `t.status NOT IN ('Cancelled','Planned')`];
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.number ILIKE $${args.length} OR i.code ILIKE $${args.length} OR i.name ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const base = `FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE ${w}`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n ${base}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `SELECT t.id::text, t.number, t.status, t.qty, t.qty_completed, i.code AS item_code, i.name AS item_name, i.standard_cost,
              COALESCE((SELECT sum(m.issued_value) FROM mfg_order_materials m WHERE m.order_id=t.id),0) AS issued_value,
              COALESCE((SELECT sum(m.returned_value) FROM mfg_order_materials m WHERE m.order_id=t.id),0) AS returned_value,
              COALESCE((SELECT sum(round(o.actual_minutes / 60 * o.cost_per_hour, 2)) FROM mfg_order_ops o WHERE o.order_id=t.id),0) AS conversion,
              COALESCE((SELECT sum(o.actual_minutes) FROM mfg_order_ops o WHERE o.order_id=t.id),0) AS minutes,
              COALESCE((SELECT sum(m.cost) FROM mfg_outside_moves m WHERE m.order_id=t.id AND m.direction='RECEIVED'),0) AS outside,
              COALESCE((SELECT sum(r.cost) FROM mfg_rework r WHERE r.order_id=t.id AND r.status='Done'),0) AS rework_cost
         ${base} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const out = rows.map((r) => {
      const n = norm<Row>(r);
      const mat = materialCost({
        issuedValue: S(n.issuedValue),
        returnedValue: S(n.returnedValue),
      });
      const conv = D(S(n.conversion));
      const outside = D(S(n.outside));
      const totalCost = mat.plus(conv).plus(outside);
      const good = D(S(n.qtyCompleted));
      const unit = good.gt(0) ? totalCost.div(good).toDecimalPlaces(4) : null;
      const std =
        n.standardCost === null || n.standardCost === undefined ? null : D(S(n.standardCost));
      return {
        ...n,
        material: mat.toFixed(2),
        conversion: conv.toFixed(2),
        outside: outside.toFixed(2),
        reworkCost: D(S(n.reworkCost)).toFixed(2),
        total: totalCost.toFixed(2),
        unitCost: unit ? unit.toFixed(4) : null,
        variancePerUnit: unit && std ? unit.minus(std).toFixed(4) : null,
      };
    });
    return { rows: out, total };
  },

  /**
   * Forward finite loading of the released orders on the work centres: each operation takes the free minutes of its work
   * center day by day, operations of an order one after the other. No holiday calendar (Phase 15): only the weekdays given.
   */
  async capacity(
    caller: Caller,
    pageId: string,
    q: { from?: string | undefined; workDays?: string | undefined; days?: number | undefined },
  ) {
    const sc = await scopeSql(caller, pageId);
    const from = q.from ?? todayIst();
    const workDays = new Set(
      (q.workDays ?? '0,1,2,3,4,5,6')
        .split(',')
        .map((x) => Number(x))
        .filter((x) => x >= 0 && x <= 6),
    );
    const rows = await query(
      prisma,
      `SELECT o.id::text AS op_id, t.id::text AS order_id, t.number, o.seq, o.name AS op_name, o.work_centre_id::text AS wc_id, w.code AS wc_code, w.name AS wc_name,
              w.capacity_hours::text AS capacity_hours,
              GREATEST(o.setup_minutes + o.run_minutes * t.qty - (o.actual_minutes - COALESCE((SELECT sum(r.minutes) FROM mfg_rework r WHERE r.op_id=o.id AND r.status='Done'),0)), 0)::text AS minutes,
              t.due_date::text AS due, COALESCE(t.start_date, $${sc.args.length + 1}::date)::text AS start
         FROM mfg_order_ops o JOIN mfg_orders t ON t.id=o.order_id JOIN mfg_work_centres w ON w.id=o.work_centre_id
        WHERE ${sc.sql} AND t.status IN ('Released','In Progress') AND o.status <> 'Done' AND w.kind <> 'OUTSIDE'`,
      ...sc.args,
      from,
    );
    const perDay = new Map<string, number>();
    const names = new Map<string, { code: string; name: string }>();
    for (const r of rows) {
      perDay.set(S(r.wc_id), Number(S(r.capacity_hours)) * 60);
      names.set(S(r.wc_id), { code: S(r.wc_code), name: S(r.wc_name) });
    }
    const res = scheduleLoad(
      rows.map((r) => ({
        orderId: S(r.order_id),
        orderNo: S(r.number),
        opId: S(r.op_id),
        seq: Number(r.seq),
        workCentreId: S(r.wc_id),
        minutes: Number(S(r.minutes)),
        due: S(r.due),
        start: S(r.start),
      })),
      { perDay, workDays },
      from,
      q.days ?? 120,
    );
    const opName = new Map(rows.map((r) => [S(r.op_id), `${S(r.seq)} · ${S(r.op_name)}`]));
    return {
      from,
      workDays: [...workDays].sort(),
      orders: res.orders,
      ops: res.ops.map((o) => ({
        ...o,
        opName: opName.get(o.opId) ?? '',
        workCentre: names.get(o.workCentreId)?.code ?? '',
      })),
      days: res.days.map((d) => ({
        ...d,
        workCentre: names.get(d.workCentreId)?.code ?? '',
        load: Math.round(d.load),
        capacity: Math.round(d.capacity),
      })),
    };
  },

  async shopFloor(caller: Caller, pageId: string) {
    const sc = await scopeSql(caller, pageId);
    const today = todayIst();
    const n = sc.args.length + 1;
    const [byStatus, running, overdue, todayLogs, load] = await Promise.all([
      query(
        prisma,
        `SELECT t.status, count(*)::int AS n FROM mfg_orders t WHERE ${sc.sql} AND t.status IN ('Planned','Released','In Progress','Completed') GROUP BY t.status`,
        ...sc.args,
      ),
      query(
        prisma,
        `SELECT o.id::text AS op_id, t.id::text AS order_id, t.number, i.name AS item_name, o.seq, o.name AS op_name, w.code AS work_centre_code,
                o.qty_done, o.qty_scrap, o.qty_rework, o.inspection_required
           FROM mfg_order_ops o JOIN mfg_orders t ON t.id=o.order_id JOIN items i ON i.id=t.item_id JOIN mfg_work_centres w ON w.id=o.work_centre_id
          WHERE ${sc.sql} AND t.status IN ('Released','In Progress') AND o.status='In Progress' ORDER BY w.code, t.number`,
        ...sc.args,
      ),
      query(
        prisma,
        `SELECT t.id::text, t.number, t.due_date, t.status, t.qty, t.qty_completed, i.name AS item_name FROM mfg_orders t JOIN items i ON i.id=t.item_id
          WHERE ${sc.sql} AND t.status IN ('Planned','Released','In Progress') AND t.due_date < $${n}::date ORDER BY t.due_date LIMIT 50`,
        ...sc.args,
        today,
      ),
      query(
        prisma,
        `SELECT COALESCE(sum(l.qty_good),0)::text AS good, COALESCE(sum(l.qty_scrap),0)::text AS scrap, COALESCE(sum(l.qty_rework),0)::text AS rework, COALESCE(sum(l.minutes),0)::text AS minutes
           FROM mfg_op_logs l JOIN mfg_orders t ON t.id=l.order_id WHERE ${sc.sql} AND l.log_date = $${n}::date`,
        ...sc.args,
        today,
      ),
      query(
        prisma,
        `SELECT w.code, w.name, w.capacity_hours,
                COALESCE(sum((o.setup_minutes + o.run_minutes * t.qty) - o.actual_minutes) FILTER (WHERE o.status <> 'Done'),0)::text AS minutes_left
           FROM mfg_work_centres w
           LEFT JOIN mfg_order_ops o ON o.work_centre_id=w.id
           LEFT JOIN mfg_orders t ON t.id=o.order_id AND t.status IN ('Released','In Progress')
          WHERE w.unit_id = $1::uuid AND w.deleted_at IS NULL AND w.status='ACTIVE' GROUP BY w.id ORDER BY w.code`,
        caller.ctx.unitId ?? '00000000-0000-0000-0000-000000000000',
      ),
    ]);
    return {
      date: today,
      orders: Object.fromEntries(byStatus.map((r) => [S(r.status), Number(r.n)])),
      running: running.map((r) => norm<Row>(r)),
      overdue: overdue.map((r) => norm<Row>(r)),
      today: norm<Row>(todayLogs[0]!),
      load: load.map((r) => {
        const x = norm<Row>(r);
        const left = D(S(x.minutesLeft));
        const pos = left.gt(0) ? left : D(0);
        const days = D(S(x.capacityHours)).gt(0) ? pos.div(60).div(S(x.capacityHours)) : D(0);
        return {
          ...x,
          minutesLeft: pos.toFixed(0),
          daysOfWork: days.toDecimalPlaces(1).toFixed(1),
        };
      }),
    };
  },
};
