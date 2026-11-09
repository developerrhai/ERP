// Phase 13 daily board (line planning) and the job-work registers: inward / outward per customer PO line, and the rework
// register against the customer's delivery challan. The customer's material itself stays in the Phase 8 customer-material
// ledger (non-valued); these registers are the paperwork view per customer PO line and challan.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import {
  TX,
  audit,
  checkVersion,
  exec,
  insertRow,
  norm,
  query,
  scopeSql,
  todayIst,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import { D, jwBalances, reworkBalance } from './logic';
import { dateOf, S, oneUnit } from './master-service';

export interface PlanDayInput {
  planDate: string;
  orderId?: string | undefined;
  itemId?: string | undefined;
  customerPoNo?: string | undefined;
  deliveryDate?: string | undefined;
  lineQty?: string | number | undefined;
  unit2Qty?: string | number | undefined;
  coatingQty?: string | number | undefined;
  dispatchQty?: string | number | undefined;
  ownerLine?: string | undefined;
  ownerUnit2?: string | undefined;
  ownerCoating?: string | undefined;
  ownerDispatch?: string | undefined;
  remark?: string | undefined;
}
const q3 = (v: string | number | undefined): string => {
  const d = D(String(v ?? 0));
  if (d.lt(0)) throw Errors.validation({ qty: 'A quantity cannot be negative.' });
  return d.toFixed(3);
};
const SUM = ['line_qty', 'unit2_qty', 'coating_qty', 'dispatch_qty'] as const;

export const boardService = {
  // ---------------------------------------------------------------------------------------------- daily board
  async listPlan(
    caller: Caller,
    pageId: string,
    q: {
      from?: string | undefined;
      to?: string | undefined;
      orderId?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    const from = q.from ?? todayIst();
    args.push(from);
    where.push(`t.plan_date >= $${args.length}::date`);
    if (q.to) {
      args.push(q.to);
      where.push(`t.plan_date <= $${args.length}::date`);
    }
    if (q.orderId) {
      args.push(q.orderId);
      where.push(`t.order_id=$${args.length}::uuid`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (
        await query(prisma, `SELECT count(*)::int AS n FROM mfg_plan_days t WHERE ${w}`, ...args)
      )[0]!.n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, i.code AS item_code, i.name AS item_name, o.number AS order_number
         FROM mfg_plan_days t LEFT JOIN items i ON i.id=t.item_id LEFT JOIN mfg_orders o ON o.id=t.order_id
        WHERE ${w} ORDER BY t.plan_date, t.created_at LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const totals = (
      await query(
        prisma,
        `SELECT ${SUM.map((c) => `COALESCE(sum(t.${c}),0)::text AS ${c}`).join(', ')} FROM mfg_plan_days t WHERE ${w}`,
        ...args,
      )
    )[0]!;
    return { rows: rows.map((r) => norm<Row>(r)), total, totals: norm<Row>(totals) };
  },

  async createPlan(caller: Caller, pageId: string, b: PlanDayInput): Promise<Row> {
    const unitId = oneUnit(caller);
    let itemId = b.itemId ?? null;
    let po = b.customerPoNo ?? null;
    const id = await prisma.$transaction(async (tx) => {
      if (b.orderId) {
        const o = (
          await query(
            tx,
            `SELECT item_id::text, customer_po_no FROM mfg_orders WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
            b.orderId,
            unitId,
          )
        )[0];
        if (!o) throw Errors.validation({ orderId: 'Production order not found in this unit.' });
        itemId = itemId ?? S(o.item_id);
        po = po ?? (o.customer_po_no ? S(o.customer_po_no) : null);
      }
      if (itemId && !(await query(tx, `SELECT 1 FROM items WHERE id=$1::uuid`, itemId))[0])
        throw Errors.validation({ itemId: 'Item not found.' });
      const rid = await insertRow(tx, 'mfg_plan_days', {
        unitId,
        planDate: b.planDate,
        orderId: b.orderId ?? null,
        itemId,
        customerPoNo: po,
        deliveryDate: b.deliveryDate ?? null,
        lineQty: q3(b.lineQty),
        unit2Qty: q3(b.unit2Qty),
        coatingQty: q3(b.coatingQty),
        dispatchQty: q3(b.dispatchQty),
        ownerLine: b.ownerLine ?? null,
        ownerUnit2: b.ownerUnit2 ?? null,
        ownerCoating: b.ownerCoating ?? null,
        ownerDispatch: b.ownerDispatch ?? null,
        remark: b.remark ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_PLAN_DAY_CREATED',
        'mfg_plan_day',
        { id: rid, code: b.planDate },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_plan_days WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async updatePlan(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: Partial<PlanDayInput>,
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_plan_days t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Plan row not found.');
      checkVersion(norm<Row>(cur), version);
      await exec(
        tx,
        `UPDATE mfg_plan_days SET plan_date=COALESCE($1::date,plan_date), customer_po_no=COALESCE($2,customer_po_no), delivery_date=COALESCE($3::date,delivery_date),
           line_qty=COALESCE($4::numeric,line_qty), unit2_qty=COALESCE($5::numeric,unit2_qty), coating_qty=COALESCE($6::numeric,coating_qty),
           dispatch_qty=COALESCE($7::numeric,dispatch_qty), owner_line=COALESCE($8,owner_line), owner_unit2=COALESCE($9,owner_unit2),
           owner_coating=COALESCE($10,owner_coating), owner_dispatch=COALESCE($11,owner_dispatch), remark=COALESCE($12,remark),
           updated_by_id=$13::uuid, updated_at=now(), version=version+1 WHERE id=$14::uuid`,
        b.planDate ?? null,
        b.customerPoNo ?? null,
        b.deliveryDate ?? null,
        b.lineQty === undefined ? null : q3(b.lineQty),
        b.unit2Qty === undefined ? null : q3(b.unit2Qty),
        b.coatingQty === undefined ? null : q3(b.coatingQty),
        b.dispatchQty === undefined ? null : q3(b.dispatchQty),
        b.ownerLine ?? null,
        b.ownerUnit2 ?? null,
        b.ownerCoating ?? null,
        b.ownerDispatch ?? null,
        b.remark ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_PLAN_DAY_UPDATED',
        'mfg_plan_day',
        { id, code: S(cur.plan_date) },
        pageId,
        {},
      );
    }, TX);
    return norm<Row>(
      (await query(prisma, `SELECT * FROM mfg_plan_days WHERE id=$1::uuid`, id))[0]!,
    );
  },

  async deletePlan(caller: Caller, pageId: string, id: string): Promise<void> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_plan_days t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Plan row not found.');
      await exec(
        tx,
        `UPDATE mfg_plan_days SET deleted_at=now(), deleted_by_id=$1::uuid, version=version+1 WHERE id=$2::uuid`,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_PLAN_DAY_DELETED',
        'mfg_plan_day',
        { id, code: S(cur.plan_date) },
        pageId,
        {},
      );
    }, TX);
  },

  // ---------------------------------------------------------------------------------------------- job work: PO lines
  async listJwLines(
    caller: Caller,
    pageId: string,
    q: {
      id?: string | undefined;
      customerId?: string | undefined;
      status?: string | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.id) {
      args.push(q.id);
      where.push(`t.id=$${args.length}::uuid`);
    }
    if (q.customerId) {
      args.push(q.customerId);
      where.push(`t.customer_id=$${args.length}::uuid`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status=$${args.length}`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.customer_po_no ILIKE $${args.length} OR t.part ILIKE $${args.length})`);
    }
    const w = where.join(' AND ');
    const total = Number(
      (await query(prisma, `SELECT count(*)::int AS n FROM mfg_jw_lines t WHERE ${w}`, ...args))[0]!
        .n,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, c.name AS customer_name,
              COALESCE((SELECT sum(m.qty) FROM mfg_jw_moves m WHERE m.jw_line_id=t.id AND m.direction='INWARD' AND m.status='Posted'),0)::text AS inward,
              COALESCE((SELECT sum(m.qty) FROM mfg_jw_moves m WHERE m.jw_line_id=t.id AND m.direction='OUTWARD' AND m.status='Posted'),0)::text AS outward
         FROM mfg_jw_lines t JOIN customers c ON c.id=t.customer_id
        WHERE ${w} ORDER BY t.customer_po_no, t.po_line_no LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return {
      rows: rows.map((r) => {
        const n = norm<Row>(r);
        return { ...n, ...jwBalances(S(n.poQty), S(n.inward), S(n.outward)) } as Row;
      }),
      total,
    };
  },

  async getJwLine(caller: Caller, pageId: string, id: string): Promise<Row> {
    const l = (await boardService.listJwLines(caller, pageId, { id, page: 1, size: 1 })).rows[0];
    if (!l) throw Errors.notFound('Customer PO line not found.');
    const moves = await query(
      prisma,
      `SELECT id::text, direction, move_date, qty, doc_no, remark, status FROM mfg_jw_moves WHERE jw_line_id=$1::uuid ORDER BY move_date, created_at`,
      id,
    );
    return { ...l, moves: moves.map((r) => norm<Row>(r)) };
  },

  async createJwLine(
    caller: Caller,
    pageId: string,
    b: {
      customerId: string;
      customerPoNo: string;
      poLineNo?: number | undefined;
      itemId?: string | undefined;
      part: string;
      poQty: string | number;
      uom: string;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    if (D(String(b.poQty)).lte(0))
      throw Errors.validation({ poQty: 'Enter a quantity greater than 0.' });
    const id = await prisma.$transaction(async (tx) => {
      if (!(await query(tx, `SELECT 1 FROM customers WHERE id=$1::uuid`, b.customerId))[0])
        throw Errors.validation({ customerId: 'Customer not found.' });
      if (b.itemId && !(await query(tx, `SELECT 1 FROM items WHERE id=$1::uuid`, b.itemId))[0])
        throw Errors.validation({ itemId: 'Item not found.' });
      const dup = await query(
        tx,
        `SELECT 1 FROM mfg_jw_lines WHERE unit_id=$1::uuid AND customer_id=$2::uuid AND customer_po_no=$3 AND po_line_no=$4 AND deleted_at IS NULL`,
        unitId,
        b.customerId,
        b.customerPoNo,
        b.poLineNo ?? 1,
      );
      if (dup.length)
        throw Errors.validation({ poLineNo: 'This customer PO line is already registered.' });
      const rid = await insertRow(tx, 'mfg_jw_lines', {
        unitId,
        customerId: b.customerId,
        customerPoNo: b.customerPoNo.trim(),
        poLineNo: b.poLineNo ?? 1,
        itemId: b.itemId ?? null,
        part: b.part.trim(),
        poQty: D(String(b.poQty)).toFixed(3),
        uom: b.uom,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JW_LINE_CREATED',
        'mfg_jw_line',
        { id: rid, code: b.customerPoNo },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return boardService.getJwLine(caller, pageId, id);
  },

  async updateJwLine(
    caller: Caller,
    pageId: string,
    id: string,
    version: number | undefined,
    b: {
      poQty?: string | number | undefined;
      part?: string | undefined;
      status?: 'Open' | 'Closed' | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const cur = (
        await query(
          tx,
          `SELECT t.* FROM mfg_jw_lines t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!cur) throw Errors.notFound('Customer PO line not found.');
      checkVersion(norm<Row>(cur), version);
      if (b.poQty !== undefined && D(String(b.poQty)).lte(0))
        throw Errors.validation({ poQty: 'Enter a quantity greater than 0.' });
      await exec(
        tx,
        `UPDATE mfg_jw_lines SET po_qty=COALESCE($1::numeric,po_qty), part=COALESCE($2,part), status=COALESCE($3,status), updated_by_id=$4::uuid, updated_at=now(), version=version+1 WHERE id=$5::uuid`,
        b.poQty === undefined ? null : D(String(b.poQty)).toFixed(3),
        b.part ?? null,
        b.status ?? null,
        caller.auth.userId,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JW_LINE_UPDATED',
        'mfg_jw_line',
        { id, code: S(cur.customer_po_no) },
        pageId,
        {},
      );
    }, TX);
    return boardService.getJwLine(caller, pageId, id);
  },

  /** Inward = material received from the customer on that PO line, outward = goods sent back or dispatched. */
  async addJwMove(
    caller: Caller,
    pageId: string,
    id: string,
    b: {
      direction: 'INWARD' | 'OUTWARD';
      qty: string | number;
      moveDate?: string | undefined;
      docNo?: string | undefined;
      remark?: string | undefined;
    },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const qty = D(String(b.qty));
    if (qty.lte(0)) throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    if (!(b.docNo ?? '').trim())
      throw Errors.validation({ docNo: 'Enter the challan or document number.' });
    await prisma.$transaction(async (tx) => {
      const line = (
        await query(
          tx,
          `SELECT t.* FROM mfg_jw_lines t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!line) throw Errors.notFound('Customer PO line not found.');
      if (S(line.status) !== 'Open') throw Errors.conflict('This customer PO line is closed.');
      if (b.direction === 'OUTWARD') {
        const held = (
          await query(
            tx,
            `SELECT (COALESCE(sum(qty) FILTER (WHERE direction='INWARD'),0) - COALESCE(sum(qty) FILTER (WHERE direction='OUTWARD'),0))::text AS h
               FROM mfg_jw_moves WHERE jw_line_id=$1::uuid AND status='Posted'`,
            id,
          )
        )[0]!;
        if (qty.gt(D(S(held.h))))
          throw Errors.validation({
            qty: `Only ${D(S(held.h)).toFixed(3)} is held for this PO line. Record the inward receipt first.`,
          });
      }
      await insertRow(tx, 'mfg_jw_moves', {
        unitId: S(line.unit_id),
        jwLineId: id,
        direction: b.direction,
        moveDate: b.moveDate ?? todayIst(),
        qty: qty.toFixed(3),
        docNo: b.docNo!.trim(),
        remark: b.remark ?? null,
        createdById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JW_MOVE',
        'mfg_jw_line',
        { id, code: S(line.customer_po_no) },
        pageId,
        { direction: b.direction, qty: qty.toFixed(3) },
      );
    }, TX);
    return boardService.getJwLine(caller, pageId, id);
  },

  async cancelJwMove(caller: Caller, pageId: string, lineId: string, moveId: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const line = (
        await query(
          tx,
          `SELECT t.* FROM mfg_jw_lines t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          lineId,
        )
      )[0];
      if (!line) throw Errors.notFound('Customer PO line not found.');
      const m = (
        await query(
          tx,
          `SELECT * FROM mfg_jw_moves WHERE id=$1::uuid AND jw_line_id=$2::uuid FOR UPDATE`,
          moveId,
          lineId,
        )
      )[0];
      if (!m || S(m.status) !== 'Posted') throw Errors.notFound('Entry not found.');
      if (S(m.direction) === 'INWARD') {
        const after = (
          await query(
            tx,
            `SELECT (COALESCE(sum(qty) FILTER (WHERE direction='INWARD'),0) - COALESCE(sum(qty) FILTER (WHERE direction='OUTWARD'),0))::text AS h
               FROM mfg_jw_moves WHERE jw_line_id=$1::uuid AND status='Posted' AND id <> $2::uuid`,
            lineId,
            moveId,
          )
        )[0]!;
        if (D(S(after.h)).lt(0))
          throw Errors.conflict(
            'Goods were already sent out against this receipt. Cancel those entries first.',
          );
      }
      await exec(tx, `UPDATE mfg_jw_moves SET status='Cancelled' WHERE id=$1::uuid`, moveId);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_JW_MOVE_CANCELLED',
        'mfg_jw_line',
        { id: lineId, code: S(line.customer_po_no) },
        pageId,
        {},
      );
    }, TX);
    return boardService.getJwLine(caller, pageId, lineId);
  },

  // ---------------------------------------------------------------------------------------------- rework against the customer's challan
  async listChallanRework(
    caller: Caller,
    pageId: string,
    q: {
      id?: string | undefined;
      customerId?: string | undefined;
      open?: boolean | undefined;
      q?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.id) {
      args.push(q.id);
      where.push(`t.id=$${args.length}::uuid`);
    }
    if (q.customerId) {
      args.push(q.customerId);
      where.push(`t.customer_id=$${args.length}::uuid`);
    }
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.challan_no ILIKE $${args.length} OR t.part ILIKE $${args.length})`);
    }
    const w = where.join(' AND ');
    const rows = await query(
      prisma,
      `SELECT t.*, c.name AS customer_name,
              COALESCE((SELECT sum(d.qty) FROM mfg_jw_rework_done d WHERE d.rework_id=t.id AND d.status='Posted'),0)::text AS done_qty
         FROM mfg_jw_rework t JOIN customers c ON c.id=t.customer_id
        WHERE ${w} ORDER BY t.challan_date DESC, t.challan_no`,
      ...args,
    );
    let out: Row[] = rows.map((r) => {
      const n = norm<Row>(r);
      return { ...n, balanceQty: reworkBalance(S(n.challanQty), S(n.doneQty)) } as Row;
    });
    if (q.open) out = out.filter((r) => D(S(r.balanceQty)).gt(0));
    const total = out.length;
    return { rows: out.slice((q.page - 1) * q.size, q.page * q.size), total };
  },

  async getChallanRework(caller: Caller, pageId: string, id: string): Promise<Row> {
    const r = (await boardService.listChallanRework(caller, pageId, { id, page: 1, size: 1 }))
      .rows[0];
    if (!r) throw Errors.notFound('Challan rework entry not found.');
    const done = await query(
      prisma,
      `SELECT id::text, done_date, qty, done_challan_no, status FROM mfg_jw_rework_done WHERE rework_id=$1::uuid ORDER BY done_date, created_at`,
      id,
    );
    return { ...r, done: done.map((d) => norm<Row>(d)) };
  },

  async createChallanRework(
    caller: Caller,
    pageId: string,
    b: {
      customerId: string;
      challanNo: string;
      challanDate: string;
      itemId?: string | undefined;
      part: string;
      challanQty: string | number;
      remark?: string | undefined;
    },
  ): Promise<Row> {
    const unitId = oneUnit(caller);
    if (D(String(b.challanQty)).lte(0))
      throw Errors.validation({ challanQty: 'Enter a quantity greater than 0.' });
    if (b.challanDate > todayIst())
      throw Errors.validation({ challanDate: 'The challan date cannot be in the future.' });
    const id = await prisma.$transaction(async (tx) => {
      if (!(await query(tx, `SELECT 1 FROM customers WHERE id=$1::uuid`, b.customerId))[0])
        throw Errors.validation({ customerId: 'Customer not found.' });
      const dup = await query(
        tx,
        `SELECT 1 FROM mfg_jw_rework WHERE unit_id=$1::uuid AND customer_id=$2::uuid AND challan_no=$3 AND part=$4 AND deleted_at IS NULL`,
        unitId,
        b.customerId,
        b.challanNo.trim(),
        b.part.trim(),
      );
      if (dup.length)
        throw Errors.validation({
          challanNo: 'This challan and part are already in the register.',
        });
      const rid = await insertRow(tx, 'mfg_jw_rework', {
        unitId,
        customerId: b.customerId,
        challanNo: b.challanNo.trim(),
        challanDate: b.challanDate,
        itemId: b.itemId ?? null,
        part: b.part.trim(),
        challanQty: D(String(b.challanQty)).toFixed(3),
        remark: b.remark ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_CHALLAN_REWORK_CREATED',
        'mfg_jw_rework',
        { id: rid, code: b.challanNo },
        pageId,
        {},
      );
      return rid;
    }, TX);
    return boardService.getChallanRework(caller, pageId, id);
  },

  async addReworkDone(
    caller: Caller,
    pageId: string,
    id: string,
    b: { qty: string | number; doneChallanNo: string; doneDate?: string | undefined },
  ): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const qty = D(String(b.qty));
    if (qty.lte(0)) throw Errors.validation({ qty: 'Enter a quantity greater than 0.' });
    await prisma.$transaction(async (tx) => {
      const r = (
        await query(
          tx,
          `SELECT t.* FROM mfg_jw_rework t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!r) throw Errors.notFound('Challan rework entry not found.');
      const done = (
        await query(
          tx,
          `SELECT COALESCE(sum(qty),0)::text AS q FROM mfg_jw_rework_done WHERE rework_id=$1::uuid AND status='Posted'`,
          id,
        )
      )[0]!;
      const bal = D(reworkBalance(S(r.challan_qty), S(done.q)));
      if (qty.gt(bal))
        throw Errors.validation({
          qty: `Only ${bal.toFixed(3)} is left to rework on this challan.`,
        });
      if (b.doneDate && b.doneDate < dateOf(r.challan_date))
        throw Errors.validation({
          doneDate: 'The rework cannot be before the customer challan date.',
        });
      await insertRow(tx, 'mfg_jw_rework_done', {
        reworkId: id,
        doneDate: b.doneDate ?? todayIst(),
        qty: qty.toFixed(3),
        doneChallanNo: b.doneChallanNo.trim(),
        createdById: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_CHALLAN_REWORK_DONE',
        'mfg_jw_rework',
        { id, code: S(r.challan_no) },
        pageId,
        { qty: qty.toFixed(3) },
      );
    }, TX);
    return boardService.getChallanRework(caller, pageId, id);
  },

  async cancelReworkDone(caller: Caller, pageId: string, id: string, doneId: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    await prisma.$transaction(async (tx) => {
      const r = (
        await query(
          tx,
          `SELECT t.* FROM mfg_jw_rework t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql} FOR UPDATE OF t`,
          ...sc.args,
          id,
        )
      )[0];
      if (!r) throw Errors.notFound('Challan rework entry not found.');
      const n = await exec(
        tx,
        `UPDATE mfg_jw_rework_done SET status='Cancelled' WHERE id=$1::uuid AND rework_id=$2::uuid AND status='Posted'`,
        doneId,
        id,
      );
      if (!n) throw Errors.notFound('Entry not found.');
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'MFG_CHALLAN_REWORK_CANCELLED',
        'mfg_jw_rework',
        { id, code: S(r.challan_no) },
        pageId,
        {},
      );
    }, TX);
    return boardService.getChallanRework(caller, pageId, id);
  },
};
