// Phase 13 MRP. Demand = approved sales-order lines still to dispatch (delivery date up to the end of the range) plus the
// independent monthly forecasts. Supply = unrestricted stock of the unit, open purchase-order lines, open requisition
// lines (so a second run does not ask twice) and open production orders. The BOM explodes level by level (logic.planMrp).
// A run is a Draft proposal; Apply raises the Purchase Requisition (Phase 9 gateway) and the Planned production orders.
// Lot-for-lot: no lead time, safety stock or lot size is applied because the spec names none.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { PurchaseRequestGateway } from '../procurement/reports-service';
import {
  TX,
  audit,
  checkVersion,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
  scopeSql,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D, planMrp } from './logic';
import type { Demand } from './logic';
import { activeBoms, dateOf, S, oneUnit } from './master-service';
import { orderService } from './order-service';

const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

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
      `SELECT t.*, (SELECT count(*)::int FROM mfg_mrp_lines l WHERE l.run_id=t.id AND l.action='PRODUCE') AS produce_lines,
              (SELECT count(*)::int FROM mfg_mrp_lines l WHERE l.run_id=t.id AND l.action='BUY') AS buy_lines,
              p.number AS pr_number
         FROM mfg_mrp_runs t LEFT JOIN purchase_requisitions p ON p.id=t.pr_id
        WHERE ${w} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, p.number AS pr_number FROM mfg_mrp_runs t LEFT JOIN purchase_requisitions p ON p.id=t.pr_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('MRP run not found.');
    const lines = await query(
      prisma,
      `SELECT l.id::text, l.item_id::text, l.level, l.bucket_start, l.action, l.gross_qty, l.on_hand_qty, l.scheduled_qty, l.net_qty, l.need_date, l.sources,
              l.order_id::text, i.code AS item_code, i.name AS item_name, i.base_uom AS uom, o.number AS order_number
         FROM mfg_mrp_lines l JOIN items i ON i.id=l.item_id LEFT JOIN mfg_orders o ON o.id=l.order_id
        WHERE l.run_id=$1::uuid ORDER BY l.level, i.code, l.bucket_start`,
      id,
    );
    return { ...norm<Row>(h), lines: lines.map((r) => norm<Row>(r)) };
  },

  /** Computes and stores a Draft proposal for the unit chosen in the top bar. */
  async run(
    caller: Caller,
    pageId: string,
    b: {
      fromDate: string;
      toDate: string;
      includeForecast?: boolean | undefined;
      bucket?: 'DAY' | 'WEEK' | 'MONTH' | 'RANGE' | undefined;
      notes?: string | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    if (b.toDate < b.fromDate)
      throw Errors.validation({ toDate: 'The end date cannot be before the start date.' });
    const include = b.includeForecast !== false;
    const id = await prisma.$transaction(async (tx) => {
      // ---- demand
      const so = await query(
        tx,
        `SELECT l.item_id::text, (l.qty - l.dispatched_qty - l.closed_qty)::text AS open_qty,
                COALESCE(l.delivery_date, s.delivery_date, s.order_date)::text AS due, s.number
           FROM sales_order_lines l JOIN sales_orders s ON s.id=l.order_id
          WHERE s.unit_id=$1::uuid AND s.deleted_at IS NULL AND s.status='Approved' AND s.closed_at IS NULL
            AND l.qty - l.dispatched_qty - l.closed_qty > 0
            AND COALESCE(l.delivery_date, s.delivery_date, s.order_date) <= $2::date`,
        unitId,
        b.toDate,
      );
      const demands: Demand[] = so.map((r) => ({
        itemId: S(r.item_id),
        qty: S(r.open_qty),
        date: S(r.due),
        type: 'SALES_ORDER',
        ref: S(r.number),
      }));
      if (include) {
        const fc = await query(
          tx,
          `SELECT item_id::text, qty::text, month FROM demand_forecasts WHERE unit_id=$1::uuid AND month = ANY($2::text[])`,
          unitId,
          monthsBetween(b.fromDate, b.toDate),
        );
        for (const r of fc) {
          const first = `${S(r.month)}-01`;
          demands.push({
            itemId: S(r.item_id),
            qty: S(r.qty),
            date: first < b.fromDate ? b.fromDate : first,
            type: 'FORECAST',
            ref: `Forecast ${S(r.month)}`,
          });
        }
      }
      if (demands.length === 0)
        throw Errors.validation({
          toDate: 'There is no approved sales order or forecast in this range.',
        });
      // material that open production orders still have to draw is demand too (it is not in stock for anyone else)
      const committed = await query(
        tx,
        `SELECT m.item_id::text, GREATEST(m.required_qty - m.issued_qty + m.returned_qty,0)::text AS q, o.due_date::text AS due, o.number
           FROM mfg_order_materials m JOIN mfg_orders o ON o.id=m.order_id
          WHERE o.unit_id=$1::uuid AND o.deleted_at IS NULL AND o.status IN ('Planned','Released','In Progress')
            AND m.customer_supplied=false AND m.required_qty - m.issued_qty + m.returned_qty > 0
            AND o.due_date <= $2::date`,
        unitId,
        b.toDate,
      );
      for (const r of committed)
        demands.push({
          itemId: S(r.item_id),
          qty: S(r.q),
          date: S(r.due),
          type: 'ORDER',
          ref: S(r.number),
        });
      // ---- supply
      const boms = await activeBoms(tx, unitId);
      const wanted = new Set<string>();
      const stack = demands.map((d) => d.itemId);
      while (stack.length) {
        const i = stack.pop()!;
        if (wanted.has(i)) continue;
        wanted.add(i);
        for (const l of boms.get(i)?.lines ?? []) stack.push(l.itemId);
      }
      const ids = [...wanted];
      const [stock, po, pr, mo, items] = await Promise.all([
        query(
          tx,
          `SELECT s.item_id::text, sum(s.qty)::text AS q FROM stock_slices s JOIN warehouses w ON w.id=s.warehouse_id
            WHERE w.unit_id=$1::uuid AND w.is_transit=false AND s.stock_status='UNRESTRICTED' AND s.item_id = ANY($2::uuid[]) GROUP BY s.item_id`,
          unitId,
          ids,
        ),
        query(
          tx,
          `SELECT l.item_id::text, GREATEST(l.base_qty - l.received_qty - l.closed_qty,0)::text AS q, l.delivery_date::text AS due
             FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id
            WHERE p.unit_id=$1::uuid AND p.deleted_at IS NULL AND p.status='Approved' AND p.closed_at IS NULL AND l.item_id = ANY($2::uuid[])
              AND l.base_qty - l.received_qty - l.closed_qty > 0`,
          unitId,
          ids,
        ),
        query(
          tx,
          `SELECT l.item_id::text, GREATEST(l.qty - l.closed_qty,0)::text AS q, l.required_date::text AS due
             FROM purchase_requisition_lines l JOIN purchase_requisitions p ON p.id=l.pr_id
            WHERE p.unit_id=$1::uuid AND p.deleted_at IS NULL AND p.status IN ('Draft','Pending Approval','Approved') AND l.item_id = ANY($2::uuid[])
              AND l.qty - l.closed_qty > 0`,
          unitId,
          ids,
        ),
        query(
          tx,
          `SELECT item_id::text, GREATEST(qty - qty_scrapped - qty_received,0)::text AS q, due_date::text AS due
             FROM mfg_orders WHERE unit_id=$1::uuid AND deleted_at IS NULL AND status IN ('Planned','Released','In Progress') AND item_id = ANY($2::uuid[])
              AND qty - qty_scrapped - qty_received > 0`,
          unitId,
          ids,
        ),
        query(
          tx,
          `SELECT id::text, is_customer_supplied FROM items WHERE id = ANY($1::uuid[])`,
          ids,
        ),
      ]);
      const sum = (...parts: Row[][]): Map<string, string> => {
        const m = new Map<string, ReturnType<typeof D>>();
        for (const part of parts)
          for (const r of part) m.set(S(r.item_id), (m.get(S(r.item_id)) ?? D(0)).plus(S(r.q)));
        return new Map([...m].map(([k, v]) => [k, v.toFixed(3)]));
      };
      const receipts = new Map<string, { qty: string; date: string | null }[]>();
      for (const r of [...po, ...pr, ...mo])
        receipts.set(S(r.item_id), [
          ...(receipts.get(S(r.item_id)) ?? []),
          { qty: S(r.q), date: r.due ? S(r.due) : null },
        ]);
      let lines;
      try {
        lines = planMrp({
          demands,
          boms,
          customerSupplied: new Set(
            items.filter((i) => i.is_customer_supplied === true).map((i) => S(i.id)),
          ),
          onHand: sum(stock),
          scheduled: receipts,
          bucket: b.bucket ?? 'WEEK',
          rangeStart: b.fromDate,
        });
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('BOM_CYCLE'))
          throw Errors.validation({
            bom: 'The bills of materials make a loop. Fix the BOM first.',
          });
        throw e;
      }
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:MRP',
        unitId,
        fyId: fy.id,
        prefix: 'MRP',
      });
      const rid = await insertRow(tx, 'mfg_mrp_runs', {
        unitId,
        fyId: fy.id,
        number,
        fromDate: b.fromDate,
        toDate: b.toDate,
        includeForecast: include,
        bucket: b.bucket ?? 'WEEK',
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      for (const l of lines)
        await insertRow(tx, 'mfg_mrp_lines', {
          runId: rid,
          itemId: l.itemId,
          level: l.level,
          bucketStart: l.bucketStart,
          action: l.action,
          grossQty: l.gross,
          onHandQty: l.onHand,
          scheduledQty: l.scheduled,
          netQty: l.net,
          needDate: l.needDate,
          sources: JSON.stringify(l.sources),
        });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_MRP_RUN',
        'mfg_mrp_run',
        { id: rid, code: number },
        pageId,
        { lines: lines.length },
      );
      return rid;
    }, TX);
    return mrpService.get(caller, pageId, id);
  },

  /** Raises one Draft Purchase Requisition for the BUY lines and one Planned production order per PRODUCE line. Safe to repeat after a failure. */
  async apply(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: { warehouseId?: string | undefined; rmWarehouseId?: string | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const run = (
      await query(
        prisma,
        `SELECT t.* FROM mfg_mrp_runs t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!run) throw Errors.notFound('MRP run not found.');
    checkVersion(norm<Row>(run), version);
    if (S(run.status) !== 'Draft')
      throw Errors.conflict('This run was already applied or cancelled.');
    const lines = await query(
      prisma,
      `SELECT * FROM mfg_mrp_lines WHERE run_id=$1::uuid AND net_qty > 0 ORDER BY level`,
      id,
    );
    const produce = lines.filter((l) => S(l.action) === 'PRODUCE');
    const buy = lines.filter((l) => S(l.action) === 'BUY');
    if (produce.some((l) => !l.order_id) && (!b.warehouseId || !b.rmWarehouseId))
      throw Errors.validation({
        warehouseId:
          'Choose the finished-goods and the raw-material warehouse for the new production orders.',
      });
    // claim the run: a second apply at the same moment (or a retry within 5 minutes of a crash) is refused
    const claimed = await exec(
      prisma,
      `UPDATE mfg_mrp_runs SET applying_at=now() WHERE id=$1::uuid AND status='Draft' AND (applying_at IS NULL OR applying_at < now() - interval '5 minutes')`,
      id,
    );
    if (!claimed)
      throw Errors.conflict('This run is being applied right now, or was already applied.');
    try {
      // production orders first (each in its own transaction); a retry skips the lines that already have an order
      for (const l of produce) {
        if (l.order_id) continue;
        const o = await orderService.create(caller, 'mfg-orders', {
          itemId: S(l.item_id),
          qty: S(l.net_qty),
          dueDate: l.need_date ? dateOf(l.need_date) : dateOf(run.to_date),
          warehouseId: b.warehouseId!,
          rmWarehouseId: b.rmWarehouseId!,
          sourceType: 'MRP',
          sourceId: id,
          notes: `From ${S(run.number)}`,
        });
        await exec(
          prisma,
          `UPDATE mfg_mrp_lines SET order_id=$1::uuid WHERE id=$2::uuid`,
          S(o.id),
          S(l.id),
        );
      }
      await prisma.$transaction(async (tx) => {
        const cur = (
          await query(tx, `SELECT * FROM mfg_mrp_runs WHERE id=$1::uuid FOR UPDATE`, id)
        )[0]!;
        if (S(cur.status) !== 'Draft')
          throw Errors.conflict('This run was already applied or cancelled.');
        let prId: string | null = cur.pr_id ? S(cur.pr_id) : null;
        if (buy.length && !prId) {
          const items = await query(
            tx,
            `SELECT id::text, base_uom, standard_cost::text FROM items WHERE id = ANY($1::uuid[])`,
            buy.map((l) => S(l.item_id)),
          );
          const m = new Map(items.map((i) => [S(i.id), i]));
          const pr = await PurchaseRequestGateway.create(tx, {
            unitId: S(cur.unit_id),
            fyId: S(cur.fy_id),
            userId: caller.auth.userId,
            department: await departmentOf(tx, 'scm-pr', caller),
            purpose: `MRP ${S(cur.number)}`,
            lines: buy.map((l) => ({
              itemId: S(l.item_id),
              qty: D(S(l.net_qty)).toFixed(3),
              uom: S(m.get(S(l.item_id))?.base_uom),
              estRate: S(m.get(S(l.item_id))?.standard_cost ?? '0') || '0',
              ...(l.need_date ? { requiredDate: dateOf(l.need_date) } : {}),
            })),
          });
          prId = pr.id;
        }
        await exec(
          tx,
          `UPDATE mfg_mrp_runs SET applying_at=NULL, status='Applied', pr_id=$1::uuid, applied_at=now(), applied_by_id=$2::uuid, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
          prId,
          caller.auth.userId,
          id,
        );
        await audit(
          tx,
          caller,
          caller.auth.userId,
          'MFG_MRP_APPLIED',
          'mfg_mrp_run',
          { id, code: S(cur.number) },
          pageId,
          { produce: produce.length, buy: buy.length },
        );
      }, TX);
    } catch (e) {
      // let the user (or a retry) try again
      await exec(prisma, `UPDATE mfg_mrp_runs SET applying_at=NULL WHERE id=$1::uuid`, id);
      throw e;
    }
    return mrpService.get(caller, pageId, id);
  },

  async cancel(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_mrp_runs t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('MRP run not found.');
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'Draft') throw Errors.conflict('Only a draft run can be cancelled.');
      const made = await query(
        tx,
        `SELECT 1 FROM mfg_mrp_lines WHERE run_id=$1::uuid AND order_id IS NOT NULL LIMIT 1`,
        id,
      );
      if (made.length)
        throw Errors.conflict(
          'Production orders were already raised from this run. Apply it to finish, or cancel those orders first.',
        );
      await exec(
        tx,
        `UPDATE mfg_mrp_runs SET status='Cancelled', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_MRP_CANCELLED',
        'mfg_mrp_run',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return mrpService.get(caller, pageId, id);
  },
};
