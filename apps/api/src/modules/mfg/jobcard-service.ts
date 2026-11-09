// Phase 13 v2 shop floor: one job card per operation of an order. Start (setup or run) opens a time log, Pause (with a downtime
// reason) closes it and opens a downtime, Resume reverses that, Complete takes the keypad quantities (good / rejected / scrap /
// rework) and finishes the card: back-flushes the components of that operation, absorbs the labour and overhead of the logged
// hours into WIP, and sends the good pieces to the inspection checkpoint when the operation needs one. Rules: an operation can
// process at most the previous operation's good (accepted) quantity; good + rejected + scrap + rework never exceed that input.
import { randomUUID } from 'node:crypto';
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import { TX, audit, exec, insertRow, norm, query, scopeSql, todayIst } from '../procurement/core';
import type { Row } from '../procurement/core';
import { createInspection } from '../qms/inspection-service';
import type { Caller } from '../records/service';
import { mfgError } from './bom-service';
import { D, r3 } from './calc';
import { costing } from './costing-service';
import { S, oneUnit } from './master-service';
import { LIVE, backflushOrder, lockOrder } from './order-service';
import { scrapService } from './scrap-service';

interface Card {
  order: Row;
  ops: Row[];
  idx: number;
  op: Row;
  qtyIn: string;
}

/** Pieces this operation may process: the order quantity (plus the tolerance) for the first, the previous operation's good for the rest. */
async function qtyInOf(tx: Db, order: Row, ops: Row[], idx: number): Promise<string> {
  if (idx === 0)
    return r3(D(S(order.qty)).mul(D(1).plus(D(S(order.over_production_pct)).div(100)))).toFixed(3);
  const prev = ops[idx - 1]!;
  if (prev.inspection_required !== true) return D(S(prev.qty_done)).toFixed(3);
  const a = (
    await query(
      tx,
      `SELECT COALESCE(sum(q.accepted_qty),0)::text AS a FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.op_id=$1::uuid AND q.status='Decided'`,
      S(prev.id),
    )
  )[0]!;
  return D(S(a.a)).toFixed(3);
}

async function loadCard(tx: Db, sc: { sql: string; args: unknown[] }, opId: string): Promise<Card> {
  const o = (
    await query(tx, `SELECT order_id::text FROM mfg_order_ops WHERE id=$1::uuid`, opId)
  )[0];
  if (!o) throw Errors.notFound('Job card not found.');
  const order = await lockOrder(tx, sc, S(o.order_id)); // lock order -> job card -> stock
  const ops = await query(
    tx,
    `SELECT o.*, w.kind AS wc_kind, w.code AS wc_code FROM mfg_order_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.order_id=$1::uuid ORDER BY o.seq FOR UPDATE OF o`,
    S(order.id),
  );
  const idx = ops.findIndex((x) => S(x.id) === opId);
  return { order, ops, idx, op: ops[idx]!, qtyIn: await qtyInOf(tx, order, ops, idx) };
}
const processed = (op: Row): ReturnType<typeof D> =>
  D(S(op.qty_done)).plus(S(op.qty_rejected)).plus(S(op.qty_scrap)).plus(S(op.qty_rework));

/** qty_completed = the good quantity that left the last operation (after its inspection); scrap and rejects are totalled. */
export async function syncOrder(tx: Db, orderId: string): Promise<void> {
  const ops = await query(
    tx,
    `SELECT * FROM mfg_order_ops WHERE order_id=$1::uuid ORDER BY seq`,
    orderId,
  );
  if (!ops.length) return;
  const last = ops[ops.length - 1]!;
  let good = D(S(last.qty_done));
  if (last.inspection_required === true) {
    const a = (
      await query(
        tx,
        `SELECT COALESCE(sum(q.accepted_qty),0)::text AS a FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.op_id=$1::uuid AND q.status='Decided'`,
        S(last.id),
      )
    )[0]!;
    good = D(S(a.a));
  }
  const rej = ops.reduce((a, o) => a.plus(S(o.qty_rejected)), D(0));
  await exec(
    tx,
    `UPDATE mfg_orders SET qty_completed=$1::numeric, qty_rejected=$2::numeric WHERE id=$3::uuid`,
    good.toFixed(3),
    rej.toFixed(3),
    orderId,
  );
}

function overlapError(e: unknown): never {
  if (e instanceof Error && /TIME_LOG_OVERLAP/.test(e.message))
    throw mfgError(
      'TIME_LOG_OVERLAP',
      'This time overlaps another time log of the job card.',
      undefined,
      409,
    );
  throw e as Error;
}

async function openLog(tx: Db, opId: string): Promise<Row | undefined> {
  return (
    await query(
      tx,
      `SELECT * FROM mfg_job_card_time_logs WHERE op_id=$1::uuid AND to_ts IS NULL FOR UPDATE`,
      opId,
    )
  )[0];
}
/** Closes a log now (or at `at`) and adds its minutes to the card's setup / run totals. */
async function closeLog(
  tx: Db,
  log: Row,
  opId: string,
  extra: { good?: string; rejected?: string } = {},
  at?: string,
): Promise<number> {
  await exec(
    tx,
    `UPDATE mfg_job_card_time_logs SET to_ts=COALESCE($1::timestamptz, now()), good=good+$2::numeric, rejected=rejected+$3::numeric WHERE id=$4::uuid`,
    at ?? null,
    extra.good ?? '0',
    extra.rejected ?? '0',
    S(log.id),
  );
  const m = (
    await query(
      tx,
      `SELECT round((EXTRACT(EPOCH FROM (to_ts - from_ts)) / 60)::numeric, 2)::text AS m FROM mfg_job_card_time_logs WHERE id=$1::uuid`,
      S(log.id),
    )
  )[0]!;
  const col = S(log.kind) === 'SETUP' ? 'setup_minutes_actual' : 'run_minutes_actual';
  await exec(
    tx,
    `UPDATE mfg_order_ops SET ${col}=${col}+$1::numeric, actual_minutes=actual_minutes+$1::numeric WHERE id=$2::uuid`,
    S(m.m),
    opId,
  );
  return Number(S(m.m));
}

export const jobCardService = {
  /** The queue of an operator or supervisor: cards of running orders, with the quantity each may still process. */
  async list(
    caller: Caller,
    pageId: string,
    q: {
      workCentreId?: string | undefined;
      status?: string | undefined;
      orderId?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql, `t.status IN ('Released','In Progress')`];
    if (q.workCentreId) {
      args.push(q.workCentreId);
      where.push(`c.work_centre_id=$${args.length}::uuid`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`c.status=$${args.length}`);
    }
    if (q.orderId) {
      args.push(q.orderId);
      where.push(`c.order_id=$${args.length}::uuid`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.number ILIKE $${args.length} OR i.name ILIKE $${args.length} OR c.name ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const base = `FROM (
        SELECT o.*, lag(CASE WHEN o.inspection_required THEN COALESCE((SELECT sum(q.accepted_qty) FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.op_id=o.id AND q.status='Decided'),0) ELSE o.qty_done END)
                  OVER (PARTITION BY o.order_id ORDER BY o.seq) AS prev_good FROM mfg_order_ops o) c
      JOIN mfg_orders t ON t.id=c.order_id JOIN items i ON i.id=t.item_id JOIN mfg_work_centres w ON w.id=c.work_centre_id WHERE ${w}`;
    const total = Number((await query(prisma, `SELECT count(*)::int AS n ${base}`, ...args))[0]!.n);
    const rows = await query(
      prisma,
      `SELECT c.id::text, c.order_id::text, c.seq, c.name, c.status, c.qty_done, c.qty_rejected, c.qty_scrap, c.qty_rework, c.inspection_required AS qc_required,
              COALESCE(c.prev_good, t.qty * (1 + t.over_production_pct / 100)) AS qty_in, t.number AS order_number, t.priority, t.due_date, i.name AS item_name, w.code AS work_centre_code, w.name AS work_centre_name,
              c.work_centre_id::text,
              EXISTS (SELECT 1 FROM mfg_job_card_time_logs x WHERE x.op_id=c.id AND x.to_ts IS NULL) AS running
         ${base} ORDER BY t.priority, t.due_date, t.number, c.seq LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, opId: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const o = (
      await query(
        prisma,
        `SELECT c.*, t.number AS order_number, t.status AS order_status, t.qty AS order_qty, t.over_production_pct, t.due_date, i.name AS item_name, w.code AS work_centre_code
           FROM mfg_order_ops c JOIN mfg_orders t ON t.id=c.order_id JOIN items i ON i.id=t.item_id JOIN mfg_work_centres w ON w.id=c.work_centre_id
          WHERE c.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        opId,
      )
    )[0];
    if (!o) throw Errors.notFound('Job card not found.');
    const all = await query(
      prisma,
      `SELECT * FROM mfg_order_ops WHERE order_id=$1::uuid ORDER BY seq`,
      S(o.order_id),
    );
    const idx = all.findIndex((x) => S(x.id) === opId);
    const qtyIn = await qtyInOf(
      prisma,
      { qty: o.order_qty, over_production_pct: o.over_production_pct },
      all,
      idx,
    );
    const logs = await query(
      prisma,
      `SELECT id::text, from_ts, to_ts, kind, operator_name, good, rejected FROM mfg_job_card_time_logs WHERE op_id=$1::uuid ORDER BY from_ts`,
      opId,
    );
    const dts = await query(
      prisma,
      `SELECT d.id::text, d.from_ts, d.to_ts, d.minutes, r.code AS reason_code, r.name AS reason_name, d.remarks FROM mfg_downtime_logs d JOIN mfg_downtime_reasons r ON r.id=d.reason_id WHERE d.op_id=$1::uuid ORDER BY d.from_ts`,
      opId,
    );
    return {
      ...norm<Row>(o),
      qtyIn,
      remaining: D(qtyIn).minus(processed(o)).toFixed(3),
      timeLogs: logs.map((r) => norm<Row>(r)),
      downtime: dts.map((r) => norm<Row>(r)),
    };
  },

  /** Start setup or run. A double tap with the same Idempotency-Key is harmless. */
  async start(
    caller: Caller,
    pageId: string,
    opId: string,
    b: {
      kind: 'SETUP' | 'RUN';
      operator?: string | undefined;
      idempotencyKey?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const c = await loadCard(tx, sc, opId);
      if (
        b.idempotencyKey &&
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_job_card_time_logs WHERE op_id=$1::uuid AND idempotency_key=$2`,
            opId,
            b.idempotencyKey,
          )
        ).length
      )
        return;
      if (!LIVE.includes(S(c.order.status)))
        throw Errors.conflict('Production can start on a released order only.');
      if (S(c.op.status) === 'Done') throw Errors.conflict('This job card is already complete.');
      if (S(c.op.wc_kind) === 'OUTSIDE')
        throw mfgError(
          'ORDER_OUTSIDE_OP_V1',
          'Outside (subcontract) operations arrive in Phase 13b.',
        );
      if (await openLog(tx, opId)) throw Errors.conflict('This job card is already running.');
      if (S(c.op.status) === 'Paused') throw Errors.conflict('This job card is paused. Resume it.');
      if (D(c.qtyIn).minus(processed(c.op)).lte(0)) {
        const prev = c.idx > 0 ? c.ops[c.idx - 1]! : null;
        throw mfgError(
          'JC_QTY_EXCEEDS_PREVIOUS',
          `Op ${S(c.op.seq)} can process at most ${D(c.qtyIn).toFixed(3)} (good qty from op ${prev ? S(prev.seq) : '—'}).`,
          undefined,
          422,
        );
      }
      if (S(c.op.status) === 'Pending' && c.idx === 0) {
        const mats = await query(
          tx,
          `SELECT issued_qty, issue_method FROM mfg_order_materials WHERE order_id=$1::uuid AND NOT customer_supplied`,
          S(c.order.id),
        );
        const manual = mats.filter((m) => S(m.issue_method) === 'MANUAL');
        if (manual.length && manual.every((m) => D(S(m.issued_qty)).lte(0)))
          throw Errors.conflict('Issue material to the order before production starts.');
      }
      try {
        await insertRow(tx, 'mfg_job_card_time_logs', {
          unitId: S(c.order.unit_id),
          orderId: S(c.order.id),
          opId,
          fromTs: new Date().toISOString(),
          kind: b.kind,
          operatorName: b.operator ?? null,
          idempotencyKey: b.idempotencyKey ?? null,
          createdById: caller.auth.userId,
        });
      } catch (e) {
        overlapError(e);
      }
      await exec(
        tx,
        `UPDATE mfg_order_ops SET status='In Progress', started_at=COALESCE(started_at, now()) WHERE id=$1::uuid`,
        opId,
      );
      await exec(
        tx,
        `UPDATE mfg_orders SET status='In Progress', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid AND status='Released'`,
        caller.auth.userId,
        S(c.order.id),
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JOBCARD_STARTED',
        'mfg_order',
        { id: S(c.order.id), code: S(c.order.number) },
        pageId,
        { op: S(c.op.name), kind: b.kind },
      );
    }, TX);
    return jobCardService.get(caller, pageId, opId);
  },

  /** Pause: the running time log closes and a downtime starts with the chosen reason. */
  async pause(
    caller: Caller,
    pageId: string,
    opId: string,
    b: { reasonId: string; remarks?: string | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const c = await loadCard(tx, sc, opId);
      if (S(c.op.status) !== 'In Progress')
        throw Errors.conflict('Only a running job card can be paused.');
      const reason = (
        await query(
          tx,
          `SELECT 1 FROM mfg_downtime_reasons WHERE id=$1::uuid AND status='ACTIVE'`,
          b.reasonId,
        )
      )[0];
      if (!reason) throw Errors.validation({ reasonId: 'Choose a downtime reason.' });
      const log = await openLog(tx, opId);
      if (log) await closeLog(tx, log, opId);
      await insertRow(tx, 'mfg_downtime_logs', {
        unitId: S(c.order.unit_id),
        workCentreId: S(c.op.work_centre_id),
        opId,
        reasonId: b.reasonId,
        fromTs: new Date().toISOString(),
        remarks: b.remarks ?? null,
        createdById: caller.auth.userId,
      });
      await exec(tx, `UPDATE mfg_order_ops SET status='Paused' WHERE id=$1::uuid`, opId);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JOBCARD_PAUSED',
        'mfg_order',
        { id: S(c.order.id), code: S(c.order.number) },
        pageId,
        { op: S(c.op.name) },
      );
    }, TX);
    return jobCardService.get(caller, pageId, opId);
  },

  async resume(
    caller: Caller,
    pageId: string,
    opId: string,
    b: { operator?: string | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const c = await loadCard(tx, sc, opId);
      if (S(c.op.status) !== 'Paused')
        throw Errors.conflict('Only a paused job card can be resumed.');
      await exec(
        tx,
        `UPDATE mfg_downtime_logs SET to_ts=now() WHERE op_id=$1::uuid AND to_ts IS NULL`,
        opId,
      );
      try {
        await insertRow(tx, 'mfg_job_card_time_logs', {
          unitId: S(c.order.unit_id),
          orderId: S(c.order.id),
          opId,
          fromTs: new Date().toISOString(),
          kind: 'RUN',
          operatorName: b.operator ?? null,
          createdById: caller.auth.userId,
        });
      } catch (e) {
        overlapError(e);
      }
      await exec(tx, `UPDATE mfg_order_ops SET status='In Progress' WHERE id=$1::uuid`, opId);
    }, TX);
    return jobCardService.get(caller, pageId, opId);
  },

  /** A finished time entry (for work noted on paper): the times, the operator and the pieces of that stretch. Times cannot overlap. */
  async logTime(
    caller: Caller,
    pageId: string,
    opId: string,
    b: {
      kind: 'SETUP' | 'RUN';
      fromTs: string;
      toTs: string;
      operator?: string | undefined;
      good?: string | number | undefined;
      rejected?: string | number | undefined;
      idempotencyKey?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    if (b.toTs < b.fromTs) throw Errors.validation({ toTs: 'The end is before the start.' });
    await prisma.$transaction(async (tx) => {
      const c = await loadCard(tx, sc, opId);
      if (!LIVE.includes(S(c.order.status)))
        throw Errors.conflict('Time can be logged on a released order only.');
      if (S(c.op.status) === 'Done') throw Errors.conflict('This job card is already complete.');
      if (
        b.idempotencyKey &&
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_job_card_time_logs WHERE op_id=$1::uuid AND idempotency_key=$2`,
            opId,
            b.idempotencyKey,
          )
        ).length
      )
        return;
      const good = D(String(b.good ?? 0));
      const rej = D(String(b.rejected ?? 0));
      if (good.lt(0) || rej.lt(0))
        throw Errors.validation({ good: 'Quantities cannot be negative.' });
      if (processed(c.op).plus(good).plus(rej).gt(c.qtyIn))
        throw mfgError(
          'JC_QTY_SUM',
          `Good + rejected + scrap + rework (${processed(c.op).plus(good).plus(rej).toFixed(3)}) exceeds input ${D(c.qtyIn).toFixed(3)}.`,
        );
      let id: string;
      try {
        id = await insertRow(tx, 'mfg_job_card_time_logs', {
          unitId: S(c.order.unit_id),
          orderId: S(c.order.id),
          opId,
          fromTs: b.fromTs,
          toTs: b.toTs,
          kind: b.kind,
          operatorName: b.operator ?? null,
          good: good.toFixed(3),
          rejected: rej.toFixed(3),
          idempotencyKey: b.idempotencyKey ?? null,
          createdById: caller.auth.userId,
        });
      } catch (e) {
        overlapError(e);
      }
      const m = (
        await query(
          tx,
          `SELECT round((EXTRACT(EPOCH FROM (to_ts - from_ts)) / 60)::numeric, 2)::text AS m FROM mfg_job_card_time_logs WHERE id=$1::uuid`,
          id!,
        )
      )[0]!;
      const col = b.kind === 'SETUP' ? 'setup_minutes_actual' : 'run_minutes_actual';
      await exec(
        tx,
        `UPDATE mfg_order_ops SET ${col}=${col}+$1::numeric, actual_minutes=actual_minutes+$1::numeric, qty_done=qty_done+$2::numeric, qty_rejected=qty_rejected+$3::numeric,
        status=CASE WHEN status='Pending' THEN 'In Progress' ELSE status END, started_at=COALESCE(started_at, $4::timestamptz) WHERE id=$5::uuid`,
        S(m.m),
        good.toFixed(3),
        rej.toFixed(3),
        b.fromTs,
        opId,
      );
      await exec(
        tx,
        `UPDATE mfg_orders SET status='In Progress', updated_at=now() WHERE id=$1::uuid AND status='Released'`,
        S(c.order.id),
      );
      await syncOrder(tx, S(c.order.id));
    }, TX);
    return jobCardService.get(caller, pageId, opId);
  },

  /**
   * Complete the card with the final keypad entry. Scrap makes a draft scrap entry (it is posted when submitted), rework makes a
   * rework order and a rejection-register line; the components of this operation are back-flushed; the labour and overhead of the
   * logged hours are absorbed; an operation that needs an inspection opens its inspection sheet for the good pieces.
   */
  async complete(
    caller: Caller,
    pageId: string,
    opId: string,
    b: {
      good?: string | number | undefined;
      rejected?: string | number | undefined;
      scrap?: string | number | undefined;
      rework?: string | number | undefined;
      scrapReasonId?: string | undefined;
      reason?: string | undefined;
      operator?: string | undefined;
      idempotencyKey?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    const good = D(String(b.good ?? 0));
    const rej = D(String(b.rejected ?? 0));
    const scrap = D(String(b.scrap ?? 0));
    const rework = D(String(b.rework ?? 0));
    if ([good, rej, scrap, rework].some((x) => x.lt(0)))
      throw Errors.validation({ good: 'Quantities cannot be negative.' });
    if ((scrap.gt(0) || rework.gt(0)) && (b.reason ?? '').trim().length < 3 && !b.scrapReasonId)
      throw Errors.validation({ reason: 'Write why the pieces were scrapped or sent for rework.' });
    const out: {
      lot?: {
        qty: string;
        itemId: string;
        orderNo: string;
        opName: string;
        wcName: string;
        unitId: string;
        orderId: string;
      };
    } = {};
    await prisma.$transaction(async (tx) => {
      const c = await loadCard(tx, sc, opId);
      if (!LIVE.includes(S(c.order.status))) throw Errors.conflict('This order is not running.');
      if (S(c.op.status) === 'Done') {
        if (
          b.idempotencyKey &&
          (
            await query(
              tx,
              `SELECT 1 FROM mfg_job_card_time_logs WHERE op_id=$1::uuid AND idempotency_key=$2`,
              opId,
              b.idempotencyKey,
            )
          ).length
        )
          return; // the double tap of a completion that was recorded
        throw Errors.conflict('This job card is already complete.');
      }
      if (S(c.op.wc_kind) === 'OUTSIDE')
        throw mfgError(
          'ORDER_OUTSIDE_OP_V1',
          'Outside (subcontract) operations arrive in Phase 13b.',
        );
      const total = processed(c.op).plus(good).plus(rej).plus(scrap).plus(rework);
      if (total.gt(c.qtyIn)) {
        const prev = c.idx > 0 ? c.ops[c.idx - 1]! : null;
        if (
          processed(c.op).plus(good).plus(rej).plus(scrap).plus(rework).gt(c.qtyIn) &&
          prev &&
          D(c.qtyIn).lt(processed(c.op))
        )
          throw mfgError(
            'JC_QTY_EXCEEDS_PREVIOUS',
            `Op ${S(c.op.seq)} can process at most ${D(c.qtyIn).toFixed(3)} (good qty from op ${S(prev.seq)}).`,
          );
        throw mfgError(
          'JC_QTY_SUM',
          `Good + rejected + scrap + rework (${total.toFixed(3)}) exceeds input ${D(c.qtyIn).toFixed(3)}.`,
        );
      }
      const open = await openLog(tx, opId);
      if (open) await closeLog(tx, open, opId, { good: good.toFixed(3), rejected: rej.toFixed(3) });
      else if (good.gt(0) || rej.gt(0))
        await insertRow(tx, 'mfg_job_card_time_logs', {
          unitId: S(c.order.unit_id),
          orderId: S(c.order.id),
          opId,
          fromTs: new Date().toISOString(),
          toTs: new Date().toISOString(),
          kind: 'RUN',
          operatorName: b.operator ?? null,
          good: good.toFixed(3),
          rejected: rej.toFixed(3),
          idempotencyKey: b.idempotencyKey ?? null,
          createdById: caller.auth.userId,
        });
      await exec(
        tx,
        `UPDATE mfg_downtime_logs SET to_ts=now() WHERE op_id=$1::uuid AND to_ts IS NULL`,
        opId,
      );
      await exec(
        tx,
        `UPDATE mfg_order_ops SET qty_done=qty_done+$1::numeric, qty_rejected=qty_rejected+$2::numeric WHERE id=$3::uuid`,
        good.toFixed(3),
        rej.toFixed(3),
        opId,
      );
      if (scrap.gt(0))
        await scrapService.createDraft(tx, caller, c.order, {
          opId,
          qty: scrap.toFixed(3),
          ...(b.scrapReasonId ? { reasonId: b.scrapReasonId } : {}),
          ...(b.reason ? { reason: b.reason } : {}),
        });
      if (rework.gt(0))
        await createRework(
          tx,
          caller,
          c.order,
          c.op,
          rework.toFixed(3),
          b.reason ?? 'Rework',
          b.operator ?? null,
        );
      const fresh = (await query(tx, `SELECT * FROM mfg_order_ops WHERE id=$1::uuid`, opId))[0]!;
      await backflushOrder(
        tx,
        caller,
        c.order,
        Number(c.op.seq),
        D(S(fresh.qty_done)).plus(S(fresh.qty_rejected)).toFixed(3),
        date,
      );
      await costing.absorbCard(tx, caller, opId, date);
      await exec(
        tx,
        `UPDATE mfg_order_ops SET status='Done', completed_at=now() WHERE id=$1::uuid`,
        opId,
      );
      if (c.op.inspection_required === true && D(S(fresh.qty_done)).gt(0)) {
        const item = (
          await query(tx, `SELECT name FROM items WHERE id=$1::uuid`, S(c.order.item_id))
        )[0]!;
        void item;
        out.lot = {
          qty: D(S(fresh.qty_done)).toFixed(3),
          itemId: S(c.order.item_id),
          orderNo: S(c.order.number),
          opName: S(c.op.name),
          wcName: S(c.op.wc_code),
          unitId: S(c.order.unit_id),
          orderId: S(c.order.id),
        };
      }
      await syncOrder(tx, S(c.order.id));
      const left = await query(
        tx,
        `SELECT 1 FROM mfg_order_ops WHERE order_id=$1::uuid AND status <> 'Done' LIMIT 1`,
        S(c.order.id),
      );
      if (!left.length)
        await exec(
          tx,
          `UPDATE mfg_orders SET status='Completed', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
          caller.auth.userId,
          S(c.order.id),
        );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JOBCARD_COMPLETED',
        'mfg_order',
        { id: S(c.order.id), code: S(c.order.number) },
        pageId,
        {
          op: S(c.op.name),
          good: good.toFixed(3),
          scrap: scrap.toFixed(3),
          rework: rework.toFixed(3),
        },
      );
    }, TX);
    if (out.lot) await requestInspection(caller, opId, out.lot);
    return jobCardService.get(caller, pageId, opId);
  },

  // ---------------------------------------------------------------------------------------------- work-centre downtime
  async startDowntime(
    caller: Caller,
    pageId: string,
    b: { workCentreId: string; reasonId: string; remarks?: string | undefined },
  ): Promise<Row> {
    const unit = caller.ctx.unitId;
    if (!unit) throw Errors.validation({ unit: 'Choose one unit in the top bar first.' });
    const wc = (
      await query(
        prisma,
        `SELECT 1 FROM mfg_work_centres WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
        b.workCentreId,
        unit,
      )
    )[0];
    if (!wc) throw Errors.validation({ workCentreId: 'Choose a work centre of this unit.' });
    if (
      !(
        await query(
          prisma,
          `SELECT 1 FROM mfg_downtime_reasons WHERE id=$1::uuid AND status='ACTIVE'`,
          b.reasonId,
        )
      ).length
    )
      throw Errors.validation({ reasonId: 'Choose a downtime reason.' });
    if (
      (
        await query(
          prisma,
          `SELECT 1 FROM mfg_downtime_logs WHERE work_centre_id=$1::uuid AND to_ts IS NULL`,
          b.workCentreId,
        )
      ).length
    )
      throw Errors.conflict('This work centre already has a downtime running.');
    const id = await insertRow(prisma, 'mfg_downtime_logs', {
      unitId: unit,
      workCentreId: b.workCentreId,
      reasonId: b.reasonId,
      fromTs: new Date().toISOString(),
      remarks: b.remarks ?? null,
      createdById: caller.auth.userId,
    });
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_DOWNTIME_STARTED',
      'mfg_downtime',
      { id, code: id },
      pageId,
      {},
    );
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_downtime_logs WHERE id=$1::uuid`, id))[0]!,
    );
  },
  async endDowntime(caller: Caller, pageId: string, id: string): Promise<Row> {
    const r = (
      await query(
        prisma,
        `SELECT l.* FROM mfg_downtime_logs l WHERE l.id=$1::uuid AND l.unit_id=$2::uuid`,
        id,
        oneUnit(caller),
      )
    )[0];
    if (!r) throw Errors.notFound('Downtime not found.');
    if (r.to_ts) throw Errors.conflict('This downtime is already closed.');
    await exec(prisma, `UPDATE mfg_downtime_logs SET to_ts=now() WHERE id=$1::uuid`, id);
    return norm<Row>(
      (
        await query(
          prisma,
          `SELECT l.*, r.name AS reason_name FROM mfg_downtime_logs l JOIN mfg_downtime_reasons r ON r.id=l.reason_id WHERE l.id=$1::uuid`,
          id,
        )
      )[0]!,
    );
  },

  // ---------------------------------------------------------------------------------------------- rework orders
  async listRework(
    caller: Caller,
    pageId: string,
    q: {
      status?: string | undefined;
      orderId?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
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

  async releaseRework(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const r = (
      await query(
        prisma,
        `SELECT t.* FROM mfg_rework t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!r) throw Errors.notFound('Rework order not found.');
    if (S(r.status) !== 'Open') throw Errors.conflict('Only an open rework order can be released.');
    await exec(
      prisma,
      `UPDATE mfg_rework SET released_at=COALESCE(released_at, now()), updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
      caller.auth.userId,
      id,
    );
    return norm<Row>((await query(prisma, `SELECT * FROM mfg_rework WHERE id=$1::uuid`, id))[0]!);
  },

  /** The outcome of a rework: every piece is good again or scrap (a scrap draft). The rework hours are absorbed at the work-centre rates. */
  async completeRework(
    caller: Caller,
    pageId: string,
    reworkId: string,
    b: {
      qtyOk: string | number;
      qtyScrap: string | number;
      hours?: string | number | undefined;
      materialCost?: string | number | undefined;
      reinspection?: 'ACCEPTED' | 'REJECTED' | 'PENDING' | undefined;
      note?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const ok = D(String(b.qtyOk));
    const sc2 = D(String(b.qtyScrap));
    const hours = D(String(b.hours ?? 0));
    if (hours.lt(0)) throw Errors.validation({ hours: 'Hours cannot be negative.' });
    const date = todayIst();
    let orderId = '';
    await prisma.$transaction(async (tx) => {
      const rw = (
        await query(
          tx,
          `SELECT t.* FROM mfg_rework t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          reworkId,
        )
      )[0];
      if (!rw) throw Errors.notFound('Rework order not found.');
      if (S(rw.status) !== 'Open') throw Errors.conflict('This rework is already finished.');
      if (ok.lt(0) || sc2.lt(0) || !ok.plus(sc2).eq(D(S(rw.qty))))
        throw Errors.validation({
          qtyOk: `Good pieces plus scrap must equal the ${D(S(rw.qty)).toFixed(3)} pieces sent for rework.`,
        });
      if (sc2.gt(0) && (b.note ?? '').trim().length < 3)
        throw Errors.validation({ note: 'Write why the pieces could not be reworked.' });
      orderId = S(rw.order_id);
      const order = await lockOrder(tx, { sql: 'true', args: [] }, orderId);
      if (!LIVE.includes(S(order.status)) && S(order.status) !== 'Completed')
        throw Errors.conflict('This order is closed.');
      const cost = hours.gt(0)
        ? await costing.absorbMinutes(tx, caller, {
            opId: S(rw.op_id),
            minutes: hours.mul(60).toFixed(2),
            date,
            docId: reworkId,
            label: 'Rework hours absorbed',
          })
        : { labour: '0.00', overhead: '0.00' };
      await exec(
        tx,
        `UPDATE mfg_order_ops SET qty_rework=qty_rework-$1::numeric, qty_done=qty_done+$2::numeric WHERE id=$3::uuid`,
        D(S(rw.qty)).toFixed(3),
        ok.toFixed(3),
        S(rw.op_id),
      );
      await exec(
        tx,
        `UPDATE mfg_rework SET status='Done', qty_ok=$1::numeric, qty_scrap=$2::numeric, labour_hrs=$3::numeric, minutes=$4::numeric, cost=$5::numeric, material_cost=$6::numeric,
           reinspection_result=$7, done_at=now(), updated_by_id=$8::uuid, updated_at=now(), version=version+1 WHERE id=$9::uuid`,
        ok.toFixed(3),
        sc2.toFixed(3),
        hours.toFixed(2),
        hours.mul(60).toFixed(2),
        D(cost.labour).plus(cost.overhead).toFixed(2),
        D(String(b.materialCost ?? 0)).toFixed(2),
        b.reinspection ?? null,
        caller.auth.userId,
        reworkId,
      );
      if (rw.rejection_id)
        await exec(
          tx,
          `UPDATE qms_rejections SET status='Closed', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
          S(rw.rejection_id),
        );
      if (sc2.gt(0)) {
        // the pieces that could not be reworked become a draft scrap entry; they leave the card's rework count above, so count them as scrap
        await scrapService.createDraft(tx, caller, order, {
          opId: S(rw.op_id),
          qty: sc2.toFixed(3),
          reason: b.note ?? 'Not reworkable',
        });
      }
      await syncOrder(tx, orderId);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_REWORK_FINISHED',
        'mfg_rework',
        { id: reworkId, code: S(rw.number) },
        pageId,
        { ok: ok.toFixed(3), scrap: sc2.toFixed(3) },
      );
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_rework WHERE id=$1::uuid`, reworkId))[0]!,
    );
  },
};

/** A rework order and its line in the quality rejection register. */
async function createRework(
  tx: Db,
  caller: Caller,
  order: Row,
  op: Row,
  qty: string,
  reason: string,
  operator: string | null,
): Promise<void> {
  const fy = S(order.fy_id);
  const item = (await query(tx, `SELECT name FROM items WHERE id=$1::uuid`, S(order.item_id)))[0]!;
  const rno = await NumberingService.allocate(tx, {
    pageId: 'qms:REJ',
    unitId: S(order.unit_id),
    fyId: fy,
    prefix: 'REJ',
  });
  const rid = await insertRow(tx, 'qms_rejections', {
    unitId: S(order.unit_id),
    fyId: fy,
    number: rno,
    rejectDate: todayIst(),
    process: S(op.name),
    operator,
    itemId: S(order.item_id),
    part: S(item.name).slice(0, 150),
    holdQty: qty,
    defect: reason.slice(0, 200),
    defectType: 'PRODUCTION',
    disposition: 'REWORK',
    dispositionNote: `Rework at ${S(op.name)} on ${S(order.number)}`,
    status: 'Open',
    createdById: caller.auth.userId,
    updatedById: caller.auth.userId,
  });
  const no = await NumberingService.allocate(tx, {
    pageId: 'mfg:RWK',
    unitId: S(order.unit_id),
    fyId: fy,
    prefix: 'RWK',
  });
  await insertRow(tx, 'mfg_rework', {
    unitId: S(order.unit_id),
    fyId: fy,
    number: no,
    reworkDate: todayIst(),
    orderId: S(order.id),
    opId: S(op.id),
    itemId: S(order.item_id),
    qty,
    reason: reason.slice(0, 200),
    rejectionId: rid,
    sourceNcrRef: rno,
    createdById: caller.auth.userId,
    updatedById: caller.auth.userId,
  });
  await exec(
    tx,
    `UPDATE mfg_order_ops SET qty_rework=qty_rework+$1::numeric WHERE id=$2::uuid`,
    qty,
    S(op.id),
  );
}

/** Opens the in-process inspection sheet for the good pieces of a finished operation that needs one (the QC checkpoint). */
async function requestInspection(
  caller: Caller,
  opId: string,
  lot: {
    qty: string;
    itemId: string;
    orderNo: string;
    opName: string;
    wcName: string;
    unitId: string;
    orderId: string;
  },
): Promise<void> {
  const lotId = randomUUID();
  const sheet = await createInspection(caller, 'qms-process', {
    kind: 'IN_PROCESS',
    header: { part: lot.itemId, machine: lot.wcName, operation: `${lot.opName} (${lot.orderNo})` },
    itemId: lot.itemId,
    sourceType: 'MFG_LOT',
    sourceId: lotId,
    lotQty: lot.qty,
  });
  const no = (
    await query(
      prisma,
      `SELECT COALESCE(max(lot_no),0)+1 AS n FROM mfg_lots WHERE order_id=$1::uuid`,
      lot.orderId,
    )
  )[0]!;
  await insertRow(prisma, 'mfg_lots', {
    id: lotId,
    unitId: lot.unitId,
    orderId: lot.orderId,
    lotNo: Number(no.n),
    kind: 'OP',
    opId,
    lotQty: lot.qty,
    inspectionId: S(sheet.id),
    createdById: caller.auth.userId,
  });
  await exec(
    prisma,
    `UPDATE mfg_order_ops SET inspection_id=$1::uuid WHERE id=$2::uuid`,
    S(sheet.id),
    opId,
  );
}

/**
 * The Usage Decision on an in-process lot: the pieces the inspection rejected leave the card's good count (they become rejected
 * pieces, already in the quality register), and the order's completed quantity follows the accepted pieces.
 */
export async function onOpLotDecided(tx: Db, lotId: string, rejected: string): Promise<void> {
  const lot = (
    await query(tx, `SELECT op_id::text, order_id::text FROM mfg_lots WHERE id=$1::uuid`, lotId)
  )[0];
  if (!lot || !lot.op_id) return;
  if (D(rejected).gt(0))
    await exec(
      tx,
      `UPDATE mfg_order_ops SET qty_done=qty_done-$1::numeric, qty_rejected=qty_rejected+$1::numeric WHERE id=$2::uuid`,
      D(rejected).toFixed(3),
      S(lot.op_id),
    );
  await syncOrder(tx, S(lot.order_id));
}
