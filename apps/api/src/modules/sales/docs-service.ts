// Phase 10 pre-sales and orders: customer RFQ with the internal engineering + finance review (client requirement 1),
// customer-wise quotation with revisions and the customer's decision, sales order with the credit check, and stock
// reservation for the order lines. Rates come from the Phase 6 price lists or from the person: never from code.
import { lineNoGstRate } from '../masters/party-rules';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import { reservationService } from '../inventory/reservations-service';
import { UomService } from '../inventory/uom/uom-service';
import { makeCrud } from '../procurement/crud';
import {
  TX,
  S,
  audit,
  exec,
  insertRow,
  loadDoc,
  loadLines,
  norm,
  query,
  registerDoc,
  todayIst,
  updateRow,
} from '../procurement/core';
import { unitState } from '../procurement/core';
import type { DocDef, Row } from '../procurement/core';
import { headerTotals, lineTax } from '../procurement/math';
import type { LineTax } from '../procurement/math';
import { resolveGstPct } from '../procurement/po-service';
import { pricingService } from '../masters/pricing-service';
import { creditExposure } from './crm-service';

export const CRFQ_DEF: DocDef = {
  pageId: 'sales-quotations',
  draftStatus: 'Received',
  table: 'customer_rfqs',
  title: 'Customer RFQ',
  amountCol: null,
  linesTable: 'customer_rfq_lines',
  parentCol: 'rfq_id',
};
export const SQ_DEF: DocDef = {
  pageId: 'sales-quotations',
  table: 'sales_quotations',
  title: 'Sales Quotation',
  amountCol: 'grand_total',
  linesTable: 'sales_quotation_lines',
  parentCol: 'quotation_id',
  async preLock(tx, id) {
    // submit gate: every line has a rate; a quotation from an RFQ needs the RFQ review to be complete
    const q = (
      await query(tx, `SELECT status, rfq_id FROM sales_quotations WHERE id=$1::uuid`, id)
    )[0];
    if (!q || (q.status !== 'Draft' && q.status !== 'Rejected')) return;
    const bad = (
      await query(
        tx,
        `SELECT 1 FROM sales_quotation_lines WHERE quotation_id=$1::uuid AND rate <= 0 LIMIT 1`,
        id,
      )
    )[0];
    if (bad) throw Errors.validation({ lines: 'Enter a rate on every line before submitting.' });
    if (q.rfq_id) {
      const r = (
        await query(tx, `SELECT status FROM customer_rfqs WHERE id=$1::uuid`, q.rfq_id)
      )[0];
      if (r?.status !== 'Reviewed' && r?.status !== 'Quoted')
        throw Errors.conflict(
          'The internal review of the customer RFQ (engineering and finance) is not complete.',
        );
    }
  },
};
export const SO_DEF: DocDef = {
  pageId: 'sales-orders',
  table: 'sales_orders',
  title: 'Sales Order',
  amountCol: 'grand_total',
  linesTable: 'sales_order_lines',
  parentCol: 'order_id',
  async preLock(tx, id) {
    // submit gate: customer active + approved, credit limit not exceeded (unless a credit override reason was recorded)
    const o = (
      await query(
        tx,
        `SELECT status, customer_id::text, grand_total::text, credit_override_reason FROM sales_orders WHERE id=$1::uuid`,
        id,
      )
    )[0];
    if (!o || (o.status !== 'Draft' && o.status !== 'Rejected')) return;
    const c = (
      await query(
        tx,
        `SELECT name, status, approval_status, credit_limit::text FROM customers WHERE id=$1::uuid`,
        o.customer_id,
      )
    )[0];
    if (!c || c.status !== 'ACTIVE' || c.approval_status !== 'APPROVED')
      throw new AppError(
        409,
        'CUSTOMER_NOT_APPROVED',
        `Customer ${S(c?.name)} is not active and approved.`,
      );
    if (c.credit_limit !== null && !o.credit_override_reason) {
      const exp = await creditExposure(tx, S(o.customer_id), id);
      const after = exp.total.plus(D(S(o.grand_total)));
      const limit = D(S(c.credit_limit));
      if (after.gt(limit))
        throw new AppError(
          409,
          'CREDIT_LIMIT_EXCEEDED',
          `Credit limit ₹${limit.toFixed(2)} of ${S(c.name)} would be exceeded by ₹${round2(after.minus(limit)).toFixed(2)} (unpaid ₹${exp.receivable.toFixed(2)}, open orders ₹${exp.openOrders.toFixed(2)}). Ask a manager for a credit override.`,
        );
    }
  },
};
registerDoc(SQ_DEF);
registerDoc(SO_DEF);

/** Fills hsn, rate (price list when none typed), GST, tax and totals for quotation / order lines. */
async function priceLines(
  tx: Db,
  customerId: string,
  unitId: string,
  date: string,
  lines: Row[],
  needItem: boolean,
) {
  const cust = (
    await query(
      tx,
      `SELECT state_code, status, approval_status FROM customers WHERE id=$1::uuid AND deleted_at IS NULL`,
      customerId,
    )
  )[0];
  if (!cust) throw Errors.validation({ customerId: 'Choose a customer.' });
  const intra = S(cust.state_code) === (await unitState(tx, unitId));
  const out: Row[] = [];
  const taxes: LineTax[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = { ...lines[i]! };
    const at = (f: string) => `lines.${i}.${f}`;
    const qty = D(S(l.qty ?? 0));
    if (qty.lte(0)) throw Errors.validation({ [at('qty')]: 'Enter a quantity greater than 0.' });
    if (needItem && !l.itemId) throw Errors.validation({ [at('itemId')]: 'Choose an item.' });
    let hsn: string | null = null;
    if (l.itemId) {
      const it = (
        await query(
          tx,
          `SELECT COALESCE(i.hsn_sac, h.code) AS hsn, i.base_uom FROM items i LEFT JOIN hsn_sac_codes h ON h.id=i.hsn_id WHERE i.id=$1::uuid AND i.deleted_at IS NULL`,
          l.itemId,
        )
      )[0];
      if (!it) throw Errors.validation({ [at('itemId')]: 'Choose an item.' });
      hsn = (it.hsn as string | null) ?? null;
      l.uom = l.uom ?? it.base_uom;
      await UomService.toBase(tx, { itemId: S(l.itemId), uom: S(l.uom), qty });
    } else l.uom = l.uom ?? 'Nos';
    if ((l.rate === undefined || l.rate === null || S(l.rate) === '') && l.itemId) {
      try {
        const p = await pricingService.lookup({
          customerId,
          itemId: S(l.itemId),
          qty: str(qty),
          uomCode: S(l.uom),
          date,
        });
        l.rate = p.rate;
        if (l.discountPct === undefined || l.discountPct === null) l.discountPct = p.discountPct;
      } catch {
        l.rate = '0'; // no price found: the person types one before submitting
      }
    }
    l.rate = S(l.rate ?? '0');
    let gst = l.gstPct === undefined || l.gstPct === null ? null : S(l.gstPct);
    if (gst === null) gst = await resolveGstPct(tx, hsn, date);
    if (gst === null)
      throw Errors.validation({
        [at('gstPct')]: lineNoGstRate(hsn),
      });
    const t = lineTax({
      qty,
      rate: D(S(l.rate)),
      discountPct: D(S(l.discountPct ?? 0)),
      gstPct: D(gst),
      intra,
    });
    taxes.push(t);
    out.push({
      ...l,
      hsnSac: hsn,
      gstPct: gst,
      discountPct: S(l.discountPct ?? 0),
      taxable: str(t.taxable),
    });
  }
  const h = headerTotals(taxes);
  return {
    lines: out,
    totals: {
      regime: intra ? 'INTRA' : 'INTER',
      taxable: str(h.taxable),
      cgst: str(h.cgst),
      sgst: str(h.sgst),
      igst: str(h.igst),
      roundOff: str(h.roundOff),
      grandTotal: str(h.grand),
    },
    taxable: h.taxable,
  };
}

// ---------------------------------------------------------------------------------------------- customer RFQ
export const rfqCrud = makeCrud({
  hasCustomer: true,
  def: CRFQ_DEF,
  headerKeys: [
    'customerId',
    'opportunityId',
    'customerRef',
    'receivedOn',
    'requiredBy',
    'description',
    'estimatedValue',
  ],
  lineKeys: ['itemId', 'description', 'partNo', 'qty', 'uom', 'targetRate'],
  series: 'sales-rfq',
  canEdit: (r) => r.status === 'Received' || r.status === 'In review',
  prepare(c) {
    c.lines.forEach((l, i) => {
      if (D(S(l.qty ?? 0)).lte(0))
        throw Errors.validation({ [`lines.${i}.qty`]: 'Enter a quantity greater than 0.' });
      if (!l.itemId && !l.description)
        throw Errors.validation({
          [`lines.${i}.description`]: 'Choose an item or describe the part.',
        });
    });
    return { header: c.header, lines: c.lines };
  },
});

export const rfqActions = {
  /** Engineering: feasible or not. Not feasible closes the RFQ. */
  async engineeringReview(caller: Caller, id: string, b: { feasible: boolean; note: string }) {
    if (b.note.trim().length < 3) throw Errors.validation({ note: 'Write the engineering note.' });
    await prisma.$transaction(async (tx) => {
      const r = await loadDoc(tx, caller, CRFQ_DEF, id, { lock: true });
      if (r.status !== 'Received' && r.status !== 'In review')
        throw Errors.conflict(`A ${S(r.status)} RFQ cannot be reviewed again.`);
      const done = !!r.finance_by_id;
      const status = !b.feasible ? 'Not feasible' : done ? 'Reviewed' : 'In review';
      await exec(
        tx,
        `UPDATE customer_rfqs SET feasibility=$2, engineering_note=$3, engineering_by_id=$4::uuid, status=$5, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        b.feasible ? 'FEASIBLE' : 'NOT_FEASIBLE',
        b.note.trim(),
        caller.auth.userId,
        status,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        CRFQ_DEF.title,
        { id, code: S(r.number) },
        CRFQ_DEF.pageId,
        { engineering: b.feasible },
      );
    }, TX);
    return rfqCrud.get(caller, id);
  },
  /** Finance: expected margin and a note. Needs a feasible RFQ. */
  async financeReview(caller: Caller, id: string, b: { marginPct: string; note: string }) {
    if (b.note.trim().length < 3) throw Errors.validation({ note: 'Write the finance note.' });
    await prisma.$transaction(async (tx) => {
      const r = await loadDoc(tx, caller, CRFQ_DEF, id, { lock: true });
      if (r.status !== 'Received' && r.status !== 'In review')
        throw Errors.conflict(`A ${S(r.status)} RFQ cannot be reviewed again.`);
      if (r.feasibility === 'NOT_FEASIBLE')
        throw Errors.conflict('Engineering marked this RFQ as not feasible.');
      const status = r.feasibility === 'FEASIBLE' ? 'Reviewed' : 'In review';
      await exec(
        tx,
        `UPDATE customer_rfqs SET finance_margin_pct=$2::numeric, finance_note=$3, finance_by_id=$4::uuid, status=$5, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        b.marginPct,
        b.note.trim(),
        caller.auth.userId,
        status,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        CRFQ_DEF.title,
        { id, code: S(r.number) },
        CRFQ_DEF.pageId,
        { financeMargin: b.marginPct },
      );
    }, TX);
    return rfqCrud.get(caller, id);
  },
  /** Reviewed RFQ -> draft quotation (rates from price lists or the customer's target, else typed later). */
  async toQuotation(caller: Caller, id: string, b: { gstPct?: string | undefined } = {}) {
    const r = await rfqCrud.get(caller, id);
    if (r.status !== 'Reviewed')
      throw Errors.conflict('Complete the engineering and finance review first.');
    // claim the RFQ first: of two clicks only one gets the row, and a failure gives it back
    const claimed = await query(
      prisma,
      `UPDATE customer_rfqs SET status='Quoted', version=version+1, updated_by_id=$2::uuid, updated_at=now() WHERE id=$1::uuid AND status='Reviewed' RETURNING id`,
      id,
      caller.auth.userId,
    );
    if (!claimed[0]) throw Errors.conflict('A quotation is already being made from this RFQ.');
    const q = await quotationCrud
      .create(caller, {
        header: {
          customerId: r.customerId,
          rfqId: id,
          opportunityId: r.opportunityId ?? null,
          notes: `From customer RFQ ${S(r.customerRef ?? r.number)}`,
          marginPct: r.financeMarginPct ?? null,
        },
        lines: r.lines.map((l) => ({
          itemId: l.itemId ?? null,
          description: l.description,
          partNo: l.partNo,
          qty: l.qty,
          uom: l.uom,
          rate: l.targetRate ?? undefined,
          ...(b.gstPct !== undefined ? { gstPct: b.gstPct } : {}),
        })),
      })
      .catch(async (err: unknown) => {
        await exec(prisma, `UPDATE customer_rfqs SET status='Reviewed' WHERE id=$1::uuid`, id);
        throw err;
      });
    return q;
  },
};

// ---------------------------------------------------------------------------------------------- quotation
export const quotationCrud = makeCrud({
  hasCustomer: true,
  def: SQ_DEF,
  headerKeys: [
    'customerId',
    'rfqId',
    'opportunityId',
    'quoteDate',
    'validUntil',
    'formatCode',
    'paymentTermId',
    'priceListId',
    'marginPct',
    'customerRef',
    'notes',
  ],
  lineKeys: [
    'itemId',
    'description',
    'partNo',
    'qty',
    'uom',
    'rate',
    'discountPct',
    'gstPct',
    'unitCost',
    'costBreakup',
    'leadDays',
  ],
  hasSupplier: false,
  async prepare(c) {
    const customerId = S(c.header.customerId ?? c.existing?.customer_id);
    if (!customerId) throw Errors.validation({ customerId: 'Choose a customer.' });
    const date = S(c.header.quoteDate ?? c.existing?.quote_date ?? todayIst());
    const p = await priceLines(c.tx, customerId, c.unitId, date, c.lines, false);
    // margin from the cost the sales person entered (the cost formulas are Phase 6B rule sets, not code)
    const costed = p.lines.filter(
      (l) => l.unitCost !== undefined && l.unitCost !== null && S(l.unitCost) !== '',
    );
    let margin: string | null = null;
    if (costed.length) {
      const rev = costed.reduce((a, l) => a.plus(D(S(l.taxable))), ZERO);
      const cost = costed.reduce((a, l) => a.plus(D(S(l.unitCost)).mul(D(S(l.qty)))), ZERO);
      if (rev.gt(0)) margin = str(rev.minus(cost).div(rev).mul(100).toDecimalPlaces(4));
    }
    return {
      header: { ...c.header, ...p.totals, ...(margin !== null ? { marginPct: margin } : {}) },
      lines: p.lines,
    };
  },
});
export const quotationActions = {
  async revise(caller: Caller, id: string, reason: string) {
    if (reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    await prisma.$transaction(async (tx) => {
      const q = await loadDoc(tx, caller, SQ_DEF, id, { lock: true });
      if (!['Approved', 'Rejected'].includes(S(q.status)))
        throw Errors.conflict('Only an approved or rejected quotation can be revised.');
      if (q.customer_status === 'ACCEPTED')
        throw Errors.conflict('The customer already accepted this quotation.');
      const used = (
        await query(
          tx,
          `SELECT 1 FROM sales_orders WHERE quotation_id=$1::uuid AND status <> 'Cancelled' AND deleted_at IS NULL LIMIT 1`,
          id,
        )
      )[0];
      if (used) throw Errors.conflict('A sales order was made from this quotation.');
      const snap = {
        header: norm(q),
        lines: (await loadLines(tx, SQ_DEF, id)).map((l) => norm(l)),
      };
      await insertRow(tx, 'sales_quotation_revisions', {
        quotationId: id,
        revisionNo: q.revision_no,
        snapshot: snap,
        reason: reason.trim(),
        createdById: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE sales_quotations SET status='Draft', revision_no=revision_no+1, customer_status='PENDING', version=version+1, updated_by_id=$2::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        SQ_DEF.title,
        { id, code: S(q.number) },
        SQ_DEF.pageId,
        { revise: reason },
      );
    }, TX);
    return quotationCrud.get(caller, id);
  },
  async revisions(caller: Caller, id: string) {
    await loadDoc(prisma, caller, SQ_DEF, id);
    return (
      await query(
        prisma,
        `SELECT * FROM sales_quotation_revisions WHERE quotation_id=$1::uuid ORDER BY revision_no`,
        id,
      )
    ).map((r) => norm<Row>(r));
  },
  async customerDecision(
    caller: Caller,
    id: string,
    b: { decision: 'ACCEPTED' | 'REJECTED'; customerRef?: string; decidedOn?: string },
  ) {
    await prisma.$transaction(async (tx) => {
      const q = await loadDoc(tx, caller, SQ_DEF, id, { lock: true });
      if (q.status !== 'Approved')
        throw Errors.conflict(
          'The quotation must be approved internally before the customer decides.',
        );
      if (q.customer_status !== 'PENDING')
        throw Errors.conflict(
          `The customer already ${S(q.customer_status).toLowerCase()} this quotation.`,
        );
      if (q.valid_until && S(norm<Row>(q).validUntil) < todayIst() && b.decision === 'ACCEPTED')
        throw Errors.conflict('This quotation has expired. Revise it first.');
      await exec(
        tx,
        `UPDATE sales_quotations SET customer_status=$2, customer_ref=COALESCE($3, customer_ref), decided_on=$4::date, version=version+1, updated_by_id=$5::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        b.decision,
        b.customerRef ?? null,
        b.decidedOn ?? todayIst(),
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        SQ_DEF.title,
        { id, code: S(q.number) },
        SQ_DEF.pageId,
        { customerDecision: b.decision },
      );
    }, TX);
    return quotationCrud.get(caller, id);
  },
  /** Accepted quotation -> sales order draft (one live order per quotation). */
  async toOrder(
    caller: Caller,
    id: string,
    b: { customerPoNo?: string; customerPoDate?: string; deliveryDate?: string },
  ) {
    const q = await quotationCrud.get(caller, id);
    if (q.status !== 'Approved' || q.customerStatus !== 'ACCEPTED')
      throw Errors.conflict('The customer must accept an approved quotation first.');
    const dup = (
      await query(
        prisma,
        `SELECT number FROM sales_orders WHERE quotation_id=$1::uuid AND status <> 'Cancelled' AND deleted_at IS NULL LIMIT 1`,
        id,
      )
    )[0];
    if (dup)
      throw Errors.conflict(`Sales order ${S(dup.number)} was already made from this quotation.`);
    if (q.lines.some((l) => !l.itemId))
      throw Errors.validation({ lines: 'Every line needs an item before it becomes an order.' });
    return orderCrud.create(caller, {
      header: {
        customerId: q.customerId,
        quotationId: id,
        paymentTermId: q.paymentTermId ?? null,
        customerPoNo: b.customerPoNo ?? null,
        customerPoDate: b.customerPoDate ?? null,
        deliveryDate: b.deliveryDate ?? null,
      },
      lines: q.lines.map((l) => ({
        itemId: l.itemId,
        description: l.description,
        partNo: l.partNo,
        qty: l.qty,
        uom: l.uom,
        rate: l.rate,
        discountPct: l.discountPct,
        gstPct: l.gstPct,
        deliveryDate: b.deliveryDate ?? null,
      })),
    });
  },
};

// ---------------------------------------------------------------------------------------------- order
export const orderCrud = makeCrud({
  hasCustomer: true,
  def: SO_DEF,
  headerKeys: [
    'customerId',
    'quotationId',
    'customerPoNo',
    'customerPoDate',
    'orderDate',
    'deliveryDate',
    'shipTo',
    'paymentTermId',
    'notes',
  ],
  lineKeys: [
    'itemId',
    'description',
    'partNo',
    'colour',
    'qty',
    'uom',
    'rate',
    'discountPct',
    'gstPct',
    'deliveryDate',
    'warehouseId',
  ],
  async prepare(c) {
    const customerId = S(c.header.customerId ?? c.existing?.customer_id);
    if (!customerId) throw Errors.validation({ customerId: 'Choose a customer.' });
    const date = S(c.header.orderDate ?? c.existing?.order_date ?? todayIst());
    const p = await priceLines(c.tx, customerId, c.unitId, date, c.lines, true);
    p.lines.forEach((l, i) => {
      if (D(S(l.rate ?? 0)).lte(0))
        throw Errors.validation({
          [`lines.${i}.rate`]: 'Enter a rate: no price list price was found.',
        });
    });
    return {
      header: { ...c.header, ...p.totals, ...(c.existing ? { creditOverrideReason: null } : {}) },
      lines: p.lines,
    };
  },
  async saveLines(c) {
    // lines carry dispatch counters, so an order is edited line by line (ids kept) while still a draft
    const existing = await query(
      c.tx,
      `SELECT id::text FROM sales_order_lines WHERE order_id=$1::uuid`,
      c.id,
    );
    if (existing.length)
      await exec(c.tx, `DELETE FROM sales_order_lines WHERE order_id=$1::uuid`, c.id);
    let n = 0;
    for (const l of c.lines) {
      n += 1;
      await insertRow(c.tx, 'sales_order_lines', { ...l, orderId: c.id, lineNo: n });
    }
  },
});

export const orderActions = {
  /** Manager override of the credit check (needs `approve`; the reason is audited). */
  async creditOverride(caller: Caller, id: string, reason: string) {
    if (reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    await prisma.$transaction(async (tx) => {
      const o = await loadDoc(tx, caller, SO_DEF, id, { lock: true });
      if (o.status !== 'Draft' && o.status !== 'Rejected')
        throw Errors.conflict('Only a draft order can get a credit override.');
      await exec(
        tx,
        `UPDATE sales_orders SET credit_override_reason=$2, version=version+1, updated_by_id=$3::uuid, updated_at=now() WHERE id=$1::uuid`,
        id,
        reason.trim(),
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        SO_DEF.title,
        { id, code: S(o.number) },
        SO_DEF.pageId,
        { creditOverride: reason.trim() },
      );
    }, TX);
    return orderCrud.get(caller, id);
  },
  /** Reserve stock for the open quantity of the lines (Phase 8 reservations; priority from the body). */
  async reserve(
    caller: Caller,
    id: string,
    b: { warehouseId?: string; priority?: 'Critical' | 'High' | 'Medium' | 'Low' },
  ) {
    const o = await loadDoc(prisma, caller, SO_DEF, id);
    if (o.status !== 'Approved') throw Errors.conflict('Approve the order before reserving stock.');
    const lines = await loadLines(prisma, SO_DEF, id);
    let made = 0;
    for (const l of lines) {
      const n = norm<Row>(l);
      const open = D(S(n.qty))
        .minus(D(S(n.dispatchedQty)))
        .minus(D(S(n.closedQty)))
        .minus(D(S(n.reservedQty)));
      const wh = S(n.warehouseId) || b.warehouseId;
      if (open.lte(0) || !wh) continue;
      const base = (
        await UomService.toBase(prisma, { itemId: S(n.itemId), uom: S(n.uom), qty: open })
      ).baseQty;
      const res = await reservationService.create(caller, {
        itemId: S(n.itemId),
        warehouseId: wh,
        requiredQty: str(base),
        priority: b.priority ?? 'Medium',
        demandType: 'SALES_ORDER',
        demandRef: S(o.number),
      });
      await exec(
        prisma,
        `UPDATE sales_order_lines SET reserved_qty = reserved_qty + $2::numeric, reservation_id = $3::uuid, warehouse_id = COALESCE(warehouse_id, $4::uuid) WHERE id=$1::uuid`,
        S(n.id),
        str(open),
        S((res as { id: string }).id),
        wh,
      );
      made += 1;
    }
    if (made === 0)
      throw Errors.validation({
        warehouseId:
          'Nothing to reserve: choose a warehouse or the lines are fully reserved / dispatched.',
      });
    return orderCrud.get(caller, id);
  },
  async closeLines(caller: Caller, id: string, b: { lineIds?: string[]; reason: string }) {
    if (b.reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    await prisma.$transaction(async (tx) => {
      const o = await loadDoc(tx, caller, SO_DEF, id, { lock: true });
      if (o.status !== 'Approved')
        throw Errors.conflict('Only an approved order can be short-closed.');
      for (const l of await query(
        tx,
        `SELECT id::text, qty::text, dispatched_qty::text, closed_qty::text FROM sales_order_lines WHERE order_id=$1::uuid FOR UPDATE`,
        id,
      )) {
        if (b.lineIds && !b.lineIds.includes(S(l.id))) continue;
        const bal = D(S(l.qty)).minus(D(S(l.dispatched_qty)));
        if (bal.gt(0))
          await exec(
            tx,
            `UPDATE sales_order_lines SET closed_qty=$2::numeric WHERE id=$1::uuid`,
            S(l.id),
            str(bal),
          );
        if (bal.gt(0)) {
          const res = (
            await query(
              tx,
              `SELECT reservation_id::text FROM sales_order_lines WHERE id=$1::uuid`,
              S(l.id),
            )
          )[0];
          if (res?.reservation_id) {
            await reservationService.end(
              tx,
              S(res.reservation_id),
              'Released',
              'Order short-closed',
              caller.auth.userId,
            );
            await exec(
              tx,
              `UPDATE sales_order_lines SET reserved_qty = 0, reservation_id = NULL WHERE id=$1::uuid`,
              S(l.id),
            );
          }
        }
      }
      const open = Number(
        (
          await query(
            tx,
            `SELECT count(*)::int AS n FROM sales_order_lines WHERE order_id=$1::uuid AND qty - dispatched_qty - closed_qty > 0`,
            id,
          )
        )[0]?.n ?? 0,
      );
      if (open === 0)
        await exec(tx, `UPDATE sales_orders SET closed_at=now() WHERE id=$1::uuid`, id);
      await exec(tx, `UPDATE sales_orders SET version=version+1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        SO_DEF.title,
        { id, code: S(o.number) },
        SO_DEF.pageId,
        { shortClose: b.reason },
      );
    }, TX);
    return orderCrud.get(caller, id);
  },
};

export { updateRow };
