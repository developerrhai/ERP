// 11-A7 / 11-A8 TDS and TCS: quarterly return data (24Q/26Q-style deductee file), summaries by deductee / section /
// quarter, challan-to-entry mapping, interest on late deposit, lower-deduction certificates, tax rules, and Excel exports
// of the registers. TRACES / FVU are outside the app (R-12): this produces the data a person loads into the RPU.
import ExcelJS from 'exceljs';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { recordAudit } from '../../core/audit/audit-service';
import { taxService } from '../finance/tax-service';
import { D, S, ZERO, iso, money, ruleNum } from './common';
import type { Row } from './common';

/** Indian financial-year quarter: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. fyStart = 2026 for FY 2026-27 */
export function quarterRange(fyStart: number, q: 1 | 2 | 3 | 4): { from: string; to: string } {
  const m0 = [3, 6, 9, 0][q - 1] as number;
  const y = q === 4 ? fyStart + 1 : fyStart;
  const from = new Date(Date.UTC(y, m0, 1));
  const to = new Date(Date.UTC(y, m0 + 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** whole months from a to b, a part month counts as a month (s.201(1A) practice); 0 when b <= a */
export function monthsPartCounted(a: string, b: string): number {
  if (b <= a) return 0;
  const y = Number(b.slice(0, 4)) - Number(a.slice(0, 4));
  const m = Number(b.slice(5, 7)) - Number(a.slice(5, 7));
  const d = Number(b.slice(8, 10)) - Number(a.slice(8, 10));
  return y * 12 + m + (d > 0 ? 1 : 0);
}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const tdsReports = {
  /** deductee-wise / section-wise / quarter-wise totals */
  async summary(q: {
    unitId: string | null;
    kind: 'TDS' | 'TCS';
    from: string;
    to: string;
    by: 'deductee' | 'section' | 'quarter';
  }) {
    const key =
      q.by === 'deductee'
        ? `COALESCE(s.name,'(no deductee)')`
        : q.by === 'section'
          ? 'e.section_code'
          : `to_char(e.deducted_on,'YYYY') || '-Q' || CASE WHEN EXTRACT(MONTH FROM e.deducted_on) BETWEEN 4 AND 6 THEN '1' WHEN EXTRACT(MONTH FROM e.deducted_on) BETWEEN 7 AND 9 THEN '2' WHEN EXTRACT(MONTH FROM e.deducted_on) BETWEEN 10 AND 12 THEN '3' ELSE '4' END`;
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT ${key} AS k, COUNT(*)::int AS n, SUM(e.base_amount)::text AS base, SUM(e.tds_amount)::text AS tds,
              SUM(CASE WHEN e.challan_id IS NULL THEN e.tds_amount ELSE 0 END)::text AS pending
         FROM tds_entries e LEFT JOIN suppliers s ON s.id=e.supplier_id
        WHERE e.kind=$1 AND e.status='Active' AND e.deducted_on BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR e.unit_id=$4::uuid)
        GROUP BY 1 ORDER BY 1`,
      q.kind,
      q.from,
      q.to,
      q.unitId,
    );
    return rows.map((r) => ({
      key: S(r.k),
      entries: Number(r.n),
      base: money(S(r.base)),
      tds: money(S(r.tds)),
      pendingDeposit: money(S(r.pending)),
    }));
  },

  /** quarterly return data. Errors stop the file; a missing PAN is an error, a late deposit a warning with interest. */
  async returnData(q: {
    unitId: string | null;
    kind: 'TDS' | 'TCS';
    fyStart: number;
    quarter: 1 | 2 | 3 | 4;
    asOf: string;
  }) {
    const r = quarterRange(q.fyStart, q.quarter);
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT e.id::text, e.section_code, e.base_amount::text, e.rate_pct::text, e.tds_amount::text, e.deducted_on, e.source_doc_no,
              s.name AS supplier, s.pan, c.challan_no, c.bsr_code, c.paid_on
         FROM tds_entries e LEFT JOIN suppliers s ON s.id=e.supplier_id LEFT JOIN tax_challans c ON c.id=e.challan_id
        WHERE e.kind=$1 AND e.status='Active' AND e.deducted_on BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR e.unit_id=$4::uuid)
        ORDER BY e.deducted_on, e.id`,
      q.kind,
      r.from,
      r.to,
      q.unitId,
    );
    const dueDay = (await ruleNum('TDS_DEPOSIT_DUE_DAY', r.to)).toNumber();
    const ratePm = await ruleNum('TDS_LATE_DEPOSIT_PM', r.to);
    const tan =
      (
        await prisma.$queryRawUnsafe<Row[]>(
          `SELECT value_text FROM tax_rules WHERE rule_key='DEDUCTOR_TAN' ORDER BY effective_from DESC LIMIT 1`,
        )
      )[0]?.value_text ?? null;
    const issues: { level: 'error' | 'warning'; message: string }[] = [];
    if (!tan)
      issues.push({
        level: 'error',
        message: 'The deductor TAN is not entered (Tax Rules > DEDUCTOR_TAN).',
      });
    let interest = ZERO;
    const data = rows.map((e) => {
      const ded = iso(e.deducted_on);
      const due = nextMonthDay(ded, dueDay);
      const paid = e.paid_on ? iso(e.paid_on) : null;
      const until = paid ?? q.asOf;
      const months = until > due ? monthsPartCounted(ded, until) : 0;
      const intr = D(S(e.tds_amount)).times(ratePm).times(months).dividedBy(100).toDecimalPlaces(2);
      interest = interest.plus(intr);
      if (!e.pan || !PAN.test(S(e.pan)))
        issues.push({
          level: 'error',
          message: `${S(e.supplier) || 'Deductee'} (${S(e.source_doc_no)}): PAN missing or wrong. A return without PAN is rejected at the higher rate.`,
        });
      if (!paid)
        issues.push({
          level: 'warning',
          message: `${S(e.source_doc_no)}: tax of ${money(S(e.tds_amount))} is not deposited yet.`,
        });
      return {
        id: S(e.id),
        deductee: S(e.supplier),
        pan: e.pan ? S(e.pan) : null,
        section: S(e.section_code),
        docNo: e.source_doc_no ? S(e.source_doc_no) : null,
        deductedOn: ded,
        base: money(S(e.base_amount)),
        ratePct: S(e.rate_pct),
        tds: money(S(e.tds_amount)),
        challanNo: e.challan_no ? S(e.challan_no) : null,
        bsr: e.bsr_code ? S(e.bsr_code) : null,
        depositedOn: paid,
        dueDate: due,
        monthsLate: months,
        interest: money(intr),
      };
    });
    const total = data.reduce((s, d) => s.plus(d.tds), ZERO);
    return {
      form: q.kind === 'TDS' ? '26Q' : '27EQ',
      fy: `${q.fyStart}-${String((q.fyStart + 1) % 100).padStart(2, '0')}`,
      quarter: q.quarter,
      from: r.from,
      to: r.to,
      tan: tan ? S(tan) : null,
      entries: data.length,
      totalTds: money(total),
      interestLateDeposit: money(interest),
      canFile: !issues.some((i) => i.level === 'error'),
      issues,
      rows: data,
      note: 'Late deduction interest is not computed: the register keeps the deduction date only, not the date the tax became deductible.',
    };
  },

  /** challan -> the entries it pays */
  async challanMap(unitId: string | null, kind: 'TDS' | 'TCS') {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT c.challan_no, c.bsr_code, c.paid_on, c.amount::text, e.id::text, e.section_code, e.tds_amount::text, e.source_doc_no, s.name AS supplier
         FROM tax_challans c LEFT JOIN tds_entries e ON e.challan_id=c.id LEFT JOIN suppliers s ON s.id=e.supplier_id
        WHERE c.tax_kind=$1 AND ($2::uuid IS NULL OR c.unit_id=$2::uuid) ORDER BY c.paid_on DESC, c.challan_no, e.deducted_on`,
      kind,
      unitId,
    );
    const m = new Map<
      string,
      {
        challanNo: string;
        bsr: string | null;
        paidOn: string;
        amount: string;
        mapped: string;
        entries: unknown[];
      }
    >();
    for (const r of rows) {
      const k = S(r.challan_no);
      const cur = m.get(k) ?? {
        challanNo: k,
        bsr: r.bsr_code ? S(r.bsr_code) : null,
        paidOn: iso(r.paid_on),
        amount: money(S(r.amount)),
        mapped: '0.00',
        entries: [],
      };
      if (r.id) {
        cur.entries.push({
          id: S(r.id),
          section: S(r.section_code),
          docNo: r.source_doc_no ? S(r.source_doc_no) : null,
          supplier: r.supplier ? S(r.supplier) : null,
          tds: money(S(r.tds_amount)),
        });
        cur.mapped = money(D(cur.mapped).plus(S(r.tds_amount)));
      }
      m.set(k, cur);
    }
    return [...m.values()].map((c) => ({ ...c, difference: money(D(c.amount).minus(c.mapped)) }));
  },

  // ---- lower-deduction certificates --------------------------------------------------------------------------
  async certs() {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT l.id::text, l.supplier_id::text, s.name AS supplier, l.section_code, l.cert_no, l.rate_pct::text, l.valid_from, l.valid_to, l.max_amount::text
         FROM lower_deduction_certs l JOIN suppliers s ON s.id=l.supplier_id ORDER BY l.valid_to DESC`,
    );
    return rows.map((r) => ({
      id: S(r.id),
      supplierId: S(r.supplier_id),
      supplier: S(r.supplier),
      section: S(r.section_code),
      certNo: S(r.cert_no),
      ratePct: S(r.rate_pct),
      validFrom: iso(r.valid_from),
      validTo: iso(r.valid_to),
      maxAmount: r.max_amount ? money(S(r.max_amount)) : null,
    }));
  },
  async addCert(
    b: {
      supplierId: string;
      sectionCode: string;
      certNo: string;
      ratePct: string;
      validFrom: string;
      validTo: string;
      maxAmount?: string;
    },
    actorId: string,
  ) {
    if (b.validTo < b.validFrom)
      throw Errors.validation({ validTo: 'The end date is before the start date.' });
    try {
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `INSERT INTO lower_deduction_certs (supplier_id, section_code, cert_no, rate_pct, valid_from, valid_to, max_amount, created_by_id)
         VALUES ($1::uuid,$2,$3,$4::numeric,$5::date,$6::date,$7::numeric,$8::uuid) RETURNING id::text`,
        b.supplierId,
        b.sectionCode,
        b.certNo.trim(),
        b.ratePct,
        b.validFrom,
        b.validTo,
        b.maxAmount ?? null,
        actorId,
      );
      await recordAudit({
        action: 'LDC_ADDED',
        actorId,
        targetType: 'LowerDeductionCert',
        targetId: S(rows[0]?.id),
        detail: { certNo: b.certNo },
      });
      return { id: S(rows[0]?.id) };
    } catch (e) {
      if (String((e as Error).message).includes('ldc_cert_uq'))
        throw Errors.conflict('This certificate number is already recorded.');
      throw e;
    }
  },
  async deleteCert(id: string, actorId: string) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM lower_deduction_certs WHERE id=$1::uuid`,
      id,
    );
    if (!n) throw Errors.notFound('Certificate not found.');
    await recordAudit({
      action: 'LDC_REMOVED',
      actorId,
      targetType: 'LowerDeductionCert',
      targetId: id,
    });
    return { id };
  },

  // ---- statutory rules as data ---------------------------------------------------------------------------------
  async rules() {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT id::text, rule_key, description, value_num::text, value_text, effective_from, effective_to, needs_review FROM tax_rules ORDER BY rule_key, effective_from DESC`,
    );
    return rows.map((r) => ({
      id: S(r.id),
      key: S(r.rule_key),
      description: S(r.description),
      valueNum: r.value_num === null ? null : S(r.value_num),
      valueText: r.value_text === null ? null : S(r.value_text),
      effectiveFrom: iso(r.effective_from),
      effectiveTo: r.effective_to ? iso(r.effective_to) : null,
      needsReview: r.needs_review === true,
    }));
  },
  async updateRule(
    id: string,
    b: { valueNum?: string | null; valueText?: string | null; needsReview?: boolean },
    actorId: string,
  ) {
    const n = await prisma.$executeRawUnsafe(
      `UPDATE tax_rules SET value_num=COALESCE($2::numeric, value_num), value_text=COALESCE($3, value_text), needs_review=COALESCE($4, needs_review),
              version=version+1, updated_at=now(), updated_by_id=$5::uuid WHERE id=$1::uuid`,
      id,
      b.valueNum ?? null,
      b.valueText ?? null,
      b.needsReview ?? null,
      actorId,
    );
    if (!n) throw Errors.notFound('Rule not found.');
    await recordAudit({
      action: 'TAX_RULE_UPDATED',
      actorId,
      targetType: 'TaxRule',
      targetId: id,
      detail: { ...b },
    });
    return { id };
  },
};

function nextMonthDay(isoDate: string, day: number): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return new Date(Date.UTC(y, m, day)).toISOString().slice(0, 10);
}

// ---- Excel exports of the registers (11-A8) -------------------------------------------------------------------
export async function registerWorkbook(
  kind: 'sales' | 'purchase' | 'tds' | 'tcs',
  q: { from: string; to: string; unitId: string | null },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(
    kind === 'sales'
      ? 'Sales register'
      : kind === 'purchase'
        ? 'Purchase register'
        : kind.toUpperCase() + ' register',
  );
  const head = (cols: string[]) => {
    ws.addRow(cols).font = { bold: true };
  };
  if (kind === 'sales' || kind === 'purchase') {
    const r = await taxService.register({
      direction: kind === 'sales' ? 'OUTWARD' : 'INWARD',
      from: q.from,
      to: q.to,
      unitId: q.unitId,
    });
    head([
      'Kind',
      'Document',
      'Date',
      'Party',
      'GSTIN',
      'Place of supply',
      'Reverse charge',
      'Taxable',
      'CGST',
      'SGST',
      'IGST',
      'Cess',
      'Status',
    ]);
    for (const x of r.rows)
      ws.addRow([
        x.docKind,
        x.docNo,
        x.docDate,
        x.partyName,
        x.partyGstin ?? '',
        x.placeOfSupply,
        x.reverseCharge ? 'Y' : 'N',
        Number(x.taxable),
        Number(x.cgst),
        Number(x.sgst),
        Number(x.igst),
        Number(x.cess),
        x.status,
      ]);
    ws.addRow([]);
    ws.addRow([
      'Total (active)',
      '',
      '',
      '',
      '',
      '',
      '',
      Number(r.totals.taxable),
      Number(r.totals.cgst),
      Number(r.totals.sgst),
      Number(r.totals.igst),
      Number(r.totals.cess),
    ]).font = { bold: true };
  } else {
    const r = await taxService.tdsRegister({
      kind: kind === 'tds' ? 'TDS' : 'TCS',
      from: q.from,
      to: q.to,
      unitId: q.unitId,
    });
    head(['Section', 'Deductee', 'Document', 'Date', 'Base', 'Rate %', 'Tax', 'Challan', 'Status']);
    for (const x of r.rows)
      ws.addRow([
        x.sectionCode,
        x.supplier ?? '',
        x.docNo ?? '',
        x.deductedOn,
        Number(x.baseAmount),
        Number(x.ratePct),
        Number(x.tdsAmount),
        x.challanNo ?? '',
        x.status,
      ]);
    ws.addRow([]);
    ws.addRow(['Total deducted', '', '', '', '', '', Number(r.totalDeducted)]).font = {
      bold: true,
    };
  }
  ws.columns.forEach((c) => {
    c.width = 16;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
