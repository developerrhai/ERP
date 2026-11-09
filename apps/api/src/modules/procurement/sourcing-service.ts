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
} from './core';
import { S } from './core';
import type { DocDef, Row } from './core';
import { concreteUnit } from '../inventory/typed';
import { lineTax } from './math';

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

// ---------------------------------------------------------------------------------------------------- PR
export const prCrud = makeCrud({
  def: PR_DEF,
  headerKeys: ['requiredDate', 'requestedById', 'supplierType', 'purpose'],
  lineKeys: ['itemId', 'serviceText', 'qty', 'uom', 'estRate', 'costCenterId', 'requiredDate'],
  prepare(c) {
    let total = ZERO;
    c.lines.forEach((l, i) => {
      itemOrText(l, i);
      total = total.plus(round2(D(S(l.qty)).mul(D(S(l.estRate ?? 0)))));
    });
    return { header: { ...c.header, estimatedTotal: str(total) }, lines: c.lines };
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
  headerKeys: ['issueDate', 'dueDate', 'supplierType', 'notes'],
  lineKeys: ['prLineId', 'itemId', 'serviceText', 'qty', 'uom', 'requiredDate'],
  prepare(c) {
    c.lines.forEach((l, i) => itemOrText(l, i));
    return { header: c.header, lines: c.lines };
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
      .plus(D(S(c.header.freight ?? c.existing?.freight ?? 0)))
      .plus(D(S(c.header.otherCharges ?? c.existing?.other_charges ?? 0)));
    return { header: { ...c.header, total: str(total) }, lines: c.lines };
  },
  async afterSave(c) {
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
            (SELECT min(l.lead_days) FROM vendor_quote_lines l WHERE l.quote_id = q.id) AS lead,
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

export const cmpCrud = makeCrud({
  def: CMP_DEF,
  headerKeys: ['rfqId', 'wPrice', 'wLead', 'wQuality'],
  lineKeys: [],
  prepare(c) {
    const w = {
      price: Number(c.header.wPrice ?? c.existing?.w_price ?? 50),
      lead: Number(c.header.wLead ?? c.existing?.w_lead ?? 20),
      quality: Number(c.header.wQuality ?? c.existing?.w_quality ?? 30),
    };
    if (Math.abs(w.price + w.lead + w.quality - 100) > 0.0001)
      throw Errors.validation({ wPrice: 'The three weights must add up to 100.' });
    return { header: c.header, lines: [] };
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
    body: { rfqId: string; wPrice?: number; wLead?: number; wQuality?: number },
  ) {
    const made = await cmpCrud.create(caller, {
      header: {
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
