// 11-A4 GSTR-2B import and ITC matching, ITC reversal register (rule 37 / 37A / 17(5) / manual).
// The GSTR-2B JSON is downloaded by a person from the portal and uploaded here: no call to GSTN (R-12).
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { PostingService } from '../finance/posting-service';
import { validateGstin } from '../masters/party-rules';
import { knownStates } from '../masters/tax-service';
import { D, S, ZERO, costCenterOf, iso, money, parseMonth, ruleNum, unitGst } from './common';
import type { Dec, Row } from './common';
import { assertGstPeriodOpen } from './period-lock';

export interface TwoBLine {
  supplierGstin: string;
  supplierName?: string;
  docKind: 'INV' | 'CRN' | 'DBN';
  docNo: string;
  docDate: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  itcAvailable: boolean;
  itcReason?: string;
}

const normNo = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+/, '');

/** DD-MM-YYYY (portal) or YYYY-MM-DD -> ISO */
function toIso(d: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d.slice(0, 10);
}

/** Accepts our own flat rows, or the portal's nested docdata.b2b / cdnr shape (best effort; unknown parts are listed). */
export function parseTwoB(payload: unknown): { lines: TwoBLine[]; skipped: string[] } {
  const skipped: string[] = [];
  const lines: TwoBLine[] = [];
  const p = payload as Record<string, unknown>;
  if (Array.isArray(p)) {
    for (const r of p as Record<string, unknown>[]) {
      lines.push({
        supplierGstin: S(r.supplierGstin).toUpperCase(),
        supplierName: r.supplierName ? S(r.supplierName) : '',
        docKind: S(r.docKind || 'INV') as TwoBLine['docKind'],
        docNo: S(r.docNo),
        docDate: toIso(S(r.docDate)),
        taxable: S(r.taxable || '0'),
        cgst: S(r.cgst || '0'),
        sgst: S(r.sgst || '0'),
        igst: S(r.igst || '0'),
        cess: S(r.cess || '0'),
        itcAvailable: r.itcAvailable !== false,
        itcReason: r.itcReason ? S(r.itcReason) : '',
      });
    }
    return { lines, skipped };
  }
  const data = (p.data as Record<string, unknown> | undefined) ?? p;
  const dd = (data.docdata as Record<string, unknown> | undefined) ?? data;
  for (const [sec, kind] of [
    ['b2b', 'INV'],
    ['cdnr', 'CRN'],
  ] as const) {
    for (const sup of (dd[sec] as Record<string, unknown>[] | undefined) ?? []) {
      const docs = ((sup.inv ?? sup.nt) as Record<string, unknown>[] | undefined) ?? [];
      for (const d of docs) {
        const itms = (d.items as Record<string, unknown>[] | undefined) ?? [];
        const sum = (k: string) =>
          itms.length ? itms.reduce((s, i) => s + Number(i[k] ?? 0), 0) : Number(d[k] ?? 0);
        lines.push({
          supplierGstin: S(sup.ctin).toUpperCase(),
          supplierName: S(sup.trdnm),
          docKind: kind === 'CRN' && S(d.typ).toUpperCase().startsWith('D') ? 'DBN' : kind,
          docNo: S(d.inum ?? d.ntnum),
          docDate: toIso(S(d.dt ?? d.idt)),
          taxable: String(sum('txval')),
          cgst: String(sum('cgst')),
          sgst: String(sum('sgst')),
          igst: String(sum('igst')),
          cess: String(sum('cess')),
          itcAvailable: S(d.itcavl || 'Y').toUpperCase() !== 'N',
          itcReason: d.rsn ? S(d.rsn) : '',
        });
      }
    }
  }
  for (const k of Object.keys(dd))
    if (
      !['b2b', 'cdnr', 'gstin', 'rtnprd', 'version', 'gendt', 'chksum', 'itcsumm'].includes(k) &&
      Array.isArray(dd[k]) &&
      (dd[k] as unknown[]).length
    )
      skipped.push(`${k} (${(dd[k] as unknown[]).length} entries not read)`);
  return { lines, skipped };
}

export const gstr2bService = {
  async import(
    unitId: string | null,
    b: { month: string; sourceName?: string; payload: unknown },
    actorId: string,
  ) {
    const ug = await unitGst(unitId);
    const per = parseMonth(b.month);
    const { lines, skipped } = parseTwoB(b.payload);
    if (!lines.length)
      throw Errors.validation({ payload: 'No supplier invoices were found in the file.' });
    const states = await knownStates(prisma);
    for (const [i, l] of lines.entries()) {
      const v = validateGstin(l.supplierGstin, states.codes);
      if (!v.ok)
        throw Errors.validation({
          payload: `Row ${i + 1}: supplier GSTIN ${l.supplierGstin}: ${v.message}`,
        });
      if (!l.docNo || !/^\d{4}-\d{2}-\d{2}$/.test(l.docDate))
        throw Errors.validation({ payload: `Row ${i + 1}: document number or date is missing.` });
    }
    const tol = D(
      S(
        (
          // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
          await prisma.$queryRawUnsafe<Row[]>(
            `SELECT tolerance_tax_amount::text AS t FROM scm_settings WHERE id=1`,
          )
        )[0]?.t ?? '1',
      ),
    );
    return prisma.$transaction(async (tx) => {
      const imp = (
        await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO gstr2b_imports (unit_id, gstin, period_month, source_name, line_count, imported_by_id)
           VALUES ($1::uuid,$2,$3::date,$4,$5,$6::uuid) RETURNING id::text`,
          ug.unitId,
          ug.gstin,
          per.start,
          b.sourceName ?? null,
          lines.length,
          actorId,
        )
      )[0];
      const importId = S(imp?.id);
      const result = { matched: 0, mismatch: 0, extra: 0 };
      for (const l of lines) {
        const key = normNo(l.docNo);
        const book = (
          await tx.$queryRawUnsafe<Row[]>(
            `SELECT t.source_id::text, t.taxable::text, t.cgst::text, t.sgst::text, t.igst::text
               FROM tax_documents t
              WHERE t.unit_id=$1::uuid AND t.direction='INWARD' AND t.doc_kind=$2 AND t.status='Active'
                AND t.party_gstin=$3 AND regexp_replace(upper(COALESCE(t.ref_no,t.doc_no)),'[^A-Z0-9]','','g') ~ ('^0*' || $4 || '$')
              LIMIT 1`,
            ug.unitId,
            l.docKind === 'CRN' ? 'DBN' : l.docKind,
            l.supplierGstin,
            key,
          )
        )[0];
        let status: 'MATCHED' | 'MISMATCH' | 'EXTRA' = 'EXTRA';
        let note: string | null = 'In GSTR-2B but not in the books.';
        let invoiceId: string | null = null;
        if (book) {
          invoiceId = book.source_id ? S(book.source_id) : null;
          const diffs: string[] = [];
          for (const k of ['taxable', 'cgst', 'sgst', 'igst'] as const) {
            const d = D(S(book[k]))
              .minus(D(l[k] || '0'))
              .abs();
            if (d.greaterThan(tol))
              diffs.push(`${k} books ${money(book[k] as string)} vs 2B ${money(l[k])}`);
          }
          if (diffs.length) {
            status = 'MISMATCH';
            note = diffs.join('; ');
          } else {
            status = 'MATCHED';
            note = null;
          }
        }
        if (status === 'MATCHED') result.matched += 1;
        else if (status === 'MISMATCH') result.mismatch += 1;
        else result.extra += 1;
        await tx.$executeRawUnsafe(
          `INSERT INTO gstr2b_lines (import_id, supplier_gstin, supplier_name, doc_kind, doc_no, doc_no_norm, doc_date, taxable,
              cgst, sgst, igst, cess, itc_available, itc_reason, match_status, invoice_id, diff_note)
           VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::date,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13,$14,$15,$16::uuid,$17)`,
          importId,
          l.supplierGstin,
          l.supplierName ?? null,
          l.docKind,
          l.docNo.slice(0, 60),
          key.slice(0, 60),
          l.docDate,
          l.taxable || '0',
          l.cgst || '0',
          l.sgst || '0',
          l.igst || '0',
          l.cess || '0',
          l.itcAvailable,
          l.itcReason ?? null,
          status,
          invoiceId,
          note,
        );
        if (invoiceId && l.docKind === 'INV') {
          await tx.$executeRawUnsafe(
            `UPDATE purchase_invoices SET gstr2b_status=$2 WHERE id=$1::uuid`,
            invoiceId,
            status === 'MATCHED' ? 'MATCHED' : 'MISMATCH',
          );
        }
      }
      // books invoices of the month that 2B does not show
      // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
      const missing = await tx.$queryRawUnsafe<Row[]>(
        `UPDATE purchase_invoices p SET gstr2b_status='MISSING'
          WHERE p.unit_id=$1::uuid AND p.status='Posted' AND p.is_rcm=false AND p.supplier_gstin IS NOT NULL
            AND p.invoice_date BETWEEN $2::date AND $3::date
            AND NOT EXISTS (SELECT 1 FROM gstr2b_lines g WHERE g.import_id=$4::uuid AND g.invoice_id=p.id)
        RETURNING p.id::text`,
        ug.unitId,
        per.start,
        per.end,
        importId,
      );
      await recordAudit(
        {
          action: 'GSTR2B_IMPORTED',
          actorId,
          targetType: 'Gstr2bImport',
          targetId: importId,
          detail: { month: b.month, lines: lines.length, ...result, missing: missing.length },
        },
        tx,
      );
      return { importId, lines: lines.length, ...result, missingInTwoB: missing.length, skipped };
    });
  },

  async report(unitId: string | null, month: string) {
    const ug = await unitGst(unitId);
    const per = parseMonth(month);
    const imp = (
      await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id::text, source_name, imported_at FROM gstr2b_imports WHERE gstin=$1 AND period_month=$2::date ORDER BY imported_at DESC LIMIT 1`,
        ug.gstin,
        per.start,
      )
    )[0];
    if (!imp)
      return {
        month,
        imported: false,
        rows: [],
        missing: [],
        summary: { matched: 0, mismatch: 0, extra: 0, missing: 0, notEligible: '0.00' },
      };
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT g.id::text, g.supplier_gstin, g.supplier_name, g.doc_kind, g.doc_no, g.doc_date, g.taxable::text, g.cgst::text, g.sgst::text,
              g.igst::text, g.itc_available, g.itc_reason, g.match_status, g.diff_note, g.invoice_id::text
         FROM gstr2b_lines g WHERE g.import_id=$1::uuid ORDER BY g.match_status DESC, g.supplier_gstin, g.doc_no`,
      S(imp.id),
    );
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const missing = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT p.id::text, p.number, p.vendor_invoice_no, p.invoice_date, p.supplier_gstin, s.name AS supplier,
              (p.cgst+p.sgst+p.igst)::text AS tax
         FROM purchase_invoices p JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.unit_id=$1::uuid AND p.status='Posted' AND p.is_rcm=false AND p.supplier_gstin IS NOT NULL
          AND p.invoice_date BETWEEN $2::date AND $3::date
          AND NOT EXISTS (SELECT 1 FROM gstr2b_lines g WHERE g.import_id=$4::uuid AND g.invoice_id=p.id)
        ORDER BY p.invoice_date`,
      ug.unitId,
      per.start,
      per.end,
      S(imp.id),
    );
    const cnt = (s: string) => rows.filter((r) => S(r.match_status) === s).length;
    let notElig: Dec = ZERO;
    for (const r of rows)
      if (r.itc_available === false)
        notElig = notElig.plus(S(r.cgst)).plus(S(r.sgst)).plus(S(r.igst));
    return {
      month,
      imported: true,
      source: imp.source_name ? S(imp.source_name) : null,
      rows: rows.map((r) => ({
        id: S(r.id),
        supplierGstin: S(r.supplier_gstin),
        supplier: S(r.supplier_name),
        kind: S(r.doc_kind),
        docNo: S(r.doc_no),
        docDate: iso(r.doc_date),
        taxable: money(S(r.taxable)),
        cgst: money(S(r.cgst)),
        sgst: money(S(r.sgst)),
        igst: money(S(r.igst)),
        itcAvailable: r.itc_available === true,
        reason: r.itc_reason ? S(r.itc_reason) : null,
        status: S(r.match_status),
        note: r.diff_note ? S(r.diff_note) : null,
      })),
      missing: missing.map((r) => ({
        id: S(r.id),
        number: S(r.number),
        vendorInvoiceNo: S(r.vendor_invoice_no),
        date: iso(r.invoice_date),
        supplier: S(r.supplier),
        gstin: S(r.supplier_gstin),
        tax: money(S(r.tax)),
      })),
      summary: {
        matched: cnt('MATCHED'),
        mismatch: cnt('MISMATCH'),
        extra: cnt('EXTRA'),
        missing: missing.length,
        notEligible: money(notElig),
      },
    };
  },

  /** reversal register of the month (Phase 9 rows + manual ones) */
  async reversals(unitId: string | null, month: string) {
    const per = parseMonth(month);
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT r.id::text, r.kind, r.event_date, r.cgst::text, r.sgst::text, r.igst::text, r.note, p.number AS inv_no
         FROM itc_reversals r LEFT JOIN purchase_invoices p ON p.id=r.invoice_id
        WHERE ($1::uuid IS NULL OR r.unit_id=$1::uuid) AND r.event_date BETWEEN $2::date AND $3::date ORDER BY r.event_date, r.created_at`,
      unitId,
      per.start,
      per.end,
    );
    return rows.map((r) => ({
      id: S(r.id),
      kind: S(r.kind),
      date: iso(r.event_date),
      invoice: r.inv_no ? S(r.inv_no) : null,
      cgst: money(S(r.cgst)),
      sgst: money(S(r.sgst)),
      igst: money(S(r.igst)),
      note: r.note ? S(r.note) : null,
    }));
  },

  /** manual ITC reversal (rule 37A, section 17(5), other): Dr 6272 or 6269 / Cr Input GST, one journal */
  async manualReversal(
    unitId: string | null,
    b: {
      kind: 'R37A' | 'S17_5' | 'MANUAL';
      date: string;
      cgst: string;
      sgst: string;
      igst: string;
      note: string;
      invoiceId?: string;
    },
    actor: { userId: string },
  ) {
    const ug = await unitGst(unitId);
    const amt = { cgst: D(b.cgst || '0'), sgst: D(b.sgst || '0'), igst: D(b.igst || '0') };
    const tot = amt.cgst.plus(amt.sgst).plus(amt.igst);
    if (!tot.greaterThan(0) || [amt.cgst, amt.sgst, amt.igst].some((x) => x.isNegative()))
      throw Errors.validation({ cgst: 'Enter the tax to reverse (not negative, not all zero).' });
    if (b.note.trim().length < 5)
      throw Errors.validation({ note: 'Give a reason of at least 5 letters.' });
    return prisma.$transaction(async (tx) => {
      await assertGstPeriodOpen(tx, { gstin: ug.gstin, docDate: b.date, direction: 'INWARD' });
      const expense = b.kind === 'S17_5' ? '6269' : '6272';
      const lines = [
        { accountCode: expense, debit: tot.toFixed(2), credit: '0.00', unitId: ug.unitId },
        ...(
          [
            ['1401', amt.cgst],
            ['1402', amt.sgst],
            ['1403', amt.igst],
          ] as [string, Dec][]
        )
          .filter(([, v]) => v.greaterThan(0))
          .map(([code, v]) => ({
            accountCode: code,
            debit: '0.00',
            credit: v.toFixed(2),
            unitId: ug.unitId,
          })),
      ];
      const cc = await costCenterOf(tx, ug.unitId);
      const withCc = lines.map((l, i) => (i === 0 && cc ? { ...l, costCenterId: cc } : l));
      const j = await PostingService.postJournal(
        tx,
        {
          unitId: ug.unitId,
          docDate: b.date,
          voucherType: 'Adjustment',
          source: 'TAX',
          narration: `ITC reversal (${b.kind}): ${b.note.trim()}`.slice(0, 300),
          lines: withCc,
        },
        actor,
      );
      const rows = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO itc_reversals (unit_id, invoice_id, kind, cgst, sgst, igst, event_date, journal_id, created_by_id, note)
         VALUES ($1::uuid,$2::uuid,$3,$4::numeric,$5::numeric,$6::numeric,$7::date,$8::uuid,$9::uuid,$10) RETURNING id::text`,
        ug.unitId,
        b.invoiceId ?? null,
        b.kind,
        amt.cgst.toFixed(2),
        amt.sgst.toFixed(2),
        amt.igst.toFixed(2),
        b.date,
        j.id,
        actor.userId,
        b.note.trim(),
      );
      await recordAudit(
        {
          action: 'ITC_REVERSAL_MANUAL',
          actorId: actor.userId,
          targetType: 'ItcReversal',
          targetId: S(rows[0]?.id),
          detail: { kind: b.kind, total: tot.toFixed(2) },
        },
        tx,
      );
      return { id: S(rows[0]?.id), journalId: j.id, total: money(tot) };
    });
  },

  /** invoices that cross the 180-day line soon (rule data: ITC_REVERSAL_DAYS) */
  async due180(unitId: string | null, asOf: string) {
    const days = (await ruleNum('ITC_REVERSAL_DAYS', asOf)).toNumber();
    // unpaginated: whole-period return build: GST/TDS returns must include every document of the period
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT p.id::text, p.number, p.vendor_invoice_no, p.invoice_date, s.name AS supplier, (p.grand_total - p.paid_amount)::text AS unpaid,
              (p.cgst+p.sgst+p.igst)::text AS tax, ($2::date - p.invoice_date) AS age
         FROM purchase_invoices p JOIN suppliers s ON s.id=p.supplier_id
        WHERE ($1::uuid IS NULL OR p.unit_id=$1::uuid) AND p.status='Posted' AND p.payment_status <> 'PAID' AND p.is_rcm=false
          AND ($2::date - p.invoice_date) >= $3::int - 30 ORDER BY p.invoice_date`,
      unitId,
      asOf,
      days,
    );
    return {
      days,
      rows: rows.map((r) => ({
        id: S(r.id),
        number: S(r.number),
        vendorInvoiceNo: S(r.vendor_invoice_no),
        date: iso(r.invoice_date),
        supplier: S(r.supplier),
        unpaid: money(S(r.unpaid)),
        tax: money(S(r.tax)),
        ageDays: Number(r.age),
        overdue: Number(r.age) >= days,
      })),
    };
  },
};
