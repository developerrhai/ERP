// Phase 9: purchase requisition -> RFQ -> vendor quote -> comparison, and rate / blanket contracts.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import { makeCrud } from './crud';
import {
  TX,
  allocateNumber,
  audit,
  departmentOf,
  exec,
  insertRow,
  loadDoc,
  loadLines,
  loadSupplier,
  assertBuyable,
  norm,
  query,
  registerDoc,
  setStatus,
  settings,
  updateRow,
  fyOfCaller,
  todayIst,
} from './core';
import { S } from './core';
import type { DocDef, Row } from './core';
import { concreteUnit } from '../inventory/typed';
import { lineTax } from './math';
import { REF_KEYS, commonPairs, prepareRefs, refLabels, referenceList, refsOf } from './profile';

// ---------------------------------------------------------------------------------------------------- defs
export const PR_DEF: DocDef = {
  pageId: 'scm-pr',
  table: 'purchase_requisitions',
  title: 'Purchase Requisition',
  amountCol: 'estimated_total',
  preLock: async (tx, id) => {
    const r = (
      await query(
        tx,
        `SELECT unit_id::text, fy_id::text, status FROM purchase_requisitions WHERE id=$1::uuid`,
        id,
      )
    )[0];
    if (r && (r.status === 'Draft' || r.status === 'Rejected'))
      await prBudgetCheck(tx, S(r.unit_id), S(r.fy_id), id); // BLOCK mode refuses the submit
  },
  linesTable: 'purchase_requisition_lines',
  parentCol: 'pr_id',
};
export const RFQ_DEF: DocDef = {
  pageId: 'scm-rfq',
  table: 'rfqs',
  title: 'RFQ',
  amountCol: null,
  linesTable: 'rfq_lines',
  parentCol: 'rfq_id',
};
export const VQ_DEF: DocDef = {
  pageId: 'scm-vendorquote',
  table: 'vendor_quotes',
  title: 'Vendor Quotation',
  amountCol: 'total',
  linesTable: 'vendor_quote_lines',
  parentCol: 'quote_id',
};
export const CMP_DEF: DocDef = {
  pageId: 'scm-comparison',
  table: 'vendor_comparisons',
  title: 'Vendor Comparison',
  amountCol: null,
  linesTable: 'comparison_entries',
  parentCol: 'comparison_id',
  preLock: async (tx, id) => {
    const r = (await query(tx, `SELECT status FROM vendor_comparisons WHERE id=$1::uuid`, id))[0];
    if (!r || (r.status !== 'Draft' && r.status !== 'Rejected')) return;
    await refreshEntries(tx, id); // quotes may have been added or changed since the sheet was made
    if (!(await query(tx, `SELECT 1 FROM comparison_entries WHERE comparison_id=$1::uuid LIMIT 1`, id))[0])
      throw Errors.conflict('There is no vendor quotation to compare yet. Enter the quotations of this RFQ first.');
  },
};
export const CON_DEF: DocDef = {
  pageId: 'scm-contracts',
  table: 'purchase_contracts',
  title: 'Rate Contract',
  amountCol: 'max_value',
  linesTable: 'purchase_contract_lines',
  parentCol: 'contract_id',
};
for (const d of [PR_DEF, RFQ_DEF, VQ_DEF, CMP_DEF, CON_DEF]) registerDoc(d);

const itemOrText = (l: Row, n: number): void => {
  if (!l.itemId && !l.serviceText)
    throw Errors.validation({ [`lines.${n}.itemId`]: 'Choose an item or describe the service.' });
  if (D(S(l.qty ?? 0)).lte(0))
    throw Errors.validation({ [`lines.${n}.qty`]: 'Enter a quantity greater than 0.' });
};

/** The references of the source document fill whatever the form left empty. */
const inherit = (header: Row, from: Row): Row => ({
  ...header,
  ...Object.fromEntries(Object.entries(from).filter(([k]) => header[k] === undefined || header[k] === null || header[k] === '')),
});

// ---------------------------------------------------------------------------------------------------- PR
export const prCrud = makeCrud({
  def: PR_DEF,
  headerKeys: [
    'requiredDate',
    'requestedById',
    'supplierType',
    'purpose',
    'prDate',
    'priority',
    'requestDepartment',
    'preferredSupplierId',
    'productionPlanId',
    'mrpLineNo',
    ...REF_KEYS,
  ],
  lineKeys: ['itemId', 'serviceText', 'qty', 'uom', 'estRate', 'costCenterId', 'requiredDate'],
  async prepare(c) {
    let total = ZERO;
    c.lines.forEach((l, i) => {
      itemOrText(l, i);
      total = total.plus(round2(D(S(l.qty)).mul(D(S(l.estRate ?? 0)))));
    });
    const header = await prepareRefs(c.tx, c.caller, c.header, c.existing);
    if (!c.existing) {
      header.prDate = header.prDate ?? todayIst();
      header.requestedById = header.requestedById ?? c.caller.auth.userId;
    }
    return { header: { ...header, estimatedTotal: str(total) }, lines: c.lines };
  },
  async decorate(db, row) {
    const l = await refLabels(db, row);
    const po = await query(
      db,
      `SELECT string_agg(DISTINCT po.number, ', ') AS numbers FROM document_links d JOIN purchase_orders po ON po.id = d.to_id
        WHERE d.from_type = 'PR' AND d.from_id = $1::uuid AND d.to_type = 'PO'`,
      row.id,
    );
    return {
      ...l,
      references: referenceList([
        ['Approval Status', row.status],
        ['Priority', row.priority],
        ['Department', row.request_department ?? row.department],
        ['Requester', l.requesterName],
        ['Preferred Vendor', l.preferredSupplierName],
        ['Production Plan', l.productionPlanNo],
        ['PO Number', po[0]?.numbers],
        ...commonPairs(l),
      ]),
    };
  },
});

/** Budget check per cost centre. Mode OFF (default) does nothing; WARN returns the message; BLOCK refuses. */
export async function prBudgetCheck(
  db: Db,
  unitId: string,
  fyId: string,
  prId: string,
): Promise<string[]> {
  const rows = await query(
    db,
    `SELECT b.cost_center_id::text AS cc, b.amount::text AS budget, b.mode,
            COALESCE((SELECT sum(l.qty * l.est_rate) FROM purchase_requisition_lines l
                        JOIN purchase_requisitions p ON p.id = l.pr_id
                       WHERE l.cost_center_id = b.cost_center_id AND p.unit_id = b.unit_id AND p.fy_id = b.fy_id
                         AND p.deleted_at IS NULL AND p.status IN ('Pending Approval','Approved','Posted')),0)::text AS committed,
            COALESCE((SELECT sum(l.qty * l.est_rate) FROM purchase_requisition_lines l WHERE l.pr_id = $3::uuid AND l.cost_center_id = b.cost_center_id),0)::text AS this_pr
       FROM scm_budgets b WHERE b.unit_id = $1::uuid AND b.fy_id = $2::uuid AND b.mode <> 'OFF'`,
    unitId,
    fyId,
    prId,
  );
  const msgs: string[] = [];
  for (const r of rows) {
    const over = D(S(r.committed))
      .plus(D(S(r.this_pr)))
      .minus(D(S(r.budget)));
    if (D(S(r.this_pr)).gt(0) && over.gt(0)) {
      const m = `The purchase budget of this cost centre is exceeded by ₹ ${round2(over).toFixed(2)}.`;
      if (r.mode === 'BLOCK') throw new AppError(409, 'BUDGET_EXCEEDED', m);
      msgs.push(m);
    }
  }
  return msgs;
}

export const prActions = {
  async closeLines(caller: Caller, id: string, body: { lines: { lineId: string; qty: string }[] }) {
    return prisma.$transaction(async (tx) => {
      const pr = await loadDoc(tx, caller, PR_DEF, id, { lock: true });
      if (pr.status !== 'Approved')
        throw Errors.conflict('Only an Approved requisition can be closed.');
      for (const x of body.lines) {
        const l = (
          await query(
            tx,
            `SELECT id, qty::text, closed_qty::text FROM purchase_requisition_lines WHERE id=$1::uuid AND pr_id=$2::uuid FOR UPDATE`,
            x.lineId,
            id,
          )
        )[0];
        if (!l) throw Errors.notFound('Requisition line not found.');
        const open = D(S(l.qty)).minus(D(S(l.closed_qty)));
        if (D(x.qty).gt(open))
          throw new AppError(
            409,
            'QUANTITY_EXCEEDS_OPEN',
            `Only ${open.toFixed()} left on ${S(pr.number)} line.`,
          );
        await exec(
          tx,
          `UPDATE purchase_requisition_lines SET closed_qty = closed_qty + $1::numeric WHERE id = $2::uuid`,
          x.qty,
          x.lineId,
        );
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        PR_DEF.title,
        { id, code: S(pr.number) },
        PR_DEF.pageId,
        { closeLines: body.lines.length },
      );
      return prCrud.getIn(tx, caller, id);
    }, TX);
  },

  /** Open quantity of an Approved PR line = qty - closed (PO / RFQ conversions use document_links on top). */
  async openQty(tx: Db, lineId: string): Promise<ReturnType<typeof D>> {
    const r = (
      await query(
        tx,
        `SELECT l.qty::text, l.closed_qty::text,
        COALESCE((SELECT sum(qty) FROM document_links d WHERE d.from_type='PR' AND d.from_line_id=l.id AND d.to_type='PO'),0)::text AS ordered
        FROM purchase_requisition_lines l WHERE l.id=$1::uuid`,
        lineId,
      )
    )[0];
    if (!r) throw Errors.notFound('Requisition line not found.');
    return D(S(r.qty))
      .minus(D(S(r.closed_qty)))
      .minus(D(S(r.ordered)));
  },

  async toRfq(caller: Caller, id: string, body: { lineIds?: string[]; dueDate?: string }) {
    const unitId = concreteUnit(caller);
    const fy = await fyOfCaller(caller);
    return prisma.$transaction(async (tx) => {
      const pr = await loadDoc(tx, caller, PR_DEF, id, { lock: true });
      if (pr.status !== 'Approved')
        throw Errors.conflict('Approve the requisition before asking suppliers for quotes.');
      const lines = (await loadLines(tx, PR_DEF, id)).filter(
        (l) => !body.lineIds || body.lineIds.includes(S(l.id)),
      );
      if (lines.length === 0) throw Errors.validation({ lineIds: 'Choose at least one line.' });
      const number = await allocateNumber(tx, RFQ_DEF, unitId, fy.id);
      const rfqId = await insertRow(tx, 'rfqs', {
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, RFQ_DEF.pageId, caller),
        status: 'Draft',
        supplierType: pr.supplier_type,
        dueDate: body.dueDate ?? null,
        prId: id,
        buyerId: caller.auth.userId,
        ...refsOf(pr),
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      let n = 0;
      for (const l of lines) {
        const open = await prActions.openQty(tx, S(l.id));
        if (open.lte(0))
          throw new AppError(
            409,
            'QUANTITY_EXCEEDS_OPEN',
            `Only 0 left on ${S(pr.number)} line ${S(l.line_no)}.`,
          );
        n += 1;
        const rl = await insertRow(tx, 'rfq_lines', {
          rfqId,
          lineNo: n,
          prLineId: l.id,
          itemId: l.item_id,
          serviceText: l.service_text,
          qty: open.toFixed(),
          uom: l.uom,
          requiredDate: l.required_date,
        });
        await insertRow(tx, 'document_links', {
          fromType: 'PR',
          fromId: id,
          fromLineId: l.id,
          toType: 'RFQ',
          toId: rfqId,
          toLineId: rl,
          qty: open.toFixed(),
          createdById: caller.auth.userId,
        });
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_CREATED',
        RFQ_DEF.title,
        { id: rfqId, code: number },
        RFQ_DEF.pageId,
        { fromPr: S(pr.number) },
      );
      return rfqCrud.getIn(tx, caller, rfqId);
    }, TX);
  },
};

// ---------------------------------------------------------------------------------------------------- RFQ
export const rfqCrud = makeCrud({
  def: RFQ_DEF,
  headerKeys: [
    'issueDate',
    'dueDate',
    'supplierType',
    'notes',
    'prId',
    'buyerId',
    'category',
    'technicalSpec',
    'commercialTerms',
    'deliveryLocation',
    'validity',
    ...REF_KEYS,
  ],
  lineKeys: ['prLineId', 'itemId', 'serviceText', 'qty', 'uom', 'requiredDate'],
  async prepare(c) {
    c.lines.forEach((l, i) => itemOrText(l, i));
    const header = await prepareRefs(c.tx, c.caller, c.header, c.existing);
    if (!c.existing) header.buyerId = header.buyerId ?? c.caller.auth.userId;
    return { header, lines: c.lines };
  },
  async decorate(db, row) {
    const l = await refLabels(db, { ...row, buyer_id: row.buyer_id ?? row.created_by_id });
    const r = (
      await query(
        db,
        `SELECT (SELECT string_agg(DISTINCT p.number, ', ') FROM purchase_requisitions p
                   WHERE p.id = $2::uuid OR p.id IN (SELECT prl.pr_id FROM rfq_lines rl JOIN purchase_requisition_lines prl ON prl.id = rl.pr_line_id WHERE rl.rfq_id = $1::uuid)) AS pr_numbers,
                (SELECT count(*)::int FROM rfq_suppliers WHERE rfq_id = $1::uuid) AS vendor_count,
                (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM rfq_suppliers rs JOIN suppliers s ON s.id = rs.supplier_id WHERE rs.rfq_id = $1::uuid) AS suppliers,
                (SELECT count(*)::int FROM vendor_quotes q WHERE q.rfq_id = $1::uuid AND q.is_current AND q.deleted_at IS NULL) AS quotes`,
        row.id,
        row.pr_id ?? null,
      )
    )[0]!;
    return {
      ...l,
      references: referenceList([
        ['PR Number', r.pr_numbers],
        ['Buyer', l.buyerName],
        ['Vendor Count', r.vendor_count],
        ['Invited Suppliers', r.suppliers],
        ['Quotations Received', r.quotes],
        ...commonPairs(l),
      ]),
    };
  },
});
export const rfqActions = {
  async invite(caller: Caller, id: string, supplierIds: string[]) {
    return prisma.$transaction(async (tx) => {
      const rfq = await loadDoc(tx, caller, RFQ_DEF, id, { lock: true });
      if (rfq.status === 'Cancelled') throw Errors.conflict('This RFQ is cancelled.');
      for (const sid of supplierIds) {
        assertBuyable(await loadSupplier(tx, sid));
        const type = (
          await query(tx, `SELECT supplier_type FROM suppliers WHERE id=$1::uuid`, sid)
        )[0]?.supplier_type;
        if (type !== rfq.supplier_type)
          throw Errors.validation({
            supplierIds: `This RFQ is for ${S(rfq.supplier_type).toLowerCase()} suppliers only.`,
          });
        await exec(
          tx,
          `INSERT INTO rfq_suppliers (rfq_id, supplier_id, invited_at) VALUES ($1::uuid,$2::uuid, $3::timestamptz) ON CONFLICT (rfq_id, supplier_id) DO NOTHING`,
          id,
          sid,
          rfq.issued_at ? new Date() : null,
        );
      }
      return rfqCrud.getIn(tx, caller, id);
    }, TX);
  },
  async issue(caller: Caller, id: string) {
    return prisma.$transaction(async (tx) => {
      const rfq = await loadDoc(tx, caller, RFQ_DEF, id, { lock: true });
      if (rfq.status !== 'Approved') throw Errors.conflict('Approve the RFQ before issuing it.');
      if (rfq.issued_at) throw Errors.conflict('This RFQ was already issued.');
      const n = Number(
        (
          await query(tx, `SELECT count(*)::int AS n FROM rfq_suppliers WHERE rfq_id=$1::uuid`, id)
        )[0]?.n ?? 0,
      );
      if (n < 1) throw Errors.validation({ suppliers: 'Invite at least one supplier first.' });
      await updateRow(tx, 'rfqs', id, {
        issuedAt: new Date(),
        issueDate: rfq.issue_date ?? new Date().toISOString().slice(0, 10),
        updatedById: caller.auth.userId,
      });
      await exec(
        tx,
        `UPDATE rfq_suppliers SET invited_at = now() WHERE rfq_id = $1::uuid AND invited_at IS NULL`,
        id,
      );
      await exec(tx, `UPDATE rfqs SET version = version + 1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_POSTED',
        RFQ_DEF.title,
        { id, code: S(rfq.number) },
        RFQ_DEF.pageId,
        { issued: true, suppliers: n },
      );
      return rfqCrud.getIn(tx, caller, id);
    }, TX);
  },
  async extend(caller: Caller, id: string, dueDate: string) {
    return prisma.$transaction(async (tx) => {
      const rfq = await loadDoc(tx, caller, RFQ_DEF, id, { lock: true });
      if (!rfq.issued_at) throw Errors.conflict('Issue the RFQ first.');
      if (rfq.due_date && dueDate <= S(rfq.due_date))
        throw Errors.validation({ dueDate: 'Choose a date after the current due date.' });
      await updateRow(tx, 'rfqs', id, { dueDate, updatedById: caller.auth.userId });
      await exec(tx, `UPDATE rfqs SET version = version + 1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        RFQ_DEF.title,
        { id, code: S(rfq.number) },
        RFQ_DEF.pageId,
        { extendedTo: dueDate },
      );
      return rfqCrud.getIn(tx, caller, id);
    }, TX);
  },
};

// ---------------------------------------------------------------------------------------------------- vendor quote
export const vqCrud = makeCrud({
  def: VQ_DEF,
  hasSupplier: true,
  headerKeys: [
    'rfqId',
    'supplierId',
    'quoteDate',
    'validUntil',
    'paymentTermId',
    'freight',
    'otherCharges',
    'technicalCompliance',
    'notes',
    'warranty',
    'complianceNote',
    ...REF_KEYS,
    'projectId',
  ],
  lineKeys: [
    'rfqLineId',
    'itemId',
    'qty',
    'uom',
    'rate',
    'discountPct',
    'gstPct',
    'leadDays',
    'landedCost',
    'costBreakup',
  ],
  async prepare(c) {
    if (c.header.supplierId) assertBuyable(await loadSupplier(c.tx, S(c.header.supplierId)));
    let header = c.header;
    // a quotation of an RFQ is about the same order, customer and project, unless the form says otherwise
    if (!c.existing && header.rfqId) {
      const rfq = (await query(c.tx, `SELECT * FROM rfqs WHERE id = $1::uuid`, header.rfqId))[0];
      if (rfq) header = inherit(header, refsOf(rfq));
    }
    header = await prepareRefs(c.tx, c.caller, header, c.existing);
    let total = ZERO;
    c.lines.forEach((l, i) => {
      if (D(S(l.qty ?? 0)).lte(0))
        throw Errors.validation({ [`lines.${i}.qty`]: 'Enter a quantity greater than 0.' });
      const t = lineTax({
        qty: D(S(l.qty)),
        rate: D(S(l.rate ?? 0)),
        discountPct: D(S(l.discountPct ?? 0)),
        gstPct: ZERO,
        intra: true,
      });
      total = total.plus(t.taxable);
    });
    total = total
      .plus(D(S(header.freight ?? c.existing?.freight ?? 0)))
      .plus(D(S(header.otherCharges ?? c.existing?.other_charges ?? 0)));
    return { header: { ...header, total: str(total) }, lines: c.lines };
  },
  async decorate(db, row) {
    const l = await refLabels(db, row);
    const r = (
      await query(
        db,
        `SELECT (SELECT number FROM rfqs WHERE id = $2::uuid) AS rfq_no,
                COALESCE(sum(l.qty * l.rate), 0)::numeric(18,2)::text AS base,
                COALESCE(sum(l.qty * l.rate * COALESCE(l.discount_pct, 0) / 100), 0)::numeric(18,2)::text AS discount,
                COALESCE(sum(l.qty * l.rate * (1 - COALESCE(l.discount_pct, 0) / 100) * COALESCE(l.gst_pct, 0) / 100), 0)::numeric(18,2)::text AS gst,
                COALESCE(sum(l.landed_cost), 0)::numeric(18,2)::text AS extra,
                max(l.lead_days) AS lead
           FROM vendor_quote_lines l WHERE l.quote_id = $1::uuid`,
        row.id,
        row.rfq_id ?? null,
      )
    )[0]!;
    const named = norm(r);
    // the quotation total already holds freight and other charges: the landed cost adds only tax and extra line costs
    const landed = round2(D(S(row.total)).plus(D(S(r.gst))).plus(D(S(r.extra))));
    return {
      ...l,
      references: [
        ...referenceList([
          ['RFQ No', named.rfqNo],
          ['Vendor ID', l.vendorId],
          ['Payment Terms', l.paymentTerms],
          ['Technical Compliance', row.technical_compliance ? 'Meets the technical needs' : 'Does not meet the technical needs'],
          ['Lead Time Days', named.lead],
        ]),
        ...referenceList([
          ['Base Amount', named.base],
          ['Discount', named.discount],
          ['GST', named.gst],
          ['Landed Cost', str(landed)],
        ]).map((x) => ({ ...x, fmt: 'inr' as const })),
        ...referenceList(commonPairs(l)),
      ],
    };
  },
  async afterSave(c) {
    // draft comparison sheets of the RFQ follow the quotation that was just saved
    for (const id of new Set([c.header.rfqId, c.existing?.rfq_id])) if (id) await refreshOpenSheets(c.tx, S(id));
    const rfqId = c.header.rfqId ?? c.existing?.rfq_id;
    const supplierId = c.header.supplierId ?? c.existing?.supplier_id;
    if (rfqId && supplierId)
      await exec(
        c.tx,
        `UPDATE rfq_suppliers SET responded_at = COALESCE(responded_at, now()) WHERE rfq_id=$1::uuid AND supplier_id=$2::uuid`,
        rfqId,
        supplierId,
      );
  },
});
export const vqActions = {
  /** A new negotiation round: copy the current quote, mark the old one not current. */
  async round(caller: Caller, id: string) {
    const unitId = concreteUnit(caller);
    const fy = await fyOfCaller(caller);
    return prisma.$transaction(async (tx) => {
      const q = await loadDoc(tx, caller, VQ_DEF, id, { lock: true });
      if (!q.is_current) throw Errors.conflict('Only the current round can be negotiated again.');
      const number = await allocateNumber(tx, VQ_DEF, unitId, fy.id);
      const newId = await insertRow(tx, 'vendor_quotes', {
        unitId,
        fyId: fy.id,
        number,
        department: q.department,
        status: 'Draft',
        rfqId: q.rfq_id,
        supplierId: q.supplier_id,
        quoteDate: new Date().toISOString().slice(0, 10),
        validUntil: q.valid_until,
        roundNo: Number(q.round_no) + 1,
        isCurrent: true,
        paymentTermId: q.payment_term_id,
        freight: norm(q).freight,
        otherCharges: norm(q).otherCharges,
        technicalCompliance: q.technical_compliance,
        warranty: q.warranty,
        complianceNote: q.compliance_note,
        ...refsOf(q),
        total: norm(q).total,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      for (const l of await loadLines(tx, VQ_DEF, id)) {
        const n = norm(l);
        await insertRow(tx, 'vendor_quote_lines', {
          quoteId: newId,
          lineNo: n.lineNo,
          rfqLineId: n.rfqLineId,
          itemId: n.itemId,
          qty: n.qty,
          uom: n.uom,
          rate: n.rate,
          discountPct: n.discountPct,
          gstPct: n.gstPct,
          leadDays: n.leadDays,
          landedCost: n.landedCost,
          costBreakup: n.costBreakup,
        });
      }
      await exec(
        tx,
        `UPDATE vendor_quotes SET is_current = false, version = version + 1 WHERE id = $1::uuid`,
        id,
      );
      if (q.rfq_id) await refreshOpenSheets(tx, S(q.rfq_id));
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_CREATED',
        VQ_DEF.title,
        { id: newId, code: number },
        VQ_DEF.pageId,
        { roundOf: S(q.number) },
      );
      return vqCrud.getIn(tx, caller, newId);
    }, TX);
  },
};

// ---------------------------------------------------------------------------------------------------- comparison
interface Entry {
  quoteId: string;
  supplierId: string;
  totalLanded: ReturnType<typeof D>;
  lead: number | null;
  compliant: boolean;
  quality: ReturnType<typeof D>;
}
export async function scoreComparison(
  db: Db,
  rfqId: string,
  w: { price: string; lead: string; quality: string },
) {
  const quotes = await query(
    db,
    `SELECT q.id::text, q.supplier_id::text, q.total::text, q.technical_compliance,
            COALESCE((SELECT sum(l.landed_cost) FROM vendor_quote_lines l WHERE l.quote_id = q.id),0)::text AS landed,
            (SELECT max(l.lead_days) FROM vendor_quote_lines l WHERE l.quote_id = q.id) AS lead,
            (SELECT e.overall::text FROM supplier_evaluations e WHERE e.supplier_id = q.supplier_id ORDER BY e.period DESC LIMIT 1) AS quality
       FROM vendor_quotes q
      WHERE q.rfq_id = $1::uuid AND q.is_current AND q.deleted_at IS NULL AND q.status IN ('Approved','Posted','Draft','Pending Approval')`,
    rfqId,
  );
  const entries: Entry[] = quotes.map((q) => ({
    quoteId: S(q.id),
    supplierId: S(q.supplier_id),
    totalLanded: D(S(q.total)).plus(D(S(q.landed))),
    lead: q.lead === null ? null : Number(q.lead),
    compliant: q.technical_compliance === true,
    quality: q.quality === null ? D(100) : D(S(q.quality)),
  }));
  const ok = entries.filter((e) => e.compliant && e.totalLanded.gt(0));
  const minPrice = ok.length
    ? ok.reduce((m, e) => (e.totalLanded.lt(m) ? e.totalLanded : m), ok[0]!.totalLanded)
    : ZERO;
  const leads = ok.map((e) => e.lead).filter((x): x is number => x !== null && x > 0);
  const minLead = leads.length ? Math.min(...leads) : null;
  const wsum = D(w.price).plus(w.lead).plus(w.quality);
  const scored = entries.map((e) => {
    if (!e.compliant || e.totalLanded.lte(0))
      return { ...e, price: null, leadS: null, total: null as ReturnType<typeof D> | null };
    const price = minPrice.mul(100).div(e.totalLanded);
    const leadS = minLead && e.lead ? D(minLead).mul(100).div(e.lead) : D(100);
    const total = price
      .mul(w.price)
      .plus(leadS.mul(w.lead))
      .plus(e.quality.mul(w.quality))
      .div(wsum);
    return { ...e, price, leadS, total };
  });
  const ranked = scored
    .filter((s) => s.total !== null)
    .sort((a, b) => b.total!.comparedTo(a.total!))
    .map((s, i) => ({ id: s.quoteId, rank: i + 1 }));
  const rankOf = new Map(ranked.map((r) => [r.id, r.rank]));
  return scored.map((s) => ({ ...s, rank: rankOf.get(s.quoteId) ?? null }));
}

/** The rows of a comparison sheet with the names behind them: live while the sheet is open, stored once awarded. */
export async function comparisonRows(db: Db, sheet: Row): Promise<Row[]> {
  if (!sheet.rfq_id) return [];
  const rows: Row[] = sheet.locked_at
    ? (await query(db, `SELECT * FROM comparison_entries WHERE comparison_id=$1::uuid`, sheet.id)).map((e) => norm(e))
    : (await scoreComparison(db, S(sheet.rfq_id), { price: S(sheet.w_price), lead: S(sheet.w_lead), quality: S(sheet.w_quality) })).map((s) => ({
        quoteId: s.quoteId,
        supplierId: s.supplierId,
        rank: s.rank,
        totalLanded: round2(s.totalLanded).toFixed(),
        priceScore: s.price ? s.price.toDecimalPlaces(4).toFixed() : null,
        leadScore: s.leadS ? s.leadS.toDecimalPlaces(4).toFixed() : null,
        qualityScore: s.quality.toDecimalPlaces(4).toFixed(),
        totalScore: s.total ? s.total.toDecimalPlaces(4).toFixed() : null,
      }));
  if (rows.length === 0) return [];
  const info = await query(
    db,
    `SELECT q.id::text AS id, q.number, s.name AS supplier, q.technical_compliance,
            (SELECT max(l.lead_days) FROM vendor_quote_lines l WHERE l.quote_id = q.id) AS lead,
            (SELECT count(*)::int FROM rfq_lines rl WHERE rl.rfq_id = $2::uuid) AS rfq_lines,
            (SELECT count(*)::int FROM rfq_lines rl WHERE rl.rfq_id = $2::uuid AND rl.qty <=
               COALESCE((SELECT sum(l.qty) FROM vendor_quote_lines l WHERE l.quote_id = q.id
                  AND (l.rfq_line_id = rl.id OR (l.rfq_line_id IS NULL AND l.item_id = rl.item_id))), 0)) AS covered
       FROM vendor_quotes q JOIN suppliers s ON s.id = q.supplier_id WHERE q.id = ANY($1::uuid[])`,
    rows.map((r) => S(r.quoteId)),
    sheet.rfq_id,
  );
  const byId = new Map(info.map((i) => [S(i.id), i]));
  return rows
    .map((r) => {
      const i = byId.get(S(r.quoteId));
      return {
        ...r,
        quoteNumber: i?.number ?? null,
        supplierName: i?.supplier ?? null,
        leadDays: i?.lead ?? null,
        meetsTechnical: i?.technical_compliance === true,
        rfqLines: Number(i?.rfq_lines ?? 0),
        coveredLines: Number(i?.covered ?? 0),
      } as Row;
    })
    .sort((a, b) => Number(a.rank ?? 9999) - Number(b.rank ?? 9999));
}

/** Keeps the stored rows of the draft sheets of an RFQ in step with its quotations. */
export async function refreshOpenSheets(tx: Db, rfqId: string): Promise<void> {
  const open = await query(
    tx,
    `SELECT id::text AS id FROM vendor_comparisons WHERE rfq_id=$1::uuid AND deleted_at IS NULL AND locked_at IS NULL AND status IN ('Draft','Rejected')`,
    rfqId,
  );
  for (const s of open) await refreshEntries(tx, S(s.id));
}

export const cmpCrud = makeCrud({
  def: CMP_DEF,
  headerKeys: [
    'rfqId',
    'wPrice',
    'wLead',
    'wQuality',
    'docDate',
    'requiredDate',
    'requestDepartment',
    'buyerId',
    'reference',
    ...REF_KEYS,
    'projectId',
  ],
  lineKeys: [],
  async decorate(db, row) {
    const l = await refLabels(db, { ...row, buyer_id: row.buyer_id ?? row.created_by_id });
    const quotes = await comparisonRows(db, row);
    const r = norm(
      (
        await query(
          db,
          `SELECT (SELECT number FROM rfqs WHERE id = $2::uuid) AS rfq_no,
                  (SELECT due_date FROM rfqs WHERE id = $2::uuid) AS due_date,
                  (SELECT current_level || ' of ' || total_levels FROM approval_requests WHERE doc_id = $1::uuid ORDER BY requested_at DESC LIMIT 1) AS approval_level,
                  (SELECT string_agg(concat_ws(' ', i.code, i.name, '×', trim_scale(rl.qty)::text, rl.uom), '; ' ORDER BY rl.line_no)
                     FROM rfq_lines rl LEFT JOIN items i ON i.id = rl.item_id WHERE rl.rfq_id = $2::uuid) AS items`,
          row.id,
          row.rfq_id ?? null,
        )
      )[0]!,
    );
    const own = norm(row);
    const best = quotes.find((q) => (row.awarded_quote_id ? q.quoteId === row.awarded_quote_id : q.rank === 1));
    const day = (v: unknown): string => S(v).slice(0, 10).split('-').reverse().join('-');
    const required = own.requiredDate ?? r.dueDate;
    return {
      ...l,
      quotes,
      rfqNo: r.rfqNo,
      references: [
        ...referenceList([
          ['RFQ No', r.rfqNo],
          ['Items Compared', r.items],
          [row.awarded_quote_id ? 'Awarded Vendor' : 'Top Ranked Vendor', best?.supplierName],
        ]),
        ...referenceList([['Amount', best?.totalLanded]]).map((x) => ({ ...x, fmt: 'inr' as const })),
        ...referenceList([
          ['Date', day(own.docDate ?? own.createdAt)],
          ['Required Date', required ? day(required) : null],
          ['Department', row.request_department ?? row.department],
          ['Buyer', l.buyerName],
          ['Reference', row.reference],
          ['Approval Level', r.approvalLevel],
          ['Award Reason', row.award_reason],
          ...commonPairs(l),
        ]),
      ],
    };
  },
  async prepare(c) {
    const w = {
      price: Number(c.header.wPrice ?? c.existing?.w_price ?? 50),
      lead: Number(c.header.wLead ?? c.existing?.w_lead ?? 20),
      quality: Number(c.header.wQuality ?? c.existing?.w_quality ?? 30),
    };
    if (Math.abs(w.price + w.lead + w.quality - 100) > 0.0001)
      throw Errors.validation({ wPrice: 'The three weights must add up to 100.' });
    let header = c.header;
    if (!c.existing && header.rfqId) {
      const rfq = (await query(c.tx, `SELECT * FROM rfqs WHERE id = $1::uuid`, header.rfqId))[0];
      if (rfq) header = inherit(header, { ...refsOf(rfq), buyerId: rfq.buyer_id ?? c.caller.auth.userId });
    }
    return { header: await prepareRefs(c.tx, c.caller, header, c.existing), lines: [] };
  },
  async afterSave() {
    /* entries are written by refreshEntries below (needs the id) */
  },
});
export async function refreshEntries(tx: Db, id: string): Promise<void> {
  const h = (
    await query(
      tx,
      `SELECT rfq_id::text, w_price::text, w_lead::text, w_quality::text, locked_at FROM vendor_comparisons WHERE id=$1::uuid FOR UPDATE`,
      id,
    )
  )[0]!;
  if (h.locked_at) return;
  const scored = await scoreComparison(tx, S(h.rfq_id), {
    price: S(h.w_price),
    lead: S(h.w_lead),
    quality: S(h.w_quality),
  });
  await exec(tx, `DELETE FROM comparison_entries WHERE comparison_id=$1::uuid`, id);
  for (const s of scored)
    await insertRow(tx, 'comparison_entries', {
      comparisonId: id,
      quoteId: s.quoteId,
      supplierId: s.supplierId,
      priceScore: s.price ? s.price.toDecimalPlaces(4).toFixed() : null,
      leadScore: s.leadS ? s.leadS.toDecimalPlaces(4).toFixed() : null,
      qualityScore: s.quality.toDecimalPlaces(4).toFixed(),
      totalScore: s.total ? s.total.toDecimalPlaces(4).toFixed() : null,
      rank: s.rank,
      totalLanded: round2(s.totalLanded).toFixed(),
    });
}
export const cmpActions = {
  async create(
    caller: Caller,
    body: Row & { rfqId: string; wPrice?: number; wLead?: number; wQuality?: number },
  ) {
    const made = await cmpCrud.create(caller, {
      header: {
        ...body,
        rfqId: body.rfqId,
        wPrice: body.wPrice ?? 50,
        wLead: body.wLead ?? 20,
        wQuality: body.wQuality ?? 30,
      },
      lines: [],
    });
    await prisma.$transaction(async (tx) => refreshEntries(tx, S(made.id)), TX);
    return cmpCrud.get(caller, S(made.id));
  },
  /** Edits the sheet's own fields and weights while it is Draft or Rejected, then scores it again. */
  async update(caller: Caller, id: string, ifMatch: number | undefined, header: Row) {
    await cmpCrud.update(caller, id, ifMatch, { header });
    await prisma.$transaction(async (tx) => refreshEntries(tx, id), TX);
    return cmpCrud.get(caller, id);
  },
  async simulate(
    caller: Caller,
    id: string,
    w: { wPrice: number; wLead: number; wQuality: number },
  ) {
    const h = await loadDoc(prisma, caller, CMP_DEF, id);
    if (Math.abs(w.wPrice + w.wLead + w.wQuality - 100) > 0.0001)
      throw Errors.validation({ wPrice: 'The three weights must add up to 100.' });
    const scored = await scoreComparison(prisma, S(h.rfq_id), {
      price: S(w.wPrice),
      lead: S(w.wLead),
      quality: S(w.wQuality),
    });
    return scored.map((s) => ({
      quoteId: s.quoteId,
      supplierId: s.supplierId,
      rank: s.rank,
      totalScore: s.total ? s.total.toDecimalPlaces(4).toFixed() : null,
    }));
  },
  async award(caller: Caller, id: string, body: { quoteId: string; reason?: string }) {
    return prisma.$transaction(async (tx) => {
      const h = await loadDoc(tx, caller, CMP_DEF, id, { lock: true });
      if (h.locked_at) throw Errors.conflict('This comparison is already awarded.');
      if (h.status !== 'Approved') throw Errors.conflict('Approve the comparison before awarding.');
      await refreshEntries(tx, id); // quotes may have changed since the comparison was made
      const e = (
        await query(
          tx,
          `SELECT rank FROM comparison_entries WHERE comparison_id=$1::uuid AND quote_id=$2::uuid`,
          id,
          body.quoteId,
        )
      )[0];
      if (!e) throw Errors.validation({ quoteId: 'Choose a quote from this comparison.' });
      if (e.rank === null)
        throw Errors.validation({
          quoteId: 'This quote does not meet the technical requirements.',
        });
      if (Number(e.rank) !== 1 && (body.reason ?? '').trim().length < 5)
        throw Errors.validation({
          reason: 'Give a reason (at least 5 letters) to award a quote that is not ranked first.',
        });
      await updateRow(tx, 'vendor_comparisons', id, {
        lockedAt: new Date(),
        awardedQuoteId: body.quoteId,
        awardReason: body.reason ?? null,
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE vendor_comparisons SET version = version + 1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_POSTED',
        CMP_DEF.title,
        { id, code: S(h.number) },
        CMP_DEF.pageId,
        { awardedQuote: body.quoteId, rank: Number(e.rank) },
      );
      return cmpCrud.getIn(tx, caller, id);
    }, TX);
  },
};

// ---------------------------------------------------------------------------------------------------- contracts
export const conCrud = makeCrud({
  def: CON_DEF,
  hasSupplier: true,
  headerKeys: ['supplierId', 'title', 'validFrom', 'validTo', 'contractType', 'maxValue', 'notes'],
  lineKeys: ['itemId', 'uom', 'rate', 'discountPct', 'minQty', 'maxQty'],
  async prepare(c) {
    if (c.header.supplierId) assertBuyable(await loadSupplier(c.tx, S(c.header.supplierId)));
    const from = S(c.header.validFrom ?? c.existing?.valid_from ?? '');
    const to = S(c.header.validTo ?? c.existing?.valid_to ?? '');
    if (from && to && to < from)
      throw Errors.validation({ validTo: 'The end date cannot be before the start date.' });
    return { header: c.header, lines: c.lines };
  },
});

/** A PO release against a contract line: within validity, within max qty and value. Called under the PO transaction. */
export async function releaseAgainstContract(
  tx: Db,
  contractLineId: string,
  qty: ReturnType<typeof D>,
  value: ReturnType<typeof D>,
  onDate: string,
): Promise<void> {
  const r = (
    await query(
      tx,
      `SELECT l.id, l.max_qty::text, l.released_qty::text, c.id AS cid, c.valid_from, c.valid_to, c.max_value::text, c.released_value::text, c.status
      FROM purchase_contract_lines l JOIN purchase_contracts c ON c.id = l.contract_id WHERE l.id=$1::uuid FOR UPDATE OF l, c`,
      contractLineId,
    )
  )[0];
  if (!r) throw Errors.notFound('Contract line not found.');
  const n = norm(r);
  if (n.status !== 'Approved' && n.status !== 'Posted')
    throw Errors.conflict('The contract is not approved.');
  if (onDate < S(n.validFrom) || onDate > S(n.validTo))
    throw Errors.conflict('The contract is not valid on this date.');
  if (
    n.maxQty !== null &&
    D(S(n.releasedQty))
      .plus(qty)
      .gt(D(S(n.maxQty)))
  )
    throw new AppError(
      409,
      'CONTRACT_QTY_EXCEEDED',
      `Balance ₹${S(n.maxValue ?? '0')}, this release ₹${round2(value).toFixed(2)}.`,
    );
  if (
    n.maxValue !== null &&
    D(S(n.releasedValue))
      .plus(value)
      .gt(D(S(n.maxValue)))
  )
    throw new AppError(
      409,
      'CONTRACT_QTY_EXCEEDED',
      `Balance ₹${D(S(n.maxValue))
        .minus(D(S(n.releasedValue)))
        .toFixed(2)}, this release ₹${round2(value).toFixed(2)}.`,
    );
  await exec(
    tx,
    `UPDATE purchase_contract_lines SET released_qty = released_qty + $1::numeric WHERE id=$2::uuid`,
    qty.toFixed(),
    contractLineId,
  );
  await exec(
    tx,
    `UPDATE purchase_contracts SET released_value = released_value + $1::numeric WHERE id=$2::uuid`,
    round2(value).toFixed(),
    S(n.cid),
  );
}

export { setStatus, settings };
