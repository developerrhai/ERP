// Phase 9 daily job (scm.daily, 01:30 IST): ITC-180 reversal + 15-day alert, MSME due alerts, contract expiry,
// delayed PO lines, supplier document expiry, and the monthly supplier evaluation. Every step is idempotent
// (dedupe keys, unique evaluation rows, reversal only for the missing amount) and isolated: one failure is
// logged and does not stop the others.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { PostingService } from '../finance/posting-service';
import type { EventLine } from '../finance/posting-service';
import { notificationService } from '../notifications/service';
import { D, ZERO, round2, str } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { anyCostCenter } from './ap-service';
import type { Row } from './core';
import { exec, insertRow, norm, pageRecipients, query, settings, todayIst, S } from './core';
import {
  addDays,
  costScore,
  daysBetween,
  deliveryScore,
  deliveryStatus,
  gradeFor,
  itc180DueDate,
  overall,
  qualityScore,
} from './math';
import type { ItcHeads } from './math';

function itc180Reverse(itc: ItcHeads, net: Dec, unpaid: Dec) {
  const part = (h: Dec) => (net.isZero() ? ZERO : round2(h.mul(unpaid).div(net)));
  return { cgst: part(itc.cgst), sgst: part(itc.sgst), igst: part(itc.igst) };
}
export { itc180Reverse };

/** Eligible ITC of an invoice by head (ELIGIBLE / CAPITAL_GOODS / INPUT_SERVICE lines only). */
async function invoiceItc(db: Db, invoiceId: string): Promise<ItcHeads> {
  const r = (
    await query(
      db,
      `SELECT COALESCE(sum(cgst),0)::text AS c, COALESCE(sum(sgst),0)::text AS s, COALESCE(sum(igst),0)::text AS i FROM purchase_invoice_lines WHERE invoice_id=$1::uuid AND itc_flag IN ('ELIGIBLE','CAPITAL_GOODS','INPUT_SERVICE')`,
      invoiceId,
    )
  )[0]!;
  return { cgst: D(S(r.c)), sgst: D(S(r.s)), igst: D(S(r.i)) };
}

/** Reverses the unpaid share of the ITC for invoices past invoice date + 180 days. Returns how many were reversed. */
export async function runItc180(today = todayIst()): Promise<{ reversed: number; alerts: number }> {
  const set = await settings();
  const rows = await query(
    prisma,
    `SELECT id::text, number, unit_id::text, invoice_date, net_payable::text, paid_amount::text, is_rcm FROM purchase_invoices WHERE status='Posted' AND deleted_at IS NULL AND net_payable - paid_amount > 0`,
  );
  let reversed = 0;
  let alerts = 0;
  for (const r of rows) {
    const n = norm<Row>(r);
    const due = itc180DueDate(S(n.invoiceDate));
    const left = daysBetween(today, due);
    try {
      if (left > 0 && left <= set.itc180AlertDays) {
        await prisma.$transaction(async (tx) => {
          const to = await pageRecipients(tx, 'fin-ap');
          await notificationService.notify(tx, to, {
            type: 'SCM_ITC_180',
            title: `Invoice ${S(n.number)}: input tax credit will be reversed in ${left} day(s) if unpaid`,
            link: '/m/fin-ap',
            dedupeKey: `itc180-alert:${S(n.id)}`,
          });
        });
        alerts += 1;
      }
      if (left > 0) continue;
      await prisma.$transaction(async (tx) => {
        await query(tx, `SELECT id FROM purchase_invoices WHERE id=$1::uuid FOR UPDATE`, n.id);
        const itc = await invoiceItc(tx, S(n.id));
        const net = D(S(n.netPayable));
        const unpaid = net.minus(D(S(n.paidAmount)));
        const target = itc180Reverse(itc, net, unpaid);
        const cur = await query(
          tx,
          `SELECT kind, COALESCE(sum(cgst),0)::text AS c, COALESCE(sum(sgst),0)::text AS s, COALESCE(sum(igst),0)::text AS i FROM itc_reversals WHERE invoice_id=$1::uuid GROUP BY kind`,
          n.id,
        );
        const g = (k: string, f: string) => D(S(cur.find((x) => x.kind === k)?.[f] ?? 0));
        const have = {
          cgst: g('R37_REVERSE', 'c').minus(g('R37_RECLAIM', 'c')),
          sgst: g('R37_REVERSE', 's').minus(g('R37_RECLAIM', 's')),
          igst: g('R37_REVERSE', 'i').minus(g('R37_RECLAIM', 'i')),
        };
        const delta = {
          cgst: target.cgst.minus(have.cgst),
          sgst: target.sgst.minus(have.sgst),
          igst: target.igst.minus(have.igst),
        };
        const total = delta.cgst.plus(delta.sgst).plus(delta.igst);
        if (total.lte(0)) return;
        const unitId = S(n.unitId);
        const legs: EventLine[] = [
          {
            account: 'ITC_REVERSED_180',
            debit: str(total),
            credit: '0.00',
            unitId,
            costCenter: await anyCostCenter(tx, unitId),
          },
        ];
        for (const [h, v] of [
          ['CGST', delta.cgst],
          ['SGST', delta.sgst],
          ['IGST', delta.igst],
        ] as [string, Dec][])
          if (v.gt(0)) legs.push({ account: `INPUT_${h}`, debit: '0.00', credit: str(v), unitId });
        const j = await PostingService.postJournal(
          tx,
          {
            unitId,
            docDate: today,
            voucherType: 'Adjustment',
            source: 'EVENT',
            narration: `ITC reversed (Rule 37) invoice ${S(n.number)}`,
            sourceDocType: 'itc_reverse',
            sourceDocId: S(n.id),
            sourceDocNo: S(n.number),
            event: `ITC_R37_REVERSE:${today}`,
            payload: { docNo: S(n.number), lines: legs },
          },
          { userId: await systemUser(tx) },
        );
        await insertRow(tx, 'itc_reversals', {
          unitId,
          invoiceId: n.id,
          kind: 'R37_REVERSE',
          cgst: str(delta.cgst),
          sgst: str(delta.sgst),
          igst: str(delta.igst),
          eventDate: today,
          journalId: j.id,
        });
        await exec(
          tx,
          `UPDATE purchase_invoices SET itc_reversed_amount = itc_reversed_amount + $2::numeric WHERE id=$1::uuid`,
          n.id,
          str(total),
        );
        reversed += 1;
      });
    } catch (err) {
      logger.error({ err, invoice: n.number }, 'scm.daily: ITC-180 step failed');
    }
  }
  return { reversed, alerts };
}

async function systemUser(tx: Db): Promise<string> {
  const r = (
    await query(tx, `SELECT id::text FROM users WHERE status='ACTIVE' ORDER BY created_at LIMIT 1`)
  )[0];
  return S(r?.id);
}

async function alertSteps(today: string): Promise<Record<string, number>> {
  const set = await settings();
  const out: Record<string, number> = {};
  // MSME legal due date within N days
  const msme = await query(
    prisma,
    `SELECT number, msme_due_date FROM purchase_invoices WHERE status='Posted' AND deleted_at IS NULL AND net_payable - paid_amount > 0 AND msme_due_date IS NOT NULL AND msme_due_date BETWEEN $1::date AND $2::date`,
    today,
    addDays(today, set.msmeAlertDays),
  );
  out.msme = msme.length;
  for (const r of msme)
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, await pageRecipients(tx, 'fin-ap'), {
        type: 'SCM_MSME_DUE',
        title: `Invoice ${S(r.number)}: MSME payment is due by ${S(norm<Row>(r).msmeDueDate)}`,
        link: '/m/fin-ap',
        dedupeKey: `msme-due:${S(r.number)}`,
      });
    });
  // contract expiring in 30 days
  const con = await query(
    prisma,
    `SELECT number, created_by_id::text, valid_to FROM purchase_contracts WHERE status='Approved' AND deleted_at IS NULL AND valid_to BETWEEN $1::date AND $2::date`,
    today,
    addDays(today, 30),
  );
  out.contracts = con.length;
  for (const r of con)
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, [S(r.created_by_id)], {
        type: 'SCM_CONTRACT_EXPIRING',
        title: `Contract ${S(r.number)} ends on ${S(norm<Row>(r).validTo)}`,
        link: '/m/scm-contracts',
        dedupeKey: `con-expiry:${S(r.number)}`,
      });
    });
  // delayed PO lines (one alert per PO per day)
  const po = await query(
    prisma,
    `SELECT p.id::text, p.number, p.created_by_id::text, l.qty::text, l.received_qty::text, l.closed_qty::text, l.delivery_date FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id WHERE p.status='Approved' AND p.amending=false AND p.deleted_at IS NULL AND l.delivery_date < $1::date`,
    today,
  );
  const delayed = new Map<string, { number: string; by: string }>();
  for (const r of po) {
    const d = deliveryStatus({
      poQty: D(S(r.qty)),
      receivedQty: D(S(r.received_qty)),
      closedQty: D(S(r.closed_qty)),
      expectedDate: S(norm<Row>(r).deliveryDate),
      today,
    });
    if (d.status === 'DELAYED')
      delayed.set(S(r.id), { number: S(r.number), by: S(r.created_by_id) });
  }
  out.delayed = delayed.size;
  for (const [id, v] of delayed)
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, [v.by], {
        type: 'SCM_PO_DELAYED',
        title: `Purchase order ${v.number} has delayed lines`,
        link: '/m/scm-po',
        dedupeKey: `po-delayed:${id}:${today}`,
      });
    });
  // supplier compliance documents expiring in 30 days
  const docs = await query(
    prisma,
    `SELECT s.name, d.doc_kind, d.valid_to, d.id::text FROM supplier_documents d JOIN suppliers s ON s.id=d.supplier_id WHERE s.deleted_at IS NULL AND d.valid_to BETWEEN $1::date AND $2::date`,
    today,
    addDays(today, 30),
  );
  out.supplierDocs = docs.length;
  for (const r of docs)
    await prisma.$transaction(async (tx) => {
      await notificationService.notify(tx, await pageRecipients(tx, 'scm-suppliers'), {
        type: 'SCM_SUPPLIER_DOC_EXPIRING',
        title: `${S(r.name)}: ${S(r.doc_kind)} expires on ${S(norm<Row>(r).validTo)}`,
        link: '/m/scm-suppliers',
        dedupeKey: `supdoc:${S(r.id)}`,
      });
    });
  return out;
}

// ------------------------------------------------------------------------------------------ evaluation
export async function evaluateMonth(period: string, unitId?: string): Promise<number> {
  const set = await settings();
  const start = `${period}-01`;
  const end = addDays(
    new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 1))
      .toISOString()
      .slice(0, 10),
    -1,
  );
  const units = unitId
    ? [{ id: unitId }]
    : await query(prisma, `SELECT id::text FROM units WHERE status='ACTIVE'`);
  let count = 0;
  for (const u of units) {
    const sups = await query(
      prisma,
      `SELECT DISTINCT g.supplier_id::text AS id FROM goods_receipts g WHERE g.unit_id=$1::uuid AND g.status='Posted' AND g.receipt_date BETWEEN $2::date AND $3::date`,
      u.id,
      start,
      end,
    );
    const rows: {
      supplierId: string;
      q: Dec;
      d: Dec;
      c: Dec;
      r: Dec;
      ppm: Dec;
      otif: Dec;
      overall: Dec;
      compliance: boolean;
    }[] = [];
    for (const s of sups) {
      const lines = await query(
        prisma,
        `SELECT gl.received_qty::text, gl.rejected_qty::text, g.receipt_date, pl.delivery_date, pl.qty::text AS po_qty, pl.received_qty::text AS po_received, pl.item_id::text, pl.net_rate::text
        FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id JOIN purchase_order_lines pl ON pl.id=gl.po_line_id
        WHERE g.supplier_id=$1::uuid AND g.unit_id=$2::uuid AND g.status='Posted' AND g.receipt_date BETWEEN $3::date AND $4::date`,
        s.id,
        u.id,
        start,
        end,
      );
      let recv = ZERO;
      let rej = ZERO;
      let good = 0;
      for (const l of lines) {
        recv = recv.plus(D(S(l.received_qty)));
        rej = rej.plus(D(S(l.rejected_qty)));
        const n = norm<Row>(l);
        const onTime = !n.deliveryDate || S(n.receiptDate) <= S(n.deliveryDate);
        const inFull = D(S(l.po_received)).gte(D(S(l.po_qty)));
        if (onTime && inFull) good += 1;
      }
      const ppm = recv.isZero() ? ZERO : rej.mul(1_000_000).div(recv).toDecimalPlaces(2);
      const otif = lines.length ? D(good).mul(100).div(lines.length).toDecimalPlaces(4) : D(100);
      // cost index: best net rate for the same item in the unit during the period vs this supplier's rate
      const costs: Dec[] = [];
      for (const it of new Set(lines.map((l) => S(l.item_id)))) {
        const mine = (
          await query(
            prisma,
            `SELECT avg(pl.net_rate)::text AS p FROM purchase_order_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.supplier_id=$1::uuid AND p.unit_id=$2::uuid AND pl.item_id=$3::uuid AND p.po_date BETWEEN $4::date AND $5::date AND p.status='Approved'`,
            s.id,
            u.id,
            it,
            start,
            end,
          )
        )[0];
        const best = (
          await query(
            prisma,
            `SELECT min(pl.net_rate)::text AS p FROM purchase_order_lines pl JOIN purchase_orders p ON p.id=pl.po_id WHERE p.unit_id=$1::uuid AND pl.item_id=$2::uuid AND p.po_date BETWEEN $3::date AND $4::date AND p.status='Approved'`,
            u.id,
            it,
            start,
            end,
          )
        )[0];
        if (mine?.p && best?.p && D(S(mine.p)).gt(0))
          costs.push(costScore(D(S(best.p)), D(S(mine.p))));
      }
      const c = costs.length ? costs.reduce((a, v) => a.plus(v), ZERO).div(costs.length) : D(100);
      const inv = (
        await query(
          prisma,
          `SELECT count(*)::int AS n, count(rs.responded_at)::int AS r FROM rfq_suppliers rs JOIN rfqs f ON f.id=rs.rfq_id WHERE rs.supplier_id=$1::uuid AND f.unit_id=$2::uuid AND rs.invited_at IS NOT NULL AND rs.invited_at::date BETWEEN $3::date AND $4::date`,
          s.id,
          u.id,
          start,
          end,
        )
      )[0]!;
      const r = Number(inv.n) ? D(Number(inv.r)).mul(100).div(Number(inv.n)) : D(100);
      const comp = !(
        await query(
          prisma,
          `SELECT 1 FROM suppliers s WHERE s.id=$1::uuid AND (s.approval_status <> 'APPROVED' OR s.status <> 'ACTIVE' OR s.purchase_hold OR EXISTS (SELECT 1 FROM supplier_documents d WHERE d.supplier_id=s.id AND d.valid_to < $2::date))`,
          s.id,
          end,
        )
      ).length;
      const q = qualityScore(ppm);
      const d = deliveryScore(otif, D(set.deliveryFloor));
      rows.push({
        supplierId: S(s.id),
        q,
        d,
        c,
        r,
        ppm,
        otif,
        compliance: comp,
        overall: overall(
          { q, d, c, r },
          {
            q: D(set.evalWQuality),
            d: D(set.evalWDelivery),
            c: D(set.evalWCost),
            r: D(set.evalWResponse),
          },
        ),
      });
    }
    rows.sort((a, b) => b.overall.comparedTo(a.overall));
    for (let i = 0; i < rows.length; i += 1) {
      const x = rows[i]!;
      const grade = x.compliance
        ? gradeFor(x.overall, D(set.gradeAMin), D(set.gradeBMin), D(set.gradeCMin))
        : 'D';
      await exec(
        prisma,
        `INSERT INTO supplier_evaluations (unit_id, supplier_id, period, quality, delivery, cost, response, compliance_ok, ppm, otif_pct, overall, grade, rank, risk_flag, details)
        VALUES ($1::uuid,$2::uuid,$3,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8,$9::numeric,$10::numeric,$11::numeric,$12,$13,$14,$15::jsonb)
        ON CONFLICT (unit_id, supplier_id, period) DO UPDATE SET quality=EXCLUDED.quality, delivery=EXCLUDED.delivery, cost=EXCLUDED.cost, response=EXCLUDED.response, compliance_ok=EXCLUDED.compliance_ok, ppm=EXCLUDED.ppm, otif_pct=EXCLUDED.otif_pct, overall=EXCLUDED.overall, grade=EXCLUDED.grade, rank=EXCLUDED.rank, risk_flag=EXCLUDED.risk_flag, details=EXCLUDED.details`,
        u.id,
        x.supplierId,
        period,
        str(x.q.toDecimalPlaces(4)),
        str(x.d.toDecimalPlaces(4)),
        str(x.c.toDecimalPlaces(4)),
        str(x.r.toDecimalPlaces(4)),
        x.compliance,
        str(x.ppm),
        str(x.otif),
        str(x.overall),
        grade,
        i + 1,
        !x.compliance || grade === 'D',
        JSON.stringify({
          weights: {
            q: set.evalWQuality,
            d: set.evalWDelivery,
            c: set.evalWCost,
            r: set.evalWResponse,
          },
        }),
      );
      count += 1;
    }
  }
  return count;
}

export async function runScmDaily(): Promise<Record<string, unknown>> {
  const today = todayIst();
  const out: Record<string, unknown> = {};
  try {
    out.itc180 = await runItc180(today);
  } catch (err) {
    logger.error({ err }, 'scm.daily: itc180 failed');
  }
  try {
    out.alerts = await alertSteps(today);
  } catch (err) {
    logger.error({ err }, 'scm.daily: alerts failed');
  }
  try {
    const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1))
      .toISOString()
      .slice(0, 7);
    if (today.slice(8) === '01' || process.env.SCM_FORCE_EVALUATION === '1')
      out.evaluated = await evaluateMonth(prev);
  } catch (err) {
    logger.error({ err }, 'scm.daily: evaluation failed');
  }
  logger.info(out, 'scm.daily done');
  return out;
}
