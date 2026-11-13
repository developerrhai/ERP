// 11-A2 GSTR-1, 11-A3 GSTR-3B, 11-A10 filing lock. Both returns are PREPARED from tax_documents (the one register the
// producers feed), the Phase 9 itc_reversals and the GST accounts of the ledger. Nothing is filed or sent to GSTN
// (R-12): the GSTR-1 file is for the offline tool, the person files on the portal and records the ARN here.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { FinErrors } from '../finance/errors';
import { validateGstin } from '../masters/party-rules';
import { knownStates } from '../masters/tax-service';
import { D, S, ZERO, ddmmyyyy, iso, money, num2, parseMonth, ruleNum, unitGst } from './common';
import type { Dec, Row } from './common';

export interface Issue {
  level: 'error' | 'warning';
  doc?: string;
  message: string;
}

interface Doc {
  id: string;
  kind: 'INV' | 'CRN' | 'DBN';
  no: string;
  date: string;
  partyName: string;
  partyGstin: string | null;
  pos: string;
  rcm: boolean;
  origNo: string | null;
  origDate: string | null;
  sourceType: string | null;
  sourceId: string | null;
  taxable: Dec;
  cgst: Dec;
  sgst: Dec;
  igst: Dec;
  lines: {
    hsn: string;
    uqc: string | null;
    qty: Dec;
    taxable: Dec;
    rate: Dec;
    cgst: Dec;
    sgst: Dec;
    igst: Dec;
  }[];
}

async function loadDocs(
  unitId: string,
  gstin: string,
  direction: 'OUTWARD' | 'INWARD',
  from: string,
  to: string,
  statuses: string[] = ['Active'],
): Promise<Doc[]> {
  // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
  const heads = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id::text, doc_kind, doc_no, doc_date, party_name, party_gstin, place_of_supply, reverse_charge,
            orig_doc_no, orig_doc_date, source_type, source_id::text, taxable::text, cgst::text, sgst::text, igst::text
       FROM tax_documents
      WHERE unit_id=$1::uuid AND gstin=$2 AND direction=$3 AND doc_date BETWEEN $4::date AND $5::date
        AND status = ANY($6::text[]) ORDER BY doc_date, doc_no`,
    unitId,
    gstin,
    direction,
    from,
    to,
    statuses,
  );
  if (!heads.length) return [];
  // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
  const lines = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT tax_document_id::text, hsn, uqc, qty::text, taxable::text, rate_pct::text, cgst::text, sgst::text, igst::text
       FROM tax_document_lines WHERE tax_document_id = ANY($1::uuid[]) ORDER BY tax_document_id, line_no`,
    heads.map((h) => S(h.id)),
  );
  const by = new Map<string, Doc['lines']>();
  for (const l of lines) {
    const arr = by.get(S(l.tax_document_id)) ?? [];
    arr.push({
      hsn: S(l.hsn),
      uqc: l.uqc ? S(l.uqc) : null,
      qty: D(S(l.qty)),
      taxable: D(S(l.taxable)),
      rate: D(S(l.rate_pct)),
      cgst: D(S(l.cgst)),
      sgst: D(S(l.sgst)),
      igst: D(S(l.igst)),
    });
    by.set(S(l.tax_document_id), arr);
  }
  return heads.map((h) => ({
    id: S(h.id),
    kind: S(h.doc_kind) as Doc['kind'],
    no: S(h.doc_no),
    date: iso(h.doc_date),
    partyName: S(h.party_name),
    partyGstin: h.party_gstin ? S(h.party_gstin) : null,
    pos: S(h.place_of_supply),
    rcm: h.reverse_charge === true,
    origNo: h.orig_doc_no ? S(h.orig_doc_no) : null,
    origDate: h.orig_doc_date ? iso(h.orig_doc_date) : null,
    sourceType: h.source_type ? S(h.source_type) : null,
    sourceId: h.source_id ? S(h.source_id) : null,
    taxable: D(S(h.taxable)),
    cgst: D(S(h.cgst)),
    sgst: D(S(h.sgst)),
    igst: D(S(h.igst)),
    lines: by.get(S(h.id)) ?? [],
  }));
}

const total = (d: Doc): Dec => d.taxable.plus(d.cgst).plus(d.sgst).plus(d.igst);

/** group a document's lines by rate: the GSTR-1 "itms" */
function itemsByRate(d: Doc) {
  const m = new Map<string, { rt: Dec; txval: Dec; iamt: Dec; camt: Dec; samt: Dec }>();
  for (const l of d.lines) {
    const k = l.rate.toString();
    const cur = m.get(k) ?? { rt: l.rate, txval: ZERO, iamt: ZERO, camt: ZERO, samt: ZERO };
    cur.txval = cur.txval.plus(l.taxable);
    cur.iamt = cur.iamt.plus(l.igst);
    cur.camt = cur.camt.plus(l.cgst);
    cur.samt = cur.samt.plus(l.sgst);
    m.set(k, cur);
  }
  return [...m.values()].map((x, i) => ({
    num: i + 1,
    itm_det: {
      txval: num2(x.txval),
      rt: Number(x.rt.toString()),
      iamt: num2(x.iamt),
      camt: num2(x.camt),
      samt: num2(x.samt),
      csamt: 0,
    },
  }));
}

export const returnsService = {
  async gstr1(unitId: string | null, month: string) {
    const ug = await unitGst(unitId);
    const per = parseMonth(month);
    const states = await knownStates(prisma);
    const b2clLimit = await ruleNum('GSTR1_B2CL_LIMIT', per.end);
    const jsonVersion =
      (
        await prisma.$queryRawUnsafe<Row[]>(
          `SELECT value_text FROM tax_rules WHERE rule_key='GSTR1_JSON_VERSION' AND effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1`,
          per.end,
        )
      )[0]?.value_text ?? null;
    const docs = await loadDocs(ug.unitId, ug.gstin, 'OUTWARD', per.start, per.end);
    const cancelled = await loadDocs(ug.unitId, ug.gstin, 'OUTWARD', per.start, per.end, [
      'Cancelled',
    ]);
    const issues: Issue[] = [];
    const einv = new Set(
      (
        // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
        await prisma.$queryRawUnsafe<Row[]>(
          `SELECT doc_id::text FROM einvoice_records WHERE unit_id=$1::uuid AND status='Generated'`,
          ug.unitId,
        )
      ).map((r) => S(r.doc_id)),
    );

    const b2b: Doc[] = [];
    const b2cl: Doc[] = [];
    const b2csDocs: Doc[] = [];
    const cdnr: Doc[] = [];
    const cdnur: Doc[] = [];
    const b2csNotes: Doc[] = []; // small unregistered notes are netted into B2CS
    const exp: Doc[] = [];
    for (const d of docs) {
      const inter = d.pos !== ug.stateCode;
      if (d.pos === '96') {
        if (d.kind === 'INV') exp.push(d);
        continue;
      }
      if (d.kind === 'INV') {
        if (d.partyGstin) b2b.push(d);
        else if (inter && total(d).greaterThan(b2clLimit)) b2cl.push(d);
        else b2csDocs.push(d);
      } else if (d.partyGstin) cdnr.push(d);
      else if (inter && total(d).greaterThan(b2clLimit)) cdnur.push(d);
      else b2csNotes.push(d);
    }

    // validation (errors stop the file; warnings do not)
    for (const d of docs) {
      const tag = `${d.kind} ${d.no}`;
      if (d.no.length > 16)
        issues.push({
          level: 'error',
          doc: tag,
          message:
            'The document number is longer than 16 characters (the offline tool refuses it).',
        });
      if (!/^[A-Za-z0-9/-]+$/.test(d.no))
        issues.push({
          level: 'error',
          doc: tag,
          message: 'The document number has a character other than letters, digits, / and -.',
        });
      if (!d.lines.length)
        issues.push({ level: 'error', doc: tag, message: 'The document has no tax lines.' });
      for (const l of d.lines) {
        if (!/^\d{4,8}$/.test(l.hsn))
          issues.push({ level: 'error', doc: tag, message: 'A line has no HSN / SAC code.' });
        else if (l.hsn.length < ug.minHsnDigits)
          issues.push({
            level: 'warning',
            doc: tag,
            message: `HSN ${l.hsn} has fewer than ${ug.minHsnDigits} digits (the registration asks for ${ug.minHsnDigits}).`,
          });
      }
      if (d.partyGstin) {
        const v = validateGstin(d.partyGstin, states.codes);
        if (!v.ok)
          issues.push({
            level: 'error',
            doc: tag,
            message: `Customer GSTIN ${d.partyGstin}: ${v.message}`,
          });
      }
      const inter = d.pos !== ug.stateCode;
      if (inter && (d.cgst.greaterThan(0) || d.sgst.greaterThan(0)))
        issues.push({
          level: 'error',
          doc: tag,
          message: 'Supply to another state carries CGST / SGST.',
        });
      if (!inter && d.igst.greaterThan(0))
        issues.push({ level: 'error', doc: tag, message: 'Supply inside the state carries IGST.' });
      if (d.kind !== 'INV' && !d.origNo)
        issues.push({
          level: 'error',
          doc: tag,
          message: 'The note does not name the invoice it corrects.',
        });
      if (ug.einvoiceEnabled && d.partyGstin && d.sourceId && !einv.has(d.sourceId))
        issues.push({
          level: 'warning',
          doc: tag,
          message: 'No IRN recorded for this B2B document (the registration is e-invoice enabled).',
        });
    }
    if (cancelled.length)
      issues.push({
        level: 'warning',
        message: `${cancelled.length} cancelled document(s) are listed in the document summary, not in the tables.`,
      });
    if (!docs.length)
      issues.push({
        level: 'warning',
        message: 'No outward documents in this month (a nil return).',
      });

    // B2CS: aggregate by place of supply and rate
    const b2cs = new Map<
      string,
      { pos: string; rt: Dec; txval: Dec; iamt: Dec; camt: Dec; samt: Dec }
    >();
    for (const d of [...b2csDocs, ...b2csNotes])
      for (const l of d.lines) {
        const sg = d.kind === 'INV' ? 1 : -1;
        const k = `${d.pos}|${l.rate.toString()}`;
        const c = b2cs.get(k) ?? {
          pos: d.pos,
          rt: l.rate,
          txval: ZERO,
          iamt: ZERO,
          camt: ZERO,
          samt: ZERO,
        };
        c.txval = c.txval.plus(l.taxable.times(sg));
        c.iamt = c.iamt.plus(l.igst.times(sg));
        c.camt = c.camt.plus(l.cgst.times(sg));
        c.samt = c.samt.plus(l.sgst.times(sg));
        b2cs.set(k, c);
      }

    // HSN summary (credit notes reduce it)
    const hsn = new Map<
      string,
      { hsn: string; uqc: string; rt: Dec; qty: Dec; txval: Dec; iamt: Dec; camt: Dec; samt: Dec }
    >();
    for (const d of docs) {
      const sign = d.kind === 'INV' ? 1 : -1;
      for (const l of d.lines) {
        const k = `${l.hsn}|${l.uqc ?? ''}|${l.rate.toString()}`;
        const c = hsn.get(k) ?? {
          hsn: l.hsn,
          uqc: l.uqc ?? 'OTH',
          rt: l.rate,
          qty: ZERO,
          txval: ZERO,
          iamt: ZERO,
          camt: ZERO,
          samt: ZERO,
        };
        c.qty = c.qty.plus(l.qty.times(sign));
        c.txval = c.txval.plus(l.taxable.times(sign));
        c.iamt = c.iamt.plus(l.igst.times(sign));
        c.camt = c.camt.plus(l.cgst.times(sign));
        c.samt = c.samt.plus(l.sgst.times(sign));
        hsn.set(k, c);
      }
    }

    // document summary
    const docSum = (kind: 'INV' | 'CRN') => {
      const live = docs.filter((d) => d.kind === kind);
      const can = cancelled.filter((d) => d.kind === kind);
      const all = [...live, ...can].map((d) => d.no).sort();
      return {
        docType: kind === 'INV' ? 'Invoices for outward supply' : 'Credit notes',
        from: all[0] ?? '',
        to: all[all.length - 1] ?? '',
        total: all.length,
        cancelled: can.length,
        net: live.length,
      };
    };

    const sum = (list: Doc[], f: (d: Doc) => Dec) => list.reduce((a, d) => a.plus(f(d)), ZERO);
    const section = (list: Doc[]) => ({
      count: list.length,
      taxable: money(sum(list, (d) => d.taxable)),
      igst: money(sum(list, (d) => d.igst)),
      cgst: money(sum(list, (d) => d.cgst)),
      sgst: money(sum(list, (d) => d.sgst)),
    });
    const fp = `${month.slice(5, 7)}${month.slice(0, 4)}`;
    const noteRow = (d: Doc) => ({
      ntty: d.kind === 'CRN' ? 'C' : 'D',
      nt_num: d.no,
      nt_dt: ddmmyyyy(d.date),
      p_gst: 'N',
      inum: d.origNo ?? '',
      idt: d.origDate ? ddmmyyyy(d.origDate) : '',
      val: num2(total(d)),
      itms: itemsByRate(d),
    });
    const groupBy = <T>(list: T[], key: (x: T) => string) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
      return [...m.entries()];
    };
    const file = {
      gstin: ug.gstin,
      fp,
      version: jsonVersion,
      hash: 'hash',
      b2b: groupBy(b2b, (d) => d.partyGstin as string).map(([ctin, list]) => ({
        ctin,
        inv: list.map((d) => ({
          inum: d.no,
          idt: ddmmyyyy(d.date),
          val: num2(total(d)),
          pos: d.pos,
          rchrg: 'N',
          inv_typ: 'R',
          itms: itemsByRate(d),
        })),
      })),
      b2cl: groupBy(b2cl, (d) => d.pos).map(([pos, list]) => ({
        pos,
        inv: list.map((d) => ({
          inum: d.no,
          idt: ddmmyyyy(d.date),
          val: num2(total(d)),
          itms: itemsByRate(d),
        })),
      })),
      b2cs: [...b2cs.values()].map((x) => ({
        sply_ty: x.pos === ug.stateCode ? 'INTRA' : 'INTER',
        pos: x.pos,
        typ: 'OE',
        txval: num2(x.txval),
        rt: Number(x.rt.toString()),
        iamt: num2(x.iamt),
        camt: num2(x.camt),
        samt: num2(x.samt),
        csamt: 0,
      })),
      cdnr: groupBy(cdnr, (d) => d.partyGstin as string).map(([ctin, list]) => ({
        ctin,
        nt: list.map(noteRow),
      })),
      cdnur: cdnur.map((d) => ({ ...noteRow(d), typ: 'B2CL' })),
      exp: exp.length
        ? [
            {
              exp_typ: 'WOPAY',
              inv: exp.map((d) => ({
                inum: d.no,
                idt: ddmmyyyy(d.date),
                val: num2(total(d)),
                itms: itemsByRate(d),
              })),
            },
          ]
        : [],
      hsn: {
        data: [...hsn.values()].map((x, i) => ({
          num: i + 1,
          hsn_sc: x.hsn,
          uqc: x.uqc,
          qty: Number(x.qty.toFixed(3)),
          rt: Number(x.rt.toString()),
          txval: num2(x.txval),
          iamt: num2(x.iamt),
          camt: num2(x.camt),
          samt: num2(x.samt),
          csamt: 0,
        })),
      },
      doc_issue: { doc_det: [docSum('INV'), docSum('CRN')] },
    };
    const errors = issues.filter((i) => i.level === 'error').length;
    return {
      gstin: ug.gstin,
      unit: ug.unitName,
      month,
      filingFrequency: ug.filingFrequency,
      jsonVersion,
      status: await returnStatus(ug.gstin, 'GSTR1', per.start),
      summary: {
        b2b: section(b2b),
        b2cl: section(b2cl),
        b2cs: {
          count: b2cs.size,
          taxable: money([...b2cs.values()].reduce((a, x) => a.plus(x.txval), ZERO)),
          igst: money([...b2cs.values()].reduce((a, x) => a.plus(x.iamt), ZERO)),
          cgst: money([...b2cs.values()].reduce((a, x) => a.plus(x.camt), ZERO)),
          sgst: money([...b2cs.values()].reduce((a, x) => a.plus(x.samt), ZERO)),
        },
        cdnr: section(cdnr),
        cdnur: section(cdnur),
        exports: section(exp),
      },
      b2b: b2b.map((d) => ({
        docNo: d.no,
        date: d.date,
        customer: d.partyName,
        gstin: d.partyGstin,
        pos: d.pos,
        value: money(total(d)),
        taxable: money(d.taxable),
        igst: money(d.igst),
        cgst: money(d.cgst),
        sgst: money(d.sgst),
      })),
      b2cl: b2cl.map((d) => ({
        docNo: d.no,
        date: d.date,
        customer: d.partyName,
        pos: d.pos,
        value: money(total(d)),
        taxable: money(d.taxable),
        igst: money(d.igst),
      })),
      b2cs: [...b2cs.values()].map((x) => ({
        pos: x.pos,
        rate: x.rt.toString(),
        taxable: money(x.txval),
        igst: money(x.iamt),
        cgst: money(x.camt),
        sgst: money(x.samt),
      })),
      cdnr: [...cdnr, ...cdnur].map((d) => ({
        docNo: d.no,
        date: d.date,
        kind: d.kind,
        customer: d.partyName,
        gstin: d.partyGstin,
        against: d.origNo,
        value: money(total(d)),
        taxable: money(d.taxable),
      })),
      hsn: [...hsn.values()].map((x) => ({
        hsn: x.hsn,
        uqc: x.uqc,
        rate: x.rt.toString(),
        qty: x.qty.toFixed(3),
        taxable: money(x.txval),
        igst: money(x.iamt),
        cgst: money(x.camt),
        sgst: money(x.samt),
      })),
      documents: [docSum('INV'), docSum('CRN')],
      issues,
      canPrepare: errors === 0,
      file,
    };
  },

  // ===========================================================================================================
  async gstr3b(unitId: string | null, month: string, asOf?: string) {
    const ug = await unitGst(unitId);
    const per = parseMonth(month);
    const out = await loadDocs(ug.unitId, ug.gstin, 'OUTWARD', per.start, per.end);
    const inn = await loadDocs(ug.unitId, ug.gstin, 'INWARD', per.start, per.end);
    const issues: Issue[] = [];
    const head = (l: Dec[]) => ({ igst: l[0] ?? ZERO, cgst: l[1] ?? ZERO, sgst: l[2] ?? ZERO });

    // 3.1(a) taxable outward (invoices less credit notes); 3.1(c) nil / exempt (rate 0 lines)
    let a = { txval: ZERO, igst: ZERO, cgst: ZERO, sgst: ZERO };
    let nil = ZERO;
    const interUnreg = new Map<string, { txval: Dec; igst: Dec }>();
    for (const d of out) {
      const sign = d.kind === 'INV' ? 1 : -1;
      for (const l of d.lines) {
        if (l.rate.isZero() && l.igst.plus(l.cgst).plus(l.sgst).isZero())
          nil = nil.plus(l.taxable.times(sign));
        else {
          a = {
            txval: a.txval.plus(l.taxable.times(sign)),
            igst: a.igst.plus(l.igst.times(sign)),
            cgst: a.cgst.plus(l.cgst.times(sign)),
            sgst: a.sgst.plus(l.sgst.times(sign)),
          };
          if (!d.partyGstin && d.pos !== ug.stateCode) {
            const c = interUnreg.get(d.pos) ?? { txval: ZERO, igst: ZERO };
            interUnreg.set(d.pos, {
              txval: c.txval.plus(l.taxable.times(sign)),
              igst: c.igst.plus(l.igst.times(sign)),
            });
          }
        }
      }
    }

    // 3.1(d) inward supplies liable to reverse charge
    const rcmDocs = inn.filter((d) => d.rcm && d.kind === 'INV');
    const rcm = {
      txval: rcmDocs.reduce((s, d) => s.plus(d.taxable), ZERO),
      igst: rcmDocs.reduce((s, d) => s.plus(d.igst), ZERO),
      cgst: rcmDocs.reduce((s, d) => s.plus(d.cgst), ZERO),
      sgst: rcmDocs.reduce((s, d) => s.plus(d.sgst), ZERO),
    };

    // ineligible lines (17(5)) of the purchase invoices: the tax stays in cost, not in ITC
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const inelig = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT COALESCE(SUM(l.cgst),0)::text AS c, COALESCE(SUM(l.sgst),0)::text AS s, COALESCE(SUM(l.igst),0)::text AS i
         FROM purchase_invoice_lines l JOIN purchase_invoices p ON p.id = l.invoice_id
        WHERE p.unit_id=$1::uuid AND p.status='Posted' AND p.invoice_date BETWEEN $2::date AND $3::date
          AND p.is_rcm = false AND l.itc_flag IN ('INELIGIBLE_17_5')`,
      ug.unitId,
      per.start,
      per.end,
    );
    const ine = {
      cgst: D(S(inelig[0]?.c ?? 0)),
      sgst: D(S(inelig[0]?.s ?? 0)),
      igst: D(S(inelig[0]?.i ?? 0)),
    };

    const isInv = (d: Doc) => d.kind === 'INV' && !d.rcm;
    const normal = inn.filter(isInv);
    const sumH = (l: Doc[], k: 'cgst' | 'sgst' | 'igst') => l.reduce((s, d) => s.plus(d[k]), ZERO);
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const reclaim = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT kind, COALESCE(SUM(igst),0)::text AS i, COALESCE(SUM(cgst),0)::text AS c, COALESCE(SUM(sgst),0)::text AS s
         FROM itc_reversals WHERE unit_id=$1::uuid AND event_date BETWEEN $2::date AND $3::date GROUP BY kind`,
      ug.unitId,
      per.start,
      per.end,
    );
    const rev = (kinds: string[]) => {
      const rows = reclaim.filter((r) => kinds.includes(S(r.kind)));
      return {
        igst: rows.reduce((s, r) => s.plus(S(r.i)), ZERO),
        cgst: rows.reduce((s, r) => s.plus(S(r.c)), ZERO),
        sgst: rows.reduce((s, r) => s.plus(S(r.s)), ZERO),
      };
    };
    const dbn = inn.filter((d) => d.kind === 'DBN');
    const crnIn = inn.filter((d) => d.kind === 'CRN');
    void crnIn;
    // 4(A): (3) reverse-charge ITC, (5) all other ITC; 4(B): (1) section 17(5) + others, (2) other reversals
    const itc5 = {
      igst: sumH(normal, 'igst')
        .minus(ine.igst)
        .plus(rev(['R37_RECLAIM']).igst),
      cgst: sumH(normal, 'cgst')
        .minus(ine.cgst)
        .plus(rev(['R37_RECLAIM']).cgst),
      sgst: sumH(normal, 'sgst')
        .minus(ine.sgst)
        .plus(rev(['R37_RECLAIM']).sgst),
    };
    const itc3 = { igst: rcm.igst, cgst: rcm.cgst, sgst: rcm.sgst };
    const b1 = rev(['S17_5']);
    const b2r = rev(['R37_REVERSE', 'R37A', 'MANUAL']);
    const b2 = {
      igst: b2r.igst.plus(sumH(dbn, 'igst')),
      cgst: b2r.cgst.plus(sumH(dbn, 'cgst')),
      sgst: b2r.sgst.plus(sumH(dbn, 'sgst')),
    };
    const net = {
      igst: itc5.igst.plus(itc3.igst).minus(b1.igst).minus(b2.igst),
      cgst: itc5.cgst.plus(itc3.cgst).minus(b1.cgst).minus(b2.cgst),
      sgst: itc5.sgst.plus(itc3.sgst).minus(b1.sgst).minus(b2.sgst),
    };

    // GSTR-2B check: how much of the claimed ITC is in 2B
    const twoB = (
      await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id::text FROM gstr2b_imports WHERE gstin=$1 AND period_month=$2::date ORDER BY imported_at DESC LIMIT 1`,
        ug.gstin,
        per.start,
      )
    )[0];
    let atRisk = ZERO;
    if (twoB) {
      // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
      const miss = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT COALESCE(SUM(t.cgst+t.sgst+t.igst),0)::text AS v FROM tax_documents t
          WHERE t.unit_id=$1::uuid AND t.gstin=$2 AND t.direction='INWARD' AND t.doc_kind='INV' AND t.reverse_charge=false
            AND t.status='Active' AND t.doc_date BETWEEN $3::date AND $4::date
            AND NOT EXISTS (SELECT 1 FROM gstr2b_lines g WHERE g.import_id=$5::uuid AND g.invoice_id = t.source_id)`,
        ug.unitId,
        ug.gstin,
        per.start,
        per.end,
        S(twoB.id),
      );
      atRisk = D(S(miss[0]?.v ?? 0));
      if (atRisk.greaterThan(0))
        issues.push({
          level: 'warning',
          message: `ITC of ${money(atRisk)} is on purchase invoices that are not in the GSTR-2B imported for this month. Check before you claim it.`,
        });
    } else if (normal.length) {
      issues.push({
        level: 'warning',
        message: 'No GSTR-2B has been imported for this month. The ITC below is the books figure.',
      });
    }

    // books vs return: the GST output accounts must agree with the return
    const gl = await prisma
      // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
      .$queryRawUnsafe<Row[]>(
        `SELECT a.code, COALESCE(SUM(g.credit - g.debit),0)::text AS net FROM gl_entries g JOIN accounts a ON a.id=g.account_id
        WHERE g.unit_id=$1::uuid AND a.code IN ('2301','2302','2303') AND g.posting_date BETWEEN $2::date AND $3::date GROUP BY a.code`,
        ug.unitId,
        per.start,
        per.end,
      )
      .catch(() => [] as Row[]);
    const glOut = (c: string) => D(S(gl.find((r) => S(r.code) === c)?.net ?? 0));
    const diffs: [string, Dec, Dec][] = [
      ['CGST', glOut('2301'), a.cgst],
      ['SGST', glOut('2302'), a.sgst],
      ['IGST', glOut('2303'), a.igst],
    ];
    for (const [n, book, ret] of diffs)
      if (!book.minus(ret).abs().lessThanOrEqualTo('0.05'))
        issues.push({
          level: 'warning',
          message: `Output ${n} in the ledger (${money(book)}) differs from the return (${money(ret)}). Check manual journals on the GST accounts.`,
        });

    // tax payable, set-off and cash
    const settle = planSetOff(
      { igst: a.igst, cgst: a.cgst, sgst: a.sgst },
      await creditBalance(ug.unitId, per.end),
    );
    const due = D(String((await ruleNum('GSTR3B_DUE_DAY', per.end)).toNumber()));
    const dueDate = nextMonthDay(month, due.toNumber());
    const filedOn = asOf ?? new Date().toISOString().slice(0, 10);
    const daysLate = Math.max(0, daysBetween(dueDate, filedOn));
    const cashTax = settle.cash.igst
      .plus(settle.cash.cgst)
      .plus(settle.cash.sgst)
      .plus(rcm.igst)
      .plus(rcm.cgst)
      .plus(rcm.sgst);
    const rate = await ruleNum('GST_INTEREST_PA', per.end);
    const feeDay = await ruleNum('GST_LATE_FEE_PER_DAY', per.end);
    const feeNil = await ruleNum('GST_LATE_FEE_NIL_DAY', per.end);
    const interest = cashTax.times(rate).times(daysLate).dividedBy(36500).toDecimalPlaces(2);
    const lateFee = (cashTax.isZero() && a.txval.isZero() ? feeNil : feeDay).times(daysLate);

    const row = (h: { igst: Dec; cgst: Dec; sgst: Dec }, txval?: Dec) => ({
      ...(txval ? { taxable: money(txval) } : {}),
      igst: money(h.igst),
      cgst: money(h.cgst),
      sgst: money(h.sgst),
      cess: '0.00',
    });
    const data = {
      gstin: ug.gstin,
      unit: ug.unitName,
      month,
      dueDate,
      status: await returnStatus(ug.gstin, 'GSTR3B', per.start),
      s31: {
        a_taxable: row(a, a.txval),
        b_zeroRated: row({ igst: ZERO, cgst: ZERO, sgst: ZERO }, ZERO),
        c_nilExempt: row({ igst: ZERO, cgst: ZERO, sgst: ZERO }, nil),
        d_reverseCharge: row(rcm, rcm.txval),
        e_nonGst: row({ igst: ZERO, cgst: ZERO, sgst: ZERO }, ZERO),
      },
      s32: [...interUnreg.entries()].map(([pos, v]) => ({
        pos,
        taxable: money(v.txval),
        igst: money(v.igst),
      })),
      s4: {
        a3_reverseCharge: row(itc3),
        a5_other: row(itc5),
        b1_section175: row(b1),
        b2_other: row(b2),
        c_net: row(net),
        d_ineligible: row(ine),
      },
      s51: { interest: money(interest), lateFee: money(lateFee), daysLate },
      s61: {
        outputTax: row(head([a.igst, a.cgst, a.sgst])),
        reverseCharge: row(rcm),
        itcSetOff: {
          fromIgst: row({
            igst: settle.off.igstToIgst,
            cgst: settle.off.igstToCgst,
            sgst: settle.off.igstToSgst,
          }),
          fromCgst: row({ igst: settle.off.cgstToIgst, cgst: settle.off.cgstToCgst, sgst: ZERO }),
          fromSgst: row({ igst: settle.off.sgstToIgst, cgst: ZERO, sgst: settle.off.sgstToSgst }),
        },
        cashPayable: row({
          igst: settle.cash.igst.plus(rcm.igst),
          cgst: settle.cash.cgst.plus(rcm.cgst),
          sgst: settle.cash.sgst.plus(rcm.sgst),
        }),
        creditAvailable: row(settle.credit),
      },
      itcAtRisk: money(atRisk),
      issues,
      plan: {
        output: { igst: money(a.igst), cgst: money(a.cgst), sgst: money(a.sgst) },
        rcm: { igst: money(rcm.igst), cgst: money(rcm.cgst), sgst: money(rcm.sgst) },
        off: {
          igstToIgst: money(settle.off.igstToIgst),
          igstToCgst: money(settle.off.igstToCgst),
          igstToSgst: money(settle.off.igstToSgst),
          cgstToCgst: money(settle.off.cgstToCgst),
          cgstToIgst: money(settle.off.cgstToIgst),
          sgstToSgst: money(settle.off.sgstToSgst),
          sgstToIgst: money(settle.off.sgstToIgst),
        },
        cash: {
          igst: money(settle.cash.igst),
          cgst: money(settle.cash.cgst),
          sgst: money(settle.cash.sgst),
        },
        interest: money(interest),
        lateFee: money(lateFee),
      },
    };
    return data;
  },

  /** mark a prepared return as filed with the ARN the person got from the portal; this locks the month (11-A10) */
  async markFiled(
    unitId: string | null,
    b: { type: 'GSTR1' | 'GSTR3B'; month: string; arn: string; filedOn: string },
    actorId: string,
  ) {
    const ug = await unitGst(unitId);
    const per = parseMonth(b.month);
    if (!/^[A-Z0-9]{8,30}$/i.test(b.arn.trim()))
      throw Errors.validation({ arn: 'Enter the ARN shown by the GST portal.' });
    const snap =
      b.type === 'GSTR1'
        ? await this.gstr1(unitId, b.month)
        : await this.gstr3b(unitId, b.month, b.filedOn);
    if (b.type === 'GSTR1' && !(snap as { canPrepare: boolean }).canPrepare)
      throw FinErrors.gstReturnInvalid(
        'The GSTR-1 still has errors. Fix them before you mark it filed.',
      );
    return prisma.$transaction(async (tx) => {
      const ex = (
        await tx.$queryRawUnsafe<Row[]>(
          `SELECT id::text, status FROM gst_returns WHERE gstin=$1 AND return_type=$2 AND period_month=$3::date FOR UPDATE`,
          ug.gstin,
          b.type,
          per.start,
        )
      )[0];
      if (ex && S(ex.status) === 'Filed')
        throw Errors.conflict('This return is already marked filed.');
      const rows = ex
        ? await tx.$queryRawUnsafe<Row[]>(
            `UPDATE gst_returns SET status='Filed', filed_on=$2::date, arn=$3, filed_by_id=$4::uuid, snapshot=$5::jsonb, version=version+1 WHERE id=$1::uuid RETURNING id::text`,
            S(ex.id),
            b.filedOn,
            b.arn.trim(),
            actorId,
            JSON.stringify(snap),
          )
        : await tx.$queryRawUnsafe<Row[]>(
            `INSERT INTO gst_returns (unit_id, gstin, return_type, period_month, status, snapshot, prepared_by_id, filed_on, arn, filed_by_id)
             VALUES ($1::uuid,$2,$3,$4::date,'Filed',$5::jsonb,$6::uuid,$7::date,$8,$6::uuid) RETURNING id::text`,
            ug.unitId,
            ug.gstin,
            b.type,
            per.start,
            JSON.stringify(snap),
            actorId,
            b.filedOn,
            b.arn.trim(),
          );
      await recordAudit(
        {
          action: 'GST_RETURN_FILED',
          actorId,
          targetType: 'GstReturn',
          targetId: S(rows[0]?.id),
          detail: { type: b.type, month: b.month, arn: b.arn.trim(), gstin: ug.gstin },
        },
        tx,
      );
      return {
        id: S(rows[0]?.id),
        type: b.type,
        month: b.month,
        status: 'Filed',
        arn: b.arn.trim(),
      };
    });
  },

  async list(unitId: string | null) {
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id::text, gstin, return_type, to_char(period_month,'YYYY-MM') AS month, status, filed_on, arn
         FROM gst_returns WHERE ($1::uuid IS NULL OR unit_id=$1::uuid) ORDER BY period_month DESC, return_type`,
      unitId,
    );
    return rows.map((r) => ({
      id: S(r.id),
      gstin: S(r.gstin),
      type: S(r.return_type),
      month: S(r.month),
      status: S(r.status),
      filedOn: r.filed_on ? iso(r.filed_on) : null,
      arn: r.arn ? S(r.arn) : null,
    }));
  },
};

async function returnStatus(
  gstin: string,
  type: string,
  start: string,
): Promise<{ status: string; arn: string | null }> {
  const r = (
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    await prisma.$queryRawUnsafe<Row[]>(
      `SELECT status, arn FROM gst_returns WHERE gstin=$1 AND return_type=$2 AND period_month=$3::date`,
      gstin,
      type,
      start,
    )
  )[0];
  return { status: r ? S(r.status) : 'Not filed', arn: r?.arn ? S(r.arn) : null };
}

/** balance of the input-credit accounts at a date = the electronic credit ledger */
export async function creditBalance(
  unitId: string,
  asOf: string,
): Promise<{ igst: Dec; cgst: Dec; sgst: Dec }> {
  // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT a.code, COALESCE(SUM(g.debit - g.credit),0)::text AS bal FROM gl_entries g JOIN accounts a ON a.id=g.account_id
      WHERE g.unit_id=$1::uuid AND a.code IN ('1401','1402','1403') AND g.posting_date <= $2::date GROUP BY a.code`,
    unitId,
    asOf,
  );
  const f = (c: string) => {
    const v = D(S(rows.find((r) => S(r.code) === c)?.bal ?? 0));
    return v.isNegative() ? ZERO : v;
  };
  return { cgst: f('1401'), sgst: f('1402'), igst: f('1403') };
}

/**
 * ITC set-off order (CGST Act s.49): IGST credit first against IGST, then CGST, then SGST; CGST credit against CGST,
 * then IGST; SGST credit against SGST, then IGST. CGST credit is never used against SGST and vice versa.
 */
export function planSetOff(
  liab: { igst: Dec; cgst: Dec; sgst: Dec },
  credit: { igst: Dec; cgst: Dec; sgst: Dec },
) {
  let li = liab.igst.isNegative() ? ZERO : liab.igst;
  let lc = liab.cgst.isNegative() ? ZERO : liab.cgst;
  let ls = liab.sgst.isNegative() ? ZERO : liab.sgst;
  let ci = credit.igst;
  let cc = credit.cgst;
  let cs = credit.sgst;
  const take = (have: Dec, need: Dec) => (have.lessThan(need) ? have : need);
  const igstToIgst = take(ci, li);
  li = li.minus(igstToIgst);
  ci = ci.minus(igstToIgst);
  const igstToCgst = take(ci, lc);
  lc = lc.minus(igstToCgst);
  ci = ci.minus(igstToCgst);
  const igstToSgst = take(ci, ls);
  ls = ls.minus(igstToSgst);
  ci = ci.minus(igstToSgst);
  const cgstToCgst = take(cc, lc);
  lc = lc.minus(cgstToCgst);
  cc = cc.minus(cgstToCgst);
  const cgstToIgst = take(cc, li);
  li = li.minus(cgstToIgst);
  cc = cc.minus(cgstToIgst);
  const sgstToSgst = take(cs, ls);
  ls = ls.minus(sgstToSgst);
  cs = cs.minus(sgstToSgst);
  const sgstToIgst = take(cs, li);
  li = li.minus(sgstToIgst);
  cs = cs.minus(sgstToIgst);
  return {
    off: { igstToIgst, igstToCgst, igstToSgst, cgstToCgst, cgstToIgst, sgstToSgst, sgstToIgst },
    cash: { igst: li, cgst: lc, sgst: ls },
    credit: { igst: ci, cgst: cc, sgst: cs },
  };
}

function nextMonthDay(month: string, day: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m, day));
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
