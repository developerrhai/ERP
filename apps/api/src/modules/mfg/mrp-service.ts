// Phase 13 v2 MRP (spec section 5). A run is queued and executed by the background job mfg.mrp.run, one at a time per unit.
// Items are processed by ascending low-level code. Per bucket: POH = previous POH + receipts - gross; below the safety stock the
// shortfall is a net requirement, ordered in lots (lot-for-lot / fixed / EOQ with minimum and multiple), released one lead time
// before the due date. Gross demand = open sales-order quantity + plan lines + the parents' planned releases x BOM + what open
// production orders still have to draw. A re-run replaces the OPEN suggestions; FIRMED ones count as scheduled receipts.
import { Errors } from '../../core/http/errors';
import { QUEUES, enqueue, jobsRunning, registerJobHandler } from '../../core/jobs';
import { logger } from '../../core/logger';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import { notificationService } from '../notifications/service';
import { PurchaseRequestGateway } from '../procurement/reports-service';
import {
  TX,
  audit,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  pageRecipients,
  query,
  scopeSql,
  todayIst,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { mfgError, releasedBoms } from './bom-service';
import { D, explode, lowLevelCodes, mrpNet } from './calc';
import type { BucketDemand, Planning } from './calc';
import { bucketStart } from './logic';
import { S, dateOf, oneUnit } from './master-service';
import { orderService } from './order-service';

interface Demand {
  bucket: string;
  qty: string;
  type: 'SO_LINE' | 'PLAN_LINE' | 'PARENT_SUGGESTION' | 'ORDER_REQUIREMENT';
  id: string | null;
  ref: string;
}

async function suggestionOf(caller: Caller, pageId: string, id: string): Promise<Row> {
  const sc = await scopeSql(caller, pageId, 'r');
  const s = (
    await query(
      prisma,
      `SELECT s.* FROM mfg_mrp_suggestions s JOIN mfg_mrp_runs r ON r.id=s.run_id WHERE s.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
      ...sc.args,
      id,
    )
  )[0];
  if (!s) throw Errors.notFound('Suggestion not found.');
  return s;
}
/** A run that never finished (the server stopped, or it could not be queued) must not block the unit for ever. */
async function sweepStuck(db: Db, unitId: string): Promise<void> {
  await exec(
    db,
    `UPDATE mfg_mrp_runs SET status='FAILED', error='Timed out: the run did not finish.', finished_at=now()
      WHERE unit_id=$1::uuid AND status IN ('QUEUED','RUNNING') AND COALESCE(started_at, created_at) < now() - interval '30 minutes'`,
    unitId,
  );
}

async function notRunning(unitId: string): Promise<void> {
  await sweepStuck(prisma, unitId);
  if (
    (
      await query(
        prisma,
        `SELECT 1 FROM mfg_mrp_runs WHERE unit_id=$1::uuid AND status IN ('QUEUED','RUNNING')`,
        unitId,
      )
    ).length
  )
    throw mfgError('MRP_ALREADY_RUNNING', 'MRP is already running for this unit.', undefined, 409);
}

export const mrpService = {
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
      (await query(prisma, `SELECT count(*)::int AS n FROM mfg_mrp_runs t WHERE ${w}`, ...args))[0]!
        .n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, (SELECT count(*)::int FROM mfg_mrp_suggestions s WHERE s.run_id=t.id AND s.type='MAKE') AS make_count,
              (SELECT count(*)::int FROM mfg_mrp_suggestions s WHERE s.run_id=t.id AND s.type='BUY') AS buy_count,
              (SELECT count(*)::int FROM mfg_mrp_exceptions e WHERE e.run_id=t.id) AS exception_count
         FROM mfg_mrp_runs t WHERE ${w} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.* FROM mfg_mrp_runs t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('MRP run not found.');
    return norm<Row>(h);
  },

  async suggestions(caller: Caller, pageId: string, id: string, status?: string): Promise<Row[]> {
    await mrpService.get(caller, pageId, id);
    const rows = await query(
      prisma,
      `SELECT s.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom,
              (SELECT json_agg(json_build_object('type', p.source_type, 'ref', p.source_ref, 'qty', p.qty::text)) FROM mfg_mrp_pegging p WHERE p.suggestion_id=s.id) AS pegging
         FROM mfg_mrp_suggestions s JOIN items i ON i.id=s.item_id WHERE s.run_id=$1::uuid ${status ? 'AND s.status=$2' : ''} ORDER BY i.code, s.due_date`,
      ...(status ? [id, status] : [id]),
    );
    return rows.map((r) => norm<Row>(r));
  },
  async buckets(caller: Caller, pageId: string, id: string, itemId?: string): Promise<Row[]> {
    await mrpService.get(caller, pageId, id);
    const rows = await query(
      prisma,
      `SELECT b.*, i.code AS item_code, i.name AS item_name FROM mfg_mrp_buckets b JOIN items i ON i.id=b.item_id WHERE b.run_id=$1::uuid ${itemId ? 'AND b.item_id=$2::uuid' : ''} ORDER BY i.code, b.bucket_date`,
      ...(itemId ? [id, itemId] : [id]),
    );
    return rows.map((r) => norm<Row>(r));
  },
  async exceptions(caller: Caller, pageId: string, id: string): Promise<Row[]> {
    await mrpService.get(caller, pageId, id);
    const rows = await query(
      prisma,
      `SELECT e.*, i.code AS item_code, i.name AS item_name FROM mfg_mrp_exceptions e LEFT JOIN items i ON i.id=e.item_id WHERE e.run_id=$1::uuid ORDER BY e.code, i.code`,
      id,
    );
    return rows.map((r) => norm<Row>(r));
  },
  async pegging(caller: Caller, pageId: string, id: string): Promise<Row[]> {
    await mrpService.get(caller, pageId, id);
    const rows = await query(
      prisma,
      `SELECT p.*, s.item_id::text AS item_id, i.code AS item_code FROM mfg_mrp_pegging p JOIN mfg_mrp_suggestions s ON s.id=p.suggestion_id JOIN items i ON i.id=s.item_id WHERE s.run_id=$1::uuid ORDER BY i.code`,
      id,
    );
    return rows.map((r) => norm<Row>(r));
  },

  /** Queues a run. Only one run per unit is queued or running at a time (MRP_ALREADY_RUNNING). */
  async enqueueRun(
    caller: Caller,
    pageId: string,
    b: {
      horizonDays?: number | undefined;
      bucket?: 'DAY' | 'WEEK' | undefined;
      includeSo?: boolean | undefined;
      planId?: string | undefined;
      notes?: string | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `mfg.mrp:${unitId}`);
      await sweepStuck(tx, unitId);
      if (
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_mrp_runs WHERE unit_id=$1::uuid AND status IN ('QUEUED','RUNNING')`,
            unitId,
          )
        ).length
      )
        throw mfgError(
          'MRP_ALREADY_RUNNING',
          'MRP is already running for this unit.',
          undefined,
          409,
        );
      if (
        b.planId &&
        !(
          await query(
            tx,
            `SELECT 1 FROM mfg_production_plans WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
            b.planId,
            unitId,
          )
        ).length
      )
        throw Errors.validation({ planId: 'Production plan not found in this unit.' });
      const horizon = b.horizonDays ?? 30;
      if (horizon < 1 || horizon > 366)
        throw Errors.validation({ horizonDays: 'Use 1 to 366 days.' });
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:MRP',
        unitId,
        fyId: fy.id,
        prefix: 'MRP',
      });
      const today = todayIst();
      const end = new Date(`${today}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + horizon);
      return insertRow(tx, 'mfg_mrp_runs', {
        unitId,
        fyId: fy.id,
        number,
        fromDate: today,
        toDate: end.toISOString().slice(0, 10),
        horizonDays: horizon,
        bucket: b.bucket ?? 'WEEK',
        includeSo: b.includeSo !== false,
        planId: b.planId ?? null,
        status: 'QUEUED',
        notes: b.notes ?? null,
        params: JSON.stringify({ requestedBy: caller.auth.userId }),
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    }, TX);
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_MRP_QUEUED',
      'mfg_mrp_run',
      { id, code: id },
      pageId,
      {},
    );
    if (jobsRunning()) {
      await enqueue(QUEUES.mfgMrp, { jobId: id });
      await exec(prisma, `UPDATE mfg_mrp_runs SET job_id=$1 WHERE id=$2::uuid`, id, id);
    } else await runMrp(id); // no job runner (tests, scripts): run it now
    return mrpService.get(caller, pageId, id);
  },

  async firm(caller: Caller, pageId: string, id: string): Promise<Row> {
    return mrpService.setStatus(caller, pageId, id, 'OPEN', 'FIRMED');
  },
  async ignore(caller: Caller, pageId: string, id: string): Promise<Row> {
    return mrpService.setStatus(caller, pageId, id, null, 'IGNORED');
  },
  async setStatus(
    caller: Caller,
    pageId: string,
    id: string,
    from: string | null,
    to: string,
  ): Promise<Row> {
    const s = await suggestionOf(caller, pageId, id);
    if (from ? S(s.status) !== from : !['OPEN', 'FIRMED'].includes(S(s.status)))
      throw Errors.conflict('This suggestion cannot change like that.');
    await notRunning(S(s.unit_id));
    await exec(
      prisma,
      `UPDATE mfg_mrp_suggestions SET status=$1, version=version+1 WHERE id=$2::uuid`,
      to,
      id,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      `MFG_MRP_SUGGESTION_${to}`,
      'mfg_mrp_suggestion',
      { id, code: id },
      pageId,
      {},
    );
    return norm<Row>(await suggestionOf(caller, pageId, id));
  },

  /** BUY -> one Draft requisition (Phase 9 gateway); MAKE -> a draft production order, with the pegging kept on the suggestion. */
  async convert(
    caller: Caller,
    pageId: string,
    id: string,
    w: { warehouseId?: string | undefined; rmWarehouseId?: string | undefined },
  ): Promise<Row> {
    const s = await suggestionOf(caller, pageId, id);
    if (!['OPEN', 'FIRMED'].includes(S(s.status)))
      throw Errors.conflict('This suggestion was already converted or ignored.');
    await notRunning(S(s.unit_id));
    let docType: string;
    let docId: string;
    if (S(s.type) === 'BUY') {
      const doc = await prisma.$transaction(async (tx) => {
        const it = (
          await query(
            tx,
            `SELECT base_uom, standard_cost::text AS c FROM items WHERE id=$1::uuid`,
            S(s.item_id),
          )
        )[0]!;
        const run = (
          await query(tx, `SELECT fy_id::text FROM mfg_mrp_runs WHERE id=$1::uuid`, S(s.run_id))
        )[0]!;
        return PurchaseRequestGateway.create(tx, {
          unitId: S(s.unit_id),
          fyId: S(run.fy_id),
          userId: caller.auth.userId,
          department: await departmentOf(tx, 'scm-pr', caller),
          purpose: 'MRP suggestion',
          lines: [
            {
              itemId: S(s.item_id),
              qty: D(S(s.qty)).toFixed(3),
              uom: S(it.base_uom),
              estRate: S(it.c ?? '0') || '0',
              requiredDate: dateOf(s.due_date),
            },
          ],
        });
      }, TX);
      docType = 'PURCHASE_REQUISITION';
      docId = doc.id;
    } else {
      const plan = (
        await query(
          prisma,
          `SELECT fg_wh_id::text, backflush_wh_id::text FROM mfg_item_planning WHERE item_id=$1::uuid`,
          S(s.item_id),
        )
      )[0];
      const fg = w.warehouseId ?? (plan?.fg_wh_id ? S(plan.fg_wh_id) : '');
      const rm = w.rmWarehouseId ?? (plan?.backflush_wh_id ? S(plan.backflush_wh_id) : '');
      if (!fg || !rm)
        throw Errors.validation({
          warehouseId:
            'Choose the finished-goods and the raw-material warehouse for the new production order.',
        });
      const o = await orderService.create(caller, 'mfg-orders', {
        itemId: S(s.item_id),
        qty: S(s.qty),
        dueDate: dateOf(s.due_date),
        startDate: dateOf(s.release_date),
        warehouseId: fg,
        rmWarehouseId: rm,
        sourceType: 'MRP',
        sourceId: S(s.run_id),
        suggestionId: id,
        notes: 'From an MRP suggestion',
      });
      docType = 'PRODUCTION_ORDER';
      docId = S(o.id);
    }
    await exec(
      prisma,
      `UPDATE mfg_mrp_suggestions SET status='CONVERTED', converted_doc_type=$1, converted_doc_id=$2::uuid, version=version+1 WHERE id=$3::uuid`,
      docType,
      docId,
      id,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_MRP_CONVERTED',
      'mfg_mrp_suggestion',
      { id, code: id },
      pageId,
      { docType },
    );
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_mrp_suggestions WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async convertBulk(
    caller: Caller,
    pageId: string,
    ids: string[],
    w: { warehouseId?: string | undefined; rmWarehouseId?: string | undefined },
  ): Promise<{ converted: string[]; failed: { id: string; error: string }[] }> {
    const converted: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        await mrpService.convert(caller, pageId, id, w);
        converted.push(id);
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : 'Failed' });
      }
    }
    return { converted, failed };
  },
};

/** The run itself (the job handler). QUEUED -> RUNNING -> DONE / FAILED, and tells the planner. */
export async function runMrp(runId: string): Promise<void> {
  const run = (await query(prisma, `SELECT * FROM mfg_mrp_runs WHERE id=$1::uuid`, runId))[0];
  if (!run || S(run.status) !== 'QUEUED') return;
  const unitId = S(run.unit_id);
  try {
    await exec(
      prisma,
      `UPDATE mfg_mrp_runs SET status='RUNNING', started_at=now() WHERE id=$1::uuid AND status='QUEUED'`,
      runId,
    );
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `mfg.mrp.exec:${unitId}`,
        );
        const counts = await compute(tx, run);
        await exec(
          tx,
          `UPDATE mfg_mrp_runs SET status='DONE', finished_at=now(), params = params || $1::jsonb WHERE id=$2::uuid`,
          JSON.stringify(counts),
          runId,
        );
      },
      { maxWait: 20_000, timeout: 120_000 },
    );
    await notifyPlanner(runId, 'DONE');
  } catch (err) {
    logger.error({ err, runId }, 'MRP run failed');
    await exec(
      prisma,
      `UPDATE mfg_mrp_runs SET status='FAILED', finished_at=now(), error=$1 WHERE id=$2::uuid`,
      (err instanceof Error ? err.message : 'Failed').slice(0, 480),
      runId,
    );
    await notifyPlanner(runId, 'FAILED');
  }
}
registerJobHandler(QUEUES.mfgMrp, async (payload) => {
  const id = (payload as { jobId?: string }).jobId;
  if (id) await runMrp(id);
});

async function notifyPlanner(runId: string, outcome: 'DONE' | 'FAILED'): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const to = await pageRecipients(tx, 'mfg-mrp');
      const r = (
        await query(tx, `SELECT number, error FROM mfg_mrp_runs WHERE id=$1::uuid`, runId)
      )[0]!;
      await notificationService.notify(tx, to, {
        type: 'MFG_MRP',
        title:
          outcome === 'DONE' ? `MRP run ${S(r.number)} is done` : `MRP run ${S(r.number)} failed`,
        body: outcome === 'DONE' ? 'The suggestions are ready to review.' : S(r.error),
        link: '/m/mfg-mrp',
        entityType: 'mfg_mrp_run',
        entityId: runId,
        dedupeKey: `mfg-mrp:${runId}:${outcome}`,
      });
    }, TX);
  } catch (err) {
    logger.error({ err }, 'MRP notification failed');
  }
}

async function compute(
  tx: Db,
  run: Row,
): Promise<{ items: number; suggestions: number; exceptions: number }> {
  const runId = S(run.id);
  const unitId = S(run.unit_id);
  const today = todayIst();
  const horizonEnd = dateOf(run.to_date);
  const bucketKind = S(run.bucket) === 'DAY' ? 'DAY' : 'WEEK';
  const b0 = (date: string) => bucketStart(date, bucketKind, today);
  const boms = await releasedBoms(tx, unitId);
  const exceptions: { itemId: string | null; code: string; message: string }[] = [];
  let llc: Map<string, number>;
  try {
    llc = lowLevelCodes(boms);
  } catch (e) {
    const path = e instanceof Error ? e.message.replace('BOM_CYCLE:', '') : '';
    throw new Error(`BOM loop: ${path}. A part can't contain itself.`);
  }
  // ---- independent demand
  const demand = new Map<string, Demand[]>();
  const add = (item: string, d: Demand) => demand.set(item, [...(demand.get(item) ?? []), d]);
  if (run.include_so === true) {
    const so = await query(
      tx,
      `SELECT l.id::text AS id, l.item_id::text, (l.qty - l.dispatched_qty - l.closed_qty)::text AS q, COALESCE(l.delivery_date, s.delivery_date, s.order_date)::text AS due, s.number
         FROM sales_order_lines l JOIN sales_orders s ON s.id=l.order_id
        WHERE s.unit_id=$1::uuid AND s.deleted_at IS NULL AND s.status='Approved' AND s.closed_at IS NULL AND l.qty - l.dispatched_qty - l.closed_qty > 0
          AND COALESCE(l.delivery_date, s.delivery_date, s.order_date) <= $2::date`,
      unitId,
      horizonEnd,
    );
    for (const r of so)
      add(S(r.item_id), {
        bucket: b0(S(r.due)),
        qty: S(r.q),
        type: 'SO_LINE',
        id: S(r.id),
        ref: S(r.number),
      });
  }
  const plans = await query(
    tx,
    run.plan_id
      ? `SELECT l.id::text AS id, l.item_id::text, l.planned_qty::text AS q, l.required_date::text AS due, p.number, l.so_line_id::text AS so_line_id FROM mfg_production_plan_lines l JOIN mfg_production_plans p ON p.id=l.plan_id WHERE p.id=$1::uuid AND p.deleted_at IS NULL`
      : `SELECT l.id::text AS id, l.item_id::text, l.planned_qty::text AS q, l.required_date::text AS due, p.number, l.so_line_id::text AS so_line_id FROM mfg_production_plan_lines l JOIN mfg_production_plans p ON p.id=l.plan_id WHERE p.unit_id=$1::uuid AND p.status='RELEASED' AND p.deleted_at IS NULL`,
    run.plan_id ? S(run.plan_id) : unitId,
  );
  for (const r of plans) {
    // a plan line pulled from a sales order is the same demand as that order line: count it once
    if (run.include_so === true && r.so_line_id) continue;
    add(S(r.item_id), {
      bucket: b0(S(r.due)),
      qty: S(r.q),
      type: 'PLAN_LINE',
      id: S(r.id),
      ref: S(r.number),
    });
  }
  const reqs = await query(
    tx,
    `SELECT * FROM (
       SELECT m.item_id::text, o.due_date::text AS due, o.number, o.id::text AS id,
              GREATEST(CASE WHEN m.issue_method='BACKFLUSH' THEN m.required_qty - m.consumed_qty ELSE m.required_qty - m.issued_qty + m.returned_qty END,0)::text AS q
         FROM mfg_order_materials m JOIN mfg_orders o ON o.id=m.order_id
        WHERE o.unit_id=$1::uuid AND o.deleted_at IS NULL AND o.status IN ('Planned','Pending Approval','Released','In Progress') AND NOT m.customer_supplied
     ) x WHERE q::numeric > 0`,
    unitId,
  );
  for (const r of reqs)
    add(S(r.item_id), {
      bucket: b0(S(r.due)),
      qty: S(r.q),
      type: 'ORDER_REQUIREMENT',
      id: S(r.id),
      ref: S(r.number),
    });
  // firmed MAKE suggestions are not orders yet: their components are still needed
  const firmedMake = await query(
    tx,
    `SELECT id::text, item_id::text, qty::text AS q, release_date::text AS rel FROM mfg_mrp_suggestions WHERE unit_id=$1::uuid AND status='FIRMED' AND type='MAKE'`,
    unitId,
  );
  for (const f of firmedMake)
    for (const rq of explode(S(f.item_id), S(f.q), S(f.rel), boms))
      add(rq.itemId, {
        bucket: b0(S(f.rel)),
        qty: rq.qty,
        type: 'ORDER_REQUIREMENT',
        id: S(f.id),
        ref: 'Firmed suggestion',
      });
  // ---- every item that can be reached from the demand
  const wanted = new Set<string>();
  const stack = [...demand.keys()];
  while (stack.length) {
    const i = stack.pop()!;
    if (wanted.has(i)) continue;
    wanted.add(i);
    for (const l of boms.get(i)?.lines ?? []) stack.push(l.itemId);
  }
  const ids = [...wanted];
  if (!ids.length) return { items: 0, suggestions: 0, exceptions: 0 };
  // ---- supply
  const [stock, reserved, po, pr, mo, firm, planRows, items, supp] = await Promise.all([
    query(
      tx,
      `SELECT s.item_id::text, sum(s.qty)::text AS q FROM stock_slices s JOIN warehouses w ON w.id=s.warehouse_id WHERE w.unit_id=$1::uuid AND w.is_transit=false AND s.stock_status='UNRESTRICTED' AND s.item_id = ANY($2::uuid[]) GROUP BY s.item_id`,
      unitId,
      ids,
    ),
    query(
      tx,
      `SELECT b.item_id::text, sum(b.reserved_qty)::text AS q FROM stock_balances b JOIN warehouses w ON w.id=b.warehouse_id WHERE w.unit_id=$1::uuid AND b.item_id = ANY($2::uuid[]) GROUP BY b.item_id`,
      unitId,
      ids,
    ),
    query(
      tx,
      `SELECT l.item_id::text, GREATEST(l.base_qty - l.received_qty - l.closed_qty,0)::text AS q, l.delivery_date::text AS due FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id WHERE p.unit_id=$1::uuid AND p.deleted_at IS NULL AND p.status='Approved' AND p.closed_at IS NULL AND l.item_id = ANY($2::uuid[]) AND l.base_qty - l.received_qty - l.closed_qty > 0`,
      unitId,
      ids,
    ),
    query(
      tx,
      `SELECT l.item_id::text, GREATEST(l.qty - l.closed_qty,0)::text AS q, l.required_date::text AS due FROM purchase_requisition_lines l JOIN purchase_requisitions p ON p.id=l.pr_id WHERE p.unit_id=$1::uuid AND p.deleted_at IS NULL AND p.status IN ('Draft','Pending Approval','Approved') AND l.item_id = ANY($2::uuid[]) AND l.qty - l.closed_qty > 0`,
      unitId,
      ids,
    ),
    query(
      tx,
      `SELECT item_id::text, GREATEST(qty - qty_scrapped - qty_received,0)::text AS q, due_date::text AS due FROM mfg_orders WHERE unit_id=$1::uuid AND deleted_at IS NULL AND status IN ('Planned','Pending Approval','Released','In Progress') AND item_id = ANY($2::uuid[]) AND qty - qty_scrapped - qty_received > 0`,
      unitId,
      ids,
    ),
    query(
      tx,
      `SELECT s.item_id::text, s.qty::text AS q, s.due_date::text AS due FROM mfg_mrp_suggestions s WHERE s.unit_id=$1::uuid AND s.status='FIRMED' AND s.item_id = ANY($2::uuid[])`,
      unitId,
      ids,
    ),
    query(tx, `SELECT * FROM mfg_item_planning WHERE item_id = ANY($1::uuid[])`, ids),
    query(
      tx,
      `SELECT id::text, code, name, standard_cost::text AS c FROM items WHERE id = ANY($1::uuid[])`,
      ids,
    ),
    query(
      tx,
      `SELECT DISTINCT item_id::text FROM supplier_items WHERE item_id = ANY($1::uuid[])`,
      ids,
    ),
  ]);
  const onHand = new Map<string, string>();
  for (const r of stock) onHand.set(S(r.item_id), S(r.q));
  for (const r of reserved)
    onHand.set(
      S(r.item_id),
      D(onHand.get(S(r.item_id)) ?? 0)
        .minus(S(r.q))
        .toFixed(3),
    );
  const receipts = new Map<string, { bucket: string; qty: string }[]>();
  for (const r of [...po, ...pr, ...mo, ...firm])
    receipts.set(S(r.item_id), [
      ...(receipts.get(S(r.item_id)) ?? []),
      { bucket: b0(r.due ? S(r.due) : today), qty: S(r.q) },
    ]);
  const plan = new Map(planRows.map((p) => [S(p.item_id), p]));
  const info = new Map(items.map((i) => [S(i.id), i]));
  const hasSupplier = new Set(supp.map((s) => S(s.item_id)));
  // a re-run replaces the OPEN suggestions of the unit
  await exec(
    tx,
    `DELETE FROM mfg_mrp_suggestions WHERE unit_id=$1::uuid AND status='OPEN'`,
    unitId,
  );
  let nSug = 0;
  const order = [...ids].sort(
    (a, b) => (llc.get(a) ?? 0) - (llc.get(b) ?? 0) || a.localeCompare(b),
  );
  for (const item of order) {
    const p = plan.get(item);
    const planning: Planning = {
      leadTimeDays: Number(p?.lead_time_days ?? 0),
      safetyStock: S(p?.safety_stock ?? '0'),
      lotSizing: (S(p?.lot_sizing) || 'LFL') as Planning['lotSizing'],
      fixedLotQty: p?.fixed_lot_qty ? S(p.fixed_lot_qty) : null,
      minOrderQty: p?.min_order_qty ? S(p.min_order_qty) : null,
      orderMultiple: p?.order_multiple ? S(p.order_multiple) : null,
      eoq: null,
    };
    // EOQ = sqrt(2 x yearly demand x setup cost / holding cost per unit), the demand of the horizon scaled to a year
    if (planning.lotSizing === 'EOQ' && p?.eoq_setup_cost && p?.eoq_holding_rate) {
      const hold = D(S(info.get(item)?.c ?? 0))
        .mul(S(p.eoq_holding_rate))
        .div(100);
      const yearly = (demand.get(item) ?? [])
        .reduce((a, d) => a.plus(d.qty), D(0))
        .mul(365)
        .div(Math.max(Number(run.horizon_days), 1));
      if (hold.gt(0) && yearly.gt(0))
        planning.eoq = D(
          Math.sqrt(Number(D(2).mul(yearly).mul(S(p.eoq_setup_cost)).div(hold))),
        ).toFixed(3);
    }
    const bkts = new Map<string, { gross: ReturnType<typeof D>; receipts: ReturnType<typeof D> }>();
    for (const d of demand.get(item) ?? []) {
      const c = bkts.get(d.bucket) ?? { gross: D(0), receipts: D(0) };
      c.gross = c.gross.plus(d.qty);
      bkts.set(d.bucket, c);
    }
    for (const r of receipts.get(item) ?? []) {
      const c = bkts.get(r.bucket) ?? { gross: D(0), receipts: D(0) };
      c.receipts = c.receipts.plus(r.qty);
      bkts.set(r.bucket, c);
    }
    const input: BucketDemand[] = [...bkts].map(([bucket, c]) => ({
      bucket,
      gross: c.gross.toFixed(3),
      receipts: c.receipts.toFixed(3),
    }));
    if (!input.length) continue;
    const rows = mrpNet(onHand.get(item) ?? '0', input, planning, today);
    const isMake = boms.has(item);
    for (const r of rows) {
      await insertRow(tx, 'mfg_mrp_buckets', {
        runId,
        itemId: item,
        bucketDate: r.bucket,
        gross: r.gross,
        scheduledReceipts: r.receipts,
        projectedOnHand: r.pohAfter,
        net: r.net,
        plannedReceipt: r.plannedReceipt,
        plannedRelease: r.releaseDate,
      });
      if (D(r.plannedReceipt).lte(0)) continue;
      const release = r.releaseDate && r.releaseDate > today ? r.releaseDate : today;
      const code = S(info.get(item)?.code);
      if (r.pastDueRelease)
        exceptions.push({
          itemId: item,
          code: 'PAST_DUE_RELEASE',
          message: `${code}: the release date ${r.releaseDate} is already past. Release today or expedite.`,
        });
      if (!isMake && S(p?.make_or_buy) === 'MAKE')
        exceptions.push({
          itemId: item,
          code: 'NO_BOM',
          message: `${code} is made in-house but has no released bill of materials.`,
        });
      else if (!isMake && !hasSupplier.has(item))
        exceptions.push({
          itemId: item,
          code: 'NO_SUPPLIER',
          message: `${code} has no supplier. Add one before it can be bought.`,
        });
      const sid = await insertRow(tx, 'mfg_mrp_suggestions', {
        runId,
        unitId,
        itemId: item,
        type: isMake ? 'MAKE' : 'BUY',
        qty: r.plannedReceipt,
        releaseDate: release,
        dueDate: r.bucket,
      });
      nSug += 1;
      const here = (demand.get(item) ?? []).filter((d) => d.bucket === r.bucket);
      for (const d of here)
        await insertRow(tx, 'mfg_mrp_pegging', {
          suggestionId: sid,
          sourceType: d.type,
          sourceId: d.id,
          sourceRef: d.ref,
          qty: D(d.qty).toFixed(3),
        });
      if (D(planning.safetyStock).gt(0) && D(r.net).gt(0) && !here.length)
        await insertRow(tx, 'mfg_mrp_pegging', {
          suggestionId: sid,
          sourceType: 'SAFETY_STOCK',
          sourceId: null,
          sourceRef: 'Safety stock',
          qty: planning.safetyStock,
        });
      // the components of a made item are needed in the bucket of its release date
      if (isMake) {
        let req;
        try {
          req = explode(item, r.plannedReceipt, release, boms);
        } catch {
          continue;
        }
        for (const q of req)
          add(q.itemId, {
            bucket: b0(release),
            qty: q.qty,
            type: 'PARENT_SUGGESTION',
            id: sid,
            ref: `Suggestion for ${code}`,
          });
      }
    }
  }
  for (const e of exceptions)
    await insertRow(tx, 'mfg_mrp_exceptions', {
      runId,
      itemId: e.itemId,
      code: e.code,
      message: e.message,
    });
  return { items: order.length, suggestions: nSug, exceptions: exceptions.length };
}
