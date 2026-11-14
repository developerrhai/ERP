// Phase 10 fulfilment and billing: dispatch (stock out + cost of goods sold, delivery challan, daily dispatch list),
// sales invoice (receivable + sales + output GST), customer receipts with allocation to invoices, and sales returns
// with the credit note (restock at the original dispatch cost). Every post = assertCanPost + NumberingService +
// StockService + PostingService in one transaction; a cancel is a reversal.
import { randomUUID } from 'node:crypto';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { assertCanPost } from '../../core/posting';
import { finishPdf, newPdf } from '../../core/pdf';
import { feedSalesCreditNote, feedSalesInvoice } from '../tax/feed';
import { PostingService } from '../finance/posting-service';
import type { EventLine } from '../finance/posting-service';
import { openItemService } from '../finance/open-items-service';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { StockService } from '../inventory/stock/stock-service';
import { UomService } from '../inventory/uom/uom-service';
import { concreteUnit } from '../inventory/typed';
import { makeCrud } from '../procurement/crud';
import {
  TX,
  S,
  allocateNumber,
  assertEditable,
  audit,
  checkVersion,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  loadDoc,
  loadLines,
  norm,
  query,
  registerDoc,
  scopeSql,
  settings,
  todayIst,
  updateRow,
} from '../procurement/core';
import { unitState } from '../procurement/core';
import type { Actor, DocDef, Row } from '../procurement/core';
import { anyCostCenter } from '../procurement/ap-service';
import { addDays, headerTotals, lineTax } from '../procurement/math';
import type { LineTax } from '../procurement/math';

export const DISP_DEF: DocDef = {
  pageId: 'sales-dispatch',
  table: 'sales_dispatches',
  title: 'Dispatch',
  amountCol: 'cost_total',
  linesTable: 'sales_dispatch_lines',
  parentCol: 'dispatch_id',
  async preLock(tx, id) {
    const r = (
      await query(tx, `SELECT order_id::text FROM sales_dispatches WHERE id=$1::uuid`, id)
    )[0];
    if (r)
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `so:${S(r.order_id)}`,
      );
  },
  async afterApproved(tx, id, actor) {
    if ((await settings(tx)).postOnApprove) await postDispatch(tx, id, actor);
  },
};
export const INV_DEF: DocDef = {
  pageId: 'sales-invoices',
  table: 'sales_invoices',
  title: 'Sales Invoice',
  amountCol: 'grand_total',
  linesTable: 'sales_invoice_lines',
  parentCol: 'invoice_id',
  async afterApproved(tx, id, actor) {
    if ((await settings(tx)).postOnApprove) await postInvoice(tx, id, actor);
  },
};
export const RET_DEF: DocDef = {
  pageId: 'sales-returns',
  table: 'sales_returns',
  title: 'Sales Return',
  amountCol: 'grand_total',
  linesTable: 'sales_return_lines',
  parentCol: 'return_id',
  async afterApproved(tx, id, actor) {
    if ((await settings(tx)).postOnApprove) await postReturn(tx, id, actor);
  },
};
registerDoc(DISP_DEF);
registerDoc(INV_DEF);
registerDoc(RET_DEF);

const keyMap = async (tx: Db) =>
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  new Map((await tx.itemTypeAccount.findMany()).map((r) => [r.itemType, r.inventoryKey]));

// ============================================================================================ dispatch
export interface DispatchBody {
  orderId: string;
  warehouseId: string;
  dispatchDate?: string;
  vehicleNo?: string | null;
  transporter?: string | null;
  lrNo?: string | null;
  driver?: string | null;
  shipTo?: string | null;
  weightKg?: string | null;
  remark?: string | null;
  lines: {
    orderLineId: string;
    qty: string;
    batchNo?: string | null;
    serialNos?: string[] | null;
    inspectionSerial?: string | null;
    remark?: string | null;
  }[];
}

async function openQtyOf(db: Db, orderLineId: string): Promise<Dec> {
  const l = (
    await query(
      db,
      `SELECT qty::text, dispatched_qty::text, closed_qty::text FROM sales_order_lines WHERE id=$1::uuid`,
      orderLineId,
    )
  )[0];
  if (!l) throw Errors.notFound('Order line not found.');
  return D(S(l.qty))
    .minus(D(S(l.dispatched_qty)))
    .minus(D(S(l.closed_qty)));
}

async function saveDispatch(
  caller: Caller,
  id: string | null,
  ifMatch: number | undefined,
  b: DispatchBody,
) {
  const unitId = concreteUnit(caller);
  const fy = await fyOfCaller(caller);
  const outId = await prisma.$transaction(async (tx) => {
    let cur: Row | null = null;
    if (id) {
      cur = await loadDoc(tx, caller, DISP_DEF, id, { lock: true });
      assertEditable(cur, 'dispatch');
      checkVersion(cur, ifMatch);
    }
    const so = (
      await query(
        tx,
        `SELECT * FROM sales_orders WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
        b.orderId,
        unitId,
      )
    )[0];
    if (!so) throw Errors.validation({ orderId: 'Choose an approved sales order of this unit.' });
    if (so.status !== 'Approved')
      throw Errors.conflict('Only an approved sales order can be dispatched.');
    const wh = (
      await query(
        tx,
        `SELECT unit_id::text FROM warehouses WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.warehouseId,
      )
    )[0];
    if (!wh || wh.unit_id !== unitId)
      throw Errors.validation({ warehouseId: 'Choose a warehouse of this unit.' });
    if (b.lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    const out: Row[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < b.lines.length; i += 1) {
      const l = b.lines[i]!;
      const at = (f: string) => `lines.${i}.${f}`;
      if (seen.has(l.orderLineId))
        throw Errors.validation({
          [at('orderLineId')]: 'This order line is already on the dispatch.',
        });
      seen.add(l.orderLineId);
      const ol = (
        await query(
          tx,
          `SELECT * FROM sales_order_lines WHERE id=$1::uuid AND order_id=$2::uuid`,
          l.orderLineId,
          b.orderId,
        )
      )[0];
      if (!ol) throw Errors.validation({ [at('orderLineId')]: 'This line is not on the order.' });
      const qty = D(l.qty);
      if (qty.lte(0)) throw Errors.validation({ [at('qty')]: 'Enter a quantity greater than 0.' });
      const open = await openQtyOf(tx, l.orderLineId);
      if (qty.gt(open))
        throw new AppError(
          409,
          'QUANTITY_EXCEEDS_OPEN',
          `Only ${open.toFixed()} left on ${S(so.number)} line ${S(ol.line_no)}.`,
          { [at('qty')]: `Only ${open.toFixed()} left.` },
        );
      out.push({
        orderLineId: l.orderLineId,
        itemId: ol.item_id,
        qty: str(qty),
        uom: ol.uom,
        batchNo: l.batchNo ?? null,
        serialNos: l.serialNos ?? null,
        inspectionSerial: l.inspectionSerial ?? null,
        remark: l.remark ?? null,
      });
    }
    const header: Row = {
      customerId: so.customer_id,
      orderId: b.orderId,
      warehouseId: b.warehouseId,
      dispatchDate: b.dispatchDate ?? todayIst(),
      vehicleNo: b.vehicleNo ?? null,
      transporter: b.transporter ?? null,
      lrNo: b.lrNo ?? null,
      driver: b.driver ?? null,
      shipTo: b.shipTo ?? S(so.ship_to) ?? null,
      weightKg: b.weightKg ?? null,
      remark: b.remark ?? null,
    };
    let did = id;
    let number = cur ? S(cur.number) : '';
    if (!did) {
      number = await allocateNumber(tx, DISP_DEF, unitId, fy.id);
      did = await insertRow(tx, 'sales_dispatches', {
        ...header,
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, DISP_DEF.pageId, caller),
        status: 'Draft',
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    } else {
      await updateRow(tx, 'sales_dispatches', did, {
        ...header,
        updatedAt: new Date(),
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE sales_dispatches SET version=version+1 WHERE id=$1::uuid`, did);
      await exec(tx, `DELETE FROM sales_dispatch_lines WHERE dispatch_id=$1::uuid`, did);
    }
    let n = 0;
    for (const l of out) {
      n += 1;
      await insertRow(tx, 'sales_dispatch_lines', { ...l, dispatchId: did, lineNo: n });
    }
    await audit(
      tx,
      caller,
      caller.auth.userId,
      id ? 'SCM_UPDATED' : 'SCM_CREATED',
      DISP_DEF.title,
      { id: did, code: number },
      DISP_DEF.pageId,
      { unitId },
    );
    return did;
  }, TX);
  return getDispatch(prisma, caller, outId);
}

export async function getDispatch(
  db: Db,
  caller: Caller,
  id: string,
): Promise<Row & { lines: Row[] }> {
  const h = await loadDoc(db, caller, DISP_DEF, id);
  const lines = await query(
    db,
    `SELECT l.*, i.code AS item_code, i.name AS item_name, o.part_no, o.colour, o.description FROM sales_dispatch_lines l JOIN items i ON i.id=l.item_id JOIN sales_order_lines o ON o.id=l.order_line_id WHERE l.dispatch_id=$1::uuid ORDER BY l.line_no`,
    id,
  );
  const c = (
    await query(
      db,
      `SELECT c.name, o.number AS order_no, o.customer_po_no FROM customers c, sales_orders o WHERE c.id=$1::uuid AND o.id=$2::uuid`,
      h.customer_id,
      h.order_id,
    )
  )[0];
  return {
    ...norm<Row>(h),
    customerName: c?.name,
    orderNo: c?.order_no,
    customerPoNo: c?.customer_po_no,
    lines: lines.map((l) => norm<Row>(l)),
  };
}

export async function postDispatch(tx: Db, id: string, actor: Actor): Promise<void> {
  const d = (
    await query(
      tx,
      `SELECT * FROM sales_dispatches WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    )
  )[0];
  if (!d) throw Errors.notFound('Record not found.');
  if (d.status === 'Posted') return;
  if (d.status !== 'Approved')
    throw Errors.conflict(
      'Submit the dispatch for approval first; only an Approved dispatch can be posted.',
    );
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `so:${S(d.order_id)}`);
  const unitId = S(d.unit_id);
  const date = S(norm<Row>(d).dispatchDate);
  await assertCanPost(tx, {
    unitId,
    fyId: S(d.fy_id),
    postingDate: date,
    documentStatus: 'Approved',
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  const so = (
    await query(tx, `SELECT * FROM sales_orders WHERE id=$1::uuid FOR UPDATE`, d.order_id)
  )[0]!;
  if (so.status !== 'Approved') throw Errors.conflict('The sales order is not approved.');
  const km = await keyMap(tx);
  const lines = await loadLines(tx, DISP_DEF, id);
  const invByKey = new Map<string, Dec>();
  let total = ZERO;
  for (const l of lines) {
    const ol = (
      await query(
        tx,
        `SELECT * FROM sales_order_lines WHERE id=$1::uuid FOR UPDATE`,
        l.order_line_id,
      )
    )[0]!;
    const qty = D(S(norm<Row>(l).qty));
    const open = D(S(ol.qty))
      .minus(D(S(ol.dispatched_qty)))
      .minus(D(S(ol.closed_qty)));
    if (qty.gt(open))
      throw new AppError(
        409,
        'QUANTITY_EXCEEDS_OPEN',
        `Only ${open.toFixed()} left on ${S(so.number)} line ${S(ol.line_no)}.`,
      );
    const base = (
      await tx.item.findUniqueOrThrow({ where: { id: S(l.item_id) }, select: { itemType: true } })
    ).itemType;
    const baseQty = (await UomService.toBase(tx, { itemId: S(l.item_id), uom: S(l.uom), qty }))
      .baseQty;
    const res = await StockService.postMovement(tx, {
      warehouseId: S(d.warehouse_id),
      itemId: S(l.item_id),
      direction: 'OUT',
      qty: baseQty,
      postingDate: date,
      voucherType: 'DISPATCH',
      voucherId: id,
      voucherNo: S(d.number),
      createdById: actor.userId,
      ...(l.batch_no ? { batch: { batchNo: S(l.batch_no) } } : {}),
      ...(Array.isArray(l.serial_nos) && l.serial_nos.length
        ? { serialNos: l.serial_nos as string[] }
        : {}),
      ...(ol.reservation_id && D(S(ol.reserved_qty)).gt(0)
        ? { reservationId: S(ol.reservation_id) }
        : {}),
    });
    const value = res.entries.reduce((a, e) => a.plus(e.value), ZERO);
    total = total.plus(value);
    const key = km.get(base) ?? 'INVENTORY_FG';
    invByKey.set(key, (invByKey.get(key) ?? ZERO).plus(value));
    await exec(
      tx,
      `UPDATE sales_dispatch_lines SET unit_cost=$2::numeric, cost_value=$3::numeric WHERE id=$1::uuid`,
      S(l.id),
      str(value.div(baseQty).toDecimalPlaces(6)),
      str(round2(value)),
    );
    await exec(
      tx,
      `UPDATE sales_order_lines SET dispatched_qty = dispatched_qty + $2::numeric, reserved_qty = GREATEST(reserved_qty - $2::numeric, 0) WHERE id=$1::uuid`,
      S(l.order_line_id),
      str(qty),
    );
  }
  const legs: EventLine[] = [
    {
      account: 'COGS',
      debit: str(round2(total)),
      credit: '0.00',
      unitId,
      costCenter: await anyCostCenter(tx, unitId),
    },
  ];
  for (const [key, v] of invByKey)
    legs.push({ account: key, debit: '0.00', credit: str(round2(v)), unitId });
  const j = await PostingService.postJournal(
    tx,
    {
      unitId,
      docDate: date,
      voucherType: 'Delivery',
      source: 'EVENT',
      narration: `Dispatch ${S(d.number)}`,
      sourceDocType: 'sales_dispatch',
      sourceDocId: id,
      sourceDocNo: S(d.number),
      event: 'DISPATCH_POST',
      payload: { docNo: S(d.number), lines: legs },
    },
    { userId: actor.userId },
  );
  await exec(
    tx,
    `UPDATE sales_dispatches SET status='Posted', posted_at=now(), journal_id=$2::uuid, cost_total=$3::numeric, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
    id,
    j.id,
    str(round2(total)),
    actor.userId,
  );
  await audit(
    tx,
    null,
    actor.userId,
    'SCM_POSTED',
    DISP_DEF.title,
    { id, code: S(d.number) },
    DISP_DEF.pageId,
    { journal: j.code },
  );
}

async function cancelDispatch(caller: Caller, id: string, reason: string) {
  if (reason.trim().length < 5)
    throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
  await prisma.$transaction(async (tx) => {
    const d = await loadDoc(tx, caller, DISP_DEF, id, { lock: true });
    if (d.status !== 'Posted') throw Errors.conflict('Only a posted dispatch can be cancelled.');
    const inv = (
      await query(
        tx,
        `SELECT 1 FROM sales_dispatch_lines WHERE dispatch_id=$1::uuid AND (invoiced_qty > 0 OR returned_qty > 0) LIMIT 1`,
        id,
      )
    )[0];
    if (inv)
      throw Errors.conflict(
        'This dispatch is already invoiced or partly returned. Cancel the invoice / return first.',
      );
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `so:${S(d.order_id)}`);
    const today = todayIst();
    await StockService.reverseVoucher(tx, id, {
      voucherNo: S(d.number),
      postingDate: today,
      createdById: caller.auth.userId,
    });
    const rev = await PostingService.reverse(
      tx,
      S(d.journal_id),
      reason.trim(),
      { userId: caller.auth.userId },
      { reversalDate: today },
    );
    for (const l of await loadLines(tx, DISP_DEF, id))
      await exec(
        tx,
        `UPDATE sales_order_lines SET dispatched_qty = dispatched_qty - $2::numeric WHERE id=$1::uuid`,
        S(l.order_line_id),
        S(norm<Row>(l).qty),
      );
    await exec(
      tx,
      `UPDATE sales_dispatches SET status='Cancelled', cancel_journal_id=$2::uuid, cancel_reason=$3, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
      id,
      rev.id,
      reason.trim(),
      caller.auth.userId,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'SCM_CANCELLED',
      DISP_DEF.title,
      { id, code: S(d.number) },
      DISP_DEF.pageId,
      { reason },
    );
  }, TX);
  return getDispatch(prisma, caller, id);
}

/** Delivery challan as a PDF: challan no, vehicle, particulars, quantities and signature boxes. */
export async function challanPdf(caller: Caller, id: string): Promise<Buffer> {
  const d = (await getDispatch(prisma, caller, id)) as Row & { lines: Row[] };
  const unit = (
    await query(prisma, `SELECT name, address, gstin FROM units WHERE id=$1::uuid`, d.unitId)
  )[0];
  const doc = newPdf({ title: `Delivery challan ${S(d.number)}` });
  doc
    .fontSize(15)
    .font('Sans-Bold')
    .text(S(unit?.name) || 'Delivery Challan', { align: 'center' });
  doc
    .fontSize(9)
    .font('Sans')
    .text(`${S(unit?.address)}${unit?.gstin ? `   GSTIN ${S(unit.gstin)}` : ''}`, {
      align: 'center',
    });
  doc
    .moveDown()
    .fontSize(13)
    .font('Sans-Bold')
    .text('DELIVERY CHALLAN', { align: 'center' })
    .moveDown(0.5);
  doc.fontSize(10).font('Sans');
  doc.text(
    `Challan no: ${S(d.number)}      Date: ${S(d.dispatchDate).split('-').reverse().join('-')}`,
  );
  doc.text(
    `Customer: ${S(d.customerName)}      Order: ${S(d.orderNo)}   PO no: ${S(d.customerPoNo) || '—'}`,
  );
  doc.text(`Ship to: ${S(d.shipTo) || '—'}`);
  doc
    .text(
      `Vehicle no: ${S(d.vehicleNo) || '—'}      Transporter: ${S(d.transporter) || '—'}      LR no: ${S(d.lrNo) || '—'}`,
    )
    .moveDown(0.5);
  const cols = [30, 150, 120, 60, 50, 80];
  const row = (cells: string[], bold = false) => {
    let x = 40;
    const y = doc.y;
    doc.font(bold ? 'Sans-Bold' : 'Sans').fontSize(9);
    cells.forEach((c, i) => {
      doc.text(c, x, y, { width: cols[i]! - 4, lineBreak: false, ellipsis: true });
      x += cols[i]!;
    });
    doc.y = y + 16;
    doc.x = 40;
  };
  row(['#', 'Particulars', 'Part no / colour', 'Qty', 'Unit', 'Remark'], true);
  doc.moveTo(40, doc.y).lineTo(535, doc.y).stroke();
  d.lines.forEach((l, i) =>
    row([
      String(i + 1),
      `${S(l.itemCode)} ${S(l.itemName)}`,
      `${S(l.partNo)} ${S(l.colour)}`.trim(),
      S(l.qty),
      S(l.uom),
      S(l.remark) || S(l.inspectionSerial),
    ]),
  );
  doc.moveDown(3).fontSize(10).font('Sans');
  const y = doc.y;
  ['Prepared by', 'Checked by', 'Driver', 'Received by customer'].forEach((t, i) =>
    doc.text(`${t}\n\n________________`, 40 + i * 125, y, { width: 120 }),
  );
  return finishPdf(doc);
}

/** Daily dispatch list: PO no, part no, description, colour, qty, remark / inspection serial (client requirement 3). */
export async function dispatchList(caller: Caller, date: string) {
  const args: unknown[] = [date];
  let unit = 'false';
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    unit = 'd.unit_id = $2::uuid';
  } else if (caller.ctx.allUnits) unit = 'true';
  const rows = await query(
    prisma,
    `SELECT d.number AS challan_no, d.vehicle_no, c.name AS customer, o.customer_po_no AS po_no, ol.part_no, COALESCE(ol.description, i.name) AS description, ol.colour, l.qty::text, l.uom,
        COALESCE(l.remark, '') AS remark, l.inspection_serial
      FROM sales_dispatch_lines l JOIN sales_dispatches d ON d.id=l.dispatch_id JOIN sales_orders o ON o.id=d.order_id JOIN sales_order_lines ol ON ol.id=l.order_line_id
      JOIN items i ON i.id=l.item_id JOIN customers c ON c.id=d.customer_id
     WHERE d.dispatch_date=$1::date AND d.status='Posted' AND ${unit} ORDER BY d.number, l.line_no`,
    ...args,
  );
  return rows.map((r) => norm<Row>(r));
}

export const dispatchService = {
  list: async (
    caller: Caller,
    q: { q?: string | undefined; status?: string | undefined; page: number; size: number },
  ) => listOf(caller, DISP_DEF, 'sales_dispatches', q),
  get: (caller: Caller, id: string) => getDispatch(prisma, caller, id),
  create: (caller: Caller, b: DispatchBody) => saveDispatch(caller, null, undefined, b),
  update: (caller: Caller, id: string, ifMatch: number | undefined, b: DispatchBody) =>
    saveDispatch(caller, id, ifMatch, b),
  post: async (caller: Caller, id: string) => {
    await prisma.$transaction(async (tx) => {
      await loadDoc(tx, caller, DISP_DEF, id);
      await postDispatch(tx, id, { userId: caller.auth.userId });
    }, TX);
    return getDispatch(prisma, caller, id);
  },
  cancel: cancelDispatch,
  /** Open order lines for "Dispatch this order": quantity still to send. */
  async fromOrder(caller: Caller, orderId: string) {
    const o = await loadDoc(
      prisma,
      caller,
      { pageId: 'sales-orders', table: 'sales_orders', title: 'Sales Order', amountCol: null },
      orderId,
    );
    const lines = await query(
      prisma,
      `SELECT l.id::text AS order_line_id, l.line_no, l.item_id::text, i.code AS item_code, i.name AS item_name, l.uom, l.warehouse_id::text, (l.qty - l.dispatched_qty - l.closed_qty)::text AS open_qty, l.reserved_qty::text
        FROM sales_order_lines l JOIN items i ON i.id=l.item_id WHERE l.order_id=$1::uuid AND l.qty - l.dispatched_qty - l.closed_qty > 0 ORDER BY l.line_no`,
      orderId,
    );
    return {
      orderId,
      orderNo: o.number,
      customerId: o.customer_id,
      status: o.status,
      lines: lines.map((l) => norm<Row>(l)),
    };
  },
};

// ============================================================================================ invoice
export interface InvoiceBody {
  dispatchId: string;
  invoiceDate?: string;
  freight?: string | null;
  notes?: string | null;
  lines?: { dispatchLineId: string; qty: string }[];
}

async function saveInvoice(
  caller: Caller,
  id: string | null,
  ifMatch: number | undefined,
  b: InvoiceBody,
) {
  const unitId = concreteUnit(caller);
  const fy = await fyOfCaller(caller);
  const outId = await prisma.$transaction(async (tx) => {
    let cur: Row | null = null;
    if (id) {
      cur = await loadDoc(tx, caller, INV_DEF, id, { lock: true });
      assertEditable(cur, 'invoice');
      checkVersion(cur, ifMatch);
    }
    const d = (
      await query(
        tx,
        `SELECT * FROM sales_dispatches WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
        b.dispatchId,
        unitId,
      )
    )[0];
    if (!d || d.status !== 'Posted')
      throw Errors.validation({ dispatchId: 'Choose a posted dispatch.' });
    const cust = (
      await query(
        tx,
        `SELECT state_code, credit_days, name FROM customers WHERE id=$1::uuid`,
        d.customer_id,
      )
    )[0]!;
    const intra = S(cust.state_code) === (await unitState(tx, unitId));
    const dl = await query(
      tx,
      `SELECT l.*, o.rate::text AS o_rate, o.discount_pct::text AS o_disc, o.gst_pct::text AS o_gst, o.hsn_sac AS o_hsn, COALESCE(o.description, '') AS o_desc FROM sales_dispatch_lines l JOIN sales_order_lines o ON o.id=l.order_line_id WHERE l.dispatch_id=$1::uuid ORDER BY l.line_no`,
      b.dispatchId,
    );
    const wanted = new Map((b.lines ?? []).map((x) => [x.dispatchLineId, D(x.qty)]));
    const out: Row[] = [];
    const taxes: LineTax[] = [];
    for (const l of dl) {
      const room = D(S(l.qty)).minus(D(S(l.invoiced_qty)));
      if (b.lines && !wanted.has(S(l.id))) continue;
      const qty = wanted.get(S(l.id)) ?? room;
      if (qty.lte(0)) continue;
      if (qty.gt(room))
        throw new AppError(
          409,
          'QUANTITY_EXCEEDS_OPEN',
          `Only ${room.toFixed()} of line ${S(l.line_no)} is left to invoice.`,
        );
      const t = lineTax({
        qty,
        rate: D(S(l.o_rate)),
        discountPct: D(S(l.o_disc)),
        gstPct: D(S(l.o_gst)),
        intra,
      });
      taxes.push(t);
      out.push({
        dispatchLineId: l.id,
        orderLineId: l.order_line_id,
        itemId: l.item_id,
        description: S(l.o_desc) || null,
        hsnSac: l.o_hsn,
        qty: str(qty),
        uom: l.uom,
        rate: l.o_rate,
        discountPct: l.o_disc,
        gstPct: l.o_gst,
        taxable: str(t.taxable),
        cgst: str(t.cgst),
        sgst: str(t.sgst),
        igst: str(t.igst),
      });
    }
    if (out.length === 0) throw Errors.conflict('Everything on this dispatch is already invoiced.');
    const h = headerTotals(taxes);
    const freight = D(b.freight ?? 0);
    const invoiceDate = b.invoiceDate ?? todayIst();
    const before = h.before.plus(freight);
    const grand = before.toDecimalPlaces(0, 4);
    const header: Row = {
      customerId: d.customer_id,
      orderId: d.order_id,
      invoiceDate,
      dueDate: addDays(invoiceDate, Number(cust.credit_days ?? 0)),
      customerState: cust.state_code,
      regime: intra ? 'INTRA' : 'INTER',
      taxable: str(h.taxable.plus(freight)),
      cgst: str(h.cgst),
      sgst: str(h.sgst),
      igst: str(h.igst),
      freight: str(freight),
      roundOff: str(grand.minus(before)),
      grandTotal: str(grand),
      notes: b.notes ?? null,
    };
    let iid = id;
    let number = cur ? S(cur.number) : '';
    if (!iid) {
      // GST rule 46: an invoice number has at most 16 characters, so the unit and year only: TAL/26-27/0001
      number = await allocateNumber(tx, INV_DEF, unitId, fy.id, undefined, GST_INVOICE_PATTERN);
      iid = await insertRow(tx, 'sales_invoices', {
        ...header,
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, INV_DEF.pageId, caller),
        status: 'Draft',
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    } else {
      await updateRow(tx, 'sales_invoices', iid, {
        ...header,
        updatedAt: new Date(),
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE sales_invoices SET version=version+1 WHERE id=$1::uuid`, iid);
      await exec(tx, `DELETE FROM sales_invoice_lines WHERE invoice_id=$1::uuid`, iid);
    }
    let n = 0;
    for (const l of out) {
      n += 1;
      await insertRow(tx, 'sales_invoice_lines', { ...l, invoiceId: iid, lineNo: n });
    }
    await audit(
      tx,
      caller,
      caller.auth.userId,
      id ? 'SCM_UPDATED' : 'SCM_CREATED',
      INV_DEF.title,
      { id: iid, code: number },
      INV_DEF.pageId,
      { unitId },
    );
    return iid;
  }, TX);
  return getInvoice(prisma, caller, outId);
}

export async function getInvoice(db: Db, caller: Caller, id: string) {
  const h = await loadDoc(db, caller, INV_DEF, id);
  const lines = await query(
    db,
    `SELECT l.*, i.code AS item_code, i.name AS item_name FROM sales_invoice_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.invoice_id=$1::uuid ORDER BY l.line_no`,
    id,
  );
  const c = (await query(db, `SELECT name FROM customers WHERE id=$1::uuid`, h.customer_id))[0];
  return { ...norm<Row>(h), customerName: c?.name, lines: lines.map((l) => norm<Row>(l)) };
}

export async function postInvoice(tx: Db, id: string, actor: Actor): Promise<void> {
  const inv = (
    await query(
      tx,
      `SELECT * FROM sales_invoices WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    )
  )[0];
  if (!inv) throw Errors.notFound('Record not found.');
  if (inv.status === 'Posted') return;
  if (inv.status !== 'Approved')
    throw Errors.conflict(
      'Submit the invoice for approval first; only an Approved invoice can be posted.',
    );
  const unitId = S(inv.unit_id);
  const n = norm<Row>(inv);
  const date = S(n.invoiceDate);
  await assertCanPost(tx, {
    unitId,
    fyId: S(inv.fy_id),
    postingDate: date,
    documentStatus: 'Approved',
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  const lines = await loadLines(tx, INV_DEF, id);
  const parent = (
    await query(
      tx,
      `SELECT status FROM sales_dispatches WHERE id = (SELECT dispatch_id FROM sales_dispatch_lines WHERE id=$1::uuid) FOR SHARE`,
      lines[0]?.dispatch_line_id,
    )
  )[0];
  if (!parent || parent.status !== 'Posted')
    throw Errors.conflict(
      'The dispatch of this invoice was cancelled. Cancel or delete the invoice.',
    );
  for (const l of lines) {
    const dl = (
      await query(
        tx,
        `SELECT qty::text, invoiced_qty::text FROM sales_dispatch_lines WHERE id=$1::uuid FOR UPDATE`,
        l.dispatch_line_id,
      )
    )[0]!;
    const room = D(S(dl.qty)).minus(D(S(dl.invoiced_qty)));
    if (D(S(norm<Row>(l).qty)).gt(room))
      throw new AppError(409, 'QUANTITY_EXCEEDS_OPEN', 'A dispatch line was already invoiced.');
    await exec(
      tx,
      `UPDATE sales_dispatch_lines SET invoiced_qty = invoiced_qty + $2::numeric WHERE id=$1::uuid`,
      S(l.dispatch_line_id),
      S(norm<Row>(l).qty),
    );
    await exec(
      tx,
      `UPDATE sales_order_lines SET invoiced_qty = invoiced_qty + $2::numeric WHERE id=$1::uuid`,
      S(l.order_line_id),
      S(norm<Row>(l).qty),
    );
  }
  const grand = D(S(n.grandTotal));
  const ro = D(S(n.roundOff));
  const legs: EventLine[] = [
    {
      account: 'AR',
      debit: str(grand),
      credit: '0.00',
      unitId,
      partyId: S(inv.customer_id),
      partyType: 'CUSTOMER',
    },
    { account: 'SALES', debit: '0.00', credit: str(D(S(n.taxable))), unitId },
  ];
  for (const [h, v] of [
    ['CGST', n.cgst],
    ['SGST', n.sgst],
    ['IGST', n.igst],
  ] as [string, unknown][])
    if (D(S(v)).gt(0))
      legs.push({ account: `OUTPUT_${h}`, debit: '0.00', credit: str(D(S(v))), unitId });
  if (!ro.isZero())
    legs.push({
      account: 'ROUND_OFF',
      debit: ro.lt(0) ? str(ro.abs()) : '0.00',
      credit: ro.gt(0) ? str(ro) : '0.00',
      unitId,
      costCenter: await anyCostCenter(tx, unitId),
    });
  const j = await PostingService.postJournal(
    tx,
    {
      unitId,
      docDate: date,
      voucherType: 'Sales Invoice',
      source: 'EVENT',
      narration: `Sales invoice ${S(inv.number)}`,
      sourceDocType: 'sales_invoice',
      sourceDocId: id,
      sourceDocNo: S(inv.number),
      event: 'SINV_POST',
      payload: {
        docNo: S(inv.number),
        dueDate: S(n.dueDate ?? date),
        partyId: S(inv.customer_id),
        partyType: 'CUSTOMER',
        invoiceType: 'Domestic',
        lines: legs,
      },
    },
    { userId: actor.userId },
  );
  await exec(
    tx,
    `UPDATE sales_invoices SET status='Posted', posted_at=now(), journal_id=$2::uuid, version=version+1, updated_by_id=$3::uuid, updated_at=now() WHERE id=$1::uuid`,
    id,
    j.id,
    actor.userId,
  );
  await feedSalesInvoice(tx, id, actor.userId);
  await audit(
    tx,
    null,
    actor.userId,
    'SCM_POSTED',
    INV_DEF.title,
    { id, code: S(inv.number) },
    INV_DEF.pageId,
    { journal: j.code },
  );
}

const GST_INVOICE_PATTERN = '{unit}/{fy}/{number:4}';

async function cancelInvoice(caller: Caller, id: string, reason: string) {
  if (reason.trim().length < 5)
    throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
  await prisma.$transaction(async (tx) => {
    const inv = await loadDoc(tx, caller, INV_DEF, id, { lock: true });
    if (inv.status !== 'Posted') throw Errors.conflict('Only a posted invoice can be cancelled.');
    if (D(S(norm<Row>(inv).receivedAmount)).gt(0))
      throw Errors.conflict('This invoice has receipts. Cancel the receipt first.');
    const rets = (
      await query(
        tx,
        `SELECT 1 FROM sales_returns WHERE invoice_id=$1::uuid AND status='Posted' LIMIT 1`,
        id,
      )
    )[0];
    if (rets)
      throw Errors.conflict('A sales return was posted against this invoice. Cancel it first.');
    const rev = await PostingService.reverse(
      tx,
      S(inv.journal_id),
      reason.trim(),
      { userId: caller.auth.userId },
      { reversalDate: todayIst() },
    );
    for (const l of await loadLines(tx, INV_DEF, id)) {
      await exec(
        tx,
        `UPDATE sales_dispatch_lines SET invoiced_qty = invoiced_qty - $2::numeric WHERE id=$1::uuid`,
        S(l.dispatch_line_id),
        S(norm<Row>(l).qty),
      );
      await exec(
        tx,
        `UPDATE sales_order_lines SET invoiced_qty = invoiced_qty - $2::numeric WHERE id=$1::uuid`,
        S(l.order_line_id),
        S(norm<Row>(l).qty),
      );
    }
    await exec(
      tx,
      `UPDATE sales_invoices SET status='Cancelled', cancel_journal_id=$2::uuid, cancel_reason=$3, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
      id,
      rev.id,
      reason.trim(),
      caller.auth.userId,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'SCM_CANCELLED',
      INV_DEF.title,
      { id, code: S(inv.number) },
      INV_DEF.pageId,
      { reason },
    );
  }, TX);
  return getInvoice(prisma, caller, id);
}

export const invoiceService = {
  list: async (
    caller: Caller,
    q: {
      q?: string | undefined;
      status?: string | undefined;
      customerId?: string | undefined;
      page: number;
      size: number;
    },
  ) => listOf(caller, INV_DEF, 'sales_invoices', q),
  get: (caller: Caller, id: string) => getInvoice(prisma, caller, id),
  create: (caller: Caller, b: InvoiceBody) => saveInvoice(caller, null, undefined, b),
  update: (caller: Caller, id: string, ifMatch: number | undefined, b: InvoiceBody) =>
    saveInvoice(caller, id, ifMatch, b),
  post: async (caller: Caller, id: string) => {
    await prisma.$transaction(async (tx) => {
      await loadDoc(tx, caller, INV_DEF, id);
      await postInvoice(tx, id, { userId: caller.auth.userId });
    }, TX);
    const posted = await getInvoice(prisma, caller, id);
    void import('../notifications/email-automation-service.js')
      .then(({ emailAutomationService }) =>
        emailAutomationService.emitEvent('sales_invoice.posted', 'SALES_INVOICE', id, Number((posted as Record<string, unknown>).version ?? 1)),
      )
      .catch(() => undefined);
    return posted;
  },
  cancel: cancelInvoice,
  /** Dispatch lines still to be invoiced. */
  async fromDispatch(caller: Caller, dispatchId: string) {
    const d = await getDispatch(prisma, caller, dispatchId);
    return {
      dispatchId,
      customerId: d.customerId,
      lines: d.lines
        .filter((l) => D(S(l.qty)).gt(D(S(l.invoicedQty))))
        .map((l) => ({ ...l, openQty: str(D(S(l.qty)).minus(D(S(l.invoicedQty)))) })),
    };
  },
};

// ============================================================================================ receipts (collections)
export interface ReceiptBody {
  customerId: string;
  bankAccountId: string;
  amount: string;
  mode: 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash';
  receiptDate?: string;
  reference?: string | null;
  allocations?: { invoiceId: string; amount: string }[];
}

export const receiptService = {
  async post(caller: Caller, b: ReceiptBody) {
    const unitId = concreteUnit(caller);
    const fy = await fyOfCaller(caller);
    const amount = D(b.amount);
    if (amount.lte(0)) throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    const alloc = b.allocations ?? [];
    const allocated = alloc.reduce((a, x) => a.plus(D(x.amount)), ZERO);
    if (allocated.gt(amount))
      throw Errors.validation({
        allocations: 'The invoices add up to more than the amount received.',
      });
    const id = await prisma.$transaction(async (tx) => {
      const bank = (
        await query(
          tx,
          `SELECT id::text, unit_id::text, kind, status FROM bank_accounts WHERE id=$1::uuid AND deleted_at IS NULL`,
          b.bankAccountId,
        )
      )[0];
      if (!bank || bank.unit_id !== unitId || bank.status !== 'Active')
        throw Errors.validation({ bankAccountId: 'Choose a cash or bank account of this unit.' });
      if ((b.mode === 'Cash') !== (bank.kind === 'CASH' || bank.kind === 'PETTY'))
        throw Errors.validation({
          mode:
            b.mode === 'Cash'
              ? 'A cash receipt needs a Cash or Petty cash book.'
              : 'This mode needs a Bank account.',
        });
      const cust = (
        await query(
          tx,
          `SELECT name FROM customers WHERE id=$1::uuid AND deleted_at IS NULL`,
          b.customerId,
        )
      )[0];
      if (!cust) throw Errors.validation({ customerId: 'Choose a customer.' });
      const date = b.receiptDate ?? todayIst();
      const number = await allocateNumber(
        tx,
        { pageId: 'sales-collections' } as DocDef,
        unitId,
        fy.id,
      );
      const sources: { invoiceId: string; itemId: string; amount: string }[] = [];
      const merged = new Map<string, Dec>();
      for (const a of alloc)
        merged.set(a.invoiceId, (merged.get(a.invoiceId) ?? ZERO).plus(D(a.amount)));
      for (const [invoiceId, total] of merged) {
        const a = { invoiceId, amount: str(total) };
        const inv = (
          await query(
            tx,
            `SELECT id::text, customer_id::text, status, journal_id::text FROM sales_invoices WHERE id=$1::uuid FOR UPDATE`,
            a.invoiceId,
          )
        )[0];
        if (!inv || inv.customer_id !== b.customerId || inv.status !== 'Posted')
          throw Errors.validation({ allocations: 'Choose posted invoices of this customer.' });
        const oi = (
          await query(
            tx,
            `SELECT id::text, outstanding::text FROM open_items WHERE journal_id=$1::uuid AND party_id=$2::uuid AND party_type='CUSTOMER' ORDER BY created_at LIMIT 1 FOR UPDATE`,
            inv.journal_id,
            b.customerId,
          )
        )[0];
        if (!oi || D(S(oi.outstanding)).lt(D(a.amount)))
          throw new AppError(
            409,
            'PAYMENT_EXCEEDS_PAYABLE',
            `Only ₹${S(oi?.outstanding ?? 0)} is outstanding on this invoice.`,
          );
        sources.push({ invoiceId: a.invoiceId, itemId: S(oi.id), amount: a.amount });
      }
      const receiptId = randomUUID();
      const j = await PostingService.postJournal(
        tx,
        {
          unitId,
          docDate: date,
          voucherType: 'Receipt',
          source: 'PAYMENT',
          narration: `Receipt ${number} from ${S(cust.name)}`,
          sourceDocType: 'sales_receipt',
          sourceDocId: receiptId,
          sourceDocNo: number,
          event: 'CUSTOMER_RECEIPT',
          payload: {
            docNo: number,
            partyId: b.customerId,
            partyType: 'CUSTOMER',
            bankAccountId: b.bankAccountId,
            paymentMode: b.mode,
            lines: [
              { account: 'BANK_OR_CASH', debit: str(amount), credit: '0.00', unitId },
              {
                account: 'AR',
                debit: '0.00',
                credit: str(amount),
                unitId,
                partyId: b.customerId,
                partyType: 'CUSTOMER',
              },
            ],
          },
        },
        { userId: caller.auth.userId },
      );
      const rid = await insertRow(tx, 'sales_receipts', {
        id: receiptId,
        unitId,
        fyId: fy.id,
        number,
        customerId: b.customerId,
        receiptDate: date,
        amount: str(amount),
        bankAccountId: b.bankAccountId,
        mode: b.mode,
        reference: b.reference ?? null,
        journalId: j.id,
        status: 'Posted',
        createdById: caller.auth.userId,
      });
      for (const s of sources) {
        await openItemService.allocate(
          tx,
          {
            sourceItemId: j.openItemIds[0]!,
            targetItemId: s.itemId,
            amount: s.amount,
            date,
            journalId: j.id,
          },
          { userId: caller.auth.userId },
        );
        await insertRow(tx, 'sales_receipt_allocations', {
          receiptId: rid,
          invoiceId: s.invoiceId,
          amount: s.amount,
        });
        await exec(
          tx,
          `UPDATE sales_invoices SET received_amount = received_amount + $2::numeric, receipt_status = CASE WHEN received_amount + $2::numeric >= grand_total THEN 'PAID' ELSE 'PARTIAL' END, version=version+1 WHERE id=$1::uuid`,
          s.invoiceId,
          s.amount,
        );
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_POSTED',
        'Customer receipt',
        { id: rid, code: number },
        'sales-collections',
        { amount: str(amount), allocated: str(allocated) },
      );
      return rid;
    }, TX);
    return norm<Row>(
      (
        await query(
          prisma,
          `SELECT r.*, c.name AS customer_name FROM sales_receipts r JOIN customers c ON c.id=r.customer_id WHERE r.id=$1::uuid`,
          id,
        )
      )[0]!,
    );
  },
  async list(caller: Caller, q: { customerId?: string | undefined; page: number; size: number }) {
    const args: unknown[] = [];
    const where: string[] = [];
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      where.push(`r.unit_id=$${args.length}::uuid`);
    } else if (!caller.ctx.allUnits) where.push('false');
    if (q.customerId) {
      args.push(q.customerId);
      where.push(`r.customer_id=$${args.length}::uuid`);
    }
    const rows = await query(
      prisma,
      `SELECT r.*, c.name AS customer_name FROM sales_receipts r JOIN customers c ON c.id=r.customer_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM sales_receipts r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
          ...args,
        )
      )[0]?.n ?? 0,
    );
    return { rows: rows.map((r) => norm<Row>(r)), total };
  },
  /** Collection worklist: unpaid invoices by customer with days overdue. */
  async outstanding(caller: Caller, asOf = todayIst()) {
    const args: unknown[] = [];
    let unit = 'false';
    if (caller.ctx.unitId) {
      args.push(caller.ctx.unitId);
      unit = 'i.unit_id=$1::uuid';
    } else if (caller.ctx.allUnits) unit = 'true';
    const rows = await query(
      prisma,
      `SELECT i.id::text, i.number, i.invoice_date, i.due_date, i.grand_total::text, i.received_amount::text, (i.grand_total - i.received_amount)::text AS outstanding, c.id::text AS customer_id, c.name AS customer_name
        FROM sales_invoices i JOIN customers c ON c.id=i.customer_id WHERE ${unit} AND i.status='Posted' AND i.deleted_at IS NULL AND i.grand_total - i.received_amount > 0 ORDER BY i.due_date NULLS LAST, i.number`,
      ...args,
    );
    const list: Row[] = rows.map((r) => {
      const n = norm<Row>(r);
      const due = n.dueDate ? S(n.dueDate) : null;
      const late =
        due && due < asOf
          ? Math.round(
              (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000,
            )
          : 0;
      return {
        ...n,
        daysOverdue: late,
        bucket:
          !due || due >= asOf
            ? 'NOT_DUE'
            : late <= 30
              ? '0-30'
              : late <= 60
                ? '31-60'
                : late <= 90
                  ? '61-90'
                  : '90+',
      };
    });
    const byCustomer = new Map<
      string,
      { customerId: string; customerName: string; outstanding: Dec }
    >();
    for (const r of list) {
      const k = S(r.customerId);
      const cur = byCustomer.get(k) ?? {
        customerId: k,
        customerName: S(r.customerName),
        outstanding: ZERO,
      };
      cur.outstanding = cur.outstanding.plus(D(S(r.outstanding)));
      byCustomer.set(k, cur);
    }
    return {
      asOf,
      rows: list,
      customers: [...byCustomer.values()].map((c) => ({ ...c, outstanding: str(c.outstanding) })),
    };
  },
};

// ============================================================================================ returns + credit note
export interface ReturnBody {
  invoiceId: string;
  warehouseId: string;
  returnDate?: string;
  reason?: string | null;
  lines: { invoiceLineId: string; qty: string; reason?: string | null }[];
}

async function saveReturn(
  caller: Caller,
  id: string | null,
  ifMatch: number | undefined,
  b: ReturnBody,
) {
  const unitId = concreteUnit(caller);
  const fy = await fyOfCaller(caller);
  const outId = await prisma.$transaction(async (tx) => {
    let cur: Row | null = null;
    if (id) {
      cur = await loadDoc(tx, caller, RET_DEF, id, { lock: true });
      assertEditable(cur, 'return');
      checkVersion(cur, ifMatch);
    }
    const inv = (
      await query(
        tx,
        `SELECT * FROM sales_invoices WHERE id=$1::uuid AND unit_id=$2::uuid AND deleted_at IS NULL`,
        b.invoiceId,
        unitId,
      )
    )[0];
    if (!inv || inv.status !== 'Posted')
      throw Errors.validation({ invoiceId: 'Choose a posted invoice of this unit.' });
    const wh = (
      await query(
        tx,
        `SELECT unit_id::text FROM warehouses WHERE id=$1::uuid AND deleted_at IS NULL`,
        b.warehouseId,
      )
    )[0];
    if (!wh || wh.unit_id !== unitId)
      throw Errors.validation({ warehouseId: 'Choose a warehouse of this unit.' });
    if (b.lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    const out: Row[] = [];
    const taxes: LineTax[] = [];
    const intra = S(inv.regime) === 'INTRA';
    for (let i = 0; i < b.lines.length; i += 1) {
      const l = b.lines[i]!;
      const at = (f: string) => `lines.${i}.${f}`;
      const il = (
        await query(
          tx,
          `SELECT l.*, dl.unit_cost::text AS d_cost FROM sales_invoice_lines l JOIN sales_dispatch_lines dl ON dl.id=l.dispatch_line_id WHERE l.id=$1::uuid AND l.invoice_id=$2::uuid`,
          l.invoiceLineId,
          b.invoiceId,
        )
      )[0];
      if (!il)
        throw Errors.validation({ [at('invoiceLineId')]: 'This line is not on the invoice.' });
      const qty = D(l.qty);
      const max = D(S(il.qty)).minus(D(S(il.returned_qty)));
      if (qty.lte(0)) throw Errors.validation({ [at('qty')]: 'Enter a quantity greater than 0.' });
      if (qty.gt(max))
        throw new AppError(
          409,
          'RETURN_EXCEEDS_RECEIVED',
          `You can return at most ${max.toFixed()}.`,
          { [at('qty')]: `You can return at most ${max.toFixed()}.` },
        );
      const t = lineTax({
        qty,
        rate: D(S(il.rate)),
        discountPct: D(S(il.discount_pct)),
        gstPct: D(S(il.gst_pct)),
        intra,
      });
      taxes.push(t);
      out.push({
        invoiceLineId: l.invoiceLineId,
        itemId: il.item_id,
        qty: str(qty),
        rate: il.rate,
        gstPct: il.gst_pct,
        taxable: str(t.taxable),
        cgst: str(t.cgst),
        sgst: str(t.sgst),
        igst: str(t.igst),
        unitCost: il.d_cost,
        costValue: str(round2(qty.mul(D(S(il.d_cost))))),
        reason: l.reason ?? null,
      });
    }
    const h = headerTotals(taxes);
    const header: Row = {
      customerId: inv.customer_id,
      invoiceId: b.invoiceId,
      warehouseId: b.warehouseId,
      returnDate: b.returnDate ?? todayIst(),
      reason: b.reason ?? null,
      regime: inv.regime,
      taxable: str(h.taxable),
      cgst: str(h.cgst),
      sgst: str(h.sgst),
      igst: str(h.igst),
      roundOff: str(h.roundOff),
      grandTotal: str(h.grand),
    };
    let rid = id;
    let number = cur ? S(cur.number) : '';
    if (!rid) {
      number = await allocateNumber(tx, RET_DEF, unitId, fy.id);
      rid = await insertRow(tx, 'sales_returns', {
        ...header,
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, RET_DEF.pageId, caller),
        status: 'Draft',
        creditNoteNo: await allocateNumber(
          tx,
          RET_DEF,
          unitId,
          fy.id,
          'sales-returns:cn',
          '{prefix}{unit}/{fy}/{number:4}',
        ),
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    } else {
      await updateRow(tx, 'sales_returns', rid, {
        ...header,
        updatedAt: new Date(),
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE sales_returns SET version=version+1 WHERE id=$1::uuid`, rid);
      await exec(tx, `DELETE FROM sales_return_lines WHERE return_id=$1::uuid`, rid);
    }
    let n = 0;
    for (const l of out) {
      n += 1;
      await insertRow(tx, 'sales_return_lines', { ...l, returnId: rid, lineNo: n });
    }
    await audit(
      tx,
      caller,
      caller.auth.userId,
      id ? 'SCM_UPDATED' : 'SCM_CREATED',
      RET_DEF.title,
      { id: rid, code: number },
      RET_DEF.pageId,
      { unitId },
    );
    return rid;
  }, TX);
  return getReturn(prisma, caller, outId);
}

export async function getReturn(db: Db, caller: Caller, id: string) {
  const h = await loadDoc(db, caller, RET_DEF, id);
  const lines = await query(
    db,
    `SELECT l.*, i.code AS item_code, i.name AS item_name FROM sales_return_lines l JOIN items i ON i.id=l.item_id WHERE l.return_id=$1::uuid ORDER BY l.line_no`,
    id,
  );
  const c = (await query(db, `SELECT name FROM customers WHERE id=$1::uuid`, h.customer_id))[0];
  return { ...norm<Row>(h), customerName: c?.name, lines: lines.map((l) => norm<Row>(l)) };
}

export async function postReturn(tx: Db, id: string, actor: Actor): Promise<void> {
  const r = (
    await query(
      tx,
      `SELECT * FROM sales_returns WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    )
  )[0];
  if (!r) throw Errors.notFound('Record not found.');
  if (r.status === 'Posted') return;
  if (r.status !== 'Approved')
    throw Errors.conflict(
      'Submit the return for approval first; only an Approved return can be posted.',
    );
  const unitId = S(r.unit_id);
  const n = norm<Row>(r);
  const date = S(n.returnDate);
  await assertCanPost(tx, {
    unitId,
    fyId: S(r.fy_id),
    postingDate: date,
    documentStatus: 'Approved',
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  const inv = (
    await query(
      tx,
      `SELECT journal_id::text, customer_id::text, number, status FROM sales_invoices WHERE id=$1::uuid FOR UPDATE`,
      r.invoice_id,
    )
  )[0]!;
  if (inv.status !== 'Posted')
    throw Errors.conflict('The invoice of this return was cancelled. Cancel or delete the return.');
  const km = await keyMap(tx);
  const lines = await loadLines(tx, RET_DEF, id);
  const invByKey = new Map<string, Dec>();
  let cost = ZERO;
  for (const l of lines) {
    const ln = norm<Row>(l);
    const il = (
      await query(
        tx,
        `SELECT l.qty::text, l.returned_qty::text, l.dispatch_line_id::text, l.order_line_id::text FROM sales_invoice_lines l WHERE l.id=$1::uuid FOR UPDATE`,
        l.invoice_line_id,
      )
    )[0]!;
    if (D(S(ln.qty)).gt(D(S(il.qty)).minus(D(S(il.returned_qty)))))
      throw new AppError(
        409,
        'RETURN_EXCEEDS_RECEIVED',
        'More than the invoiced quantity is being returned.',
      );
    const item = await tx.item.findUniqueOrThrow({
      where: { id: S(l.item_id) },
      select: { itemType: true, qcRequired: true },
    });
    const value = D(S(ln.costValue));
    await StockService.postMovement(tx, {
      warehouseId: S(r.warehouse_id),
      itemId: S(l.item_id),
      direction: 'IN',
      qty: D(S(ln.qty)),
      postingDate: date,
      voucherType: 'SALES_RETURN',
      voucherId: id,
      voucherNo: S(r.number),
      createdById: actor.userId,
      value,
      rate: D(S(ln.unitCost)),
      stockStatus: item.qcRequired ? 'QUALITY_INSPECTION' : 'UNRESTRICTED',
    });
    cost = cost.plus(value);
    const key = km.get(item.itemType) ?? 'INVENTORY_FG';
    invByKey.set(key, (invByKey.get(key) ?? ZERO).plus(value));
    await exec(
      tx,
      `UPDATE sales_invoice_lines SET returned_qty = returned_qty + $2::numeric WHERE id=$1::uuid`,
      S(l.invoice_line_id),
      S(ln.qty),
    );
    await exec(
      tx,
      `UPDATE sales_order_lines SET returned_qty = returned_qty + $2::numeric WHERE id=$1::uuid`,
      S(il.order_line_id),
      S(ln.qty),
    );
    await exec(
      tx,
      `UPDATE sales_dispatch_lines SET returned_qty = returned_qty + $2::numeric WHERE id=$1::uuid`,
      S(il.dispatch_line_id),
      S(ln.qty),
    );
  }
  const legs: EventLine[] = [];
  for (const [k, v] of invByKey)
    legs.push({ account: k, debit: str(round2(v)), credit: '0.00', unitId });
  legs.push({
    account: 'COGS',
    debit: '0.00',
    credit: str(round2(cost)),
    unitId,
    costCenter: await anyCostCenter(tx, unitId),
  });
  legs.push({ account: 'SALES_RETURNS', debit: str(D(S(n.taxable))), credit: '0.00', unitId });
  for (const [h, v] of [
    ['CGST', n.cgst],
    ['SGST', n.sgst],
    ['IGST', n.igst],
  ] as [string, unknown][])
    if (D(S(v)).gt(0))
      legs.push({ account: `OUTPUT_${h}`, debit: str(D(S(v))), credit: '0.00', unitId });
  const ro = D(S(n.roundOff));
  if (!ro.isZero())
    legs.push({
      account: 'ROUND_OFF',
      debit: ro.gt(0) ? str(ro) : '0.00',
      credit: ro.lt(0) ? str(ro.abs()) : '0.00',
      unitId,
      costCenter: await anyCostCenter(tx, unitId),
    });
  const grand = D(S(n.grandTotal));
  legs.push({
    account: 'AR',
    debit: '0.00',
    credit: str(grand),
    unitId,
    partyId: S(r.customer_id),
    partyType: 'CUSTOMER',
  });
  const j = await PostingService.postJournal(
    tx,
    {
      unitId,
      docDate: date,
      voucherType: 'Credit Note',
      source: 'EVENT',
      narration: `Credit note ${S(r.credit_note_no)} (return ${S(r.number)})`,
      sourceDocType: 'sales_return',
      sourceDocId: id,
      sourceDocNo: S(r.credit_note_no),
      event: 'SRET_POST',
      payload: {
        docNo: S(r.credit_note_no),
        partyId: S(r.customer_id),
        partyType: 'CUSTOMER',
        lines: legs,
      },
    },
    { userId: actor.userId },
  );
  // settle the credit note against the invoice it belongs to
  const bill = (
    await query(
      tx,
      `SELECT id::text, outstanding::text FROM open_items WHERE journal_id=$1::uuid AND party_id=$2::uuid AND party_type='CUSTOMER' ORDER BY created_at LIMIT 1`,
      inv.journal_id,
      inv.customer_id,
    )
  )[0];
  if (bill && j.openItemIds[0]) {
    const room = D(S(bill.outstanding));
    const take = room.lt(grand) ? room : grand;
    if (take.gt(0))
      await openItemService.allocate(
        tx,
        {
          sourceItemId: j.openItemIds[0],
          targetItemId: S(bill.id),
          amount: str(take),
          date,
          journalId: j.id,
        },
        { userId: actor.userId },
      );
    if (take.gt(0))
      await exec(
        tx,
        `UPDATE sales_invoices SET received_amount = received_amount + $2::numeric,
                receipt_status = CASE WHEN received_amount + $2::numeric >= grand_total THEN 'PAID' ELSE 'PARTIAL' END, version = version + 1
          WHERE id = $1::uuid`,
        S(r.invoice_id),
        str(take),
      );
  }
  await exec(
    tx,
    `UPDATE sales_returns SET status='Posted', posted_at=now(), journal_id=$2::uuid, version=version+1, updated_by_id=$3::uuid, updated_at=now() WHERE id=$1::uuid`,
    id,
    j.id,
    actor.userId,
  );
  await feedSalesCreditNote(tx, id, actor.userId);
  await audit(
    tx,
    null,
    actor.userId,
    'SCM_POSTED',
    RET_DEF.title,
    { id, code: S(r.number) },
    RET_DEF.pageId,
    { journal: j.code },
  );
}

export const returnService = {
  list: async (
    caller: Caller,
    q: { q?: string | undefined; status?: string | undefined; page: number; size: number },
  ) => listOf(caller, RET_DEF, 'sales_returns', q),
  get: (caller: Caller, id: string) => getReturn(prisma, caller, id),
  create: (caller: Caller, b: ReturnBody) => saveReturn(caller, null, undefined, b),
  update: (caller: Caller, id: string, ifMatch: number | undefined, b: ReturnBody) =>
    saveReturn(caller, id, ifMatch, b),
  post: async (caller: Caller, id: string) => {
    await prisma.$transaction(async (tx) => {
      await loadDoc(tx, caller, RET_DEF, id);
      await postReturn(tx, id, { userId: caller.auth.userId });
    }, TX);
    return getReturn(prisma, caller, id);
  },
};

// ============================================================================================ shared list
async function listOf(
  caller: Caller,
  def: DocDef,
  table: string,
  q: {
    q?: string | undefined;
    status?: string | undefined;
    customerId?: string | undefined;
    page: number;
    size: number;
  },
) {
  const sc = await scopeSql(caller, def.pageId);
  const args = [...sc.args];
  const where = [sc.sql];
  if (q.q) {
    args.push(`%${q.q}%`);
    where.push(`t.number ILIKE $${args.length}`);
  }
  if (q.status) {
    args.push(q.status);
    where.push(`t.status = $${args.length}`);
  }
  if (q.customerId) {
    args.push(q.customerId);
    where.push(`t.customer_id = $${args.length}::uuid`);
  }
  const total = Number(
    (
      await query(
        prisma,
        `SELECT count(*)::int AS n FROM "${table}" t WHERE ${where.join(' AND ')}`,
        ...args,
      )
    )[0]?.n ?? 0,
  );
  const rows = await query(
    prisma,
    `SELECT t.*, c.name AS customer_name FROM "${table}" t JOIN customers c ON c.id=t.customer_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
    ...args,
  );
  return { rows: rows.map((r) => norm<Row>(r)), total };
}

export { makeCrud };
