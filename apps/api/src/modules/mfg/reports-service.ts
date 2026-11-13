// Phase 13 v2 reports (spec section 6 "Reports" and "Dashboard"): WIP and its reconciliation with the general ledger, cost sheets,
// OEE per work centre, plan adherence, yield, variances and the shop-floor summary. Every figure comes from logged events; with no
// data a report says "No data yet" (no fake numbers).
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { norm, query, scopeSql, todayIst } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D, oee } from './calc';
import { costing } from './costing-service';
import { S, oneUnit } from './master-service';
import { scheduleLoad } from './logic';

interface Paged {
  page: number;
  size: number;
}

const dayRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
};

export const reportsService = {
  /** Orders that hold WIP: the sum of their cost-ledger rows. */
  async wip(caller: Caller, pageId: string, q: Paged) {
    const sc = await scopeSql(caller, pageId);
    const base = `FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE ${sc.sql} AND t.status IN ('Released','In Progress','Completed')`;
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n ${base}`, ...sc.args))[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.id::text, t.number, t.status, t.qty, t.qty_completed, t.qty_scrapped, t.qty_received, t.due_date, i.code AS item_code, i.name AS item_name,
              COALESCE((SELECT sum(amount) FROM mfg_cost_ledger c WHERE c.order_id=t.id),0) AS wip_value,
              COALESCE((SELECT sum(o.qty_rework) FROM mfg_order_ops o WHERE o.order_id=t.id),0) AS qty_rework,
              (SELECT o.name FROM mfg_order_ops o WHERE o.order_id=t.id AND o.status <> 'Done' ORDER BY o.seq LIMIT 1) AS current_op
         ${base} ORDER BY t.due_date, t.number LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...sc.args,
    );
    const sum = (
      await query(
        prisma,
        `SELECT COALESCE(sum((SELECT COALESCE(sum(amount),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id)),0)::text AS v ${base}`,
        ...sc.args,
      )
    )[0]!;
    return { rows: rows.map((r) => norm<Row>(r)), total, totalValue: D(S(sum.v)).toFixed(2) };
  },

  /** WIP of the cost ledger against the INVENTORY_WIP account of the general ledger; a difference above Rs 1 is an exception. */
  async wipReconciliation(caller: Caller) {
    const unitId = oneUnit(caller);
    const led = (
      await query(
        prisma,
        `SELECT COALESCE(sum(amount),0)::text AS v FROM mfg_cost_ledger WHERE unit_id=$1::uuid`,
        unitId,
      )
    )[0]!;
    const gl = (
      await query(
        prisma,
        `SELECT COALESCE(sum(g.debit - g.credit),0)::text AS v FROM gl_entries g JOIN accounts a ON a.id=g.account_id WHERE a.code='1302' AND g.unit_id=$1::uuid`,
        unitId,
      )
    )[0]!;
    const diff = D(S(led.v)).minus(S(gl.v));
    return {
      ledger: D(S(led.v)).toFixed(2),
      generalLedger: D(S(gl.v)).toFixed(2),
      difference: diff.toFixed(2),
      exception: diff.abs().gt(1),
    };
  },

  async costing(
    caller: Caller,
    pageId: string,
    q: Paged & { status?: string | undefined; q?: string | undefined },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql, `t.status NOT IN ('Cancelled','Planned','Pending Approval')`];
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
      `SELECT t.id::text, t.number, t.status, t.qty, t.qty_completed, t.qty_received, i.code AS item_code, i.name AS item_name, i.standard_cost,
              (SELECT COALESCE(sum(amount) FILTER (WHERE event IN ('ISSUE','RETURN','BACKFLUSH')),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id) AS material,
              (SELECT COALESCE(sum(amount) FILTER (WHERE event='LABOUR'),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id) AS labour,
              (SELECT COALESCE(sum(amount) FILTER (WHERE event='OVERHEAD'),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id) AS overhead,
              (SELECT COALESCE(-sum(amount) FILTER (WHERE event='ABNORMAL_SCRAP'),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id) AS abnormal_scrap,
              (SELECT COALESCE(-sum(amount) FILTER (WHERE event='FG_RECEIPT'),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id) AS fg_value,
              (SELECT COALESCE(sum(amount),0) FROM mfg_cost_ledger c WHERE c.order_id=t.id) AS wip
         ${base} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const out = rows.map((r) => {
      const n = norm<Row>(r);
      const total2 = D(S(n.material)).plus(S(n.labour)).plus(S(n.overhead));
      const good = D(S(n.qtyCompleted));
      const unit = good.gt(0)
        ? total2.minus(S(n.abnormalScrap)).div(good).toDecimalPlaces(2)
        : null;
      return {
        ...n,
        total: total2.toFixed(2),
        unitCost: unit ? unit.toFixed(2) : null,
        variancePerUnit:
          unit && n.standardCost !== null && n.standardCost !== undefined
            ? unit.minus(S(n.standardCost)).toFixed(2)
            : null,
      };
    });
    return { rows: out, total };
  },

  async costSheet(caller: Caller, pageId: string, orderId: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    if (
      !(
        await query(
          prisma,
          `SELECT 1 FROM mfg_orders t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
          ...sc.args,
          orderId,
        )
      ).length
    )
      throw Errors.notFound('Production order not found.');
    return costing.sheet(prisma, orderId, false);
  },

  /**
   * OEE per work centre over a date range, from the logs only. Planned time = calendar shift hours - planned downtime; run time =
   * planned - unplanned downtime that counts against availability; performance = ideal cycle x pieces / run time (capped at 1);
   * quality = good / pieces.
   */
  async oee(caller: Caller, q: { from: string; to: string; workCentreId?: string | undefined }) {
    const unitId = oneUnit(caller);
    const wcs = await query(
      prisma,
      `SELECT w.id::text, w.code, w.name, w.hours_per_shift::text AS hps, w.shifts_per_day, w.oee_target_pct::text AS target, c.work_days
         FROM mfg_work_centres w LEFT JOIN mfg_wc_calendars c ON c.id=w.calendar_id
        WHERE w.unit_id=$1::uuid AND w.deleted_at IS NULL AND w.status='ACTIVE' ${q.workCentreId ? 'AND w.id=$2::uuid' : ''} ORDER BY w.code`,
      ...(q.workCentreId ? [unitId, q.workCentreId] : [unitId]),
    );
    const days = dayRange(q.from, q.to);
    const out: Row[] = [];
    for (const w of wcs) {
      const exc = await query(
        prisma,
        `SELECT x.exc_date::text AS d, x.available_hrs::text AS h FROM mfg_wc_calendar_exceptions x JOIN mfg_work_centres w ON w.calendar_id=x.calendar_id WHERE w.id=$1::uuid`,
        S(w.id),
      );
      const ex = new Map(exc.map((e) => [S(e.d), Number(S(e.h))]));
      const workDays = new Set<number>((w.work_days as number[] | null) ?? [1, 2, 3, 4, 5, 6]);
      let shiftMin = 0;
      for (const d of days) {
        const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
        shiftMin +=
          (ex.has(d)
            ? ex.get(d)!
            : workDays.has(wd)
              ? Number(S(w.hps)) * Number(w.shifts_per_day)
              : 0) * 60;
      }
      const dt = (
        await query(
          prisma,
          `SELECT COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(COALESCE(d.to_ts, now()), $3::timestamptz) - GREATEST(d.from_ts, $2::timestamptz))) / 60) FILTER (WHERE r.category='PLANNED'),0)::text AS planned,
                  COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(COALESCE(d.to_ts, now()), $3::timestamptz) - GREATEST(d.from_ts, $2::timestamptz))) / 60) FILTER (WHERE r.category='UNPLANNED' AND r.counts_against_availability),0)::text AS unplanned
             FROM mfg_downtime_logs d JOIN mfg_downtime_reasons r ON r.id=d.reason_id
            WHERE d.work_centre_id=$1::uuid AND d.from_ts < $3::timestamptz AND COALESCE(d.to_ts, now()) > $2::timestamptz`,
          S(w.id),
          `${q.from}T00:00:00Z`,
          `${q.to}T23:59:59Z`,
        )
      )[0]!;
      // Phase 14: the maintenance downtime events of the machine behind this work centre count as well (planned or not)
      const dte = (
        await query(
          prisma,
          `SELECT COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(COALESCE(e.end_at, now()), $3::timestamptz) - GREATEST(e.start_at, $2::timestamptz))) / 60) FILTER (WHERE e.dt_type='PLANNED'),0)::text AS planned,
                  COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(COALESCE(e.end_at, now()), $3::timestamptz) - GREATEST(e.start_at, $2::timestamptz))) / 60) FILTER (WHERE e.dt_type='UNPLANNED'),0)::text AS unplanned
             FROM downtime_events e
            WHERE e.work_centre_id=$1::uuid AND e.deleted_at IS NULL AND e.start_at < $3::timestamptz AND COALESCE(e.end_at, now()) > $2::timestamptz`,
          S(w.id),
          `${q.from}T00:00:00Z`,
          `${q.to}T23:59:59Z`,
        )
      )[0]!;
      dt.planned = D(S(dt.planned)).plus(S(dte.planned)).toFixed(2);
      dt.unplanned = D(S(dt.unplanned)).plus(S(dte.unplanned)).toFixed(2);
      const pcs = (
        await query(
          prisma,
          `SELECT COALESCE(sum(l.good),0)::text AS good, COALESCE(sum(l.good + l.rejected),0)::text AS total, COALESCE(sum((l.good + l.rejected) * o.run_minutes),0)::text AS ideal
             FROM mfg_job_card_time_logs l JOIN mfg_order_ops o ON o.id=l.op_id WHERE o.work_centre_id=$1::uuid AND l.from_ts >= $2::timestamptz AND l.from_ts <= $3::timestamptz`,
          S(w.id),
          `${q.from}T00:00:00Z`,
          `${q.to}T23:59:59Z`,
        )
      )[0]!;
      const total = D(S(pcs.total));
      if (total.lte(0) && D(S(dt.planned)).plus(S(dt.unplanned)).lte(0)) {
        out.push({
          workCentreId: S(w.id),
          code: S(w.code),
          name: S(w.name),
          noData: true,
          target: w.target ? S(w.target) : null,
        });
        continue;
      }
      const cycle = total.gt(0) ? D(S(pcs.ideal)).div(total) : D(0);
      const r = oee({
        shiftMinutes: shiftMin,
        plannedDowntimeMinutes: D(S(dt.planned)).toFixed(2),
        unplannedDowntimeMinutes: D(S(dt.unplanned)).toFixed(2),
        idealCycleMinutes: cycle.toFixed(6),
        totalPieces: total,
        goodPieces: S(pcs.good),
      });
      out.push({
        workCentreId: S(w.id),
        code: S(w.code),
        name: S(w.name),
        noData: false,
        shiftMinutes: shiftMin,
        plannedDowntime: D(S(dt.planned)).toFixed(0),
        unplannedDowntime: D(S(dt.unplanned)).toFixed(0),
        pieces: total.toFixed(0),
        good: S(pcs.good),
        ...r,
        target: w.target ? S(w.target) : null,
      });
    }
    return { from: q.from, to: q.to, rows: out };
  },

  /** Orders closed or completed in the range: how many were on or before their due date. */
  async planAdherence(caller: Caller, pageId: string, q: { from: string; to: string }) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args, q.from, q.to];
    const rows = await query(
      prisma,
      `SELECT t.number, t.due_date::text AS due, COALESCE(t.closed_at, t.updated_at)::date::text AS done, i.name AS item_name, (COALESCE(t.closed_at, t.updated_at)::date <= t.due_date) AS on_time
         FROM mfg_orders t JOIN items i ON i.id=t.item_id
        WHERE ${sc.sql} AND t.status IN ('Completed','Closed') AND t.due_date BETWEEN $${sc.args.length + 1}::date AND $${sc.args.length + 2}::date ORDER BY t.due_date`,
      ...args,
    );
    const onTime = rows.filter((r) => r.on_time === true).length;
    return {
      total: rows.length,
      onTime,
      pct: rows.length ? ((onTime / rows.length) * 100).toFixed(1) : null,
      rows: rows.map((r) => norm<Row>(r)),
    };
  },

  /** Yield: good pieces out of the pieces started, per order. */
  async yieldReport(caller: Caller, pageId: string, q: Paged) {
    const sc = await scopeSql(caller, pageId);
    const rows = await query(
      prisma,
      `SELECT t.id::text, t.number, i.name AS item_name, t.qty, t.qty_completed, t.qty_scrapped, t.qty_rejected,
              CASE WHEN t.qty > 0 THEN round(t.qty_completed / t.qty * 100, 2) END AS yield_pct
         FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE ${sc.sql} AND t.status IN ('In Progress','Completed','Closed') ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...sc.args,
    );
    return { rows: rows.map((r) => norm<Row>(r)) };
  },

  async variances(caller: Caller, pageId: string, q: Paged) {
    const sc = await scopeSql(caller, pageId);
    const ids = await query(
      prisma,
      `SELECT t.id::text FROM mfg_orders t WHERE ${sc.sql} AND t.status IN ('In Progress','Completed','Closed') ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...sc.args,
    );
    const out: Row[] = [];
    for (const r of ids) {
      const o = (
        await query(
          prisma,
          `SELECT t.number, i.name AS item_name FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE t.id=$1::uuid`,
          S(r.id),
        )
      )[0]!;
      out.push({
        number: S(o.number),
        itemName: S(o.item_name),
        ...(await costing.variances(caller, pageId, S(r.id))),
      });
    }
    return { rows: out };
  },

  /** The supervisor dashboard for one day: OEE per work centre against its target, rejection %, downtime minutes, good pieces by hour. */
  async shopFloor(caller: Caller, q: { date?: string | undefined }) {
    const unitId = oneUnit(caller);
    const date = q.date ?? todayIst();
    const o = await reportsService.oee(caller, { from: date, to: date });
    const dtm = (
      await query(
        prisma,
        `SELECT COALESCE(sum(minutes),0)::text AS m FROM mfg_downtime_logs WHERE unit_id=$1::uuid AND from_ts::date = $2::date AND to_ts IS NOT NULL`,
        unitId,
        date,
      )
    )[0]!;
    const pieces = (
      await query(
        prisma,
        `SELECT COALESCE(sum(good),0)::text AS good, COALESCE(sum(rejected),0)::text AS rej FROM mfg_job_card_time_logs WHERE unit_id=$1::uuid AND from_ts::date = $2::date`,
        unitId,
        date,
      )
    )[0]!;
    const hourly = await query(
      prisma,
      `SELECT EXTRACT(HOUR FROM (COALESCE(to_ts, from_ts) AT TIME ZONE 'Asia/Kolkata'))::int AS hour, sum(good)::text AS good FROM mfg_job_card_time_logs
        WHERE unit_id=$1::uuid AND (COALESCE(to_ts, from_ts) AT TIME ZONE 'Asia/Kolkata')::date = $2::date GROUP BY 1 ORDER BY 1`,
      unitId,
      date,
    );
    const status = await query(
      prisma,
      `SELECT status, count(*)::int AS n FROM mfg_orders WHERE unit_id=$1::uuid AND deleted_at IS NULL AND status IN ('Planned','Pending Approval','Released','In Progress','Completed') GROUP BY status`,
      unitId,
    );
    const late = await query(
      prisma,
      `SELECT t.id::text, t.number, t.due_date, t.status, i.name AS item_name FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE t.unit_id=$1::uuid AND t.deleted_at IS NULL AND t.status IN ('Planned','Pending Approval','Released','In Progress') AND t.due_date < $2::date ORDER BY t.due_date LIMIT 50`,
      unitId,
      date,
    );
    const total = D(S(pieces.good)).plus(S(pieces.rej));
    return {
      date,
      empty: total.lte(0) && o.rows.every((r) => r.noData === true),
      oee: o.rows,
      rejectionPct: total.gt(0) ? D(S(pieces.rej)).div(total).mul(100).toFixed(2) : null,
      downtimeMinutes: D(S(dtm.m)).toFixed(0),
      goodPieces: S(pieces.good),
      hourly: hourly.map((h) => ({ hour: Number(h.hour), good: S(h.good) })),
      orders: Object.fromEntries(status.map((r) => [S(r.status), Number(r.n)])),
      overdue: late.map((r) => norm<Row>(r)),
    };
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
};

void scheduleLoad;
