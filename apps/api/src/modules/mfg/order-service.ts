// Phase 13 production orders. Plan -> Release (operations copied from the routing) -> issue material -> log each operation
// (good / scrap / rework) -> inspection checkpoints -> final-inspection lot -> FG receipt after a positive Usage Decision.
// Stock moves only through the Phase 8 StockService and its inline GL (Dr consumption / Cr stock on issue, Dr FG stock / Cr
// consumption on receipt), so stock value = GL always. Costing here is figures only: no extra journal is posted.
import { randomUUID } from 'node:crypto';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import { customerMaterialService } from '../inventory/customer-material-service';
import { D as ID, ZERO, round2 } from '../inventory/money';
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
import {
  D,
  conversionCost,
  fgUnitRate,
  inspectionBlocks,
  logErrors,
  lotReceivable,
  lotRoom,
  materialCost,
  opClosable,
  opRemaining,
  orderMaterials,
} from './logic';
import type { Bom, OpState } from './logic';
import { S, oneUnit } from './master-service';

export const ORDER_STATUSES = [
  'Planned',
  'Released',
  'In Progress',
  'Completed',
  'Closed',
  'Cancelled',
] as const;

export interface OrderInput {
  itemId: string;
  qty: string | number;
  dueDate: string;
  startDate?: string | undefined;
  customerId?: string | undefined;
  customerPoNo?: string | undefined;
  warehouseId: string;
  rmWarehouseId: string;
  sourceType?: 'MANUAL' | 'SALES_ORDER' | 'MRP' | undefined;
  sourceId?: string | undefined;
  notes?: string | undefined;
}

const LIVE = ['Released', 'In Progress'];

async function lockOrder(tx: Db, sc: { sql: string; args: unknown[] }, id: string): Promise<Row> {
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

async function activeBomOf(
  tx: Db,
  unitId: string,
  itemId: string,
): Promise<{ id: string; bom: Bom }> {
  const h = (
    await query(
      tx,
      `SELECT id::text, base_qty::text FROM mfg_boms WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='ACTIVE' AND deleted_at IS NULL`,
      unitId,
      itemId,
    )
  )[0];
  if (!h)
    throw Errors.validation({
      itemId: 'This item has no active bill of materials. Create and activate one first.',
    });
  const lines = await query(
    tx,
    `SELECT item_id::text, qty_per::text, scrap_pct::text FROM mfg_bom_lines WHERE bom_id=$1::uuid ORDER BY line_no`,
    S(h.id),
  );
  return {
    id: S(h.id),
    bom: {
      itemId,
      baseQty: S(h.base_qty),
      lines: lines.map((l) => ({
        itemId: S(l.item_id),
        qtyPer: S(l.qty_per),
        scrapPct: S(l.scrap_pct),
      })),
    },
  };
}

async function writeMaterials(tx: Db, orderId: string, qty: string, bom: Bom): Promise<void> {
  const mats = orderMaterials(qty, bom);
  const items = await query(
    tx,
    `SELECT id::text, is_customer_supplied FROM items WHERE id = ANY($1::uuid[])`,
    mats.map((m) => m.itemId),
  );
  const cs = new Map(items.map((i) => [S(i.id), i.is_customer_supplied === true]));
  let n = 0;
  for (const m of mats) {
    n += 1;
    await insertRow(tx, 'mfg_order_materials', {
      orderId,
      lineNo: n,
      itemId: m.itemId,
      requiredQty: m.requiredQty,
      customerSupplied: cs.get(m.itemId) === true,
    });
  }
}

/** Register entry of the quality module (Phase 12) for pieces lost in production, written inside the caller's transaction. */
async function rejectionEntry(
  tx: Db,
  caller: Caller,
  o: {
    unitId: string;
    fyId: string;
    itemId: string;
    part: string;
    qty: string;
    defect: string;
    operator: string | null;
    disposition: 'SCRAP' | 'REWORK';
    note: string;
    process: string;
  },
): Promise<string> {
  const no = await NumberingService.allocate(tx, {
    pageId: 'qms:REJ',
    unitId: o.unitId,
    fyId: o.fyId,
    prefix: 'REJ',
  });
  return insertRow(tx, 'qms_rejections', {
    unitId: o.unitId,
    fyId: o.fyId,
    number: no,
    rejectDate: todayIst(),
    process: o.process,
    operator: o.operator,
    itemId: o.itemId,
    part: o.part.slice(0, 150),
    holdQty: o.qty,
    defect: o.defect.slice(0, 200),
    defectType: 'PRODUCTION',
    disposition: o.disposition,
    dispositionNote: o.note.slice(0, 300),
    status: o.disposition === 'SCRAP' ? 'Closed' : 'Open',
    createdById: caller.auth.userId,
    updatedById: caller.auth.userId,
  });
}

async function nextMoveNo(
  tx: Db,
  order: Row,
  kind: 'ISSUE' | 'RETURN' | 'FG_RECEIPT',
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
  const tag = kind === 'ISSUE' ? 'I' : kind === 'RETURN' ? 'R' : 'F';
  return { seq, number: `${S(order.number)}-${tag}${seq}` };
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
        WHERE ${w} ORDER BY t.due_date, t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },

  async get(caller: Caller, pageId: string, id: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const h = (
      await query(
        prisma,
        `SELECT t.*, i.code AS item_code, i.name AS item_name, i.base_uom AS uom, i.batch_tracked, i.serial_tracked,
                c.name AS customer_name, w.code AS warehouse_code, rw.code AS rm_warehouse_code
           FROM mfg_orders t JOIN items i ON i.id=t.item_id LEFT JOIN customers c ON c.id=t.customer_id
           JOIN warehouses w ON w.id=t.warehouse_id JOIN warehouses rw ON rw.id=t.rm_warehouse_id
          WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        id,
      )
    )[0];
    if (!h) throw Errors.notFound('Production order not found.');
    const [materials, ops, lots, moves, outsideMoves] = await Promise.all([
      query(
        prisma,
        `SELECT m.id::text, m.line_no, m.item_id::text, m.required_qty, m.issued_qty, m.returned_qty, m.issued_value, m.returned_value,
                m.customer_supplied, i.code AS item_code, i.name AS item_name, i.base_uom AS uom
           FROM mfg_order_materials m JOIN items i ON i.id=m.item_id WHERE m.order_id=$1::uuid ORDER BY m.line_no`,
        id,
      ),
      query(
        prisma,
        `SELECT o.id::text, o.seq, o.name, o.work_centre_id::text, w.code AS work_centre_code, o.setup_minutes, o.run_minutes,
                o.inspection_required, w.kind AS work_centre_kind, o.status, o.qty_done, o.qty_scrap, o.qty_rework, o.actual_minutes, o.cost_per_hour, o.started_at, o.completed_at
           FROM mfg_order_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.order_id=$1::uuid ORDER BY o.seq`,
        id,
      ),
      query(
        prisma,
        `SELECT l.id::text, l.kind, l.lot_no, l.lot_qty, l.received_qty, l.op_id::text, l.inspection_id::text, q.number AS inspection_no,
                q.status AS inspection_status, q.result AS inspection_result, q.accepted_qty, q.rejected_qty
           FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.order_id=$1::uuid AND q.status <> 'Cancelled' ORDER BY l.lot_no`,
        id,
      ),
      query(
        prisma,
        `SELECT id::text, kind, seq, number, move_date, total_qty, total_value, detail FROM mfg_order_moves WHERE order_id=$1::uuid ORDER BY created_at`,
        id,
      ),
      query(
        prisma,
        `SELECT m.id::text, m.op_id::text, m.direction, m.move_date, m.qty, m.qty_scrap, m.doc_no, m.rate, m.cost, m.remark, s.name AS supplier_name
           FROM mfg_outside_moves m JOIN suppliers s ON s.id=m.supplier_id WHERE m.order_id=$1::uuid ORDER BY m.created_at`,
        id,
      ),
    ]);
    const order = norm<Row>(h);
    const opRows = ops.map((r) => norm<Row>(r));
    // pieces that reached each operation
    let prevDone = S(order.qty);
    const withInput = opRows.map((o) => {
      const input = prevDone;
      prevDone = S(o.qtyDone);
      return { ...o, input, remaining: opRemaining(opState(input, o)).toFixed(3) };
    });
    return {
      ...order,
      materials: materials.map((r) => norm<Row>(r)),
      ops: withInput,
      lots: lots.map((r) => norm<Row>(r)),
      moves: moves.map((r) => norm<Row>(r)),
      outsideMoves: outsideMoves.map((r) => norm<Row>(r)),
      cost: costOf(
        materials.map((r) => norm<Row>(r)),
        opRows,
        S(order.qtyCompleted),
        outsideMoves
          .filter((m) => S(m.direction) === 'RECEIVED')
          .reduce((a, m) => a.plus(S(m.cost)), D(0))
          .toFixed(2),
      ),
    };
  },

  // ---------------------------------------------------------------------------------------------- create / change
  async create(caller: Caller, pageId: string, b: OrderInput): Promise<Row> {
    const unitId = oneUnit(caller);
    const fy = await fyOfCaller(caller);
    if (D(String(b.qty)).lte(0))
      throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    const id = await prisma.$transaction(async (tx) => {
      const item = (
        await query(
          tx,
          `SELECT id::text, status::text AS status, is_customer_supplied FROM items WHERE id=$1::uuid AND deleted_at IS NULL`,
          b.itemId,
        )
      )[0];
      if (!item || S(item.status) !== 'ACTIVE')
        throw Errors.validation({ itemId: 'Choose an active item.' });
      if (item.is_customer_supplied === true)
        throw Errors.validation({
          itemId: 'This item is supplied by the customer. It cannot be produced here.',
        });
      await checkWarehouses(tx, unitId, [b.warehouseId, b.rmWarehouseId]);
      if (
        b.customerId &&
        !(await query(tx, `SELECT 1 FROM customers WHERE id=$1::uuid`, b.customerId))[0]
      )
        throw Errors.validation({ customerId: 'Customer not found.' });
      const { id: bomId, bom } = await activeBomOf(tx, unitId, b.itemId);
      const routing = (
        await query(
          tx,
          `SELECT id::text FROM mfg_routings WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='ACTIVE' AND deleted_at IS NULL`,
          unitId,
          b.itemId,
        )
      )[0];
      const number = await NumberingService.allocate(tx, {
        pageId: 'mfg:PRO',
        unitId,
        fyId: fy.id,
        prefix: 'PRO',
      });
      const rid = await insertRow(tx, 'mfg_orders', {
        unitId,
        fyId: fy.id,
        number,
        status: 'Planned',
        itemId: b.itemId,
        bomId,
        routingId: routing ? S(routing.id) : null,
        qty: D(String(b.qty)).toFixed(3),
        startDate: b.startDate ?? null,
        dueDate: b.dueDate,
        sourceType: b.sourceType ?? 'MANUAL',
        sourceId: b.sourceId ?? null,
        customerId: b.customerId ?? null,
        customerPoNo: b.customerPoNo ?? null,
        warehouseId: b.warehouseId,
        rmWarehouseId: b.rmWarehouseId,
        notes: b.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await writeMaterials(tx, rid, D(String(b.qty)).toFixed(3), bom);
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
      if (S(cur.status) !== 'Planned') throw Errors.conflict('Only a planned order can be edited.');
      const unitId = S(cur.unit_id);
      if (b.warehouseId || b.rmWarehouseId)
        await checkWarehouses(tx, unitId, [
          b.warehouseId ?? S(cur.warehouse_id),
          b.rmWarehouseId ?? S(cur.rm_warehouse_id),
        ]);
      if (b.qty !== undefined) {
        if (D(String(b.qty)).lte(0))
          throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
        const { bom } = await activeBomOf(tx, unitId, S(cur.item_id));
        await exec(tx, `DELETE FROM mfg_order_materials WHERE order_id=$1::uuid`, id);
        await writeMaterials(tx, id, D(String(b.qty)).toFixed(3), bom);
      }
      await exec(
        tx,
        `UPDATE mfg_orders SET qty=COALESCE($1::numeric,qty), due_date=COALESCE($2::date,due_date), start_date=COALESCE($3::date,start_date),
           customer_id=COALESCE($4::uuid,customer_id), customer_po_no=COALESCE($5,customer_po_no), warehouse_id=COALESCE($6::uuid,warehouse_id),
           rm_warehouse_id=COALESCE($7::uuid,rm_warehouse_id), notes=COALESCE($8,notes), updated_by_id=$9::uuid, updated_at=now(), version=version+1
         WHERE id=$10::uuid`,
        b.qty === undefined ? null : D(String(b.qty)).toFixed(3),
        b.dueDate ?? null,
        b.startDate ?? null,
        b.customerId ?? null,
        b.customerPoNo ?? null,
        b.warehouseId ?? null,
        b.rmWarehouseId ?? null,
        b.notes ?? null,
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

  /** Planned -> Released: the operations are copied from the item's Active routing, with the work centre's hourly rate. */
  async release(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      checkVersion(norm<Row>(cur), version);
      if (S(cur.status) !== 'Planned')
        throw Errors.conflict('Only a planned order can be released.');
      const rt = (
        await query(
          tx,
          `SELECT id::text FROM mfg_routings WHERE unit_id=$1::uuid AND item_id=$2::uuid AND status='ACTIVE' AND deleted_at IS NULL`,
          S(cur.unit_id),
          S(cur.item_id),
        )
      )[0];
      if (!rt)
        throw Errors.validation({
          routing: 'This item has no active routing. Create and activate one first.',
        });
      const ops = await query(
        tx,
        `SELECT o.*, w.status AS wc_status, w.cost_per_hour FROM mfg_routing_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id
          WHERE o.routing_id=$1::uuid ORDER BY o.seq`,
        S(rt.id),
      );
      if (!ops.length) throw Errors.validation({ routing: 'The routing has no operation.' });
      for (const o of ops)
        if (S(o.wc_status) !== 'ACTIVE')
          throw Errors.validation({
            routing: `Operation ${S(o.seq)} uses a work centre that is no longer active.`,
          });
      for (const o of ops)
        await insertRow(tx, 'mfg_order_ops', {
          orderId: id,
          seq: Number(o.seq),
          name: S(o.name),
          workCentreId: S(o.work_centre_id),
          setupMinutes: S(o.setup_minutes),
          runMinutes: S(o.run_minutes),
          inspectionRequired: o.inspection_required === true,
          costPerHour: S(o.cost_per_hour),
        });
      await exec(
        tx,
        `UPDATE mfg_orders SET status='Released', routing_id=$1::uuid, released_at=now(), updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
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
        {},
      );
    }, TX);
    return orderService.get(caller, pageId, id);
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
      if (!['Planned', 'Released'].includes(S(cur.status)))
        throw Errors.conflict('Only a planned or released order can be cancelled.');
      const net = (
        await query(
          tx,
          `SELECT COALESCE(sum(issued_qty - returned_qty),0)::text AS n FROM mfg_order_materials WHERE order_id=$1::uuid`,
          id,
        )
      )[0]!;
      if (D(S(net.n)).gt(0))
        throw Errors.conflict(
          'Material is still issued to this order. Return it to the store first.',
        );
      const logs = await query(tx, `SELECT 1 FROM mfg_op_logs WHERE order_id=$1::uuid LIMIT 1`, id);
      if (logs.length)
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

  /** Completed -> Closed. Everything that was made must be in stock, no rework may be open. */
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
      if (S(cur.status) !== 'Completed')
        throw Errors.conflict(
          'Only a completed order can be closed. Finish every operation first.',
        );
      // every finished piece is either in stock or was rejected by a final inspection (it sits in the rejection register)
      const rej = (
        await query(
          tx,
          `SELECT COALESCE(sum(q.rejected_qty),0)::text AS n FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id
            WHERE l.order_id=$1::uuid AND l.kind='FG' AND q.status='Decided'`,
          id,
        )
      )[0]!;
      const open = D(S(cur.qty_completed)).minus(S(cur.qty_received)).minus(S(rej.n));
      if (open.gt(0))
        throw Errors.conflict(
          `${open.toFixed(3)} finished pieces are not in stock yet. Inspect and receive them first.`,
        );
      const rw = await query(
        tx,
        `SELECT 1 FROM mfg_rework WHERE order_id=$1::uuid AND status='Open' LIMIT 1`,
        id,
      );
      if (rw.length) throw Errors.conflict('A rework entry is still open on this order.');
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
        {},
      );
    }, TX);
    return orderService.get(caller, pageId, id);
  },

  // ---------------------------------------------------------------------------------------------- material
  /** Issue components to the order from its raw-material warehouse. Customer-supplied lines name a customer-material lot. */
  async issue(
    caller: Caller,
    pageId: string,
    id: string,
    lines: {
      materialId: string;
      qty: string | number;
      batchNo?: string | undefined;
      serialNos?: string[] | undefined;
      customerLotId?: string | undefined;
    }[],
  ): Promise<Row> {
    if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    assertDistinct(lines);
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    const customerLines: { materialId: string; lotId: string; qty: string }[] = [];
    const hold: { ord?: Row } = {};
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, id);
      hold.ord = cur;
      if (!LIVE.includes(S(cur.status)))
        throw Errors.conflict('Material can be issued to a released order only.');
      const mats = await query(
        tx,
        `SELECT m.*, i.code FROM mfg_order_materials m JOIN items i ON i.id=m.item_id WHERE m.order_id=$1::uuid FOR UPDATE OF m`,
        id,
      );
      const byId = new Map(mats.map((m) => [S(m.id), m]));
      const errs: Record<string, string> = {};
      const moves: StockMoveInput[] = [];
      const mv = await nextMoveNo(tx, cur, 'ISSUE');
      const moveId = randomUUID();
      const touched: { m: Row; qty: string }[] = [];
      lines.forEach((l, i) => {
        const m = byId.get(l.materialId);
        const qty = D(String(l.qty));
        if (!m)
          return void (errs[`lines.${i}.materialId`] = 'This is not a material of the order.');
        if (qty.lte(0)) return void (errs[`lines.${i}.qty`] = 'Enter a quantity greater than 0.');
        const room = D(S(m.required_qty)).minus(D(S(m.issued_qty)).minus(S(m.returned_qty)));
        if (qty.gt(room))
          return void (errs[`lines.${i}.qty`] =
            `${S(m.code)}: only ${room.gt(0) ? room.toFixed(3) : '0'} more is needed for this order. Raise the order quantity if more is required.`);
        if (m.customer_supplied === true) {
          if (!cur.customer_id)
            return void (errs[`lines.${i}.materialId`] =
              "Choose the customer on the order first: customer material is issued from the customer's lots.");
          if (!l.customerLotId)
            return void (errs[`lines.${i}.customerLotId`] =
              'Choose the customer-material lot to take this from.');
          customerLines.push({
            materialId: l.materialId,
            lotId: l.customerLotId,
            qty: qty.toFixed(3),
          });
          return;
        }
        touched.push({ m, qty: qty.toFixed(3) });
        moves.push({
          warehouseId: S(cur.rm_warehouse_id),
          itemId: S(m.item_id),
          direction: 'OUT',
          qty: ID(qty.toFixed(3)),
          postingDate: date,
          voucherType: 'ISSUE',
          voucherId: moveId,
          voucherNo: mv.number,
          createdById: caller.auth.userId,
          reasonCode: 'MFG_ISSUE',
          ...(l.batchNo ? { batch: { batchNo: l.batchNo } } : {}),
          ...(l.serialNos?.length ? { serialNos: l.serialNos } : {}),
        });
      });
      if (Object.keys(errs).length) throw Errors.validation(errs);
      if (moves.length === 0) {
        // only customer material: nothing to post here
        return;
      }
      const results = await StockService.postMany(tx, moves);
      const ledgerIds: string[] = [];
      let total = ZERO;
      const detail: unknown[] = [];
      results.forEach((r, i) => {
        const t = touched[i]!;
        let v = ZERO;
        for (const e of r.entries) {
          ledgerIds.push(e.id);
          v = v.plus(e.value);
        }
        total = total.plus(v);
        detail.push({
          materialId: S(t.m.id),
          itemId: S(t.m.item_id),
          qty: t.qty,
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
        counter: 'CONSUMPTION_EXPENSE',
        ledgerIds,
        narration: `Material issued to ${S(cur.number)}`,
        actorId: caller.auth.userId,
      });
      for (let i = 0; i < touched.length; i++) {
        const t = touched[i]!;
        const d = detail[i] as { value: string };
        await exec(
          tx,
          `UPDATE mfg_order_materials SET issued_qty=issued_qty+$1::numeric, issued_value=issued_value+$2::numeric WHERE id=$3::uuid`,
          t.qty,
          d.value,
          S(t.m.id),
        );
      }
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
    // customer-supplied lines leave the non-valued customer-material ledger (Phase 8), one document for the order
    if (customerLines.length && hold.ord) {
      const o = hold.ord;
      await customerMaterialService.take(
        caller,
        'ISSUE',
        {
          customerId: S(o.customer_id),
          warehouseId: S(o.rm_warehouse_id),
          docDate: date,
          reference: `Production order ${S(o.number)}`,
        },
        customerLines.map((c) => ({ lotId: c.lotId, qty: c.qty })),
      );
      for (const c of customerLines)
        await exec(
          prisma,
          `UPDATE mfg_order_materials SET issued_qty=issued_qty+$1::numeric WHERE id=$2::uuid`,
          c.qty,
          c.materialId,
        );
      await audit(
        prisma,
        caller,
        caller.auth.userId,
        'MFG_CUSTOMER_MATERIAL_ISSUED',
        'mfg_order',
        { id, code: S(o.number) },
        pageId,
        {},
      );
    }
    return orderService.get(caller, pageId, id);
  },

  /** Unused components go back to the raw-material warehouse at the rate they were issued at. */
  async returnMaterial(
    caller: Caller,
    pageId: string,
    id: string,
    lines: { materialId: string; qty: string | number; batchNo?: string | undefined }[],
  ): Promise<Row> {
    if (lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    assertDistinct(lines);
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
            'Customer material is returned on the Customer Material screen, against your challan.');
        if (qty.lte(0)) return void (errs[`lines.${i}.qty`] = 'Enter a quantity greater than 0.');
        const out = D(S(m.issued_qty)).minus(S(m.returned_qty));
        if (qty.gt(out))
          return void (errs[`lines.${i}.qty`] =
            `${S(m.code)}: only ${out.toFixed(3)} is with the order.`);
        // value of the returned part at the average issue rate; the last piece takes the rounding rest
        const outValue = D(S(m.issued_value)).minus(S(m.returned_value));
        const value = qty.eq(out) ? outValue : round2(outValue.mul(qty).div(out));
        touched.push({ m, qty: qty.toFixed(3), value: value.toFixed(2) });
        moves.push({
          warehouseId: S(cur.rm_warehouse_id),
          itemId: S(m.item_id),
          direction: 'IN',
          qty: ID(qty.toFixed(3)),
          postingDate: date,
          voucherType: 'RECEIPT',
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
      const ledgerIds = results.flatMap((r) => r.entries.map((e) => e.id));
      const total = touched.reduce((a, t) => a.plus(t.value), ZERO);
      const journal = await StockGl.post(tx, {
        voucherId: moveId,
        voucherNo: mv.number,
        unitId: S(cur.unit_id),
        postingDate: date,
        event: 'MFG_MATERIAL_RETURNED',
        voucherType: 'Goods Receipt',
        counter: 'CONSUMPTION_EXPENSE',
        ledgerIds,
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

  // ---------------------------------------------------------------------------------------------- operations
  /**
   * The operator's log line: good, scrap and rework pieces and the minutes taken. Scrap and rework need a reason and enter the
   * Phase 12 rejection register. `fromGood` moves pieces that were logged good (and failed the inspection) to scrap or rework.
   */
  async logOperation(
    caller: Caller,
    pageId: string,
    orderId: string,
    opId: string,
    b: {
      good?: string | number | undefined;
      scrap?: string | number | undefined;
      rework?: string | number | undefined;
      minutes?: string | number | undefined;
      operator?: string | undefined;
      reason?: string | undefined;
      note?: string | undefined;
      fromGood?: boolean | undefined;
      /** set by the outside-processing receipt only: the pieces of an outside operation come back through it */
      viaOutside?: boolean | undefined;
      logDate?: string | undefined;
      /** run inside this transaction (outside-processing receipt) instead of opening one */
      tx?: Db | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const good = D(String(b.good ?? 0));
    const scrap = D(String(b.scrap ?? 0));
    const rework = D(String(b.rework ?? 0));
    const minutes = D(String(b.minutes ?? 0));
    if ([good, scrap, rework, minutes].some((x) => x.lt(0)))
      throw Errors.validation({ qtyGood: 'Quantities and minutes cannot be negative.' });
    if (good.plus(scrap).plus(rework).plus(minutes).lte(0))
      throw Errors.validation({ qtyGood: 'Enter the pieces made or the minutes taken.' });
    if ((scrap.gt(0) || rework.gt(0)) && (b.reason ?? '').trim().length < 3)
      throw Errors.validation({ reason: 'Write why the pieces were scrapped or sent for rework.' });
    if (b.fromGood && good.gt(0))
      throw Errors.validation({
        qtyGood: 'Moving pieces from good to scrap or rework cannot add good pieces.',
      });
    const body = async (tx: Db): Promise<void> => {
      const cur = await lockOrder(tx, sc, orderId);
      if (!LIVE.includes(S(cur.status)))
        throw Errors.conflict('Production can be logged on a released order only.');
      const ops = await query(
        tx,
        `SELECT * FROM mfg_order_ops WHERE order_id=$1::uuid ORDER BY seq FOR UPDATE`,
        orderId,
      );
      const idx = ops.findIndex((o) => S(o.id) === opId);
      if (idx < 0) throw Errors.notFound('Operation not found.');
      const op = ops[idx]!;
      if (S(op.status) === 'Done') throw Errors.conflict('This operation is already complete.');
      const wcKind = (
        await query(tx, `SELECT kind FROM mfg_work_centres WHERE id=$1::uuid`, S(op.work_centre_id))
      )[0];
      if (S(wcKind?.kind) === 'OUTSIDE' && !b.viaOutside)
        throw Errors.conflict(
          'This operation is done by an outside party. Record the pieces sent and received instead.',
        );
      const prev = idx > 0 ? ops[idx - 1]! : null;
      if (prev && S(prev.status) !== 'Done')
        throw Errors.conflict(
          `Operation ${S(prev.seq)} (${S(prev.name)}) must be complete before this one starts.`,
        );
      if (S(op.status) === 'Pending') {
        const valued = await query(
          tx,
          `SELECT issued_qty FROM mfg_order_materials WHERE order_id=$1::uuid AND customer_supplied=false`,
          orderId,
        );
        if (valued.length && valued.every((m) => D(S(m.issued_qty)).lte(0)))
          throw Errors.conflict('Issue material to the order before production starts.');
      }
      const input = prev ? S(prev.qty_done) : S(cur.qty);
      const state = opState(input, norm<Row>(op));
      if (b.fromGood) {
        const moved = scrap.plus(rework);
        const isLast = idx === ops.length - 1;
        if (
          isLast &&
          D(state.qtyDone)
            .minus(moved)
            .lt(D(S(cur.qty_received)))
        )
          throw Errors.validation({
            qtyGood: `${D(S(cur.qty_received)).toFixed(3)} pieces are already in stock, so they cannot be moved to scrap.`,
          });
        if (moved.gt(D(state.qtyDone)))
          throw Errors.validation({
            qtyGood: `Only ${D(state.qtyDone).toFixed(3)} good pieces are logged at this operation.`,
          });
      } else {
        const errs = logErrors(state, {
          good: good.toFixed(3),
          scrap: scrap.toFixed(3),
          rework: rework.toFixed(3),
        });
        if (Object.keys(errs).length) throw Errors.validation(errs);
      }
      const gd = b.fromGood ? D(0).minus(scrap).minus(rework) : good;
      await exec(
        tx,
        `UPDATE mfg_order_ops SET qty_done=qty_done+$1::numeric, qty_scrap=qty_scrap+$2::numeric, qty_rework=qty_rework+$3::numeric,
           actual_minutes=actual_minutes+$4::numeric, status='In Progress', started_at=COALESCE(started_at, now()) WHERE id=$5::uuid`,
        gd.toFixed(3),
        scrap.toFixed(3),
        rework.toFixed(3),
        minutes.toFixed(2),
        opId,
      );
      await insertRow(tx, 'mfg_op_logs', {
        unitId: S(cur.unit_id),
        orderId,
        opId,
        logDate: b.logDate ?? todayIst(),
        operator: b.operator ?? null,
        qtyGood: b.fromGood ? '0' : good.toFixed(3),
        qtyScrap: scrap.toFixed(3),
        qtyRework: rework.toFixed(3),
        minutes: minutes.toFixed(2),
        note:
          (b.fromGood ? `Moved from good: ${b.reason ?? ''}` : (b.note ?? b.reason ?? null))?.slice(
            0,
            200,
          ) ?? null,
        createdById: caller.auth.userId,
      });
      const item = (
        await query(tx, `SELECT name FROM items WHERE id=$1::uuid`, S(cur.item_id))
      )[0]!;
      const fy = S(cur.fy_id);
      if (scrap.gt(0)) {
        // a rejection that the inspection already registered is not entered twice
        const rid = b.fromGood
          ? null
          : await rejectionEntry(tx, caller, {
              unitId: S(cur.unit_id),
              fyId: fy,
              itemId: S(cur.item_id),
              part: S(item.name),
              qty: scrap.toFixed(3),
              defect: b.reason!,
              operator: b.operator ?? null,
              disposition: 'SCRAP',
              note: `Scrapped at ${S(op.name)} on ${S(cur.number)}`,
              process: S(op.name),
            });
        const no = await NumberingService.allocate(tx, {
          pageId: 'mfg:SCR',
          unitId: S(cur.unit_id),
          fyId: fy,
          prefix: 'SCR',
        });
        await insertRow(tx, 'mfg_scrap', {
          unitId: S(cur.unit_id),
          fyId: fy,
          number: no,
          scrapDate: b.logDate ?? todayIst(),
          orderId,
          opId,
          itemId: S(cur.item_id),
          qty: scrap.toFixed(3),
          reason: b.reason!.slice(0, 200),
          source: 'OPERATION',
          rejectionId: rid,
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        });
        await exec(
          tx,
          `UPDATE mfg_orders SET qty_scrapped=qty_scrapped+$1::numeric WHERE id=$2::uuid`,
          scrap.toFixed(3),
          orderId,
        );
      }
      if (rework.gt(0)) {
        const rid = b.fromGood
          ? null
          : await rejectionEntry(tx, caller, {
              unitId: S(cur.unit_id),
              fyId: fy,
              itemId: S(cur.item_id),
              part: S(item.name),
              qty: rework.toFixed(3),
              defect: b.reason!,
              operator: b.operator ?? null,
              disposition: 'REWORK',
              note: `Rework at ${S(op.name)} on ${S(cur.number)}`,
              process: S(op.name),
            });
        const no = await NumberingService.allocate(tx, {
          pageId: 'mfg:RWK',
          unitId: S(cur.unit_id),
          fyId: fy,
          prefix: 'RWK',
        });
        await insertRow(tx, 'mfg_rework', {
          unitId: S(cur.unit_id),
          fyId: fy,
          number: no,
          reworkDate: b.logDate ?? todayIst(),
          orderId,
          opId,
          itemId: S(cur.item_id),
          qty: rework.toFixed(3),
          reason: b.reason!.slice(0, 200),
          rejectionId: rid,
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        });
      }
      await syncCompleted(tx, orderId);
      await exec(
        tx,
        `UPDATE mfg_orders SET status='In Progress', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid AND status='Released'`,
        caller.auth.userId,
        orderId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_OPERATION_LOGGED',
        'mfg_order',
        { id: orderId, code: S(cur.number) },
        pageId,
        {
          op: S(op.name),
          good: good.toFixed(3),
          scrap: scrap.toFixed(3),
          rework: rework.toFixed(3),
        },
      );
    };
    if (b.tx) {
      await body(b.tx);
      return {};
    }
    await prisma.$transaction(body, TX);
    return orderService.get(caller, pageId, orderId);
  },

  /**
   * Outside processing (subcontract) of an operation at an OUTSIDE work centre: pieces are sent out on a challan and come back
   * good or scrapped. The cost is pieces processed x the rate agreed with the supplier and goes into the order's costing. No
   * stock or ledger posting is made (the spec names none): this is the paperwork and cost record.
   */
  async outsideMove(
    caller: Caller,
    pageId: string,
    orderId: string,
    opId: string,
    b: {
      direction: 'SENT' | 'RECEIVED';
      qty: string | number;
      qtyScrap?: string | number | undefined;
      docNo: string;
      supplierId: string;
      rate?: string | number | undefined;
      moveDate?: string | undefined;
      reason?: string | undefined;
      remark?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const qty = D(String(b.qty));
    const scrap = D(String(b.qtyScrap ?? 0));
    const rateIn = D(String(b.rate ?? 0));
    if (qty.lt(0) || scrap.lt(0) || rateIn.lt(0) || qty.plus(scrap).lte(0))
      throw Errors.validation({ qty: 'Enter the pieces (a quantity greater than 0).' });
    if (b.direction === 'SENT' && scrap.gt(0))
      throw Errors.validation({ qtyScrap: 'Scrap is recorded when the pieces come back.' });
    const date = b.moveDate ?? todayIst();
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, orderId);
      const unitId = S(cur.unit_id);
      if (!LIVE.includes(S(cur.status))) throw Errors.conflict('This order is not running.');
      if (!(await query(tx, `SELECT 1 FROM suppliers WHERE id=$1::uuid`, b.supplierId))[0])
        throw Errors.validation({ supplierId: 'Supplier not found.' });
      const ops = await query(
        tx,
        `SELECT o.*, w.kind AS wc_kind FROM mfg_order_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.order_id=$1::uuid ORDER BY o.seq FOR UPDATE OF o`,
        orderId,
      );
      const idx = ops.findIndex((o) => S(o.id) === opId);
      if (idx < 0) throw Errors.notFound('Operation not found.');
      const op = ops[idx]!;
      if (S(op.wc_kind) !== 'OUTSIDE')
        throw Errors.validation({ operation: 'This operation is not done by an outside party.' });
      if (S(op.status) === 'Done') throw Errors.conflict('This operation is already complete.');
      const prev = idx > 0 ? ops[idx - 1]! : null;
      if (prev && S(prev.status) !== 'Done')
        throw Errors.conflict(
          `Operation ${S(prev.seq)} (${S(prev.name)}) must be complete before this one starts.`,
        );
      const input = prev ? S(prev.qty_done) : S(cur.qty);
      const sums = (
        await query(
          tx,
          `SELECT COALESCE(sum(qty) FILTER (WHERE direction='SENT'),0)::text AS sent,
                  COALESCE(sum(qty + qty_scrap) FILTER (WHERE direction='RECEIVED'),0)::text AS back
             FROM mfg_outside_moves WHERE op_id=$1::uuid`,
          opId,
        )
      )[0]!;
      if (b.direction === 'SENT') {
        const room = D(input).minus(S(sums.sent));
        if (qty.gt(room))
          throw Errors.validation({
            qty: `Only ${room.gt(0) ? room.toFixed(3) : '0'} pieces are left to send for this operation.`,
          });
      } else {
        const out = D(S(sums.sent)).minus(S(sums.back));
        if (qty.plus(scrap).gt(out))
          throw Errors.validation({
            qty: `Only ${out.gt(0) ? out.toFixed(3) : '0'} pieces are with the supplier.`,
          });
        if (scrap.gt(0) && (b.reason ?? '').trim().length < 3)
          throw Errors.validation({ reason: 'Write why the pieces were scrapped.' });
      }
      // the rate: the one entered now, else the one given when the pieces were sent
      let rate = rateIn;
      if (b.direction === 'RECEIVED') {
        if (b.rate === undefined) {
          const sentRate = (
            await query(
              tx,
              `SELECT rate::text AS r FROM mfg_outside_moves WHERE op_id=$1::uuid AND direction='SENT' AND rate > 0 ORDER BY created_at DESC LIMIT 1`,
              opId,
            )
          )[0];
          rate = D(S(sentRate?.r ?? 0));
        }
        if (rate.lte(0))
          throw Errors.validation({ rate: 'Enter the rate per piece agreed with the supplier.' });
        // the pieces enter the operation's good / scrap counts through the normal log, in this same transaction
        await orderService.logOperation(caller, pageId, orderId, opId, {
          good: qty.toFixed(3),
          scrap: scrap.toFixed(3),
          ...(scrap.gt(0) ? { reason: b.reason! } : {}),
          logDate: date,
          viaOutside: true,
          tx,
        });
      }
      await insertRow(tx, 'mfg_outside_moves', {
        unitId,
        orderId,
        opId,
        direction: b.direction,
        moveDate: date,
        qty: qty.toFixed(3),
        qtyScrap: scrap.toFixed(3),
        docNo: b.docNo.trim(),
        supplierId: b.supplierId,
        rate: rate.toFixed(4),
        cost: b.direction === 'RECEIVED' ? round2(qty.plus(scrap).mul(rate)).toFixed(2) : '0',
        remark: b.remark ?? null,
        createdById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_OUTSIDE_' + b.direction,
        'mfg_order',
        { id: orderId, code: b.docNo },
        pageId,
        { qty: qty.toFixed(3) },
      );
    }, TX);
    return orderService.get(caller, pageId, orderId);
  },

  /** Closes an operation. Needs every piece accounted for and, where the routing asks, an accepted inspection. */
  async completeOperation(
    caller: Caller,
    pageId: string,
    orderId: string,
    opId: string,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, orderId);
      if (!LIVE.includes(S(cur.status))) throw Errors.conflict('This order is not running.');
      const ops = await query(
        tx,
        `SELECT * FROM mfg_order_ops WHERE order_id=$1::uuid ORDER BY seq FOR UPDATE`,
        orderId,
      );
      const idx = ops.findIndex((o) => S(o.id) === opId);
      if (idx < 0) throw Errors.notFound('Operation not found.');
      const op = ops[idx]!;
      if (S(op.status) === 'Done') throw Errors.conflict('This operation is already complete.');
      if (S(op.status) !== 'In Progress')
        throw Errors.conflict('Nothing has been logged on this operation yet.');
      const input = idx > 0 ? S(ops[idx - 1]!.qty_done) : S(cur.qty);
      const why = opClosable(opState(input, norm<Row>(op)));
      if (why) throw Errors.validation({ operation: why });
      const sheets = await query(
        tx,
        `SELECT q.status, q.accepted_qty::text AS accepted_qty FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id
          WHERE l.op_id=$1::uuid AND q.status <> 'Cancelled'`,
        opId,
      );
      const block = inspectionBlocks(
        op.inspection_required === true,
        sheets.map((s) => ({
          status: S(s.status),
          acceptedQty: s.accepted_qty === null ? null : S(s.accepted_qty),
        })),
        S(op.qty_done),
      );
      if (block) throw new AppError(422, 'MFG_INSPECTION_PENDING', block, { operation: block });
      await exec(
        tx,
        `UPDATE mfg_order_ops SET status='Done', completed_at=now() WHERE id=$1::uuid`,
        opId,
      );
      const last = idx === ops.length - 1;
      if (last) {
        await syncCompleted(tx, orderId);
        await exec(
          tx,
          `UPDATE mfg_orders SET status='Completed', updated_by_id=$1::uuid, updated_at=now(), version=version+1 WHERE id=$2::uuid`,
          caller.auth.userId,
          orderId,
        );
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_OPERATION_COMPLETED',
        'mfg_order',
        { id: orderId, code: S(cur.number) },
        pageId,
        { op: S(op.name) },
      );
    }, TX);
    return orderService.get(caller, pageId, orderId);
  },

  /** Rework outcome: all the pieces are either good again or scrap. */
  async finishRework(
    caller: Caller,
    pageId: string,
    reworkId: string,
    b: {
      qtyOk: string | number;
      qtyScrap: string | number;
      minutes?: string | number | undefined;
      note?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const minutes = D(String(b.minutes ?? 0));
    if (minutes.lt(0)) throw Errors.validation({ minutes: 'Minutes cannot be negative.' });
    const ok = D(String(b.qtyOk));
    const sc2 = D(String(b.qtyScrap));
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
      if (!rw) throw Errors.notFound('Rework entry not found.');
      if (S(rw.status) !== 'Open') throw Errors.conflict('This rework is already finished.');
      if (ok.lt(0) || sc2.lt(0) || !ok.plus(sc2).eq(D(S(rw.qty))))
        throw Errors.validation({
          qtyOk: `Good pieces plus scrap must equal the ${D(S(rw.qty)).toFixed(3)} pieces sent for rework.`,
        });
      if (sc2.gt(0) && (b.note ?? '').trim().length < 3)
        throw Errors.validation({ note: 'Write why the pieces could not be reworked.' });
      orderId = S(rw.order_id);
      // the rework minutes are charged at the rate the order copied from the work centre
      const rate = (
        await query(
          tx,
          `SELECT cost_per_hour::text AS r FROM mfg_order_ops WHERE id=$1::uuid`,
          S(rw.op_id),
        )
      )[0]!;
      const cost = conversionCost(minutes, S(rate.r));
      if (minutes.gt(0))
        await insertRow(tx, 'mfg_op_logs', {
          unitId: S(rw.unit_id),
          orderId,
          opId: S(rw.op_id),
          logDate: todayIst(),
          minutes: minutes.toFixed(2),
          note: `Rework ${S(rw.number)}`,
          createdById: caller.auth.userId,
        });
      await exec(
        tx,
        `UPDATE mfg_order_ops SET qty_rework=qty_rework-$1::numeric, qty_done=qty_done+$2::numeric, qty_scrap=qty_scrap+$3::numeric,
           actual_minutes=actual_minutes+$5::numeric WHERE id=$4::uuid`,
        D(S(rw.qty)).toFixed(3),
        ok.toFixed(3),
        sc2.toFixed(3),
        S(rw.op_id),
        minutes.toFixed(2),
      );
      await exec(
        tx,
        `UPDATE mfg_rework SET status='Done', qty_ok=$1::numeric, qty_scrap=$2::numeric, minutes=$5::numeric, cost=$6::numeric, done_at=now(),
           updated_by_id=$3::uuid, updated_at=now(), version=version+1 WHERE id=$4::uuid`,
        ok.toFixed(3),
        sc2.toFixed(3),
        caller.auth.userId,
        reworkId,
        minutes.toFixed(2),
        cost.toFixed(2),
      );
      if (rw.rejection_id)
        await exec(
          tx,
          `UPDATE qms_rejections SET status='Closed', updated_at=now(), version=version+1 WHERE id=$1::uuid`,
          S(rw.rejection_id),
        );
      if (sc2.gt(0)) {
        const no = await NumberingService.allocate(tx, {
          pageId: 'mfg:SCR',
          unitId: S(rw.unit_id),
          fyId: S(rw.fy_id),
          prefix: 'SCR',
        });
        await insertRow(tx, 'mfg_scrap', {
          unitId: S(rw.unit_id),
          fyId: S(rw.fy_id),
          number: no,
          orderId,
          opId: S(rw.op_id),
          itemId: S(rw.item_id),
          qty: sc2.toFixed(3),
          reason: (b.note ?? 'Not reworkable').slice(0, 200),
          source: 'REWORK',
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        });
        await exec(
          tx,
          `UPDATE mfg_orders SET qty_scrapped=qty_scrapped+$1::numeric WHERE id=$2::uuid`,
          sc2.toFixed(3),
          orderId,
        );
      }
      await syncCompleted(tx, orderId);
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

  // ---------------------------------------------------------------------------------------------- inspection lots
  /** In-process checkpoint: creates the Phase 12 in-process sheet for the pieces logged good at an operation. */
  async createOpLot(
    caller: Caller,
    pageId: string,
    orderId: string,
    opId: string,
    lotQty: string | number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const lotId = randomUUID();
    const ctx = await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, orderId);
      if (!LIVE.includes(S(cur.status))) throw Errors.conflict('This order is not running.');
      const op = (
        await query(
          tx,
          `SELECT o.*, w.name AS wc_name FROM mfg_order_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.id=$1::uuid AND o.order_id=$2::uuid FOR UPDATE OF o`,
          opId,
          orderId,
        )
      )[0];
      if (!op) throw Errors.notFound('Operation not found.');
      if (op.inspection_required !== true)
        throw Errors.validation({ operation: 'This operation does not need an inspection.' });
      const lotted = (
        await query(
          tx,
          `SELECT COALESCE(sum(l.lot_qty),0)::text AS n FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.op_id=$1::uuid AND q.status <> 'Cancelled'`,
          opId,
        )
      )[0]!;
      const room = lotRoom(S(op.qty_done), S(lotted.n));
      const qty = lotQty === undefined ? room : D(String(lotQty));
      if (qty.lte(0) || qty.gt(room))
        throw Errors.validation({
          lotQty: room.gt(0)
            ? `Enter a quantity up to ${room.toFixed(3)} (good pieces not yet inspected).`
            : 'No good pieces are waiting for inspection.',
        });
      const lotNo = (
        await query(
          tx,
          `SELECT COALESCE(max(lot_no),0)+1 AS n FROM mfg_lots WHERE order_id=$1::uuid`,
          orderId,
        )
      )[0]!;
      const item = (
        await query(tx, `SELECT name FROM items WHERE id=$1::uuid`, S(cur.item_id))
      )[0]!;
      return {
        unitId: S(cur.unit_id),
        itemId: S(cur.item_id),
        itemName: S(item.name),
        opName: S(op.name),
        wcName: S(op.wc_name),
        qty: qty.toFixed(3),
        lotNo: Number(lotNo.n),
        orderNo: S(cur.number),
      };
    }, TX);
    const sheet = await createInspection(caller, 'qms-process', {
      kind: 'IN_PROCESS',
      header: {
        part: ctx.itemId,
        machine: ctx.wcName,
        operation: `${ctx.opName} (${ctx.orderNo})`,
      },
      itemId: ctx.itemId,
      sourceType: 'MFG_LOT',
      sourceId: lotId,
      lotQty: ctx.qty,
    });
    await insertLotOrCancel(S(sheet.id), {
      id: lotId,
      unitId: ctx.unitId,
      orderId,
      lotNo: ctx.lotNo,
      kind: 'OP',
      opId,
      lotQty: ctx.qty,
      inspectionId: S(sheet.id),
      createdById: caller.auth.userId,
    });
    await exec(
      prisma,
      `UPDATE mfg_order_ops SET inspection_id=$1::uuid WHERE id=$2::uuid`,
      S(sheet.id),
      opId,
    );
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_OP_INSPECTION_CREATED',
      'mfg_order',
      { id: orderId, code: ctx.orderNo },
      pageId,
      { sheet: S(sheet.number) },
    );
    return orderService.get(caller, pageId, orderId);
  },

  /** Final inspection of finished pieces (the pre-dispatch sheet); the FG receipt later takes what the Usage Decision accepted. */
  async createFgLot(
    caller: Caller,
    pageId: string,
    orderId: string,
    lotQty: string | number | undefined,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const lotId = randomUUID();
    const ctx = await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, orderId);
      if (!LIVE.includes(S(cur.status)) && S(cur.status) !== 'Completed')
        throw Errors.conflict('Final inspection needs a running or completed order.');
      const lotted = (
        await query(
          tx,
          `SELECT COALESCE(sum(l.lot_qty),0)::text AS n FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id WHERE l.order_id=$1::uuid AND l.kind='FG' AND q.status <> 'Cancelled'`,
          orderId,
        )
      )[0]!;
      const room = lotRoom(S(cur.qty_completed), S(lotted.n));
      const qty = lotQty === undefined ? room : D(String(lotQty));
      if (qty.lte(0) || qty.gt(room))
        throw Errors.validation({
          lotQty: room.gt(0)
            ? `Enter a quantity up to ${room.toFixed(3)} (finished pieces not yet in an inspection lot).`
            : 'No finished pieces are waiting for inspection.',
        });
      const lotNo = (
        await query(
          tx,
          `SELECT COALESCE(max(lot_no),0)+1 AS n FROM mfg_lots WHERE order_id=$1::uuid`,
          orderId,
        )
      )[0]!;
      const item = (
        await query(tx, `SELECT name FROM items WHERE id=$1::uuid`, S(cur.item_id))
      )[0]!;
      return {
        unitId: S(cur.unit_id),
        itemId: S(cur.item_id),
        itemName: S(item.name),
        customerId: cur.customer_id ? S(cur.customer_id) : null,
        qty: qty.toFixed(3),
        lotNo: Number(lotNo.n),
        orderNo: S(cur.number),
      };
    }, TX);
    const sheet = await createInspection(caller, 'qms-final', {
      kind: 'PRE_DISPATCH',
      header: { part: ctx.itemId, ...(ctx.customerId ? { customer: ctx.customerId } : {}) },
      itemId: ctx.itemId,
      sourceType: 'MFG_LOT',
      sourceId: lotId,
      lotQty: ctx.qty,
    });
    await insertLotOrCancel(S(sheet.id), {
      id: lotId,
      unitId: ctx.unitId,
      orderId,
      lotNo: ctx.lotNo,
      kind: 'FG',
      lotQty: ctx.qty,
      inspectionId: S(sheet.id),
      createdById: caller.auth.userId,
    });
    await audit(
      prisma,
      caller,
      caller.auth.userId,
      'MFG_FG_LOT_CREATED',
      'mfg_order',
      { id: orderId, code: ctx.orderNo },
      pageId,
      { sheet: S(sheet.number) },
    );
    return orderService.get(caller, pageId, orderId);
  },

  /** FG receipt: only the pieces a Usage Decision accepted, at the material cost carried by the good pieces. */
  async receiveFg(
    caller: Caller,
    pageId: string,
    orderId: string,
    b: {
      lotId: string;
      qty: string | number;
      batchNo?: string | undefined;
      serialNos?: string[] | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const date = todayIst();
    await prisma.$transaction(async (tx) => {
      const cur = await lockOrder(tx, sc, orderId);
      if (!LIVE.includes(S(cur.status)) && S(cur.status) !== 'Completed')
        throw Errors.conflict(
          'Finished goods can be received from a running or completed order only.',
        );
      const lot = (
        await query(
          tx,
          `SELECT l.*, q.status AS q_status, q.accepted_qty::text AS accepted_qty, q.number AS q_number FROM mfg_lots l JOIN qms_inspections q ON q.id=l.inspection_id
            WHERE l.id=$1::uuid AND l.order_id=$2::uuid AND l.kind='FG' FOR UPDATE OF l`,
          b.lotId,
          orderId,
        )
      )[0];
      if (!lot) throw Errors.notFound('Inspection lot not found.');
      const room = lotReceivable({
        status: S(lot.q_status),
        acceptedQty: lot.accepted_qty === null ? null : S(lot.accepted_qty),
        receivedQty: S(lot.received_qty),
      });
      if (S(lot.q_status) !== 'Decided')
        throw new AppError(
          422,
          'MFG_INSPECTION_PENDING',
          `Inspection ${S(lot.q_number)} has no Usage Decision yet. Finished goods are received after a positive decision only.`,
          { lotId: 'Wait for the Usage Decision.' },
        );
      const qty = D(String(b.qty));
      if (qty.lte(0) || qty.gt(room))
        throw Errors.validation({
          qty: room.gt(0)
            ? `Enter a quantity up to ${room.toFixed(3)} (accepted and not yet received).`
            : 'Nothing accepted is left to receive on this lot.',
        });
      const mats = await query(
        tx,
        `SELECT issued_value, returned_value FROM mfg_order_materials WHERE order_id=$1::uuid`,
        orderId,
      );
      const matValue = mats.reduce(
        (a, m) =>
          a.plus(
            materialCost({ issuedValue: S(m.issued_value), returnedValue: S(m.returned_value) }),
          ),
        ZERO,
      );
      const rate = fgUnitRate(matValue.toFixed(2), S(cur.qty_completed));
      const value = round2(rate.mul(qty));
      const item = (
        await query(tx, `SELECT batch_tracked FROM items WHERE id=$1::uuid`, S(cur.item_id))
      )[0]!;
      const mv = await nextMoveNo(tx, cur, 'FG_RECEIPT');
      const moveId = randomUUID();
      const res = await StockService.postMovement(tx, {
        warehouseId: S(cur.warehouse_id),
        itemId: S(cur.item_id),
        direction: 'IN',
        qty: ID(qty.toFixed(3)),
        postingDate: date,
        voucherType: 'RECEIPT',
        voucherId: moveId,
        voucherNo: mv.number,
        createdById: caller.auth.userId,
        value: ID(value.toFixed(2)),
        stockStatus: 'UNRESTRICTED',
        reasonCode: 'MFG_FG',
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
        counter: 'CONSUMPTION_EXPENSE',
        ledgerIds: res.entries.map((e) => e.id),
        narration: `Finished goods from ${S(cur.number)}`,
        actorId: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE mfg_lots SET received_qty=received_qty+$1::numeric WHERE id=$2::uuid`,
        qty.toFixed(3),
        b.lotId,
      );
      await exec(
        tx,
        `UPDATE mfg_orders SET qty_received=qty_received+$1::numeric, updated_by_id=$2::uuid, updated_at=now(), version=version+1 WHERE id=$3::uuid`,
        qty.toFixed(3),
        caller.auth.userId,
        orderId,
      );
      await insertRow(tx, 'mfg_order_moves', {
        id: moveId,
        unitId: S(cur.unit_id),
        orderId,
        kind: 'FG_RECEIPT',
        seq: mv.seq,
        number: mv.number,
        moveDate: date,
        lotId: b.lotId,
        journalId: journal?.id ?? null,
        totalQty: qty.toFixed(3),
        totalValue: value.toFixed(2),
        detail: JSON.stringify([
          { lotId: b.lotId, qty: qty.toFixed(3), rate: rate.toFixed(6), value: value.toFixed(2) },
        ]),
        createdById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_FG_RECEIVED',
        'mfg_order',
        { id: orderId, code: S(cur.number) },
        pageId,
        { number: mv.number, qty: qty.toFixed(3), value: value.toFixed(2) },
      );
    }, TX);
    return orderService.get(caller, pageId, orderId);
  },
};

// ------------------------------------------------------------------------------------------------ helpers
export function opState(input: string, o: Row): OpState {
  return {
    input,
    qtyDone: S(o.qtyDone ?? o.qty_done),
    qtyScrap: S(o.qtyScrap ?? o.qty_scrap),
    qtyRework: S(o.qtyRework ?? o.qty_rework),
  };
}
/** qty_completed = good pieces at the last operation. */
async function syncCompleted(tx: Db, orderId: string): Promise<void> {
  await exec(
    tx,
    `UPDATE mfg_orders SET qty_completed = COALESCE((SELECT qty_done FROM mfg_order_ops WHERE order_id=$1::uuid ORDER BY seq DESC LIMIT 1),0) WHERE id=$1::uuid`,
    orderId,
  );
}
/** Material and conversion cost of an order (figures only; the stock side is already in the GL). */
export function costOf(materials: Row[], ops: Row[], goodQty: string, outside = '0') {
  const mat = materials.reduce(
    (a, m) =>
      a.plus(materialCost({ issuedValue: S(m.issuedValue), returnedValue: S(m.returnedValue) })),
    D(0),
  );
  const conv = ops.reduce(
    (a, o) => a.plus(conversionCost(S(o.actualMinutes), S(o.costPerHour))),
    D(0),
  );
  const total = mat.plus(conv).plus(outside);
  const q = D(goodQty);
  return {
    material: mat.toFixed(2),
    conversion: conv.toFixed(2),
    outside: D(outside).toFixed(2),
    total: total.toFixed(2),
    goodQty: q.toFixed(3),
    unitCost: q.gt(0) ? total.div(q).toDecimalPlaces(4).toFixed(4) : null,
  };
}

/** Inserts the lot of a freshly made inspection sheet; if that fails (a concurrent lot took the number) the sheet is cancelled. */
async function insertLotOrCancel(sheetId: string, row: Row): Promise<void> {
  try {
    await insertRow(prisma, 'mfg_lots', row);
  } catch {
    await exec(
      prisma,
      `UPDATE qms_inspections SET status='Cancelled', updated_at=now() WHERE id=$1::uuid AND status='Draft'`,
      sheetId,
    );
    throw Errors.conflict('Another inspection lot was created at the same moment. Try again.');
  }
}

/** The same component twice in one request would pass the room check twice. */
function assertDistinct(lines: { materialId: string }[]): void {
  if (new Set(lines.map((l) => l.materialId)).size !== lines.length)
    throw Errors.validation({ lines: 'A material is listed twice. Put the total on one line.' });
}
