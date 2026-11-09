// Phase 13 v2 production orders (spec sections 3 to 5). Draft -> (approval above a value) -> Released (BOM explosion frozen, job
// cards made from the routing) -> In Progress -> Completed -> Closed. Material moves through the stock service and posts
// Dr INVENTORY_WIP / Cr INVENTORY_RM; the finished goods receipt takes the order's WIP (Dr INVENTORY_FG / Cr INVENTORY_WIP) and
// holds the stock in Quality Inspection when the item needs a final inspection; close settles the last rupee of WIP.
import { randomUUID } from 'node:crypto';
import { AppError, Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { NumberingService } from '../../core/numbering';
import { D as ID, round2, ZERO } from '../inventory/money';
import { StockGl } from '../inventory/stock/gl';
import { StockService } from '../inventory/stock/stock-service';
import type { StockMoveInput } from '../inventory/stock/stock-service';
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
import { createInspection } from '../qms/inspection-service';
import type { Caller } from '../records/service';
import { releasedBoms, mfgError } from './bom-service';
import { D, explode, r2, r3, wipShare } from './calc';
import { costing } from './costing-service';
import { S, dateOf, masterService, oneUnit } from './master-service';

export const LIVE = ['Released', 'In Progress'];
export interface OrderInput {
  itemId: string;
  qty: string | number;
  dueDate: string;
  startDate?: string | undefined;
  customerId?: string | undefined;
  customerPoNo?: string | undefined;
  warehouseId: string;
  rmWarehouseId: string;
  wipWhId?: string | undefined;
  priority?: number | undefined;
  overProductionPct?: string | number | undefined;
  sourceType?: 'MANUAL' | 'SALES_ORDER' | 'MRP' | 'PLAN' | undefined;
  sourceId?: string | undefined;
  planLineId?: string | undefined;
  soLineId?: string | undefined;
  suggestionId?: string | undefined;
  notes?: string | undefined;
}

export async function lockOrder(
  tx: Db,
  sc: { sql: string; args: unknown[] },
  id: string,
): Promise<Row> {
  const cur = (
    await query(
      tx,
      `SELECT t.* FROM mfg_orders t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
      ...sc.args,
      id,
    )
  )[0];
  if (!cur) throw Errors.notFound('Production order not found.');
  return cur;
}

async function checkWarehouses(tx: Db, unitId: string, ids: string[]): Promise<void> {
  const rows = await query(
    tx,
    `SELECT id::text, status::text AS status, unit_id::text, is_transit FROM warehouses WHERE id = ANY($1::uuid[])`,
    [...new Set(ids)],
  );
  const m = new Map(rows.map((r) => [S(r.id), r]));
  for (const id of ids) {
    const w = m.get(id);
    if (!w || S(w.unit_id) !== unitId)
      throw Errors.validation({ warehouseId: 'Choose a warehouse of this unit.' });
    if (S(w.status) !== 'ACTIVE' || w.is_transit === true)
      throw Errors.validation({ warehouseId: 'Choose an active, non-transit warehouse.' });
  }
}

export async function nextMoveNo(
  tx: Db,
  order: Row,
  kind: 'ISSUE' | 'RETURN' | 'FG_RECEIPT' | 'BACKFLUSH' | 'SCRAP_RECOVERY',
): Promise<{ seq: number; number: string }> {
  const r = (
    await query(
      tx,
      `SELECT COALESCE(max(seq),0)+1 AS n FROM mfg_order_moves WHERE order_id=$1::uuid AND kind=$2`,
      S(order.id),
      kind,
    )
  )[0]!;
  const seq = Number(r.n);
  const tag = { ISSUE: 'I', RETURN: 'R', FG_RECEIPT: 'F', BACKFLUSH: 'B', SCRAP_RECOVERY: 'S' }[
    kind
  ];
  return { seq, number: `${S(order.number)}-${tag}${seq}` };
}

/** The frozen explosion of an order: flat requirements of the default released BOM on the date, phantoms exploded through. */
async function buildMaterials(
  tx: Db,
  unitId: string,
  itemId: string,
  qty: string,
  date: string,
): Promise<{
  bomId: string;
  lines: {
    itemId: string;
    qty: string;
    issueMethod: string;
    operationSeq: number | null;
    customerSupplied: boolean;
  }[];
  stdValue: string;
}> {
  const b = (
    await query(
      tx,
      `SELECT id::text FROM mfg_boms WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='RELEASED' AND is_default AND bom_type='STANDARD' AND deleted_at IS NULL
          AND (effective_from IS NULL OR effective_from <= $3::date) AND (effective_to IS NULL OR effective_to >= $3::date)`,
      unitId,
      itemId,
      date,
    )
  )[0];
  if (!b)
    throw Errors.validation({
      itemId: 'This item has no released bill of materials. Release one first.',
    });
  const map = await releasedBoms(tx, unitId);
  let req;
  try {
    req = explode(itemId, qty, date, map);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('BOM_CYCLE'))
      throw mfgError('BOM_CYCLE', `BOM loop: ${e.message.slice(10)}. A part can't contain itself.`);
    throw e;
  }
  if (req.length === 0)
    throw Errors.validation({ itemId: 'The bill of materials has no component valid today.' });
  const items = await query(
    tx,
    `SELECT id::text, is_customer_supplied, standard_cost::text AS c FROM items WHERE id = ANY($1::uuid[])`,
    req.map((r) => r.itemId),
  );
  const info = new Map(items.map((i) => [S(i.id), i]));
  let std = D(0);
  const lines = req.map((r) => {
    std = std.plus(D(r.qty).mul(S(info.get(r.itemId)?.c ?? 0)));
    return {
      itemId: r.itemId,
      qty: r.qty,
      issueMethod: r.issueMethod,
      operationSeq: r.operationSeq,
      customerSupplied: info.get(r.itemId)?.is_customer_supplied === true,
    };
  });
  return { bomId: S(b.id), lines, stdValue: r2(std).toFixed(2) };
}
async function writeMaterials(
  tx: Db,
  orderId: string,
  lines: {
    itemId: string;
    qty: string;
    issueMethod: string;
    operationSeq: number | null;
    customerSupplied: boolean;
  }[],
): Promise<void> {
  let n = 0;
  for (const l of lines) {
    n += 1;
    await insertRow(tx, 'mfg_order_materials', {
      orderId,
      lineNo: n,
      itemId: l.itemId,
      requiredQty: l.qty,
      issueMethod: l.issueMethod,
      operationSeq: l.operationSeq,
      customerSupplied: l.customerSupplied,
    });
  }
}

/** Σ(setup + run x qty) / 60 per work centre against the calendar hours up to the due date; over 100 % is a warning, not a block. */
export async function capacityCheck(
  db: Db,
  ops: { workCentreId: string; setup: string; run: string }[],
  qty: string,
  start: string,
  due: string,
): Promise<{ workCentre: string; neededHours: string; availableHours: string; loadPct: string }[]> {
  const out: {
    workCentre: string;
    neededHours: string;
    availableHours: string;
    loadPct: string;
  }[] = [];
  const byWc = new Map<string, number>();
  for (const o of ops)
    byWc.set(
      o.workCentreId,
      (byWc.get(o.workCentreId) ?? 0) +
        Number(D(o.setup).plus(D(o.run).mul(qty)).div(60).toFixed(4)),
    );
  for (const [wcId, needed] of byWc) {
    const w = (
      await query(
        db,
        `SELECT w.code, w.capacity_hours::text AS hrs, w.calendar_id::text AS cal, c.work_days FROM mfg_work_centres w LEFT JOIN mfg_wc_calendars c ON c.id=w.calendar_id WHERE w.id=$1::uuid`,
        wcId,
      )
    )[0];
    if (!w) continue;
    const workDays = new Set<number>((w.work_days as number[] | null) ?? [1, 2, 3, 4, 5, 6]);
    const exc = w.cal
      ? await query(
          db,
          `SELECT exc_date::text AS d, available_hrs::text AS h FROM mfg_wc_calendar_exceptions WHERE calendar_id=$1::uuid`,
          S(w.cal),
        )
      : [];
    const ex = new Map(exc.map((e) => [S(e.d), Number(S(e.h))]));
    let avail = 0;
    for (
      let d = new Date(`${start}T00:00:00Z`);
      d.toISOString().slice(0, 10) <= due;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const iso = d.toISOString().slice(0, 10);
      avail += ex.has(iso) ? ex.get(iso)! : workDays.has(d.getUTCDay()) ? Number(S(w.hrs)) : 0;
    }
    out.push({
      workCentre: S(w.code),
      neededHours: needed.toFixed(2),
      availableHours: avail.toFixed(2),
      loadPct: avail > 0 ? ((needed / avail) * 100).toFixed(1) : '999.0',
    });
  }
  return out;
}

interface FinalLot {
  lotId: string;
  qty: string;
  itemId: string;
  customerId: string | null;
  receiptId: string;
  orderNo: string;
  unitId: string;
}

export const orderService = {
  // ---------------------------------------------------------------------------------------------- read
  async list(
    caller: Caller,
    pageId: string,
    q: {
      status?: string | undefined;
      itemId?: string | undefined;
      q?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
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
    if (q.itemId) {
      args.push(q.itemId);
      where.push(`t.item_id=$${args.length}::uuid`);
    }
    if (q.from) {
      args.push(q.from);
      where.push(`t.due_date >= $${args.length}::date`);
    }
    if (q.to) {
      args.push(q.to);
      where.push(`t.due_date <= $${args.length}::date`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(
        `(t.number ILIKE $${args.length} OR i.code ILIKE $${args.length} OR i.name ILIKE $${args.length} OR t.customer_po_no ILIKE $${args.length})`,
      );
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM mfg_orders t JOIN items i ON i.id=t.item_id WHERE ${w}`,
          ...args,
        )
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom, c.name AS customer_name
         FROM mfg_orders t JOIN items i ON i.id=t.item_id LEFT JOIN customers c ON c.id=t.customer_id
        WHERE ${w} ORDER BY t.priority, t.due_date, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom, i.batch_tracked, i.serial_tracked, i.qc_required,
                c.name AS customer_name, w.code AS warehouse_code, rw.code AS rm_warehouse_code, b.number AS bom_no, b.version_no AS bom_version
           FROM mfg_orders t JOIN items i ON i.id=t.item_id LEFT JOIN customers c ON c.id=t.customer_id
           JOIN warehouses w ON w.id=t.warehouse_id JOIN warehouses rw ON rw.id=t.rm_warehouse_id JOIN mfg_boms b ON b.id=t.bom_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Production order not found.');
    const [materials, ops, lots, moves, receipts] = await Promise.all([
      query(
        prisma,
        `SELECT m.id::text, m.line_no, m.item_id::text, m.required_qty, m.issued_qty, m.returned_qty, m.consumed_qty, m.issued_value, m.returned_value,
                m.customer_supplied, m.issue_method, m.operation_seq, i.code AS item_code, i.name AS item_name, i.base_uom AS uom
           FROM mfg_order_materials m JOIN items i ON i.id=m.item_id WHERE m.order_id=$1::uuid ORDER BY m.line_no`,
        id,
      ),
      query(
        prisma,
        `SELECT o.id::text, o.seq, o.name, o.work_centre_id::text, w.code AS work_centre_code, w.kind AS work_centre_kind, o.setup_minutes, o.run_minutes, o.queue_min, o.move_min,
                o.inspection_required AS qc_required, o.status, o.qty_done, o.qty_rejected, o.qty_scrap, o.qty_rework, o.setup_minutes_actual, o.run_minutes_actual,
                o.labour_rate, o.overhead_rate, o.absorbed_posted, o.inspection_id::text, o.started_at, o.completed_at
           FROM mfg_order_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.order_id=$1::uuid ORDER BY o.seq`,
        id,
      ),
      query(
        prisma,
        `SELECT l.id::text, l.kind, l.lot_no, l.lot_qty, l.received_qty, l.op_id::text, l.receipt_id::text, l.inspection_id::text, q.number AS inspection_no,
                q.status AS inspection_status, q.result AS inspection_result, q.accepted_qty, q.rejected_qty
           FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.order_id=$1::uuid AND q.status <> 'Cancelled' ORDER BY l.lot_no`,
        id,
      ),
      query(
        prisma,
        `SELECT id::text, kind, seq, number, move_date, total_qty, total_value, status FROM mfg_order_moves WHERE order_id=$1::uuid ORDER BY created_at`,
        id,
      ),
      query(
        prisma,
        `SELECT id::text, number, receipt_date, qty, qc_status, unit_cost, amount, is_final, status, lot_id::text FROM mfg_production_receipts WHERE order_id=$1::uuid ORDER BY created_at`,
        id,
      ),
    ]);
    const order = norm<Row>(h);
    const tol = D(S(order.overProductionPct));
    const opRows = ops.map((r) => norm<Row>(r));
    const acceptedByOp = new Map<string, string>();
    for (const l of lots)
      if (S(l.kind) === 'OP' && S(l.inspection_status) === 'Decided')
        acceptedByOp.set(
          S(l.op_id),
          D(acceptedByOp.get(S(l.op_id)) ?? 0)
            .plus(S(l.accepted_qty ?? 0))
            .toFixed(3),
        );
    let carry = r3(D(S(order.qty)).mul(D(1).plus(tol.div(100)))).toFixed(3);
    const cards = opRows.map((o) => {
      const qtyIn = carry;
      const processed = D(S(o.qtyDone))
        .plus(S(o.qtyRejected))
        .plus(S(o.qtyScrap))
        .plus(S(o.qtyRework));
      carry = o.qcRequired === true ? (acceptedByOp.get(S(o.id)) ?? '0.000') : S(o.qtyDone);
      return { ...o, qtyIn, remaining: D(qtyIn).minus(processed).toFixed(3), goodForNext: carry };
    });
    const ev = await costing.byEvent(prisma, id);
    const material = D(ev.ISSUE ?? 0)
      .plus(ev.RETURN ?? 0)
      .plus(ev.BACKFLUSH ?? 0);
    const wip = await costing.wip(prisma, id);
    return {
      ...order,
      materials: materials.map((r) => norm<Row>(r)),
      ops: cards,
      lots: lots.map((r) => norm<Row>(r)),
      moves: moves.map((r) => norm<Row>(r)),
      receipts: receipts.map((r) => norm<Row>(r)),
      cost: {
        material: material.toFixed(2),
        labour: D(ev.LABOUR ?? 0).toFixed(2),
        overhead: D(ev.OVERHEAD ?? 0).toFixed(2),
        abnormalScrap: D(ev.ABNORMAL_SCRAP ?? 0)
          .negated()
          .toFixed(2),
        recovery: D(ev.RECOVERY ?? 0)
          .negated()
          .toFixed(2),
        fgValue: D(ev.FG_RECEIPT ?? 0)
          .negated()
          .toFixed(2),
        wip,
      },
    };
  },

  // ---------------------------------------------------------------------------------------------- create / change
  async create(caller: Caller, pageId: string, b: OrderInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    if (D(String(b.qty)).lte(0))
      throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    if (
      b.overProductionPct !== undefined &&
      (D(String(b.overProductionPct)).lt(0) || D(String(b.overProductionPct)).gt(100))
    )
      throw Errors.validation({ overProductionPct: 'Enter 0 to 100.' });
    const id = await prisma.$transaction(async (tx) => {
      const item = (
        await query(
          tx,
          `SELECT status::text AS status, is_customer_supplied FROM items WHERE id=$1::uuid AND deleted_at IS NULL`,
          b.itemId,
        )
      )[0];
      if (!item || S(item.status) !== 'ACTIVE')
        throw Errors.validation({ itemId: 'Choose an active item.' });
      if (item.is_customer_supplied === true)
        throw Errors.validation({
          itemId: 'This item is supplied by the customer. It cannot be produced here.',
        });
      const planning = (
        await query(
          tx,
          `SELECT wip_wh_id::text, fg_wh_id::text FROM mfg_item_planning WHERE item_id=$1::uuid`,
          b.itemId,
        )
      )[0];
      const wip = b.wipWhId ?? (planning?.wip_wh_id ? S(planning.wip_wh_id) : null);
      await checkWarehouses(tx, unitId, [b.warehouseId, b.rmWarehouseId, ...(wip ? [wip] : [])]);
      if (
        b.customerId &&
        !(await query(tx, `SELECT 1 FROM customers WHERE id=$1::uuid`, b.customerId))[0]
      )
        throw Errors.validation({ customerId: 'Customer not found.' });
      const qty = D(String(b.qty)).toFixed(3);
      const mats = await buildMaterials(tx, unitId, b.itemId, qty, b.startDate ?? todayIst());
      const routing = (
        await query(
          tx,
          `SELECT id::text FROM mfg_routings WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='RELEASED' AND deleted_at IS NULL`,
          unitId,
          b.itemId,
        )
      )[0];
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:PRO',
        unitId,
        fyId: fy.id,
        prefix: 'PO-MFG',
      });
      const rid = await insertRow(tx, 'mfg_orders', {
        unitId,
        fyId: fy.id,
        number,
        status: 'Planned',
        itemId: b.itemId,
        bomId: mats.bomId,
        routingId: routing ? S(routing.id) : null,
        qty,
        startDate: b.startDate ?? null,
        dueDate: b.dueDate,
        priority: b.priority ?? 5,
        sourceType: b.sourceType ?? 'MANUAL',
        sourceId: b.sourceId ?? null,
        planLineId: b.planLineId ?? null,
        soLineId: b.soLineId ?? null,
        suggestionId: b.suggestionId ?? null,
        customerId: b.customerId ?? null,
        customerPoNo: b.customerPoNo ?? null,
        warehouseId: b.warehouseId,
        rmWarehouseId: b.rmWarehouseId,
        wipWhId: wip,
        overProductionPct: D(String(b.overProductionPct ?? 0)).toFixed(2),
        stdValue: mats.stdValue,
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await writeMaterials(tx, rid, mats.lines);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ORDER_CREATED',
        'mfg_order',
        { id: rid, code: number },
        pageId,
        { source: b.sourceType ?? 'MANUAL' },
      );
      return rid;
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  async update(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: Partial<Omit<OrderInput, 'itemId' | 'sourceType' | 'sourceId'>>,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'Planned') throw Errors.conflict('Only a draft order can be edited.');
      const unitId = S(cur.unit_id);
      if (b.warehouseId || b.rmWarehouseId)
        await checkWarehouses(tx, unitId, [
          b.warehouseId ?? S(cur.warehouse_id),
          b.rmWarehouseId ?? S(cur.rm_warehouse_id),
        ]);
      let std: string | null = null;
      if (b.qty !== undefined) {
        if (D(String(b.qty)).lte(0))
          throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
        const mats = await buildMaterials(
          tx,
          unitId,
          S(cur.item_id),
          D(String(b.qty)).toFixed(3),
          todayIst(),
        );
        await exec(tx, `DELETE FROM mfg_order_materials WHERE order_id=$1::uuid`, id);
        await writeMaterials(tx, id, mats.lines);
        await exec(tx, `UPDATE mfg_orders SET bom_id=$1::uuid WHERE id=$2::uuid`, mats.bomId, id);
        std = mats.stdValue;
      }
      await exec(
        tx,
        `UPDATE mfg_orders SET qty=COALESCE($1::numeric,qty), due_date=COALESCE($2::date,due_date), start_date=COALESCE($3::date,start_date), customer_id=COALESCE($4::uuid,customer_id),
           customer_po_no=COALESCE($5,customer_po_no), warehouse_id=COALESCE($6::uuid,warehouse_id), rm_warehouse_id=COALESCE($7::uuid,rm_warehouse_id), notes=COALESCE($8,notes),
           priority=COALESCE($9,priority), over_production_pct=COALESCE($10::numeric,over_production_pct), std_value=COALESCE($11::numeric,std_value),
           updated_by_id=$12::uuid, updated_at=now(), version=version+1 WHERE id=$13::uuid`,
        b.qty === undefined ? null : D(String(b.qty)).toFixed(3),
        b.dueDate ?? null,
        b.startDate ?? null,
        b.customerId ?? null,
        b.customerPoNo ?? null,
        b.warehouseId ?? null,
        b.rmWarehouseId ?? null,
        b.notes ?? null,
        b.priority ?? null,
        b.overProductionPct === undefined ? null : D(String(b.overProductionPct)).toFixed(2),
        std,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ORDER_UPDATED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  /**
   * Release. Above the approval value (a setting; none is set until the owner sets it) a user without the approve right sends the
   * order to Pending Approval; the approver's release runs the same checks and freezes everything: the explosion stays as made,
   * job cards are created from the routing with the work-centre rates, an outside operation blocks the release.
   */
  async release(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    canApprove: boolean,
  ): Promise<Row & { warnings?: unknown[] }> {
    const sc = await scopeSql(caller, pageId);
    let warnings: unknown[] = [];
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (!['Planned', 'Pending Approval'].includes(S(cur.status)))
        throw Errors.conflict('Only a draft order can be released.');
      const unitId = S(cur.unit_id);
      const rt = (
        await query(
          tx,
          `SELECT id::text FROM mfg_routings WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='RELEASED' AND deleted_at IS NULL`,
          unitId,
          S(cur.item_id),
        )
      )[0];
      if (!rt)
        throw Errors.validation({
          routing: 'This item has no released routing. Release one first.',
        });
      const ops = await query(
        tx,
        `SELECT o.*, w.status AS wc_status, w.code AS wc_code, w.labour_rate_per_hr::text AS lr, w.overhead_rate_per_hr::text AS orr, w.cost_centre_id::text AS cc
           FROM mfg_routing_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.routing_id=$1::uuid ORDER BY o.seq`,
        S(rt.id),
      );
      if (!ops.length) throw Errors.validation({ routing: 'The routing has no operation.' });
      for (const o of ops) {
        if (o.is_outside === true)
          throw mfgError(
            'ORDER_OUTSIDE_OP_V1',
            'Outside (subcontract) operations arrive in Phase 13b.',
            { routing: `Operation ${S(o.seq)} is an outside operation.` },
          );
        if (S(o.wc_status) !== 'ACTIVE')
          throw Errors.validation({
            routing: `Operation ${S(o.seq)} uses a work centre that is no longer active.`,
          });
        if (o.lr === null || o.orr === null || !o.cc)
          throw mfgError(
            'WC_RATE_MISSING',
            `Work centre ${S(o.wc_code)} has no labour/overhead rate; Finance must set it before release.`,
            {
              workCentre: `Work centre ${S(o.wc_code)}: set the labour rate, the overhead rate and the cost centre.`,
            },
          );
      }
      const settings = await masterService.settings(unitId);
      const limit = settings.ORDER_APPROVAL_VALUE;
      const needsApproval = limit !== undefined && D(S(cur.std_value ?? 0)).gt(limit);
      if (needsApproval && !canApprove) {
        await exec(
          tx,
          `UPDATE mfg_orders SET status='Pending Approval', submitted_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
          caller.auth.userId,
          id,
        );
        await audit(
          tx,
          caller,
          caller.auth.userId,
          'MFG_ORDER_SUBMITTED',
          'mfg_order',
          { id, code: S(cur.number) },
          pageId,
          { value: S(cur.std_value) },
        );
        return;
      }
      for (const o of ops)
        await insertRow(tx, 'mfg_order_ops', {
          orderId: id,
          seq: Number(o.seq),
          name: S(o.name),
          workCentreId: S(o.work_centre_id),
          setupMinutes: S(o.setup_minutes),
          runMinutes: S(o.run_minutes),
          queueMin: S(o.queue_min),
          moveMin: S(o.move_min),
          inspectionRequired: o.inspection_required === true,
          costPerHour: S(o.lr),
          labourRate: S(o.lr),
          overheadRate: S(o.orr),
        });
      warnings = await capacityCheck(
        tx,
        ops.map((o) => ({
          workCentreId: S(o.work_centre_id),
          setup: S(o.setup_minutes),
          run: S(o.run_minutes),
        })),
        S(cur.qty),
        dateOf(cur.start_date ?? todayIst()),
        dateOf(cur.due_date),
      );
      warnings = (warnings as { loadPct: string }[]).filter((w) => Number(w.loadPct) > 100);
      await exec(
        tx,
        `UPDATE mfg_orders SET status='Released', routing_id=$1::uuid, released_at=now(), approved_by_id=$2::uuid, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        S(rt.id),
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ORDER_RELEASED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        { warnings: warnings.length },
      );
    }, TX);
    return { ...(await orderService.get(caller, pageId, id)), warnings };
  },

  async cancel(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    reason: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (!['Planned', 'Pending Approval', 'Released'].includes(S(cur.status)))
        throw Errors.conflict('Only an order that has not started can be cancelled.');
      const net = (
        await query(
          tx,
          `SELECT COALESCE(sum(issued_qty - returned_qty - consumed_qty),0)::text AS n FROM mfg_order_materials WHERE order_id=$1::uuid`,
          id,
        )
      )[0]!;
      if (D(S(net.n)).gt(0))
        throw Errors.conflict(
          'Material is still issued to this order. Return it to the store first.',
        );
      if (
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_job_card_time_logs WHERE order_id=$1::uuid LIMIT 1`,
            id,
          )
        ).length
      )
        throw Errors.conflict('Production has been logged on this order. Close it instead.');
      await exec(
        tx,
        `UPDATE mfg_orders SET status='Cancelled', close_note=$1, closed_at=now(), updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        reason,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ORDER_CANCELLED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        { reason },
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  /** Start of production: In Progress is set by the first job-card start; this only checks the order can run. */
  async technicallyComplete(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      if (!LIVE.includes(S(cur.status))) throw Errors.conflict('This order is not running.');
      const open = await query(
        tx,
        `SELECT seq FROM mfg_order_ops WHERE order_id=$1::uuid AND status <> 'Done' ORDER BY seq`,
        id,
      );
      if (open.length) throw Errors.conflict(`Operation ${S(open[0]!.seq)} is not complete.`);
      await exec(
        tx,
        `UPDATE mfg_orders SET status='Completed', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ORDER_COMPLETED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        {},
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  /**
   * Close: every finished piece must be in stock; open rework or unsettled scrap blocks it. The last receipt already took the
   * exact WIP; a rounding rest (up to Rs 1) or the WIP of an order that made nothing good goes to SCRAP_LOSS; more than that is
   * ORDER_HAS_OPEN_WIP. The cost sheet is finalised.
   */
  async close(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    note: string | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (!['Completed', 'In Progress'].includes(S(cur.status)))
        throw Errors.conflict('Only a completed order can be closed.');
      const open = await query(
        tx,
        `SELECT seq FROM mfg_order_ops WHERE order_id=$1::uuid AND status <> 'Done' ORDER BY seq LIMIT 1`,
        id,
      );
      if (open.length && D(S(cur.qty_completed)).gt(0))
        throw Errors.conflict(`Operation ${S(open[0]!.seq)} is not complete.`);
      if (
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_rework WHERE order_id=$1::uuid AND status='Open' LIMIT 1`,
            id,
          )
        ).length
      )
        throw Errors.conflict('A rework order is still open on this order.');
      if (
        (
          await query(
            tx,
            `SELECT 1 FROM mfg_scrap WHERE order_id=$1::uuid AND status='Draft' LIMIT 1`,
            id,
          )
        ).length
      )
        throw Errors.conflict('A scrap entry is still a draft. Submit or cancel it first.');
      const left = D(S(cur.qty_completed)).minus(S(cur.qty_received));
      if (left.gt(0))
        throw Errors.conflict(
          `${left.toFixed(3)} finished pieces are not in stock yet. Receive them first.`,
        );
      const date = todayIst();
      const wip = D(await costing.wip(tx, id));
      if (wip.abs().gt(0)) {
        if (D(S(cur.qty_completed)).gt(0) && wip.abs().gt(1))
          throw mfgError(
            'ORDER_HAS_OPEN_WIP',
            `Close blocked: WIP ₹${wip.toFixed(2)} not settled.`,
            undefined,
            409,
          );
        await costing.sweepToLoss(tx, caller, id, date);
      }
      await costing.sheet(tx, id, true);
      await exec(
        tx,
        `UPDATE mfg_orders SET status='Closed', close_note=$1, closed_at=now(), updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        note ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_ORDER_CLOSED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        { wip: wip.toFixed(2) },
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- material
  /** Manual issue to the order. Over-issue beyond the tolerance needs a supervisor (the approve right). Dr INVENTORY_WIP / Cr stock. */
  async issue(
    caller: Caller,
    pageId: string,
    id: string,
    lines: {
      materialId: string;
      qty: string | number;
      batchNo?: string | undefined;
      serialNos?: string[] | undefined;
    }[],
    supervisor: boolean,
  ): Promise<Row> {
    if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    if (new Set(lines.map((l) => l.materialId)).size !== lines.length)
      throw Errors.validation({ lines: 'A material is listed twice. Put the total on one line.' });
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      if (!LIVE.includes(S(cur.status)))
        throw Errors.conflict('Material can be issued to a released order only.');
      const tol = D((await masterService.settings(S(cur.unit_id))).OVER_ISSUE_PCT ?? '0');
      const mats = await query(
        tx,
        `SELECT m.*, i.code FROM mfg_order_materials m JOIN items i ON i.id=m.item_id WHERE m.order_id=$1::uuid FOR UPDATE OF m`,
        id,
      );
      const byId = new Map(mats.map((m) => [S(m.id), m]));
      const errs: Record<string, string> = {};
      const moves: StockMoveInput[] = [];
      const touched: { m: Row; qty: string }[] = [];
      const mv = await nextMoveNo(tx, cur, 'ISSUE');
      const moveId = randomUUID();
      lines.forEach((l, i) => {
        const m = byId.get(l.materialId);
        const qty = D(String(l.qty));
        if (!m)
          return void (errs[`lines.${i}.materialId`] = 'This is not a material of the order.');
        if (qty.lte(0)) return void (errs[`lines.${i}.qty`] = 'Enter a quantity greater than 0.');
        if (m.customer_supplied === true)
          return void (errs[`lines.${i}.materialId`] =
            "This is the customer's own material. It is not issued from valued stock.");
        const net = D(S(m.issued_qty)).minus(S(m.returned_qty));
        const max = D(S(m.required_qty)).mul(D(1).plus(tol.div(100)));
        if (net.plus(qty).gt(max) && !supervisor)
          throw mfgError(
            'OVER_ISSUE',
            `Issue exceeds requirement by more than ${tol.toFixed(0)} %.`,
            {
              [`lines.${i}.qty`]: `${S(m.code)}: at most ${max.minus(net).gt(0) ? max.minus(net).toFixed(3) : '0'} more can be issued without a supervisor.`,
            },
          );
        touched.push({ m, qty: qty.toFixed(3) });
        moves.push({
          warehouseId: S(cur.rm_warehouse_id),
          itemId: S(m.item_id),
          direction: 'OUT',
          qty: ID(qty.toFixed(3)),
          postingDate: date,
          voucherType: 'MFG_ISSUE',
          voucherId: moveId,
          voucherNo: mv.number,
          createdById: caller.auth.userId,
          reasonCode: 'MFG_ISSUE',
          ...(l.batchNo ? { batch: { batchNo: l.batchNo } } : {}),
          ...(l.serialNos?.length ? { serialNos: l.serialNos } : {}),
        });
      });
      if (Object.keys(errs).length) throw Errors.validation(errs);
      const results = await StockService.postMany(tx, moves);
      let total = ZERO;
      const ledgerIds: string[] = [];
      const detail: unknown[] = [];
      results.forEach((r, i) => {
        let v = ZERO;
        for (const e of r.entries) {
          ledgerIds.push(e.id);
          v = v.plus(e.value);
        }
        total = total.plus(v);
        detail.push({
          materialId: S(touched[i]!.m.id),
          itemId: S(touched[i]!.m.item_id),
          qty: touched[i]!.qty,
          value: round2(v).toFixed(),
        });
      });
      const journal = await StockGl.post(tx, {
        voucherId: moveId,
        voucherNo: mv.number,
        unitId: S(cur.unit_id),
        postingDate: date,
        event: 'MFG_MATERIAL_ISSUED',
        voucherType: 'Delivery',
        counter: 'INVENTORY_WIP',
        ledgerIds,
        narration: `Material issued to ${S(cur.number)}`,
        actorId: caller.auth.userId,
      });
      for (let i = 0; i < touched.length; i++)
        await exec(
          tx,
          `UPDATE mfg_order_materials SET issued_qty=issued_qty+$1::numeric, issued_value=issued_value+$2::numeric WHERE id=$3::uuid`,
          touched[i]!.qty,
          (detail[i] as { value: string }).value,
          S(touched[i]!.m.id),
        );
      await insertRow(tx, 'mfg_order_moves', {
        id: moveId,
        unitId: S(cur.unit_id),
        orderId: id,
        kind: 'ISSUE',
        seq: mv.seq,
        number: mv.number,
        moveDate: date,
        journalId: journal?.id ?? null,
        totalQty: touched.reduce((a, t) => a.plus(t.qty), ZERO).toFixed(3),
        totalValue: round2(total).toFixed(),
        detail: JSON.stringify(detail),
        createdById: caller.auth.userId,
      });
      await costing.ledger(tx, caller, {
        unitId: S(cur.unit_id),
        orderId: id,
        event: 'ISSUE',
        element: 'MATERIAL',
        amount: round2(total).toFixed(2),
        journalId: journal?.id ?? null,
        refType: 'move',
        refId: moveId,
        date,
      });
      await refreshMaterialStatus(tx, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_MATERIAL_ISSUED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        { number: mv.number, value: round2(total).toFixed() },
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  /** Unused components go back to their warehouse at the rate they were issued at. Dr stock / Cr INVENTORY_WIP. */
  async returnMaterial(
    caller: Caller,
    pageId: string,
    id: string,
    lines: { materialId: string; qty: string | number; batchNo?: string | undefined }[],
  ): Promise<Row> {
    if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    if (new Set(lines.map((l) => l.materialId)).size !== lines.length)
      throw Errors.validation({ lines: 'A material is listed twice. Put the total on one line.' });
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      if (!LIVE.includes(S(cur.status)) && S(cur.status) !== 'Completed')
        throw Errors.conflict('Material can be returned from a running or completed order only.');
      const mats = await query(
        tx,
        `SELECT m.*, i.code FROM mfg_order_materials m JOIN items i ON i.id=m.item_id WHERE m.order_id=$1::uuid FOR UPDATE OF m`,
        id,
      );
      const byId = new Map(mats.map((m) => [S(m.id), m]));
      const errs: Record<string, string> = {};
      const mv = await nextMoveNo(tx, cur, 'RETURN');
      const moveId = randomUUID();
      const moves: StockMoveInput[] = [];
      const touched: { m: Row; qty: string; value: string }[] = [];
      lines.forEach((l, i) => {
        const m = byId.get(l.materialId);
        const qty = D(String(l.qty));
        if (!m)
          return void (errs[`lines.${i}.materialId`] = 'This is not a material of the order.');
        if (m.customer_supplied === true)
          return void (errs[`lines.${i}.materialId`] =
            'Customer material is returned on the Customer Material screen.');
        if (qty.lte(0)) return void (errs[`lines.${i}.qty`] = 'Enter a quantity greater than 0.');
        const out = D(S(m.issued_qty)).minus(S(m.returned_qty)).minus(S(m.consumed_qty));
        if (qty.gt(out))
          return void (errs[`lines.${i}.qty`] =
            `${S(m.code)}: only ${out.toFixed(3)} is with the order.`);
        const outValue = D(S(m.issued_value)).minus(S(m.returned_value));
        const value = qty.eq(out) ? outValue : r2(outValue.mul(qty).div(out));
        touched.push({ m, qty: qty.toFixed(3), value: value.toFixed(2) });
        moves.push({
          warehouseId: S(cur.rm_warehouse_id),
          itemId: S(m.item_id),
          direction: 'IN',
          qty: ID(qty.toFixed(3)),
          postingDate: date,
          voucherType: 'MFG_RETURN',
          voucherId: moveId,
          voucherNo: mv.number,
          createdById: caller.auth.userId,
          value: ID(value.toFixed(2)),
          stockStatus: 'UNRESTRICTED',
          reasonCode: 'MFG_RETURN',
          ...(l.batchNo ? { batch: { batchNo: l.batchNo } } : {}),
        });
      });
      if (Object.keys(errs).length) throw Errors.validation(errs);
      const results = await StockService.postMany(tx, moves);
      const total = touched.reduce((a, t) => a.plus(t.value), ZERO);
      const journal = await StockGl.post(tx, {
        voucherId: moveId,
        voucherNo: mv.number,
        unitId: S(cur.unit_id),
        postingDate: date,
        event: 'MFG_MATERIAL_RETURNED',
        voucherType: 'Goods Receipt',
        counter: 'INVENTORY_WIP',
        ledgerIds: results.flatMap((r) => r.entries.map((e) => e.id)),
        narration: `Material returned from ${S(cur.number)}`,
        actorId: caller.auth.userId,
      });
      for (const t of touched)
        await exec(
          tx,
          `UPDATE mfg_order_materials SET returned_qty=returned_qty+$1::numeric, returned_value=returned_value+$2::numeric WHERE id=$3::uuid`,
          t.qty,
          t.value,
          S(t.m.id),
        );
      await insertRow(tx, 'mfg_order_moves', {
        id: moveId,
        unitId: S(cur.unit_id),
        orderId: id,
        kind: 'RETURN',
        seq: mv.seq,
        number: mv.number,
        moveDate: date,
        journalId: journal?.id ?? null,
        totalQty: touched.reduce((a, t) => a.plus(t.qty), ZERO).toFixed(3),
        totalValue: total.toFixed(2),
        detail: JSON.stringify(
          touched.map((t) => ({
            materialId: S(t.m.id),
            itemId: S(t.m.item_id),
            qty: t.qty,
            value: t.value,
          })),
        ),
        createdById: caller.auth.userId,
      });
      await costing.ledger(tx, caller, {
        unitId: S(cur.unit_id),
        orderId: id,
        event: 'RETURN',
        element: 'MATERIAL',
        amount: total.negated().toFixed(2),
        journalId: journal?.id ?? null,
        refType: 'move',
        refId: moveId,
        date,
      });
      await refreshMaterialStatus(tx, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_MATERIAL_RETURNED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        { number: mv.number },
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- finished goods
  /**
   * Production receipt. The order's WIP is shared out by pieces (the last piece takes the exact balance). An item that needs a final
   * inspection goes into Quality Inspection stock and an inspection lot is opened; the Usage Decision releases or blocks it.
   */
  async receive(
    caller: Caller,
    pageId: string,
    id: string,
    b: { qty: string | number; batchNo?: string | undefined; serialNos?: string[] | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    const out: { lot?: FinalLot } = {};
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      if (!LIVE.includes(S(cur.status)) && S(cur.status) !== 'Completed')
        throw Errors.conflict(
          'Finished goods can be received from a running or completed order only.',
        );
      const qty = D(String(b.qty));
      if (qty.lte(0)) throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
      const tol = D(S(cur.over_production_pct));
      const maxTotal = D(S(cur.qty)).mul(D(1).plus(tol.div(100)));
      if (D(S(cur.qty_received)).plus(qty).gt(maxTotal))
        throw mfgError(
          'OVER_PRODUCTION',
          `Receipt exceeds order qty + ${tol.toFixed(0)} % tolerance.`,
          { qty: 'Too much for this order.' },
        );
      const goodLeft = D(S(cur.qty_completed)).minus(S(cur.qty_received));
      if (qty.gt(goodLeft))
        throw Errors.validation({
          qty: `Only ${goodLeft.gt(0) ? goodLeft.toFixed(3) : '0'} good pieces are ready to receive.`,
        });
      const item = (
        await query(
          tx,
          `SELECT batch_tracked, qc_required FROM items WHERE id=$1::uuid`,
          S(cur.item_id),
        )
      )[0]!;
      // backflush at FG receipt for lines with no operation of their own
      await backflushOrder(tx, caller, cur, null, qty.toFixed(3), date);
      const wip = D(await costing.wip(tx, id));
      // while the order is still running, the pieces still to come count: the first receipt must not take all the WIP
      const planLeft = D(S(cur.qty)).minus(S(cur.qty_scrapped)).minus(S(cur.qty_received));
      const shareBase =
        S(cur.status) !== 'Completed' && planLeft.gt(goodLeft) ? planLeft : goodLeft;
      const share = wipShare(wip, qty, shareBase);
      const finalReceipt = qty.gte(shareBase);
      const mv = await nextMoveNo(tx, cur, 'FG_RECEIPT');
      const moveId = randomUUID();
      const qc = item.qc_required === true;
      const res = await StockService.postMovement(tx, {
        warehouseId: S(cur.warehouse_id),
        itemId: S(cur.item_id),
        direction: 'IN',
        qty: ID(qty.toFixed(3)),
        postingDate: date,
        voucherType: 'FG_RECEIPT',
        voucherId: moveId,
        voucherNo: mv.number,
        createdById: caller.auth.userId,
        value: ID(share.toFixed(2)),
        stockStatus: qc ? 'QUALITY_INSPECTION' : 'UNRESTRICTED',
        reasonCode: 'FG_RECEIPT',
        ...(item.batch_tracked === true ? { batch: { batchNo: b.batchNo ?? S(cur.number) } } : {}),
        ...(b.serialNos?.length ? { serialNos: b.serialNos } : {}),
      });
      const journal = await StockGl.post(tx, {
        voucherId: moveId,
        voucherNo: mv.number,
        unitId: S(cur.unit_id),
        postingDate: date,
        event: 'MFG_FG_RECEIVED',
        voucherType: 'Goods Receipt',
        counter: 'INVENTORY_WIP',
        ledgerIds: res.entries.map((e) => e.id),
        narration: `Finished goods from ${S(cur.number)}`,
        actorId: caller.auth.userId,
      });
      await insertRow(tx, 'mfg_order_moves', {
        id: moveId,
        unitId: S(cur.unit_id),
        orderId: id,
        kind: 'FG_RECEIPT',
        seq: mv.seq,
        number: mv.number,
        moveDate: date,
        journalId: journal?.id ?? null,
        totalQty: qty.toFixed(3),
        totalValue: share.toFixed(2),
        detail: JSON.stringify([{ qty: qty.toFixed(3), value: share.toFixed(2) }]),
        createdById: caller.auth.userId,
      });
      await costing.ledger(tx, caller, {
        unitId: S(cur.unit_id),
        orderId: id,
        event: 'FG_RECEIPT',
        element: 'FG',
        amount: share.negated().toFixed(2),
        journalId: journal?.id ?? null,
        refType: 'move',
        refId: moveId,
        date,
      });
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:FGR',
        unitId: S(cur.unit_id),
        fyId: S(cur.fy_id),
        prefix: 'FGR',
      });
      const rid = await insertRow(tx, 'mfg_production_receipts', {
        unitId: S(cur.unit_id),
        fyId: S(cur.fy_id),
        number,
        orderId: id,
        itemId: S(cur.item_id),
        receiptDate: date,
        qty: qty.toFixed(3),
        batchNo: b.batchNo ?? null,
        qcStatus: qc ? 'PENDING' : 'NOT_REQUIRED',
        unitCost: share.div(qty).toDecimalPlaces(6).toFixed(6),
        amount: share.toFixed(2),
        costBreakup: JSON.stringify({
          wipBefore: wip.toFixed(2),
          share: share.toFixed(2),
          batchId: res.entries[0]?.batchId ?? null,
          binId: res.entries[0]?.binId ?? null,
        }),
        moveId,
        isFinal: finalReceipt,
        createdById: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE mfg_orders SET qty_received=qty_received+$1::numeric, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        qty.toFixed(3),
        caller.auth.userId,
        id,
      );
      if (qc)
        out.lot = {
          lotId: randomUUID(),
          qty: qty.toFixed(3),
          itemId: S(cur.item_id),
          customerId: cur.customer_id ? S(cur.customer_id) : null,
          receiptId: rid,
          orderNo: S(cur.number),
          unitId: S(cur.unit_id),
        };
      if (qc)
        await exec(
          tx,
          `UPDATE mfg_production_receipts SET cost_breakup = cost_breakup || $1::jsonb WHERE id=$2::uuid`,
          JSON.stringify({ lotId: out.lot!.lotId }),
          rid,
        );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_FG_RECEIVED',
        'mfg_order',
        { id, code: S(cur.number) },
        pageId,
        { number: mv.number, qty: qty.toFixed(3), value: share.toFixed(2) },
      );
    }, TX);
    if (out.lot) await openFinalInspection(caller, id, out.lot);
    return orderService.get(caller, pageId, id);
  },

  /** Reverses a receipt while that stock is still on the shelf (FG_ALREADY_CONSUMED otherwise). The WIP comes back. */
  async cancelReceipt(
    caller: Caller,
    pageId: string,
    receiptId: string,
    reason: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    let orderId = '';
    await prisma.$transaction(async (tx) => {
      const r = (
        await query(
          tx,
          `SELECT * FROM mfg_production_receipts WHERE id=$1::uuid FOR UPDATE`,
          receiptId,
        )
      )[0];
      if (!r) throw Errors.notFound('Receipt not found.');
      orderId = S(r.order_id);
      const cur = await lockOrder(tx, sc, orderId);
      if (S(r.status) !== 'Posted') throw Errors.conflict('This receipt is already cancelled.');
      if (S(r.qc_status) === 'ACCEPTED' || S(r.qc_status) === 'REJECTED')
        throw Errors.conflict(
          'The final inspection already decided this lot. It cannot be reversed.',
        );
      const mv = (
        await query(tx, `SELECT * FROM mfg_order_moves WHERE id=$1::uuid`, S(r.move_id))
      )[0]!;
      const revNo = `${S(mv.number)}-X`;
      try {
        await StockService.reverseVoucher(tx, S(mv.id), {
          voucherNo: revNo,
          postingDate: date,
          createdById: caller.auth.userId,
        });
      } catch (e) {
        if (
          e instanceof AppError &&
          (e.code === 'INSUFFICIENT_STOCK' || e.status === 422 || e.status === 409)
        )
          throw mfgError(
            'FG_ALREADY_CONSUMED',
            "This finished stock has already been used and can't be reversed.",
            undefined,
            409,
          );
        throw e;
      }
      if (mv.journal_id)
        await StockGl.reverse(tx, S(mv.journal_id), { reason, date, actorId: caller.auth.userId });
      const led = (
        await query(
          tx,
          `SELECT id::text, amount::text FROM mfg_cost_ledger WHERE ref_type='move' AND ref_id=$1::uuid AND event='FG_RECEIPT' ORDER BY created_at LIMIT 1`,
          S(mv.id),
        )
      )[0];
      if (led)
        await costing.ledger(tx, caller, {
          unitId: S(cur.unit_id),
          orderId,
          event: 'REVERSAL',
          element: 'FG',
          amount: D(S(led.amount)).negated().toFixed(2),
          journalId: null,
          refType: 'receipt',
          refId: receiptId,
          date,
          reversalOfId: S(led.id),
        });
      await exec(tx, `UPDATE mfg_order_moves SET status='Cancelled' WHERE id=$1::uuid`, S(mv.id));
      await exec(
        tx,
        `UPDATE mfg_production_receipts SET status='Cancelled', cancel_reason=$1, qc_status=CASE WHEN qc_status='PENDING' THEN 'REJECTED' ELSE qc_status END, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
        reason,
        receiptId,
      );
      await exec(
        tx,
        `UPDATE qms_inspections SET status='Cancelled', updated_at=now() WHERE id IN (SELECT inspection_id FROM mfg_lots WHERE receipt_id=$1::uuid) AND status IN ('Draft','Submitted')`,
        receiptId,
      );
      await exec(
        tx,
        `UPDATE mfg_orders SET qty_received=qty_received-$1::numeric, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        S(r.qty),
        caller.auth.userId,
        orderId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_FG_RECEIPT_CANCELLED',
        'mfg_order',
        { id: orderId, code: S(cur.number) },
        pageId,
        { reason },
      );
    }, TX);
    return orderService.get(caller, pageId, orderId);
  },
};

async function refreshMaterialStatus(tx: Db, orderId: string): Promise<void> {
  const r = (
    await query(
      tx,
      `SELECT count(*) FILTER (WHERE NOT customer_supplied AND issue_method='MANUAL')::int AS total,
              count(*) FILTER (WHERE NOT customer_supplied AND issue_method='MANUAL' AND issued_qty - returned_qty >= required_qty)::int AS done,
              count(*) FILTER (WHERE NOT customer_supplied AND issue_method='MANUAL' AND issued_qty - returned_qty > 0)::int AS some
         FROM mfg_order_materials WHERE order_id=$1::uuid`,
      orderId,
    )
  )[0]!;
  const status =
    Number(r.total) > 0 && Number(r.done) === Number(r.total)
      ? 'ISSUED'
      : Number(r.some) > 0
        ? 'PARTIAL'
        : 'NOT_ISSUED';
  await exec(tx, `UPDATE mfg_orders SET material_status=$1 WHERE id=$2::uuid`, status, orderId);
}

/**
 * Back-flush of lines flagged BACKFLUSH: when a job card of the matching operation completes (or at FG receipt for lines without
 * an operation), qty = (good + rejected) x requirement per piece, first-expiry-first-out. A shortage stops the confirmation:
 * stock never goes negative. Dr INVENTORY_WIP / Cr stock.
 */
export async function backflushOrder(
  tx: Db,
  caller: Caller,
  order: Row,
  opSeq: number | null,
  pieces: string,
  date: string,
): Promise<void> {
  const lines = await query(
    tx,
    `SELECT m.*, i.code FROM mfg_order_materials m JOIN items i ON i.id=m.item_id
      WHERE m.order_id=$1::uuid AND m.issue_method='BACKFLUSH' AND NOT m.customer_supplied AND ${opSeq === null ? 'm.operation_seq IS NULL' : 'm.operation_seq = $2'} FOR UPDATE OF m`,
    ...(opSeq === null ? [S(order.id)] : [S(order.id), opSeq]),
  );
  if (!lines.length) return;
  const mv = await nextMoveNo(tx, order, 'BACKFLUSH');
  const moveId = randomUUID();
  const moves: StockMoveInput[] = [];
  const touched: { m: Row; qty: string }[] = [];
  for (const m of lines) {
    const perPiece = D(S(m.required_qty)).div(S(order.qty));
    const qty = r3(perPiece.mul(pieces));
    const left = D(S(m.required_qty)).minus(S(m.consumed_qty));
    const take = qty.gt(left) ? left : qty; // never beyond the requirement
    if (take.lte(0)) continue;
    touched.push({ m, qty: take.toFixed(3) });
    moves.push({
      warehouseId: S(order.rm_warehouse_id),
      itemId: S(m.item_id),
      direction: 'OUT',
      qty: ID(take.toFixed(3)),
      postingDate: date,
      voucherType: 'MFG_ISSUE',
      voucherId: moveId,
      voucherNo: mv.number,
      createdById: caller.auth.userId,
      reasonCode: 'BACKFLUSH',
    });
  }
  if (!moves.length) return;
  let results;
  try {
    results = await StockService.postMany(tx, moves);
  } catch (e) {
    if (e instanceof AppError && (e.code === 'INSUFFICIENT_STOCK' || e.code === 'STOCK_RESERVED'))
      throw mfgError(
        'STOCK_SHORT_BACKFLUSH',
        `Not enough ${S(touched[0]!.m.code)} in ${S(order.rm_warehouse_code ?? 'the store')} (${e.message}). Issue material first.`,
        undefined,
        409,
      );
    throw e;
  }
  let total = ZERO;
  const ledgerIds: string[] = [];
  results.forEach((r, i) => {
    let v = ZERO;
    for (const e of r.entries) {
      ledgerIds.push(e.id);
      v = v.plus(e.value);
    }
    total = total.plus(v);
    void i;
  });
  const journal = await StockGl.post(tx, {
    voucherId: moveId,
    voucherNo: mv.number,
    unitId: S(order.unit_id),
    postingDate: date,
    event: 'MFG_BACKFLUSH',
    voucherType: 'Delivery',
    counter: 'INVENTORY_WIP',
    ledgerIds,
    narration: `Back-flushed to ${S(order.number)}`,
    actorId: caller.auth.userId,
  });
  for (let i = 0; i < touched.length; i++) {
    const v = results[i]!.entries.reduce((a, e) => a.plus(e.value), ZERO);
    await exec(
      tx,
      `UPDATE mfg_order_materials SET issued_qty=issued_qty+$1::numeric, consumed_qty=consumed_qty+$1::numeric, issued_value=issued_value+$2::numeric WHERE id=$3::uuid`,
      touched[i]!.qty,
      round2(v).toFixed(2),
      S(touched[i]!.m.id),
    );
  }
  await insertRow(tx, 'mfg_order_moves', {
    id: moveId,
    unitId: S(order.unit_id),
    orderId: S(order.id),
    kind: 'BACKFLUSH',
    seq: mv.seq,
    number: mv.number,
    moveDate: date,
    journalId: journal?.id ?? null,
    totalQty: touched.reduce((a, t) => a.plus(t.qty), ZERO).toFixed(3),
    totalValue: round2(total).toFixed(2),
    detail: JSON.stringify(touched.map((t) => ({ materialId: S(t.m.id), qty: t.qty }))),
    createdById: caller.auth.userId,
  });
  await costing.ledger(tx, caller, {
    unitId: S(order.unit_id),
    orderId: S(order.id),
    event: 'BACKFLUSH',
    element: 'MATERIAL',
    amount: round2(total).toFixed(2),
    journalId: journal?.id ?? null,
    refType: 'move',
    refId: moveId,
    date,
  });
}

/** Opens the final-inspection sheet (pre-dispatch) for the received lot; its Usage Decision releases or blocks the stock. */
async function openFinalInspection(
  caller: Caller,
  orderId: string,
  lot: {
    lotId: string;
    qty: string;
    itemId: string;
    customerId: string | null;
    receiptId: string;
    orderNo: string;
    unitId: string;
  },
): Promise<void> {
  const sheet = await createInspection(caller, 'qms-final', {
    kind: 'PRE_DISPATCH',
    header: { part: lot.itemId, ...(lot.customerId ? { customer: lot.customerId } : {}) },
    itemId: lot.itemId,
    sourceType: 'MFG_LOT',
    sourceId: lot.lotId,
    lotQty: lot.qty,
  });
  const no = (
    await query(
      prisma,
      `SELECT COALESCE(max(lot_no),0)+1 AS n FROM mfg_lots WHERE order_id=$1::uuid`,
      orderId,
    )
  )[0]!;
  await insertRow(prisma, 'mfg_lots', {
    id: lot.lotId,
    unitId: lot.unitId,
    orderId,
    lotNo: Number(no.n),
    kind: 'FG',
    lotQty: lot.qty,
    receiptId: lot.receiptId,
    inspectionId: S(sheet.id),
    createdById: caller.auth.userId,
  });
  await exec(
    prisma,
    `UPDATE mfg_production_receipts SET lot_id=$1::uuid, qms_inspection_ref=$2 WHERE id=$3::uuid`,
    lot.lotId,
    S(sheet.number),
    lot.receiptId,
  );
  await audit(
    prisma,
    caller,
    caller.auth.userId,
    'MFG_FG_LOT_CREATED',
    'mfg_order',
    { id: orderId, code: lot.orderNo },
    'mfg-fg',
    { sheet: S(sheet.number) },
  );
}

/**
 * The Usage Decision on a final-inspection lot (called by the quality module): accepted pieces leave Quality Inspection for
 * Unrestricted, rejected pieces go to Blocked. The receipt shows the outcome.
 */
export async function onFgLotDecided(
  tx: Db,
  caller: Caller,
  lotId: string,
  accepted: string,
  rejected: string,
): Promise<void> {
  const lot = (
    await query(
      tx,
      `SELECT l.*, o.warehouse_id::text AS wh, o.item_id::text AS item, o.number AS order_no FROM mfg_lots l JOIN mfg_orders o ON o.id=l.order_id WHERE l.id=$1::uuid`,
      lotId,
    )
  )[0];
  if (!lot || S(lot.kind) !== 'FG' || !lot.receipt_id) return;
  const rec = (
    await query(
      tx,
      `SELECT cost_breakup FROM mfg_production_receipts WHERE id=$1::uuid`,
      S(lot.receipt_id),
    )
  )[0]!;
  const cb = (rec.cost_breakup ?? {}) as { batchId?: string | null; binId?: string | null };
  const base = {
    warehouseId: S(lot.wh),
    itemId: S(lot.item),
    batchId: cb.batchId ?? null,
    binId: cb.binId ?? null,
    from: 'QUALITY_INSPECTION' as const,
    postingDate: todayIst(),
    createdById: caller.auth.userId,
  };
  if (D(accepted).gt(0))
    await StockService.changeStatus(tx, {
      ...base,
      qty: ID(accepted),
      to: 'UNRESTRICTED',
      voucherId: randomUUID(),
      voucherNo: `${S(lot.order_no)}-QC-OK`,
    });
  if (D(rejected).gt(0))
    await StockService.changeStatus(tx, {
      ...base,
      qty: ID(rejected),
      to: 'BLOCKED',
      voucherId: randomUUID(),
      voucherNo: `${S(lot.order_no)}-QC-NOK`,
    });
  await exec(
    tx,
    `UPDATE mfg_production_receipts SET qc_status=$1, updated_at=now() WHERE id=$2::uuid`,
    D(accepted).gt(0) ? 'ACCEPTED' : 'REJECTED',
    S(lot.receipt_id),
  );
  await exec(tx, `UPDATE mfg_lots SET received_qty=lot_qty WHERE id=$1::uuid`, lotId);
}

export { openFinalInspection };
