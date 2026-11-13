// Phase 9: purchase invoice with 3-way match, GST (ITC flags, RCM), TDS ledger, MSME due date and the GL chain;
// debit notes (return / rate difference). Every post = assertCanPost + numbering + StockService + PostingService
// in one transaction. No rate is decided in code: GST % comes from the PO / the invoice, TDS % from dated rows.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { assertCanPost } from '../../core/posting';
import { PostingService } from '../finance/posting-service';
import { feedDebitNote, feedPurchaseInvoice } from '../tax/feed';
import type { EventLine } from '../finance/posting-service';
import { notificationService } from '../notifications/service';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { StockService } from '../inventory/stock/stock-service';
import { concreteUnit } from '../inventory/typed';
import {
  TX,
  allocateNumber,
  assertBuyable,
  assertEditable,
  audit,
  checkVersion,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  loadDoc,
  loadLines,
  loadSupplier,
  norm,
  query,
  registerDoc,
  scopeSql,
  settings,
  submitDoc,
  todayIst,
  updateRow,
} from './core';
import { S, approvalHandler } from './core';
import type { DocDef, Actor, Row } from './core';
import {
  addDays,
  computeTds,
  daysBetween,
  headerTotals,
  lineTax,
  matchLine,
  msmeDueDate,
} from './math';
import type { LineTax, TdsRule } from './math';
import { resolveGstPct } from './po-service';
import '../finance/notes-service';
import { approvalService } from '../approvals/service';
import { handlerFor } from '../approvals/handlers';

export const PINV_DEF: DocDef = {
  pageId: 'scm-purchaseinvoice',
  table: 'purchase_invoices',
  title: 'Purchase Invoice',
  amountCol: 'grand_total',
  preLock: async (tx, id) => {
    const r = (
      await query(tx, `SELECT supplier_id::text FROM purchase_invoices WHERE id=$1::uuid`, id)
    )[0];
    if (r)
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `supplier-inv:${S(r.supplier_id)}`,
      );
  },
  linesTable: 'purchase_invoice_lines',
  parentCol: 'invoice_id',
  async afterApproved(tx, id, actor) {
    if (!(await settings(tx)).postOnApprove) return;
    await postInvoice(tx, id, actor);
  },
};
export const DN_DEF: DocDef = {
  pageId: 'fin-debitnote',
  table: 'debit_notes',
  title: 'Debit Note',
  amountCol: 'grand_total',
  linesTable: 'debit_note_lines',
  parentCol: 'note_id',
  async afterApproved(tx, id, actor) {
    if (!(await settings(tx)).postOnApprove) return;
    await postDebitNote(tx, id, actor);
  },
};
registerDoc(PINV_DEF);
// 'fin-debitnote' is one page with two stores: Phase 7 standalone notes (credit_debit_notes) and these stock-linked
// notes (debit_notes). One approval handler serves both and asks which table owns the document.
const phase7DebitNoteHandler = handlerFor('fin-debitnote');
const ownDebitNoteHandler = approvalHandler(DN_DEF);
const owns = async (tx: Db, id: string): Promise<boolean> =>
  (await query(tx, `SELECT 1 FROM debit_notes WHERE id=$1::uuid`, id)).length > 0;
approvalService.register('fin-debitnote', {
  snapshot: async (tx, id) =>
    ((await owns(tx, id)) ? ownDebitNoteHandler : phase7DebitNoteHandler).snapshot(tx, id),
  onSubmitted: async (tx, id, r) =>
    ((await owns(tx, id)) ? ownDebitNoteHandler : phase7DebitNoteHandler).onSubmitted(tx, id, r),
  onApproved: async (tx, id, r) =>
    ((await owns(tx, id)) ? ownDebitNoteHandler : phase7DebitNoteHandler).onApproved(tx, id, r),
  onRejected: async (tx, id, r) =>
    ((await owns(tx, id)) ? ownDebitNoteHandler : phase7DebitNoteHandler).onRejected(tx, id, r),
  onReturned: async (tx, id, r) =>
    ((await owns(tx, id)) ? ownDebitNoteHandler : phase7DebitNoteHandler).onReturned(tx, id, r),
});

const normInvNo = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function unitState(tx: Db, unitId: string): Promise<string> {
  const u = (await query(tx, `SELECT state_code, gstin FROM units WHERE id=$1::uuid`, unitId))[0];
  const st = (u?.state_code as string | null) || ((u?.gstin as string | null)?.slice(0, 2) ?? null);
  if (!st) throw Errors.validation({ unitId: 'Set the state (or GSTIN) of this unit first.' });
  return st;
}

// ============================================================================================ input
export interface InvLineIn {
  grnLineId?: string | null;
  poLineId?: string | null;
  itemId?: string | null;
  description?: string | null;
  hsnSac?: string | null;
  qty: string;
  uom?: string | null;
  rate: string;
  gstPct?: string | null;
  /** tax amounts as printed on the vendor invoice (optional; compared with the calculated tax) */
  cgst?: string | null;
  sgst?: string | null;
  igst?: string | null;
  itcFlag?: 'ELIGIBLE' | 'CAPITAL_GOODS' | 'INPUT_SERVICE' | 'INELIGIBLE_17_5' | 'NOT_APPLICABLE';
  costCenterId?: string | null;
  /** a freight / service line that belongs to a GRN's landed cost */
  landedGrnId?: string | null;
}
export interface InvBody {
  supplierId: string;
  vendorInvoiceNo: string;
  invoiceDate: string;
  poId?: string | null;
  isRcm?: boolean;
  tdsSectionCode?: string | null;
  bankAccountId?: string | null;
  advanceTerms?: string | null;
  notes?: string | null;
  lines: InvLineIn[];
}

// ============================================================================================ TDS
export interface TdsSectionRow extends TdsRule {
  code: string;
  rateIndividual: Dec | null;
  noPanRate: Dec | null;
}
export async function tdsSection(tx: Db, code: string, on: string): Promise<TdsSectionRow | null> {
  const r = (
    await query(
      tx,
      `SELECT * FROM tds_sections WHERE code=$1 AND tax_kind='TDS' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC LIMIT 1`,
      code,
      on,
    )
  )[0];
  if (!r) return null;
  const n = norm<Row>(r);
  if (n.ratePct === null)
    throw new AppError(
      422,
      'TDS_RATE_MISSING',
      `The TDS rate for section ${code} is not set. Ask the accountant to fill it in under TDS sections.`,
      { tdsSectionCode: 'Rate not set.' },
    );
  return {
    code,
    mode: n.mode as 'ON_ALL' | 'ON_EXCESS',
    thresholdSingle: n.thresholdSingle === null ? null : D(S(n.thresholdSingle)),
    thresholdAnnual: n.thresholdAnnual === null ? null : D(S(n.thresholdAnnual)),
    ratePct: D(S(n.ratePct)),
    rounding: n.rounding as 'RUPEE' | 'PAISE',
    rateIndividual: n.ratePctIndividual === null ? null : D(S(n.ratePctIndividual)),
    noPanRate: n.noPanRate === null ? null : D(S(n.noPanRate)),
  };
}

async function tdsState(
  tx: Db,
  supplierId: string,
  fyId: string,
  code: string,
): Promise<{ cumBase: Dec; cumTdsBase: Dec; lastId: string | null }> {
  const r = (
    await query(
      tx,
      `SELECT id::text, cum_base_after::text, cum_tds_base_after::text FROM supplier_tds_ledger WHERE supplier_id=$1::uuid AND fy_id=$2::uuid AND section_code=$3 ORDER BY seq DESC LIMIT 1`,
      supplierId,
      fyId,
      code,
    )
  )[0];
  return r
    ? { cumBase: D(S(r.cum_base_after)), cumTdsBase: D(S(r.cum_tds_base_after)), lastId: S(r.id) }
    : { cumBase: ZERO, cumTdsBase: ZERO, lastId: null };
}

/** The rate for this supplier: lower-deduction certificate, individual / HUF rate, no-PAN rate, else the section rate. */
async function effectiveRate(
  tx: Db,
  sec: TdsSectionRow,
  supplierId: string,
  on: string,
): Promise<Dec> {
  // Phase 11: a lower-deduction certificate valid on the date for this section wins (rate from the certificate)
  const cert = (
    await query(
      tx,
      `SELECT rate_pct::text FROM lower_deduction_certs WHERE supplier_id=$1::uuid AND section_code=$2
          AND valid_from <= $3::date AND valid_to >= $3::date ORDER BY valid_to DESC LIMIT 1`,
      supplierId,
      sec.code,
      on,
    )
  )[0];
  if (cert?.rate_pct !== undefined && cert.rate_pct !== null) return D(S(cert.rate_pct));
  const s = (
    await query(
      tx,
      `SELECT pan, lower_tds_rate::text, lower_tds_valid_to FROM suppliers WHERE id=$1::uuid`,
      supplierId,
    )
  )[0];
  if (
    s?.lower_tds_rate !== null &&
    s?.lower_tds_rate !== undefined &&
    s.lower_tds_valid_to &&
    S(norm<Row>(s).lowerTdsValidTo) >= on
  )
    return D(S(s.lower_tds_rate));
  if (!s?.pan && sec.noPanRate) return sec.noPanRate;
  if (s?.pan && 'PH'.includes(S(s.pan)[3] ?? '') && sec.rateIndividual) return sec.rateIndividual;
  return sec.ratePct;
}

export async function tdsPreviewFor(
  tx: Db,
  supplierId: string,
  fyId: string,
  code: string | null,
  taxable: Dec,
  on: string,
  lock = false,
) {
  if (!code)
    return {
      section: null as string | null,
      base: ZERO,
      tds: ZERO,
      cumBaseAfter: ZERO,
      cumTdsBaseAfter: ZERO,
      ratePct: ZERO,
    };
  if (lock)
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      `tds:${supplierId}:${fyId}:${code}`,
    );
  const sec = await tdsSection(tx, code, on);
  if (!sec)
    throw Errors.validation({ tdsSectionCode: `TDS section ${code} has no rate valid on ${on}.` });
  const rate = await effectiveRate(tx, sec, supplierId, on);
  const st = await tdsState(tx, supplierId, fyId, code);
  const r = computeTds(taxable, { ...sec, ratePct: rate }, st);
  return { section: code, ...r, ratePct: rate };
}

// ============================================================================================ save
async function dueDates(
  tx: Db,
  sup: { paymentTermId: string | null; msme45: boolean; msmeAgreedDays: number | null },
  invoiceDate: string,
  grnDates: string[],
) {
  let due = invoiceDate;
  if (sup.paymentTermId) {
    const t = await query(
      tx,
      `SELECT due_basis, days FROM payment_term_lines WHERE payment_term_id=$1::uuid ORDER BY line_no`,
      sup.paymentTermId,
    );
    for (const l of t) {
      const days = Number(l.days);
      let d = invoiceDate;
      if (l.due_basis === 'END_OF_INVOICE_MONTH') {
        const [y, m] = invoiceDate.split('-').map(Number) as [number, number];
        d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      } else if (l.due_basis === 'RECEIPT_OF_GOODS' && grnDates.length)
        d = [...grnDates].sort().at(-1)!;
      const dd = addDays(d, days);
      if (dd > due) due = dd;
    }
  }
  let msme: string | null = null;
  if (sup.msme45 && grnDates.length) {
    msme = msmeDueDate([...grnDates].sort().at(-1)!, sup.msmeAgreedDays);
    if (msme < due) due = msme;
  }
  return { due, msme };
}

async function saveInvoice(
  caller: Caller,
  id: string | null,
  ifMatch: number | undefined,
  b: InvBody,
) {
  const unitId = concreteUnit(caller);
  const fy = await fyOfCaller(caller);
  const outId = await prisma.$transaction(async (tx) => {
    let cur: Row | null = null;
    if (id) {
      cur = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
      assertEditable(cur, 'purchase invoice');
      checkVersion(cur, ifMatch);
    }
    const sup = await loadSupplier(tx, b.supplierId);
    assertBuyable(sup);
    const normNo = normInvNo(b.vendorInvoiceNo);
    if (!normNo) throw Errors.validation({ vendorInvoiceNo: 'Enter the supplier invoice number.' });
    const dup = (
      await query(
        tx,
        `SELECT number FROM purchase_invoices WHERE supplier_id=$1::uuid AND vendor_invoice_no_norm=$2 AND fy_id=$3::uuid AND status <> 'Cancelled' AND deleted_at IS NULL AND ($4::uuid IS NULL OR id <> $4::uuid)`,
        b.supplierId,
        normNo,
        fy.id,
        id,
      )
    )[0];
    if (dup)
      throw new AppError(
        409,
        'DUPLICATE_INVOICE',
        `Invoice ${b.vendorInvoiceNo} of this supplier is already entered as ${S(dup.number)}.`,
      );
    if (b.lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    const us = await unitState(tx, unitId);
    const intra = sup.stateCode === us;
    if (b.isRcm && (!sup.stateCode || b.lines.some((l) => !l.hsnSac && !l.grnLineId)))
      throw new AppError(
        422,
        'RCM_SELF_INVOICE',
        'Reverse-charge invoice needs supplier state and SAC.',
        { isRcm: 'Reverse-charge invoice needs supplier state and SAC.' },
      );
    const out: Row[] = [];
    const taxes: LineTax[] = [];
    const grnDates: string[] = [];
    const usedGrnLines = new Set<string>();
    const charges: Row[] = [];
    for (let i = 0; i < b.lines.length; i += 1) {
      const l = b.lines[i]!;
      const at = (f: string) => `lines.${i}.${f}`;
      const qty = D(l.qty);
      if (qty.lte(0)) throw Errors.validation({ [at('qty')]: 'Enter a quantity greater than 0.' });
      if (l.grnLineId) {
        if (usedGrnLines.has(l.grnLineId))
          throw Errors.validation({
            [at('grnLineId')]:
              'This receipt line is already on the invoice. Use one line and the total quantity.',
          });
        usedGrnLines.add(l.grnLineId);
      }
      let poLineId = l.poLineId ?? null;
      let itemId = l.itemId ?? null;
      let hsn = l.hsnSac ?? null;
      let uom = l.uom ?? null;
      let pct = l.gstPct ?? null;
      if (l.grnLineId) {
        const gl = (
          await query(
            tx,
            `SELECT gl.*, g.supplier_id::text AS g_supplier, g.status AS g_status, g.receipt_date FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id WHERE gl.id=$1::uuid`,
            l.grnLineId,
          )
        )[0];
        if (!gl || gl.g_supplier !== b.supplierId)
          throw Errors.validation({
            [at('grnLineId')]: 'This receipt line belongs to another supplier.',
          });
        if (gl.g_status !== 'Posted')
          throw Errors.validation({ [at('grnLineId')]: 'The goods receipt is not posted.' });
        poLineId = S(gl.po_line_id);
        itemId = S(gl.item_id);
        uom = S(gl.uom);
        grnDates.push(S(norm<Row>(gl).receiptDate));
        const pl = (
          await query(
            tx,
            `SELECT hsn_sac, gst_pct::text FROM purchase_order_lines WHERE id=$1::uuid`,
            poLineId,
          )
        )[0]!;
        hsn = hsn ?? (pl.hsn_sac as string | null);
        pct = pct ?? S(pl.gst_pct);
      }
      if (pct === null) pct = await resolveGstPct(tx, hsn, b.invoiceDate);
      if (pct === null)
        throw Errors.validation({
          [at('gstPct')]: `Enter the GST rate: no rate is set for ${hsn ?? 'this line'}.`,
        });
      const t = lineTax({ qty, rate: D(l.rate), discountPct: ZERO, gstPct: D(pct), intra });
      // tax printed on the vendor invoice wins (that is what the supplier will report), the difference is a match exception
      const stated = [l.cgst, l.sgst, l.igst].some((x) => x !== undefined && x !== null)
        ? { cgst: D(l.cgst ?? 0), sgst: D(l.sgst ?? 0), igst: D(l.igst ?? 0) }
        : null;
      const used: LineTax = stated
        ? {
            ...t,
            cgst: stated.cgst,
            sgst: stated.sgst,
            igst: stated.igst,
            tax: stated.cgst.plus(stated.sgst).plus(stated.igst),
            total: t.taxable.plus(stated.cgst).plus(stated.sgst).plus(stated.igst),
          }
        : t;
      taxes.push(used);
      out.push({
        grnLineId: l.grnLineId ?? null,
        poLineId,
        itemId,
        description: l.description ?? null,
        hsnSac: hsn,
        qty: str(qty),
        uom,
        rate: l.rate,
        gstPct: pct,
        taxable: str(used.taxable),
        cgst: str(used.cgst),
        sgst: str(used.sgst),
        igst: str(used.igst),
        itcFlag: l.itcFlag ?? 'ELIGIBLE',
        costCenterId: l.costCenterId ?? null,
        landedGrnId: l.landedGrnId ?? null,
        _calcTax: str(t.tax),
      });
      if (l.landedGrnId)
        charges.push({ chargeType: 'FREIGHT', amount: str(used.taxable), grnId: l.landedGrnId });
    }
    const h = headerTotals(taxes);
    const { due, msme } = await dueDates(tx, sup, b.invoiceDate, grnDates);
    const tdsCode = b.tdsSectionCode === undefined ? sup.tdsSectionCode : b.tdsSectionCode;
    const tds = await tdsPreviewFor(tx, b.supplierId, fy.id, tdsCode, h.taxable, b.invoiceDate);
    const payableBeforeTds = b.isRcm ? h.taxable : h.grand;
    const header: Row = {
      supplierId: b.supplierId,
      vendorInvoiceNo: b.vendorInvoiceNo.trim(),
      vendorInvoiceNoNorm: normNo,
      supplierGstin: null,
      invoiceDate: b.invoiceDate,
      dueDate: due,
      msmeDueDate: msme,
      isRcm: b.isRcm === true,
      poId: b.poId ?? null,
      supplierState: sup.stateCode,
      regime: intra ? 'INTRA' : 'INTER',
      taxable: str(h.taxable),
      cgst: str(h.cgst),
      sgst: str(h.sgst),
      igst: str(h.igst),
      roundOff: b.isRcm ? '0' : str(h.roundOff),
      grandTotal: str(payableBeforeTds),
      tdsSectionCode: tdsCode,
      tdsBase: str(tds.base),
      tdsAmount: str(tds.tds),
      netPayable: str(payableBeforeTds.minus(tds.tds)),
      bankAccountId: b.bankAccountId ?? null,
      advanceTerms: b.advanceTerms ?? null,
      matchState: 'PENDING',
    };
    const supplierGstin = (
      await query(tx, `SELECT gstin FROM suppliers WHERE id=$1::uuid`, b.supplierId)
    )[0]?.gstin as string | null;
    header.supplierGstin = supplierGstin;
    let invId = id;
    let number = cur ? S(cur.number) : '';
    if (!invId) {
      number = await allocateNumber(tx, PINV_DEF, unitId, fy.id);
      try {
        invId = await insertRow(tx, 'purchase_invoices', {
          ...header,
          unitId,
          fyId: fy.id,
          number,
          department: await departmentOf(tx, PINV_DEF.pageId, caller),
          status: 'Draft',
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        });
      } catch (err) {
        if (S((err as { message?: unknown }).message).includes('vendor_invoice_no_norm'))
          throw new AppError(
            409,
            'DUPLICATE_INVOICE',
            `Invoice ${b.vendorInvoiceNo} of this supplier is already entered.`,
          );
        throw err;
      }
    } else {
      await updateRow(tx, 'purchase_invoices', invId, {
        ...header,
        updatedAt: new Date(),
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE purchase_invoices SET version = version + 1 WHERE id=$1::uuid`, invId);
      await exec(tx, `DELETE FROM purchase_invoice_lines WHERE invoice_id=$1::uuid`, invId);
      await exec(tx, `DELETE FROM purchase_invoice_charges WHERE invoice_id=$1::uuid`, invId);
    }
    let n = 0;
    for (const l of out) {
      n += 1;
      const { _calcTax, ...cols } = l as Row & { _calcTax: string };
      await insertRow(tx, 'purchase_invoice_lines', { ...cols, invoiceId: invId, lineNo: n });
      void _calcTax;
    }
    for (const c of charges)
      await insertRow(tx, 'purchase_invoice_charges', { ...c, invoiceId: invId });
    await runMatch(
      tx,
      invId,
      out.map((l) => S((l as Row & { _calcTax: string })._calcTax)),
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      id ? 'SCM_UPDATED' : 'SCM_CREATED',
      PINV_DEF.title,
      { id: invId, code: number },
      PINV_DEF.pageId,
      { unitId },
    );
    return invId;
  }, TX);
  return getInvoice(prisma, caller, outId);
}

// ============================================================================================ match
/** (Re)computes the 3-way match of every line and the exception rows. Overridden exceptions stay overridden. */
export async function runMatch(
  tx: Db,
  invoiceId: string,
  calcTaxByLine?: string[],
): Promise<{ open: number }> {
  const set = await settings(tx);
  const lines = await loadLines(tx, PINV_DEF, invoiceId);
  const prev = await query(
    tx,
    `SELECT line_id::text, code, state, reason, overridden_by_id::text, overridden_at FROM invoice_match_exceptions WHERE invoice_id=$1::uuid`,
    invoiceId,
  );
  const overridden = new Map(
    prev.filter((p) => p.state === 'OVERRIDDEN').map((p) => [`${S(p.line_id)}:${S(p.code)}`, p]),
  );
  await exec(tx, `DELETE FROM invoice_match_exceptions WHERE invoice_id=$1::uuid`, invoiceId);
  let open = 0;
  let any = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = norm<Row>(lines[i]!);
    if (!l.grnLineId) {
      await exec(
        tx,
        `UPDATE purchase_invoice_lines SET match_status='OK', matched_value=taxable WHERE id=$1::uuid`,
        S(l.id),
      );
      continue;
    }
    any += 1;
    const gl = norm<Row>(
      (await query(tx, `SELECT * FROM goods_receipt_lines WHERE id=$1::uuid`, l.grnLineId))[0]!,
    );
    const pl = norm<Row>(
      (
        await query(
          tx,
          `SELECT net_rate::text FROM purchase_order_lines WHERE id=$1::uuid`,
          l.poLineId,
        )
      )[0]!,
    );
    const billedElsewhere = D(S(gl.billedQty)); // posted invoices only (this draft is not counted until posted)
    const calc =
      calcTaxByLine?.[i] ??
      str(
        D(S(l.cgst))
          .plus(D(S(l.sgst)))
          .plus(D(S(l.igst))),
      );
    const m = matchLine(
      {
        invoiceQty: D(S(l.qty)),
        invoiceRate: D(S(l.rate)),
        grnAcceptedQty: D(S(gl.acceptedQty)),
        alreadyBilledQty: billedElsewhere,
        poNetRate: D(S(pl.netRate)),
        invoiceTax: D(S(l.cgst))
          .plus(D(S(l.sgst)))
          .plus(D(S(l.igst))),
        expectedTax: D(calc),
      },
      { qtyPct: D(set.tolQtyPct), pricePct: D(set.tolPricePct), taxAmount: D(set.tolTaxAmount) },
    );
    let lineOpen = 0;
    const msgs: Record<string, string> = {
      QTY_OVER_RECEIPT: `Billed ${S(l.qty)}, received ${S(gl.acceptedQty)}${billedElsewhere.gt(0) ? ` (already billed ${str(billedElsewhere)})` : ''}`,
      PRICE_VARIANCE: `Rate ${S(l.rate)} differs from the PO rate ${S(pl.netRate)} by more than ${set.tolPricePct} %`,
      TAX_VARIANCE: `Tax on the invoice differs from the calculated tax by more than ₹${set.tolTaxAmount}`,
    };
    for (const code of m.codes) {
      const ov =
        overridden.get(`${S(l.id)}:${code}`) ?? overridden.get(`${S(lines[i]!.id)}:${code}`);
      await insertRow(tx, 'invoice_match_exceptions', {
        invoiceId,
        lineId: S(l.id),
        code,
        severity: 'ERROR',
        message: msgs[code],
        state: ov ? 'OVERRIDDEN' : 'OPEN',
        reason: ov ? ov.reason : null,
        overriddenById: ov ? ov.overridden_by_id : null,
        overriddenAt: ov ? ov.overridden_at : null,
      });
      if (!ov) lineOpen += 1;
    }
    open += lineOpen;
    await exec(
      tx,
      `UPDATE purchase_invoice_lines SET matched_value=$2::numeric, match_status=$3 WHERE id=$1::uuid`,
      S(l.id),
      str(m.matchedValue),
      m.codes.length === 0 ? 'OK' : lineOpen === 0 ? 'OVERRIDDEN' : 'ERROR',
    );
  }
  const state =
    any === 0
      ? 'MATCHED'
      : open > 0
        ? 'ON_HOLD'
        : (
              await query(
                tx,
                `SELECT 1 FROM invoice_match_exceptions WHERE invoice_id=$1::uuid LIMIT 1`,
                invoiceId,
              )
            ).length
          ? 'OVERRIDDEN'
          : 'MATCHED';
  await exec(tx, `UPDATE purchase_invoices SET match_state=$2 WHERE id=$1::uuid`, invoiceId, state);
  return { open };
}

// ============================================================================================ read
export async function getInvoice(db: Db, caller: Caller, id: string) {
  const h = await loadDoc(db, caller, PINV_DEF, id);
  const lines = await loadLines(db, PINV_DEF, id);
  const ex = await query(
    db,
    `SELECT * FROM invoice_match_exceptions WHERE invoice_id=$1::uuid ORDER BY created_at`,
    id,
  );
  const s = (await query(db, `SELECT name FROM suppliers WHERE id=$1::uuid`, h.supplier_id))[0];
  const n = norm<Row>(h);
  const itc = lines.reduce(
    (a, l) =>
      ['ELIGIBLE', 'CAPITAL_GOODS', 'INPUT_SERVICE'].includes(S(l.itc_flag))
        ? a
            .plus(D(S(l.cgst)))
            .plus(D(S(l.sgst)))
            .plus(D(S(l.igst)))
        : a,
    ZERO,
  );
  const eligibleSince = daysBetween(S(n.invoiceDate), todayIst());
  return {
    ...n,
    supplierName: s?.name,
    lines: lines.map((l) => norm<Row>(l)),
    exceptions: ex.map((e) => norm<Row>(e)),
    itcAmount: str(itc),
    itc180DaysLeft: 180 - eligibleSince,
    readiness: {
      dueDate: n.dueDate,
      msmeDueDate: n.msmeDueDate,
      tdsAmount: n.tdsAmount,
      netPayable: n.netPayable,
      outstanding: str(D(S(n.netPayable)).minus(D(S(n.paidAmount)))),
    },
  };
}

// ============================================================================================ post
async function costCenterCode(tx: Db, unitId: string, ccId?: string | null): Promise<string> {
  if (ccId) {
    const r = (await query(tx, `SELECT code FROM cost_centers WHERE id=$1::uuid`, ccId))[0];
    if (r) return S(r.code);
  }
  const r = (
    await query(
      tx,
      `SELECT code FROM cost_centers WHERE unit_id=$1::uuid AND NOT is_group AND status='Active' ORDER BY (code LIKE '%-STORE') DESC, code LIMIT 1`,
      unitId,
    )
  )[0];
  if (!r)
    throw Errors.validation({
      costCenter: 'This unit has no cost centre. Add one under Finance > Cost Centres.',
    });
  return S(r.code);
}

export async function postInvoice(tx: Db, id: string, actor: Actor): Promise<void> {
  const sid = (
    await query(tx, `SELECT supplier_id::text FROM purchase_invoices WHERE id=$1::uuid`, id)
  )[0];
  if (sid)
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1))`,
      `supplier-inv:${S(sid.supplier_id)}`,
    );
  const inv = (
    await query(
      tx,
      `SELECT * FROM purchase_invoices WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    )
  )[0];
  if (!inv) throw Errors.notFound('Record not found.');
  if (inv.status === 'Posted') return;
  if (inv.status !== 'Approved')
    throw Errors.conflict(
      'Submit the invoice for approval first; only an Approved invoice can be posted.',
    );
  const n = norm<Row>(inv);
  const unitId = S(inv.unit_id);
  const date = S(n.invoiceDate);
  await assertCanPost(tx, {
    unitId,
    fyId: S(inv.fy_id),
    postingDate: date,
    documentStatus: 'Approved',
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  const open = (await runMatch(tx, id)).open;
  if (open > 0)
    throw new AppError(
      409,
      'MATCH_BLOCKED',
      `Resolve or override the ${open} matching problems first.`,
    );
  const sup = await loadSupplier(tx, S(inv.supplier_id));
  assertBuyable(sup);
  const lines = (await loadLines(tx, PINV_DEF, id)).map((l) => norm<Row>(l));
  const charges = (
    await query(tx, `SELECT * FROM purchase_invoice_charges WHERE invoice_id=$1::uuid`, id)
  ).map((c) => norm<Row>(c));
  const landedByLine = new Set(charges.map((c) => S(c.amount)));
  void landedByLine;
  const isRcm = inv.is_rcm === true;
  // lock the GRN lines being billed, then re-check the quantities
  const legs: EventLine[] = [];
  const add = (account: string, debit: Dec, credit: Dec, line?: Row) => {
    if (debit.isZero() && credit.isZero()) return;
    legs.push({
      account,
      debit: str(round2(debit)),
      credit: str(round2(credit)),
      unitId,
      ...(line?.__cc ? { costCenter: S(line.__cc) } : {}),
    });
  };
  let ppvTotal = ZERO;
  for (const l of lines) {
    const taxable = D(S(l.taxable));
    if (l.grnLineId) {
      await query(
        tx,
        `SELECT id FROM goods_receipt_lines WHERE id=$1::uuid FOR UPDATE`,
        l.grnLineId,
      );
      const matched = D(S(l.matchedValue));
      add('GRIR', matched, ZERO);
      const ppv = taxable.minus(matched);
      ppvTotal = ppvTotal.plus(ppv);
      await exec(
        tx,
        `UPDATE goods_receipt_lines SET billed_qty = billed_qty + $1::numeric WHERE id=$2::uuid`,
        S(l.qty),
        S(l.grnLineId),
      );
      await exec(
        tx,
        `UPDATE purchase_order_lines SET billed_qty = billed_qty + $1::numeric WHERE id=$2::uuid`,
        S(l.qty),
        S(l.poLineId),
      );
    } else {
      if (l.landedGrnId) add('LANDED_COST_CLEARING', taxable, ZERO);
      else
        add('PURCHASE_EXPENSE', taxable, ZERO, {
          __cc: await costCenterCode(tx, unitId, (l.costCenterId as string | null) ?? null),
        });
    }
    const heads: [string, Dec][] = [
      ['CGST', D(S(l.cgst))],
      ['SGST', D(S(l.sgst))],
      ['IGST', D(S(l.igst))],
    ];
    for (const [head, amt] of heads) {
      if (amt.isZero()) continue;
      const flag = S(l.itcFlag);
      if (flag === 'INELIGIBLE_17_5')
        add('ITC_INELIGIBLE_EXPENSE', amt, ZERO, {
          __cc: await costCenterCode(tx, unitId, (l.costCenterId as string | null) ?? null),
        });
      else if (flag === 'NOT_APPLICABLE')
        add(l.grnLineId ? 'PURCHASE_PRICE_VARIANCE' : 'PURCHASE_EXPENSE', amt, ZERO, {
          __cc: await costCenterCode(tx, unitId, (l.costCenterId as string | null) ?? null),
        });
      else add(`INPUT_${head}`, amt, ZERO);
      if (isRcm) add(`RCM_PAYABLE_${head}`, ZERO, amt);
    }
  }
  if (!ppvTotal.isZero())
    legs.push({
      account: 'PURCHASE_PRICE_VARIANCE',
      debit: ppvTotal.gt(0) ? str(round2(ppvTotal)) : '0.00',
      credit: ppvTotal.lt(0) ? str(round2(ppvTotal.abs())) : '0.00',
      unitId,
      costCenter: await costCenterCode(tx, unitId),
    });
  const roundOff = D(S(n.roundOff));
  if (!roundOff.isZero())
    legs.push({
      account: 'ROUND_OFF',
      debit: roundOff.gt(0) ? str(roundOff) : '0.00',
      credit: roundOff.lt(0) ? str(roundOff.abs()) : '0.00',
      unitId,
      costCenter: await costCenterCode(tx, unitId),
    });
  // TDS: the cumulative ledger is locked per supplier + year + section
  const fyId = S(inv.fy_id);
  let ledgerId: string | null = null;
  const tdsCode = (inv.tds_section_code as string | null) ?? null;
  let tds = ZERO;
  if (tdsCode) {
    const t = await tdsPreviewFor(
      tx,
      S(inv.supplier_id),
      fyId,
      tdsCode,
      D(S(n.taxable)),
      date,
      true,
    );
    tds = t.tds;
    ledgerId = await insertRow(tx, 'supplier_tds_ledger', {
      supplierId: inv.supplier_id,
      fyId,
      sectionCode: tdsCode,
      docType: 'PINV',
      docId: id,
      docDate: date,
      base: str(t.base),
      cumBaseAfter: str(t.cumBaseAfter),
      cumTdsBaseAfter: str(t.cumTdsBaseAfter),
      tdsAmount: str(t.tds),
      needsReview: true,
      createdById: actor.userId,
    });
    await exec(
      tx,
      `UPDATE purchase_invoices SET tds_base=$2::numeric, tds_amount=$3::numeric, net_payable=grand_total - $3::numeric, tds_ledger_id=$4::uuid WHERE id=$1::uuid`,
      id,
      str(t.base),
      str(t.tds),
      ledgerId,
    );
    if (t.tds.gt(0))
      legs.push({ account: 'TDS_PAYABLE', debit: '0.00', credit: str(t.tds), unitId });
  }
  const grand = isRcm ? D(S(n.taxable)) : D(S(n.grandTotal));
  const ap = grand.minus(tds);
  legs.push({
    account: 'AP_CONTROL',
    debit: '0.00',
    credit: str(round2(ap)),
    unitId,
    partyId: S(inv.supplier_id),
    partyType: 'SUPPLIER',
  });
  let selfNo: string | null = null;
  if (isRcm) selfNo = await allocateNumber(tx, PINV_DEF, unitId, fyId, 'scm-purchaseinvoice:rcm');
  const journal = await PostingService.postJournal(
    tx,
    {
      unitId,
      docDate: date,
      voucherType: 'Purchase Invoice',
      source: 'EVENT',
      narration: `Purchase invoice ${S(inv.number)} (${S(n.vendorInvoiceNo)})`,
      sourceDocType: 'purchase_invoice',
      sourceDocId: id,
      sourceDocNo: S(inv.number),
      referenceNo: S(n.vendorInvoiceNo),
      event: 'PINV_POST',
      payload: {
        docNo: S(n.vendorInvoiceNo),
        dueDate: S(n.dueDate ?? date),
        partyId: S(inv.supplier_id),
        partyType: 'SUPPLIER',
        lines: legs,
      },
    },
    { userId: actor.userId },
  );
  if (n.msmeDueDate)
    await exec(
      tx,
      `UPDATE open_items SET msme_due_date=$2::date WHERE journal_id=$1::uuid AND party_id=$3::uuid`,
      journal.id,
      S(n.msmeDueDate),
      S(inv.supplier_id),
    );
  await exec(
    tx,
    `UPDATE purchase_invoices SET status='Posted', posted_at=now(), journal_id=$2::uuid, self_invoice_no=$3, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
    id,
    journal.id,
    selfNo,
    actor.userId,
  );
  await feedPurchaseInvoice(tx, id, actor.userId);
  await audit(
    tx,
    null,
    actor.userId,
    'SCM_POSTED',
    PINV_DEF.title,
    { id, code: S(inv.number) },
    PINV_DEF.pageId,
    { journal: journal.code, tds: str(tds) },
  );
}

// ============================================================================================ cancel
async function cancelInvoice(caller: Caller, id: string, reason: string) {
  if (reason.trim().length < 5)
    throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
  await prisma.$transaction(async (tx) => {
    const inv = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
    if (inv.status === 'Cancelled') throw Errors.conflict('This invoice is already cancelled.');
    if (inv.status !== 'Posted')
      throw Errors.conflict('Only a posted invoice is cancelled; delete a draft instead.');
    if (D(S(norm<Row>(inv).paidAmount)).gt(0))
      throw Errors.conflict('This invoice has payments. Cancel the payment first.');
    const dn = (
      await query(
        tx,
        `SELECT count(*)::int AS n FROM debit_notes WHERE invoice_id=$1::uuid AND status='Posted'`,
        id,
      )
    )[0];
    if (Number(dn?.n ?? 0) > 0)
      throw Errors.conflict('A debit note was posted against this invoice. Cancel it first.');
    if (inv.tds_ledger_id) {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `tds:${S(inv.supplier_id)}:${S(inv.fy_id)}:${S(inv.tds_section_code)}`,
      );
      const last = await tdsState(tx, S(inv.supplier_id), S(inv.fy_id), S(inv.tds_section_code));
      if (last.lastId !== S(inv.tds_ledger_id))
        throw new AppError(
          409,
          'TDS_LATER_ENTRIES',
          'Cancel later TDS entries of this supplier first.',
        );
      const row = (
        await query(tx, `SELECT * FROM supplier_tds_ledger WHERE id=$1::uuid`, inv.tds_ledger_id)
      )[0]!;
      const prev = D(S(row.cum_base_after)).minus(D(S(row.base)));
      const prevTax = (
        await query(
          tx,
          `SELECT cum_tds_base_after::text FROM supplier_tds_ledger WHERE supplier_id=$1::uuid AND fy_id=$2::uuid AND section_code=$3 AND id <> $4::uuid ORDER BY seq DESC LIMIT 1`,
          inv.supplier_id,
          inv.fy_id,
          row.section_code,
          row.id,
        )
      )[0];
      await insertRow(tx, 'supplier_tds_ledger', {
        supplierId: row.supplier_id,
        fyId: row.fy_id,
        sectionCode: row.section_code,
        docType: 'REVERSAL',
        docId: id,
        docDate: todayIst(),
        base: str(D(S(row.base)).neg()),
        cumBaseAfter: str(prev),
        cumTdsBaseAfter: prevTax ? S(prevTax.cum_tds_base_after) : '0',
        tdsAmount: str(D(S(row.tds_amount)).neg()),
        reversesId: row.id,
        createdById: caller.auth.userId,
      });
    }
    const today = todayIst();
    const rev = await PostingService.reverse(
      tx,
      S(inv.journal_id),
      reason.trim(),
      { userId: caller.auth.userId },
      { reversalDate: today },
    );
    for (const l of await loadLines(tx, PINV_DEF, id)) {
      if (l.grn_line_id)
        await exec(
          tx,
          `UPDATE goods_receipt_lines SET billed_qty = billed_qty - $1::numeric WHERE id=$2::uuid`,
          S(l.qty),
          S(l.grn_line_id),
        );
      if (l.po_line_id)
        await exec(
          tx,
          `UPDATE purchase_order_lines SET billed_qty = billed_qty - $1::numeric WHERE id=$2::uuid`,
          S(l.qty),
          S(l.po_line_id),
        );
    }
    await exec(
      tx,
      `UPDATE purchase_invoices SET status='Cancelled', cancelled_at=now(), cancel_reason=$2, cancel_journal_id=$3::uuid, version=version+1, updated_by_id=$4::uuid, updated_at=now() WHERE id=$1::uuid`,
      id,
      reason.trim(),
      rev.id,
      caller.auth.userId,
    );
    await audit(
      tx,
      caller,
      caller.auth.userId,
      'SCM_CANCELLED',
      PINV_DEF.title,
      { id, code: S(inv.number) },
      PINV_DEF.pageId,
      { reason },
    );
  }, TX);
  return getInvoice(prisma, caller, id);
}

// ============================================================================================ service
export const invoiceService = {
  async list(
    caller: Caller,
    q: {
      q?: string | undefined;
      status?: string | undefined;
      supplierId?: string | undefined;
      matchState?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, PINV_DEF.pageId);
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.q) {
      args.push(`%${q.q}%`);
      where.push(`(t.number ILIKE $${args.length} OR t.vendor_invoice_no ILIKE $${args.length})`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status = $${args.length}`);
    }
    if (q.supplierId) {
      args.push(q.supplierId);
      where.push(`t.supplier_id = $${args.length}::uuid`);
    }
    if (q.matchState) {
      args.push(q.matchState);
      where.push(`t.match_state = $${args.length}`);
    }
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM purchase_invoices t WHERE ${where.join(' AND ')}`,
          ...args,
        )
      )[0]?.n ?? 0,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, s.name AS supplier_name FROM purchase_invoices t JOIN suppliers s ON s.id=t.supplier_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm(r)), total };
  },
  get: (caller: Caller, id: string) => getInvoice(prisma, caller, id),
  create: (caller: Caller, body: InvBody) => saveInvoice(caller, null, undefined, body),
  update: (caller: Caller, id: string, ifMatch: number | undefined, body: InvBody) =>
    saveInvoice(caller, id, ifMatch, body),

  /** Lines of posted GRNs not yet fully billed, for "Create invoice from GRN". */
  async fromGrn(caller: Caller, grnId: string) {
    const g = await loadDoc(
      prisma,
      caller,
      { pageId: 'scm-grn', table: 'goods_receipts', title: 'Goods Receipt', amountCol: null },
      grnId,
    );
    if (g.status !== 'Posted') throw Errors.conflict('The goods receipt is not posted.');
    const lines = await query(
      prisma,
      `SELECT gl.id::text AS grn_line_id, gl.item_id::text, i.code AS item_code, i.name AS item_name, gl.uom, gl.accepted_qty::text, gl.billed_qty::text, pl.net_rate::text AS rate, pl.gst_pct::text, pl.hsn_sac
        FROM goods_receipt_lines gl JOIN purchase_order_lines pl ON pl.id=gl.po_line_id JOIN items i ON i.id=gl.item_id WHERE gl.grn_id=$1::uuid AND gl.accepted_qty - gl.billed_qty > 0 ORDER BY gl.line_no`,
      grnId,
    );
    return {
      supplierId: g.supplier_id,
      poId: g.po_id,
      grnId,
      lines: lines.map((l) => ({
        ...norm<Row>(l),
        qty: str(D(S(l.accepted_qty)).minus(D(S(l.billed_qty)))),
      })),
    };
  },

  async match(caller: Caller, id: string) {
    await prisma.$transaction(async (tx) => {
      const inv = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
      if (inv.status === 'Posted' || inv.status === 'Cancelled')
        throw Errors.conflict('A posted invoice cannot be matched again.');
      await runMatch(tx, id);
    }, TX);
    return getInvoice(prisma, caller, id);
  },

  async overrideException(caller: Caller, id: string, eid: string, reason: string) {
    if (reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    await prisma.$transaction(async (tx) => {
      const inv = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
      if (inv.status === 'Posted' || inv.status === 'Cancelled')
        throw Errors.conflict('A posted invoice cannot be changed.');
      const ex = (
        await query(
          tx,
          `SELECT * FROM invoice_match_exceptions WHERE id=$1::uuid AND invoice_id=$2::uuid FOR UPDATE`,
          eid,
          id,
        )
      )[0];
      if (!ex) throw Errors.notFound('Problem not found.');
      if (ex.state === 'OVERRIDDEN') throw Errors.conflict('This problem is already overridden.');
      await exec(
        tx,
        `UPDATE invoice_match_exceptions SET state='OVERRIDDEN', reason=$2, overridden_by_id=$3::uuid, overridden_at=now() WHERE id=$1::uuid`,
        eid,
        reason.trim(),
        caller.auth.userId,
      );
      await runMatch(tx, id);
      await exec(tx, `UPDATE purchase_invoices SET version=version+1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_MATCH_OVERRIDDEN',
        PINV_DEF.title,
        { id, code: S(inv.number) },
        PINV_DEF.pageId,
        { code: S(ex.code), reason: reason.trim() },
      );
    }, TX);
    return getInvoice(prisma, caller, id);
  },

  async setItc(caller: Caller, id: string, flags: { lineId: string; itcFlag: string }[]) {
    await prisma.$transaction(async (tx) => {
      const inv = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
      if (inv.status === 'Posted' || inv.status === 'Cancelled')
        throw Errors.conflict('The ITC flag cannot change after posting.');
      for (const f of flags) {
        const n = await exec(
          tx,
          `UPDATE purchase_invoice_lines SET itc_flag=$1 WHERE id=$2::uuid AND invoice_id=$3::uuid`,
          f.itcFlag,
          f.lineId,
          id,
        );
        if (n !== 1) throw Errors.notFound('Invoice line not found.');
      }
      await exec(tx, `UPDATE purchase_invoices SET version=version+1 WHERE id=$1::uuid`, id);
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_ITC_FLAG_SET',
        PINV_DEF.title,
        { id, code: S(inv.number) },
        PINV_DEF.pageId,
        { flags: flags.map((f) => `${f.lineId}:${f.itcFlag}`) },
      );
    }, TX);
    return getInvoice(prisma, caller, id);
  },

  async setGstr2b(caller: Caller, id: string, status: string) {
    await prisma.$transaction(async (tx) => {
      const inv = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
      await exec(
        tx,
        `UPDATE purchase_invoices SET gstr2b_status=$2, version=version+1 WHERE id=$1::uuid`,
        id,
        status,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_UPDATED',
        PINV_DEF.title,
        { id, code: S(inv.number) },
        PINV_DEF.pageId,
        { gstr2b: status },
      );
    }, TX);
    return getInvoice(prisma, caller, id);
  },

  async tdsPreview(caller: Caller, id: string) {
    const inv = await loadDoc(prisma, caller, PINV_DEF, id);
    const n = norm<Row>(inv);
    const t = await tdsPreviewFor(
      prisma,
      S(inv.supplier_id),
      S(inv.fy_id),
      (inv.tds_section_code as string | null) ?? null,
      D(S(n.taxable)),
      S(n.invoiceDate),
    );
    return {
      section: t.section,
      base: str(t.base),
      tds: str(t.tds),
      ratePct: str(t.ratePct),
      cumBaseAfter: str(t.cumBaseAfter),
      needsReview: true,
    };
  },

  async submit(caller: Caller, id: string, ifMatch: number | undefined) {
    concreteUnit(caller);
    // the match and the "on hold" notice are committed first; only then is MATCH_BLOCKED thrown
    const open = await prisma.$transaction(async (tx) => {
      const inv = await loadDoc(tx, caller, PINV_DEF, id, { lock: true });
      assertEditable(inv, 'purchase invoice');
      const m = await runMatch(tx, id);
      if (m.open > 0)
        await notificationService.notify(tx, [S(inv.created_by_id)], {
          type: 'SCM_INVOICE_ON_HOLD',
          title: `Invoice ${S(inv.number)} is on hold: ${m.open} matching problem(s)`,
          link: '/m/scm-purchaseinvoice',
          dedupeKey: `pinv-hold:${id}`,
        });
      return m.open;
    }, TX);
    if (open > 0)
      throw new AppError(
        409,
        'MATCH_BLOCKED',
        `Resolve or override the ${open} matching problems first.`,
      );
    await submitDoc(caller, PINV_DEF, id, ifMatch);
    return getInvoice(prisma, caller, id);
  },
  async post(caller: Caller, id: string) {
    await prisma.$transaction(async (tx) => {
      await loadDoc(tx, caller, PINV_DEF, id);
      await postInvoice(tx, id, { userId: caller.auth.userId });
    }, TX);
    return getInvoice(prisma, caller, id);
  },
  cancel: cancelInvoice,
};

// ============================================================================================ debit notes
export interface DnLineIn {
  grnLineId?: string | null;
  invoiceLineId?: string | null;
  qty?: string;
  /** RATE_DIFF / SHORT_SUPPLY / QUALITY: the rate difference per unit */
  rate?: string;
}
export interface DnBody {
  kind: 'RETURN' | 'RATE_DIFF' | 'SHORT_SUPPLY' | 'QUALITY';
  supplierId: string;
  invoiceId?: string | null;
  grnId?: string | null;
  noteDate?: string;
  reason?: string | null;
  lines: DnLineIn[];
}

async function saveDebitNote(
  caller: Caller,
  id: string | null,
  ifMatch: number | undefined,
  b: DnBody,
) {
  const unitId = concreteUnit(caller);
  const fy = await fyOfCaller(caller);
  const outId = await prisma.$transaction(async (tx) => {
    let cur: Row | null = null;
    if (id) {
      cur = await loadDoc(tx, caller, DN_DEF, id, { lock: true });
      assertEditable(cur, 'debit note');
      checkVersion(cur, ifMatch);
    }
    const sup = await loadSupplier(tx, b.supplierId);
    const us = await unitState(tx, unitId);
    const intra = sup.stateCode === us;
    if (b.lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    const out: Row[] = [];
    const taxes: LineTax[] = [];
    for (let i = 0; i < b.lines.length; i += 1) {
      const l = b.lines[i]!;
      const at = (f: string) => `lines.${i}.${f}`;
      if (b.kind === 'RETURN') {
        const gl = (
          await query(
            tx,
            `SELECT gl.*, g.supplier_id::text AS g_supplier, g.status AS g_status FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id WHERE gl.id=$1::uuid`,
            l.grnLineId ?? null,
          )
        )[0];
        if (!gl || gl.g_supplier !== b.supplierId || gl.g_status !== 'Posted')
          throw Errors.validation({
            [at('grnLineId')]: 'Choose a line of a posted receipt of this supplier.',
          });
        const qty = D(S(l.qty ?? 0));
        const max = D(S(norm<Row>(gl).receivedQty)).minus(D(S(norm<Row>(gl).returnedQty)));
        if (qty.lte(0))
          throw Errors.validation({ [at('qty')]: 'Enter a quantity greater than 0.' });
        if (qty.gt(max))
          throw new AppError(
            409,
            'RETURN_EXCEEDS_RECEIVED',
            `You can return at most ${str(max)}.`,
            { [at('qty')]: `You can return at most ${str(max)}.` },
          );
        let rate = D(
          S(
            norm<Row>(
              (
                await query(
                  tx,
                  `SELECT net_rate::text FROM purchase_order_lines WHERE id=$1::uuid`,
                  gl.po_line_id,
                )
              )[0]!,
            ).netRate,
          ),
        );
        let pct = ZERO;
        let invLineId: string | null = null;
        if (b.invoiceId) {
          const il = (
            await query(
              tx,
              `SELECT * FROM purchase_invoice_lines WHERE invoice_id=$1::uuid AND grn_line_id=$2::uuid`,
              b.invoiceId,
              l.grnLineId,
            )
          )[0];
          if (!il)
            throw Errors.validation({ [at('grnLineId')]: 'This line is not on that invoice.' });
          rate = D(S(il.rate));
          pct = D(S(il.gst_pct));
          invLineId = S(il.id);
        }
        const t = lineTax({
          qty,
          rate,
          discountPct: ZERO,
          gstPct: b.invoiceId ? pct : ZERO,
          intra,
        });
        taxes.push(t);
        out.push({
          grnLineId: l.grnLineId,
          invoiceLineId: invLineId,
          itemId: gl.item_id,
          qty: str(qty),
          rate: str(rate),
          gstPct: str(pct),
          taxable: str(t.taxable),
          cgst: str(t.cgst),
          sgst: str(t.sgst),
          igst: str(t.igst),
        });
      } else {
        const il = (
          await query(
            tx,
            `SELECT l.*, i.supplier_id::text AS inv_supplier FROM purchase_invoice_lines l JOIN purchase_invoices i ON i.id=l.invoice_id WHERE l.id=$1::uuid AND l.invoice_id=$2::uuid`,
            l.invoiceLineId ?? null,
            b.invoiceId ?? null,
          )
        )[0];
        if (!il || il.inv_supplier !== b.supplierId)
          throw Errors.validation({
            [at('invoiceLineId')]: 'Choose a line of an invoice of this supplier.',
          });
        const qty = D(S(l.qty ?? il.qty));
        const rate = D(S(l.rate ?? 0));
        if (rate.lte(0) || qty.lte(0))
          throw Errors.validation({ [at('rate')]: 'Enter the rate difference and quantity.' });
        const already = (
          await query(
            tx,
            `SELECT COALESCE(sum(n.taxable),0)::text AS t FROM debit_note_lines n JOIN debit_notes d ON d.id = n.note_id
              WHERE n.invoice_line_id = $1::uuid AND d.status <> 'Cancelled' AND d.deleted_at IS NULL AND ($2::uuid IS NULL OR d.id <> $2::uuid)`,
            il.id,
            id,
          )
        )[0];
        if (
          qty.gt(D(S(il.qty))) ||
          D(S(already?.t ?? 0))
            .plus(round2(qty.mul(rate)))
            .gt(D(S(il.taxable)))
        )
          throw Errors.validation({
            [at('qty')]:
              `A debit note cannot be more than the invoiced value of ${S(il.taxable)} (already noted: ${S(already?.t ?? 0)}).`,
          });
        const t = lineTax({ qty, rate, discountPct: ZERO, gstPct: D(S(il.gst_pct)), intra });
        taxes.push(t);
        out.push({
          grnLineId: il.grn_line_id,
          invoiceLineId: il.id,
          itemId: il.item_id,
          qty: str(qty),
          rate: str(rate),
          gstPct: S(il.gst_pct),
          taxable: str(t.taxable),
          cgst: str(t.cgst),
          sgst: str(t.sgst),
          igst: str(t.igst),
        });
      }
    }
    if (b.kind !== 'RETURN' && !b.invoiceId)
      throw Errors.validation({ invoiceId: 'Choose the invoice this note is against.' });
    const h = headerTotals(taxes);
    // returns on an invoice round to the rupee (spec example); a rate-difference note keeps paise (spec example)
    const roundIt = b.kind === 'RETURN' && !!b.invoiceId;
    const grand = roundIt ? h.grand : h.before;
    const header: Row = {
      supplierId: b.supplierId,
      kind: b.kind,
      invoiceId: b.invoiceId ?? null,
      grnId: b.grnId ?? null,
      noteDate: b.noteDate ?? todayIst(),
      regime: intra ? 'INTRA' : 'INTER',
      taxable: str(h.taxable),
      cgst: str(h.cgst),
      sgst: str(h.sgst),
      igst: str(h.igst),
      roundOff: roundIt ? str(h.roundOff) : '0',
      grandTotal: str(grand),
      reason: b.reason ?? null,
    };
    let nid = id;
    let number = cur ? S(cur.number) : '';
    if (!nid) {
      number = await allocateNumber(tx, DN_DEF, unitId, fy.id, 'scm-debitnote');
      nid = await insertRow(tx, 'debit_notes', {
        ...header,
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, 'fin-debitnote', caller),
        status: 'Draft',
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
    } else {
      await updateRow(tx, 'debit_notes', nid, {
        ...header,
        updatedAt: new Date(),
        updatedById: caller.auth.userId,
      });
      await exec(tx, `UPDATE debit_notes SET version=version+1 WHERE id=$1::uuid`, nid);
      await exec(tx, `DELETE FROM debit_note_lines WHERE note_id=$1::uuid`, nid);
    }
    let n = 0;
    for (const l of out) {
      n += 1;
      await insertRow(tx, 'debit_note_lines', { ...l, noteId: nid, lineNo: n });
    }
    await audit(
      tx,
      caller,
      caller.auth.userId,
      id ? 'SCM_UPDATED' : 'SCM_CREATED',
      DN_DEF.title,
      { id: nid, code: number },
      'fin-debitnote',
      { unitId, kind: b.kind },
    );
    return nid;
  }, TX);
  return getDebitNote(prisma, caller, outId);
}

export async function getDebitNote(db: Db, caller: Caller, id: string) {
  const h = await loadDoc(db, caller, DN_DEF, id);
  const lines = await loadLines(db, DN_DEF, id);
  const s = (await query(db, `SELECT name FROM suppliers WHERE id=$1::uuid`, h.supplier_id))[0];
  return { ...norm<Row>(h), supplierName: s?.name, lines: lines.map((l) => norm<Row>(l)) };
}

/** Takes the returned quantity out of stock: rejected (Blocked) stock first, then usable stock. */
async function returnStock(
  tx: Db,
  g: Row,
  gl: Row,
  qty: Dec,
  noteNo: string,
  noteId: string,
  date: string,
  actorId: string,
): Promise<Dec> {
  const n = norm<Row>(gl);
  const ratio = D(S(n.baseQty)).div(D(S(n.receivedQty)));
  let left = qty.mul(ratio).toDecimalPlaces(3, 4);
  let total = ZERO;
  const batches = await query(
    tx,
    `SELECT batch_id::text, qty::text, serial_nos FROM goods_receipt_batches WHERE grn_line_id=$1::uuid ORDER BY batch_no`,
    gl.id,
  );
  const targets =
    batches.length && batches.some((b) => b.batch_id)
      ? batches.map((b) => ({ batchId: b.batch_id as string | null }))
      : [{ batchId: null as string | null }];
  for (const status of ['BLOCKED', 'UNRESTRICTED'] as const) {
    for (const t of targets) {
      if (left.lte(0)) break;
      const sl = (
        await query(
          tx,
          `SELECT COALESCE(sum(qty),0)::text AS q FROM stock_slices WHERE item_id=$1::uuid AND warehouse_id=$2::uuid AND stock_status=$3 AND batch_id = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
          gl.item_id,
          g.warehouse_id,
          status,
          t.batchId,
        )
      )[0];
      const avail = D(S(sl?.q ?? 0));
      const take = left.lt(avail) ? left : avail;
      if (take.lte(0)) continue;
      const res = await StockService.postMovement(tx, {
        warehouseId: S(g.warehouse_id),
        itemId: S(gl.item_id),
        direction: 'OUT',
        qty: take,
        postingDate: date,
        voucherType: 'PURCH_RETURN',
        voucherId: noteId,
        voucherNo: noteNo,
        createdById: actorId,
        fromStatus: status,
        batchId: t.batchId,
        corrective: true,
      });
      total = total.plus(res.entries.reduce((a, e) => a.plus(e.value), ZERO));
      left = left.minus(take);
    }
  }
  if (left.gt(0))
    throw Errors.conflict('The stock to return is no longer there (it was used or moved).');
  return total;
}

export async function postDebitNote(tx: Db, id: string, actor: Actor): Promise<void> {
  const dn = (
    await query(
      tx,
      `SELECT * FROM debit_notes WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`,
      id,
    )
  )[0];
  if (!dn) throw Errors.notFound('Record not found.');
  if (dn.status === 'Posted') return;
  if (dn.status !== 'Approved') throw Errors.conflict('Submit the debit note for approval first.');
  const n = norm<Row>(dn);
  const unitId = S(dn.unit_id);
  const date = S(n.noteDate);
  await assertCanPost(tx, {
    unitId,
    fyId: S(dn.fy_id),
    postingDate: date,
    documentStatus: 'Approved',
    allowedStatuses: ['Approved'],
    action: 'post',
  });
  const lines = (await loadLines(tx, DN_DEF, id)).map((l) => norm<Row>(l));
  const legs: EventLine[] = [];
  const cc = await costCenterCode(tx, unitId);
  const keyMap = new Map(
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    (await tx.itemTypeAccount.findMany()).map((r) => [r.itemType, r.inventoryKey]),
  );
  let invCredit = ZERO;
  let grirDebit = ZERO;
  const invByKey = new Map<string, Dec>();
  let stockValueTotal = ZERO;
  for (const l of lines) {
    if (dn.kind === 'RETURN') {
      const gl = (
        await query(
          tx,
          `SELECT * FROM goods_receipt_lines WHERE id=$1::uuid FOR UPDATE`,
          l.grnLineId,
        )
      )[0]!;
      const g = (await query(tx, `SELECT * FROM goods_receipts WHERE id=$1::uuid`, gl.grn_id))[0]!;
      const value = await returnStock(tx, g, gl, D(S(l.qty)), S(dn.number), id, date, actor.userId);
      const it = (await query(tx, `SELECT item_type FROM items WHERE id=$1::uuid`, gl.item_id))[0]!;
      const key = keyMap.get(S(it.item_type)) ?? 'INVENTORY_RM';
      invByKey.set(key, (invByKey.get(key) ?? ZERO).plus(value));
      stockValueTotal = stockValueTotal.plus(value);
      invCredit = invCredit.plus(value);
      await exec(
        tx,
        `UPDATE goods_receipt_lines SET returned_qty = returned_qty + $1::numeric WHERE id=$2::uuid`,
        S(l.qty),
        S(gl.id),
      );
      await exec(
        tx,
        `UPDATE purchase_order_lines SET returned_qty = returned_qty + $1::numeric WHERE id=$2::uuid`,
        S(l.qty),
        S(gl.po_line_id),
      );
      await exec(
        tx,
        `UPDATE debit_note_lines SET stock_value=$2::numeric WHERE id=$1::uuid`,
        S(l.id),
        str(value),
      );
      if (!dn.invoice_id) {
        const poRate = D(
          S(
            norm<Row>(
              (
                await query(
                  tx,
                  `SELECT net_rate::text FROM purchase_order_lines WHERE id=$1::uuid`,
                  gl.po_line_id,
                )
              )[0]!,
            ).netRate,
          ),
        );
        grirDebit = grirDebit.plus(round2(D(S(l.qty)).mul(poRate)));
      }
    }
  }
  await exec(
    tx,
    `UPDATE debit_notes SET stock_value=$2::numeric WHERE id=$1::uuid`,
    id,
    str(stockValueTotal),
  );
  const tax = { CGST: D(S(n.cgst)), SGST: D(S(n.sgst)), IGST: D(S(n.igst)) };
  const grand = D(S(n.grandTotal));
  const roundOff = D(S(n.roundOff));
  if (dn.kind === 'RETURN') {
    for (const [key, v] of invByKey)
      legs.push({ account: key, debit: '0.00', credit: str(round2(v)), unitId });
    if (dn.invoice_id) {
      legs.push({
        account: 'AP_CONTROL',
        debit: str(round2(grand)),
        credit: '0.00',
        unitId,
        partyId: S(dn.supplier_id),
        partyType: 'SUPPLIER',
      });
      for (const [h, a] of Object.entries(tax))
        if (a.gt(0)) legs.push({ account: `INPUT_${h}`, debit: '0.00', credit: str(a), unitId });
      if (!roundOff.isZero())
        legs.push({
          account: 'ROUND_OFF',
          debit: roundOff.lt(0) ? str(roundOff.abs()) : '0.00',
          credit: roundOff.gt(0) ? str(roundOff) : '0.00',
          unitId,
          costCenter: cc,
        });
    } else legs.push({ account: 'GRIR', debit: str(round2(grirDebit)), credit: '0.00', unitId });
    const dr = legs.reduce((a, x) => a.plus(D(x.debit)), ZERO);
    const cr = legs.reduce((a, x) => a.plus(D(x.credit)), ZERO);
    const diff = cr.minus(dr); // PPV balances: debit when the credits are larger
    if (!diff.isZero())
      legs.push({
        account: 'PURCHASE_PRICE_VARIANCE',
        debit: diff.gt(0) ? str(round2(diff)) : '0.00',
        credit: diff.lt(0) ? str(round2(diff.abs())) : '0.00',
        unitId,
        costCenter: cc,
      });
  } else {
    // rate difference / short supply / quality: Dr AP, Cr PPV (net of tax), Cr INPUT tax
    legs.push({
      account: 'AP_CONTROL',
      debit: str(round2(grand)),
      credit: '0.00',
      unitId,
      partyId: S(dn.supplier_id),
      partyType: 'SUPPLIER',
    });
    legs.push({
      account: 'PURCHASE_PRICE_VARIANCE',
      debit: '0.00',
      credit: str(round2(D(S(n.taxable)))),
      unitId,
      costCenter: cc,
    });
    for (const [h, a] of Object.entries(tax))
      if (a.gt(0)) legs.push({ account: `INPUT_${h}`, debit: '0.00', credit: str(a), unitId });
  }
  const journal = await PostingService.postJournal(
    tx,
    {
      unitId,
      docDate: date,
      voucherType: 'Debit Note',
      source: 'EVENT',
      narration: `Debit note ${S(dn.number)}`,
      sourceDocType: 'purchase_debit_note',
      sourceDocId: id,
      sourceDocNo: S(dn.number),
      event: 'PDN_POST',
      payload: {
        docNo: S(dn.number),
        partyId: S(dn.supplier_id),
        partyType: 'SUPPLIER',
        lines: legs,
      },
    },
    { userId: actor.userId },
  );
  // TDS: a negative base row, so the next invoice is computed net
  if (dn.invoice_id) {
    const inv = (
      await query(
        tx,
        `SELECT supplier_id::text, fy_id::text, tds_section_code FROM purchase_invoices WHERE id=$1::uuid`,
        dn.invoice_id,
      )
    )[0]!;
    if (inv.tds_section_code) {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `tds:${S(inv.supplier_id)}:${S(inv.fy_id)}:${S(inv.tds_section_code)}`,
      );
      const st = await tdsState(tx, S(inv.supplier_id), S(inv.fy_id), S(inv.tds_section_code));
      const base = D(S(n.taxable)).neg();
      const lid = await insertRow(tx, 'supplier_tds_ledger', {
        supplierId: inv.supplier_id,
        fyId: inv.fy_id,
        sectionCode: inv.tds_section_code,
        docType: 'DN',
        docId: id,
        docDate: date,
        base: str(base),
        cumBaseAfter: str(st.cumBase.plus(base)),
        cumTdsBaseAfter: str(st.cumTdsBase.plus(base).lt(0) ? ZERO : st.cumTdsBase.plus(base)),
        tdsAmount: '0',
        needsReview: true,
        createdById: actor.userId,
      });
      await exec(tx, `UPDATE debit_notes SET tds_ledger_id=$2::uuid WHERE id=$1::uuid`, id, lid);
    }
  }
  await exec(
    tx,
    `UPDATE debit_notes SET status='Posted', posted_at=now(), journal_id=$2::uuid, version=version+1, updated_at=now(), updated_by_id=$3::uuid WHERE id=$1::uuid`,
    id,
    journal.id,
    actor.userId,
  );
  await feedDebitNote(tx, id, actor.userId);
  await audit(
    tx,
    null,
    actor.userId,
    'SCM_POSTED',
    DN_DEF.title,
    { id, code: S(dn.number) },
    'fin-debitnote',
    { journal: journal.code },
  );
}

export const debitNoteService = {
  async list(
    caller: Caller,
    q: {
      q?: string | undefined;
      status?: string | undefined;
      supplierId?: string | undefined;
      page: number;
      size: number;
    },
  ) {
    const sc = await scopeSql(caller, DN_DEF.pageId);
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
    if (q.supplierId) {
      args.push(q.supplierId);
      where.push(`t.supplier_id = $${args.length}::uuid`);
    }
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM debit_notes t WHERE ${where.join(' AND ')}`,
          ...args,
        )
      )[0]?.n ?? 0,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, s.name AS supplier_name FROM debit_notes t JOIN suppliers s ON s.id=t.supplier_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm(r)), total };
  },
  get: (caller: Caller, id: string) => getDebitNote(prisma, caller, id),
  create: (caller: Caller, body: DnBody) => saveDebitNote(caller, null, undefined, body),
  update: (caller: Caller, id: string, ifMatch: number | undefined, body: DnBody) =>
    saveDebitNote(caller, id, ifMatch, body),
  async post(caller: Caller, id: string) {
    await prisma.$transaction(async (tx) => {
      await loadDoc(tx, caller, DN_DEF, id);
      await postDebitNote(tx, id, { userId: caller.auth.userId });
    }, TX);
    return getDebitNote(prisma, caller, id);
  },
  async cancel(caller: Caller, id: string, reason: string) {
    if (reason.trim().length < 5)
      throw Errors.validation({ reason: 'Give a reason of at least 5 letters.' });
    await prisma.$transaction(async (tx) => {
      const dn = await loadDoc(tx, caller, DN_DEF, id, { lock: true });
      if (dn.status !== 'Posted') throw Errors.conflict('Only a posted debit note is cancelled.');
      if (dn.kind === 'RETURN')
        throw Errors.conflict(
          'A posted return cannot be cancelled here: receive the goods again with a new goods receipt.',
        );
      if (dn.tds_ledger_id) {
        const inv = (
          await query(
            tx,
            `SELECT supplier_id::text, fy_id::text, tds_section_code FROM purchase_invoices WHERE id=$1::uuid`,
            dn.invoice_id,
          )
        )[0]!;
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          `tds:${S(inv.supplier_id)}:${S(inv.fy_id)}:${S(inv.tds_section_code)}`,
        );
        const last = await tdsState(tx, S(inv.supplier_id), S(inv.fy_id), S(inv.tds_section_code));
        if (last.lastId !== S(dn.tds_ledger_id))
          throw new AppError(
            409,
            'TDS_LATER_ENTRIES',
            'Cancel later TDS entries of this supplier first.',
          );
        const row = (
          await query(tx, `SELECT * FROM supplier_tds_ledger WHERE id=$1::uuid`, dn.tds_ledger_id)
        )[0]!;
        const prev = (
          await query(
            tx,
            `SELECT cum_base_after::text, cum_tds_base_after::text FROM supplier_tds_ledger WHERE supplier_id=$1::uuid AND fy_id=$2::uuid AND section_code=$3 AND id <> $4::uuid ORDER BY seq DESC LIMIT 1`,
            row.supplier_id,
            row.fy_id,
            row.section_code,
            row.id,
          )
        )[0];
        await insertRow(tx, 'supplier_tds_ledger', {
          supplierId: row.supplier_id,
          fyId: row.fy_id,
          sectionCode: row.section_code,
          docType: 'REVERSAL',
          docId: id,
          docDate: todayIst(),
          base: str(D(S(row.base)).neg()),
          cumBaseAfter: prev ? S(prev.cum_base_after) : '0',
          cumTdsBaseAfter: prev ? S(prev.cum_tds_base_after) : '0',
          tdsAmount: '0',
          reversesId: row.id,
          createdById: caller.auth.userId,
        });
      }
      const rev = await PostingService.reverse(
        tx,
        S(dn.journal_id),
        reason.trim(),
        { userId: caller.auth.userId },
        { reversalDate: todayIst() },
      );
      await exec(
        tx,
        `UPDATE debit_notes SET status='Cancelled', cancel_journal_id=$2::uuid, version=version+1, updated_at=now(), updated_by_id=$3::uuid WHERE id=$1::uuid`,
        id,
        rev.id,
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_CANCELLED',
        DN_DEF.title,
        { id, code: S(dn.number) },
        'fin-debitnote',
        { reason },
      );
    }, TX);
    return getDebitNote(prisma, caller, id);
  },
};
