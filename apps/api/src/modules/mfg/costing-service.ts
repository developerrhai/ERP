// Phase 13 v2 costing: the WIP sub-ledger (mfg_cost_ledger, append-only) and every journal of a production order. Material moves
// through the stock service (Dr INVENTORY_WIP / Cr INVENTORY_RM and back); labour and overhead absorbed by logged hours, the
// abnormal-scrap loss and the final sweep are posted here through the PostingService. WIP of an order = sum of its ledger rows;
// a cancel or a correction is a reversal row, never an edit.
import { Errors } from '../../core/http/errors';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { PostingService } from '../finance/posting-service';
import type { PostedJournal } from '../finance/posting-service';
import { insertRow, norm, query, scopeSql } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { D, absorbed, r2, variances } from './calc';
import { S } from './master-service';

export type CostElement = 'MATERIAL' | 'LABOUR' | 'OVERHEAD' | 'SCRAP' | 'FG';
export type CostEvent =
  | 'ISSUE'
  | 'RETURN'
  | 'BACKFLUSH'
  | 'LABOUR'
  | 'OVERHEAD'
  | 'ABNORMAL_SCRAP'
  | 'RECOVERY'
  | 'FG_RECEIPT'
  | 'SCRAP_LOSS_CLOSE'
  | 'REVERSAL';

interface JLine {
  accountCode: string;
  debit: string;
  credit: string;
  costCenterId?: string | undefined;
  narration?: string | undefined;
}

export const costing = {
  /** One balanced journal through the PostingService (source SYSTEM, voucher type Journal). */
  async journal(
    tx: Db,
    caller: Caller,
    p: {
      unitId: string;
      date: string;
      narration: string;
      docType: string;
      docId: string;
      docNo: string;
      lines: JLine[];
    },
  ): Promise<PostedJournal> {
    return PostingService.postJournal(
      tx,
      {
        unitId: p.unitId,
        docDate: p.date,
        voucherType: 'Journal',
        source: 'SYSTEM',
        narration: p.narration.slice(0, 300),
        sourceDocType: p.docType,
        sourceDocId: p.docId,
        sourceDocNo: p.docNo,
        lines: p.lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
          unitId: p.unitId,
          ...(l.costCenterId ? { costCenterId: l.costCenterId } : {}),
          ...(l.narration ? { narration: l.narration.slice(0, 200) } : {}),
        })),
      },
      { userId: caller.auth.userId },
    );
  },

  async reverseJournal(
    tx: Db,
    caller: Caller,
    journalId: string,
    reason: string,
    date: string,
  ): Promise<PostedJournal> {
    return PostingService.reverse(
      tx,
      journalId,
      reason,
      { userId: caller.auth.userId },
      { reversalDate: date },
    );
  },

  /** A row of the WIP sub-ledger: positive adds to the order's WIP, negative takes out of it. */
  async ledger(
    tx: Db,
    caller: Caller,
    p: {
      unitId: string;
      orderId: string;
      event: CostEvent;
      element: CostElement;
      amount: string;
      journalId: string | null;
      refType?: string | undefined;
      refId?: string | undefined;
      date: string;
      reversalOfId?: string | undefined;
    },
  ): Promise<string> {
    return insertRow(tx, 'mfg_cost_ledger', {
      unitId: p.unitId,
      orderId: p.orderId,
      event: p.event,
      element: p.element,
      amount: D(p.amount).toFixed(2),
      journalId: p.journalId,
      refType: p.refType ?? null,
      refId: p.refId ?? null,
      postedOn: p.date,
      reversalOfId: p.reversalOfId ?? null,
      createdById: caller.auth.userId,
    });
  },

  async wip(db: Db, orderId: string): Promise<string> {
    const r = (
      await query(
        db,
        `SELECT COALESCE(sum(amount),0)::text AS w FROM mfg_cost_ledger WHERE order_id=$1::uuid`,
        orderId,
      )
    )[0]!;
    return D(S(r.w)).toFixed(2);
  },

  /** Sums of the ledger by element (positive in minus negative out), for the cost sheet and the abnormal-scrap rate. */
  async byEvent(db: Db, orderId: string): Promise<Record<string, string>> {
    const rows = await query(
      db,
      `SELECT event, COALESCE(sum(amount),0)::text AS a FROM mfg_cost_ledger WHERE order_id=$1::uuid GROUP BY event`,
      orderId,
    );
    return Object.fromEntries(rows.map((r) => [S(r.event), D(S(r.a)).toFixed(2)]));
  },

  /**
   * Labour and overhead absorbed by hours at a job card rates (copied from the work centre at release):
   * Dr INVENTORY_WIP / Cr OVERHEAD_ABSORBED (cost centre of the work centre).
   */
  async absorbMinutes(
    tx: Db,
    caller: Caller,
    p: { opId: string; minutes: string; date: string; docId: string; label: string },
  ): Promise<{ labour: string; overhead: string }> {
    const op = (
      await query(
        tx,
        `SELECT o.*, d.number AS order_no, d.unit_id AS d_unit, w.cost_centre_id::text AS cc, w.code AS wc_code
           FROM mfg_order_ops o JOIN mfg_orders d ON d.id=o.order_id JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.id=$1::uuid`,
        p.opId,
      )
    )[0];
    if (!op) throw Errors.notFound('Job card not found.');
    const hours = D(p.minutes).div(60);
    const labour = absorbed(hours, S(op.labour_rate));
    const overhead = absorbed(hours, S(op.overhead_rate));
    if (labour.plus(overhead).lte(0)) return { labour: '0.00', overhead: '0.00' };
    if (!op.cc)
      throw Errors.validation({
        workCentre: `Work centre ${S(op.wc_code)} has no cost centre. Set it before production is confirmed.`,
      });
    const lines: JLine[] = [
      { accountCode: '1302', debit: labour.plus(overhead).toFixed(2), credit: '0' },
    ];
    if (labour.gt(0))
      lines.push({
        accountCode: '5116',
        debit: '0',
        credit: labour.toFixed(2),
        costCenterId: S(op.cc),
        narration: `Labour absorbed ${S(op.order_no)} op ${S(op.seq)}`,
      });
    if (overhead.gt(0))
      lines.push({
        accountCode: '5116',
        debit: '0',
        credit: overhead.toFixed(2),
        costCenterId: S(op.cc),
        narration: `Overhead absorbed ${S(op.order_no)} op ${S(op.seq)}`,
      });
    const j = await costing.journal(tx, caller, {
      unitId: S(op.d_unit),
      date: p.date,
      narration: `${p.label}: ${S(op.order_no)} op ${S(op.seq)} (${hours.toFixed(2)} h)`,
      docType: 'mfg_job_card',
      docId: p.docId,
      docNo: `${S(op.order_no)}/${S(op.seq)}`,
      lines,
    });
    if (labour.gt(0))
      await costing.ledger(tx, caller, {
        unitId: S(op.d_unit),
        orderId: S(op.order_id),
        event: 'LABOUR',
        element: 'LABOUR',
        amount: labour.toFixed(2),
        journalId: j.id,
        refType: 'job_card',
        refId: p.opId,
        date: p.date,
      });
    if (overhead.gt(0))
      await costing.ledger(tx, caller, {
        unitId: S(op.d_unit),
        orderId: S(op.order_id),
        event: 'OVERHEAD',
        element: 'OVERHEAD',
        amount: overhead.toFixed(2),
        journalId: j.id,
        refType: 'job_card',
        refId: p.opId,
        date: p.date,
      });
    return { labour: labour.toFixed(2), overhead: overhead.toFixed(2) };
  },

  /** The whole logged time of a job card, once, when the card is complete. */
  async absorbCard(
    tx: Db,
    caller: Caller,
    opId: string,
    date: string,
  ): Promise<{ labour: string; overhead: string }> {
    const op = (
      await query(
        tx,
        `SELECT setup_minutes_actual::text AS s, run_minutes_actual::text AS r, absorbed_posted FROM mfg_order_ops WHERE id=$1::uuid FOR UPDATE`,
        opId,
      )
    )[0];
    if (!op) throw Errors.notFound('Job card not found.');
    if (op.absorbed_posted === true) return { labour: '0.00', overhead: '0.00' };
    const mins = D(S(op.s)).plus(S(op.r));
    const r = await costing.absorbMinutes(tx, caller, {
      opId,
      minutes: mins.toFixed(2),
      date,
      docId: opId,
      label: 'Labour and overhead absorbed',
    });
    await tx.$executeRawUnsafe(
      `UPDATE mfg_order_ops SET absorbed_posted=true WHERE id=$1::uuid`,
      opId,
    );
    return r;
  },

  /** Abnormal scrap: qty x (WIP so far / planned quantity). Dr SCRAP_LOSS (5109) / Cr INVENTORY_WIP. Never capitalised. */
  async abnormalScrap(
    tx: Db,
    caller: Caller,
    p: { orderId: string; opId: string | null; qty: string; scrapId: string; date: string },
  ): Promise<{ amount: string; journalId: string | null }> {
    const o = (
      await query(
        tx,
        `SELECT number, qty::text, unit_id::text FROM mfg_orders WHERE id=$1::uuid`,
        p.orderId,
      )
    )[0]!;
    const wip = D(await costing.wip(tx, p.orderId));
    const perUnit = D(S(o.qty)).gt(0) ? wip.div(S(o.qty)) : D(0);
    const amount = r2(perUnit.mul(p.qty));
    if (amount.lte(0)) return { amount: '0.00', journalId: null };
    const cc = p.opId
      ? S(
          (
            await query(
              tx,
              `SELECT w.cost_centre_id::text AS cc FROM mfg_order_ops o JOIN mfg_work_centres w ON w.id=o.work_centre_id WHERE o.id=$1::uuid`,
              p.opId,
            )
          )[0]?.cc,
        )
      : '';
    const ccId = cc || (await fallbackCostCentre(tx, S(o.unit_id)));
    const j = await costing.journal(tx, caller, {
      unitId: S(o.unit_id),
      date: p.date,
      narration: `Abnormal scrap ${S(o.number)}: ${p.qty} pcs`,
      docType: 'mfg_scrap',
      docId: p.scrapId,
      docNo: S(o.number),
      lines: [
        { accountCode: '5109', debit: amount.toFixed(2), credit: '0', costCenterId: ccId },
        { accountCode: '1302', debit: '0', credit: amount.toFixed(2) },
      ],
    });
    await costing.ledger(tx, caller, {
      unitId: S(o.unit_id),
      orderId: p.orderId,
      event: 'ABNORMAL_SCRAP',
      element: 'SCRAP',
      amount: amount.negated().toFixed(2),
      journalId: j.id,
      refType: 'scrap',
      refId: p.scrapId,
      date: p.date,
    });
    return { amount: amount.toFixed(2), journalId: j.id };
  },

  /** What is left in WIP goes to SCRAP_LOSS (an order closed with no good output, or a rounding rest). */
  async sweepToLoss(tx: Db, caller: Caller, orderId: string, date: string): Promise<string> {
    const o = (
      await query(tx, `SELECT number, unit_id::text FROM mfg_orders WHERE id=$1::uuid`, orderId)
    )[0]!;
    const wip = D(await costing.wip(tx, orderId));
    if (wip.eq(0)) return '0.00';
    const cc = await fallbackCostCentre(tx, S(o.unit_id));
    const loss = wip.gt(0);
    const amt = wip.abs().toFixed(2);
    const j = await costing.journal(tx, caller, {
      unitId: S(o.unit_id),
      date,
      narration: `Remaining WIP settled on close ${S(o.number)}`,
      docType: 'mfg_order_close',
      docId: orderId,
      docNo: S(o.number),
      lines: loss
        ? [
            { accountCode: '5109', debit: amt, credit: '0', costCenterId: cc },
            { accountCode: '1302', debit: '0', credit: amt },
          ]
        : [
            { accountCode: '1302', debit: amt, credit: '0' },
            { accountCode: '5109', debit: '0', credit: amt, costCenterId: cc },
          ],
    });
    await costing.ledger(tx, caller, {
      unitId: S(o.unit_id),
      orderId,
      event: 'SCRAP_LOSS_CLOSE',
      element: 'SCRAP',
      amount: wip.negated().toFixed(2),
      journalId: j.id,
      refType: 'order',
      refId: orderId,
      date,
    });
    return wip.toFixed(2);
  },

  /** Standard (BOM roll-up material x quantity) against actual (ledger) for one order; written to the cost sheet. */
  async sheet(db: Db, orderId: string, finalise = false): Promise<Row> {
    const o = (
      await query(
        db,
        `SELECT o.*, b.std_material_cost::text AS bom_std, b.base_qty::text AS bom_base FROM mfg_orders o JOIN mfg_boms b ON b.id=o.bom_id WHERE o.id=$1::uuid`,
        orderId,
      )
    )[0];
    if (!o) throw Errors.notFound('Production order not found.');
    const ev = await costing.byEvent(db, orderId);
    const actMaterial = D(ev.ISSUE ?? 0)
      .plus(ev.RETURN ?? 0)
      .plus(ev.BACKFLUSH ?? 0);
    const actLabour = D(ev.LABOUR ?? 0);
    const actOverhead = D(ev.OVERHEAD ?? 0);
    const abnormal = D(ev.ABNORMAL_SCRAP ?? 0).negated();
    const stdMaterial =
      o.bom_std === null ? D(0) : r2(D(S(o.bom_std)).mul(S(o.qty)).div(S(o.bom_base)));
    const stdLabourOverhead = (
      await query(
        db,
        `SELECT COALESCE(sum((o.setup_minutes + o.run_minutes * d.qty) / 60 * o.labour_rate),0)::text AS l,
                COALESCE(sum((o.setup_minutes + o.run_minutes * d.qty) / 60 * o.overhead_rate),0)::text AS h
           FROM mfg_order_ops o JOIN mfg_orders d ON d.id=o.order_id WHERE d.id=$1::uuid`,
        orderId,
      )
    )[0]!;
    const stdLabour = r2(D(S(stdLabourOverhead.l)));
    const stdOverhead = r2(D(S(stdLabourOverhead.h)));
    const stdTotal = stdMaterial.plus(stdLabour).plus(stdOverhead);
    const actTotal = actMaterial.plus(actLabour).plus(actOverhead);
    const varPct = stdTotal.gt(0)
      ? actTotal.minus(stdTotal).div(stdTotal).mul(100).toDecimalPlaces(2)
      : null;
    await db.$executeRawUnsafe(
      `INSERT INTO mfg_cost_sheets (order_id, std_material, act_material, std_labour, act_labour, std_overhead, act_overhead, abnormal_scrap, std_total, act_total, variance_pct, finalised_at)
       VALUES ($1::uuid,$2::numeric,$3::numeric,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11::numeric, CASE WHEN $12::boolean THEN now() END)
       ON CONFLICT (order_id) DO UPDATE SET std_material=$2::numeric, act_material=$3::numeric, std_labour=$4::numeric, act_labour=$5::numeric, std_overhead=$6::numeric,
         act_overhead=$7::numeric, abnormal_scrap=$8::numeric, std_total=$9::numeric, act_total=$10::numeric, variance_pct=$11::numeric,
         finalised_at=CASE WHEN $12::boolean THEN now() ELSE mfg_cost_sheets.finalised_at END, updated_at=now()`,
      orderId,
      stdMaterial.toFixed(2),
      actMaterial.toFixed(2),
      stdLabour.toFixed(2),
      actLabour.toFixed(2),
      stdOverhead.toFixed(2),
      actOverhead.toFixed(2),
      abnormal.toFixed(2),
      stdTotal.toFixed(2),
      actTotal.toFixed(2),
      varPct === null ? null : varPct.toFixed(2),
      finalise,
    );
    return norm<Row>(
      (await query(db, `SELECT * FROM mfg_cost_sheets WHERE order_id=$1::uuid`, orderId))[0]!,
    );
  },

  /** Reported variances (not posted): material usage / price, efficiency, yield. */
  async variances(caller: Caller, pageId: string, orderId: string): Promise<Row> {
    const sc = await scopeSql(caller, pageId);
    const o = (
      await query(
        prisma,
        `SELECT t.* FROM mfg_orders t WHERE t.id=$${sc.args.length + 1}::uuid AND ${sc.sql}`,
        ...sc.args,
        orderId,
      )
    )[0];
    if (!o) throw Errors.notFound('Production order not found.');
    const mats = await query(
      prisma,
      `SELECT m.required_qty::text AS req, (m.issued_qty - m.returned_qty)::text AS act, (m.issued_value - m.returned_value)::text AS act_value, COALESCE(i.standard_cost,0)::text AS std
         FROM mfg_order_materials m JOIN items i ON i.id=m.item_id WHERE m.order_id=$1::uuid AND NOT m.customer_supplied`,
      orderId,
    );
    let usage = D(0);
    let price = D(0);
    for (const m of mats) {
      const act = D(S(m.act));
      const actRate = act.gt(0) ? D(S(m.act_value)).div(act) : D(S(m.std));
      const v = variances({
        actualQty: act,
        standardQty: S(m.req),
        standardRate: S(m.std),
        actualRate: actRate,
        actualHours: 0,
        standardHours: 0,
        hourRate: 0,
        standardInput: 1,
        actualOutput: 1,
      });
      usage = usage.plus(v.materialUsage);
      price = price.plus(v.materialPrice);
    }
    const h = (
      await query(
        prisma,
        `SELECT COALESCE(sum((setup_minutes + run_minutes * $2::numeric) / 60),0)::text AS std_h, COALESCE(sum((setup_minutes_actual + run_minutes_actual) / 60),0)::text AS act_h,
                COALESCE(max(labour_rate + overhead_rate),0)::text AS rate
           FROM mfg_order_ops WHERE order_id=$1::uuid`,
        orderId,
        S(o.qty),
      )
    )[0]!;
    const eff = variances({
      actualQty: 0,
      standardQty: 0,
      standardRate: 0,
      actualRate: 0,
      actualHours: S(h.act_h),
      standardHours: S(h.std_h),
      hourRate: S(h.rate),
      standardInput: 1,
      actualOutput: 1,
    });
    const y = variances({
      actualQty: 0,
      standardQty: 0,
      standardRate: 0,
      actualRate: 0,
      actualHours: 0,
      standardHours: 0,
      hourRate: 0,
      standardInput: S(o.qty),
      actualOutput: S(o.qty_completed),
    });
    return {
      orderId,
      materialUsage: usage.toFixed(2),
      materialPrice: price.toFixed(2),
      efficiency: eff.efficiency,
      yield: y.yield,
      note: 'Reported only: no variance journal is posted.',
    };
  },
};

/** Expense accounts of production need a cost centre: the unit's first leaf cost centre when the work centre has none. */
export async function fallbackCostCentre(tx: Db, unitId: string): Promise<string> {
  const r = (
    await query(
      tx,
      `SELECT id::text FROM cost_centers WHERE unit_id=$1::uuid AND NOT is_group AND status='Active' ORDER BY (code LIKE '%-STORE') DESC, code LIMIT 1`,
      unitId,
    )
  )[0];
  if (!r)
    throw Errors.validation({
      costCenter:
        'This unit has no cost centre. Add one under Finance > Cost Centres before posting production.',
    });
  return S(r.id);
}
