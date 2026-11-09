// Phase 9 reports, alerts and the services later phases call (PHASE-09 §5 "Contracts exported to later phases").
// KPIs come from real queries only (no synthetic numbers).
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import type { Row } from './core';
import { allocateNumber, insertRow, norm, query, settings, todayIst, S } from './core';
import { addDays, daysBetween, deliveryStatus } from './math';
import { PR_DEF } from './sourcing-service';
import { tdsPreviewFor } from './invoice-service';
import { apService } from './ap-service';

function unitWhere(caller: Caller, alias: string, args: unknown[]): string {
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    return `${alias}.unit_id = $${args.length}::uuid`;
  }
  return caller.ctx.allUnits ? 'true' : 'false';
}

export const GrirService = {
  /** Goods received but not yet invoiced, per item (qty and value). */
  async openByItem(
    db: Db,
    itemId?: string,
    unitId?: string,
  ): Promise<{ itemId: string; qty: string; value: string }[]> {
    const rows = await query(
      db,
      `SELECT gl.item_id::text AS item_id, sum(gl.accepted_qty - gl.billed_qty)::text AS qty, sum((gl.accepted_qty - gl.billed_qty) * gl.rate)::text AS value
        FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id
       WHERE g.status='Posted' AND gl.accepted_qty - gl.billed_qty > 0 AND ($1::uuid IS NULL OR gl.item_id=$1::uuid) AND ($2::uuid IS NULL OR g.unit_id=$2::uuid)
       GROUP BY gl.item_id`,
      itemId ?? null,
      unitId ?? null,
    );
    return rows.map((r) => ({
      itemId: S(r.item_id),
      qty: S(r.qty),
      value: str(round2(D(S(r.value)))),
    }));
  },
};

export const ProcurementQueries = {
  /** Open (not yet received) PO quantity of an item, for MRP (Phase 13). */
  async openPoQty(db: Db, itemId: string, unitId?: string): Promise<string> {
    const r = (
      await query(
        db,
        `SELECT COALESCE(sum(l.base_qty * (l.qty - l.received_qty - l.closed_qty) / NULLIF(l.qty,0)),0)::text AS q
        FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id
       WHERE l.item_id=$1::uuid AND p.status='Approved' AND p.amending=false AND p.deleted_at IS NULL AND ($2::uuid IS NULL OR p.unit_id=$2::uuid) AND l.qty - l.received_qty - l.closed_qty > 0`,
        itemId,
        unitId ?? null,
      )
    )[0];
    return str(D(S(r?.q ?? 0)).toDecimalPlaces(3));
  },
};

export const SupplierScoreService = {
  async latest(db: Db, supplierId: string): Promise<Row | null> {
    const r = (
      await query(
        db,
        `SELECT e.*, s.name AS supplier_name FROM supplier_evaluations e JOIN suppliers s ON s.id=e.supplier_id WHERE e.supplier_id=$1::uuid ORDER BY e.period DESC LIMIT 1`,
        supplierId,
      )
    )[0];
    return r ? norm<Row>(r) : null;
  },
};

export const TdsService = {
  preview: tdsPreviewFor,
  async ledger(db: Db, supplierId: string, fyId: string): Promise<Row[]> {
    return (
      await query(
        db,
        `SELECT * FROM supplier_tds_ledger WHERE supplier_id=$1::uuid AND fy_id=$2::uuid ORDER BY seq`,
        supplierId,
        fyId,
      )
    ).map((r) => norm<Row>(r));
  },
};

/** MRP (Phase 13) raises requisitions through this; the PR is created as a Draft in the given unit and year. */
export const PurchaseRequestGateway = {
  async create(
    db: Db,
    p: {
      unitId: string;
      fyId: string;
      userId: string;
      department: string;
      purpose: string;
      lines: {
        itemId: string;
        qty: string;
        uom: string;
        estRate?: string;
        requiredDate?: string;
      }[];
    },
  ): Promise<{ id: string; number: string }> {
    if (p.lines.length === 0) throw Errors.validation({ lines: 'Add at least one line.' });
    const number = await allocateNumber(db, PR_DEF, p.unitId, p.fyId);
    const total = p.lines.reduce((a, l) => a.plus(round2(D(l.qty).mul(D(l.estRate ?? '0')))), ZERO);
    const id = await insertRow(db, 'purchase_requisitions', {
      unitId: p.unitId,
      fyId: p.fyId,
      number,
      department: p.department,
      status: 'Draft',
      purpose: p.purpose,
      estimatedTotal: str(total),
      createdById: p.userId,
      updatedById: p.userId,
    });
    let n = 0;
    for (const l of p.lines) {
      n += 1;
      await insertRow(db, 'purchase_requisition_lines', {
        prId: id,
        lineNo: n,
        itemId: l.itemId,
        qty: l.qty,
        uom: l.uom,
        estRate: l.estRate ?? '0',
        requiredDate: l.requiredDate ?? null,
      });
    }
    return { id, number };
  },
};

export const reportsService = {
  async grir(caller: Caller) {
    const args: unknown[] = [];
    const w = unitWhere(caller, 'g', args);
    const rows = await query(
      prisma,
      `SELECT g.number AS grn_no, g.receipt_date, s.name AS supplier_name, i.code AS item_code, i.name AS item_name, gl.accepted_qty::text, gl.billed_qty::text,
        ((gl.accepted_qty - gl.billed_qty) * gl.rate)::text AS open_value
        FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id JOIN suppliers s ON s.id=g.supplier_id JOIN items i ON i.id=gl.item_id
       WHERE g.status='Posted' AND ${w} AND gl.accepted_qty - gl.billed_qty > 0 ORDER BY g.receipt_date`,
      ...args,
    );
    const today = todayIst();
    const out = rows.map((r) => {
      const n = norm<Row>(r);
      const age = daysBetween(S(n.receiptDate), today);
      return {
        ...n,
        openValue: str(round2(D(S(n.openValue)))),
        ageDays: age,
        bucket: age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+',
      };
    });
    return { rows: out, total: str(out.reduce((a, r) => a.plus(D(S(r.openValue))), ZERO)) };
  },

  async msmeOverdue(caller: Caller) {
    const p = await apService.payables(caller, {});
    return p.rows.filter(
      (r) =>
        r.msmeOverdue === true || (r.msmeDueDate && S(r.msmeDueDate) <= addDays(todayIst(), 7)),
    );
  },

  async itc180(caller: Caller) {
    const args: unknown[] = [];
    const w = unitWhere(caller, 'i', args);
    const rows = await query(
      prisma,
      `SELECT i.id::text, i.number, i.invoice_date, s.name AS supplier_name, i.net_payable::text, i.paid_amount::text, i.itc_reversed_amount::text, i.gstr2b_status,
        (SELECT COALESCE(sum(cgst+sgst+igst),0) FROM purchase_invoice_lines l WHERE l.invoice_id=i.id AND l.itc_flag IN ('ELIGIBLE','CAPITAL_GOODS','INPUT_SERVICE'))::text AS itc
        FROM purchase_invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE i.status='Posted' AND ${w} AND i.net_payable - i.paid_amount > 0 ORDER BY i.invoice_date`,
      ...args,
    );
    const today = todayIst();
    return rows.map((r) => {
      const n = norm<Row>(r);
      return {
        ...n,
        daysLeft: 180 - daysBetween(S(n.invoiceDate), today),
        unpaidItc: str(
          round2(
            D(S(n.itc))
              .mul(D(S(n.netPayable)).minus(D(S(n.paidAmount))))
              .div(D(S(n.netPayable))),
          ),
        ),
      };
    });
  },

  async itcAtRisk(caller: Caller) {
    const rows = await reportsService.itc180(caller);
    const atRisk = rows.filter(
      (r) => Number(r.daysLeft) <= 30 || S((r as Row).gstr2bStatus ?? '') === 'MISSING',
    );
    return { rows: atRisk, total: str(atRisk.reduce((a, r) => a.plus(D(S(r.unpaidItc))), ZERO)) };
  },

  async supplierScorecard(caller: Caller, period?: string) {
    const args: unknown[] = [];
    const w = unitWhere(caller, 'e', args);
    let sql = `SELECT e.*, s.name AS supplier_name FROM supplier_evaluations e JOIN suppliers s ON s.id=e.supplier_id WHERE ${w}`;
    if (period) {
      args.push(period);
      sql += ` AND e.period = $${args.length}`;
    } else sql += ` AND e.period = (SELECT max(period) FROM supplier_evaluations)`;
    return (await query(prisma, sql + ' ORDER BY e.rank', ...args)).map((r) => norm<Row>(r));
  },

  async alerts(caller: Caller) {
    const set = await settings();
    const today = todayIst();
    const args: unknown[] = [];
    const w = unitWhere(caller, 'i', args);
    const n = async (sql: string, ...a: unknown[]) =>
      Number((await query(prisma, sql, ...a))[0]?.n ?? 0);
    const pargs: unknown[] = [];
    const pw = unitWhere(caller, 'p', pargs);
    return {
      invoicesOnHold: await n(
        `SELECT count(*)::int AS n FROM purchase_invoices i WHERE ${w} AND i.deleted_at IS NULL AND i.match_state='ON_HOLD' AND i.status IN ('Draft','Rejected')`,
        ...args,
      ),
      msmeDueSoon: await n(
        `SELECT count(*)::int AS n FROM purchase_invoices i WHERE ${w} AND i.status='Posted' AND i.net_payable - i.paid_amount > 0 AND i.msme_due_date IS NOT NULL AND i.msme_due_date <= $${args.length + 1}::date`,
        ...args,
        addDays(today, set.msmeAlertDays),
      ),
      itc180Soon: await n(
        `SELECT count(*)::int AS n FROM purchase_invoices i WHERE ${w} AND i.status='Posted' AND i.net_payable - i.paid_amount > 0 AND i.invoice_date <= $${args.length + 1}::date`,
        ...args,
        addDays(today, -(180 - set.itc180AlertDays)),
      ),
      contractsExpiring: await n(
        `SELECT count(*)::int AS n FROM purchase_contracts p WHERE ${pw} AND p.status='Approved' AND p.valid_to BETWEEN $${pargs.length + 1}::date AND $${pargs.length + 2}::date`,
        ...pargs,
        today,
        addDays(today, 30),
      ),
      putawayExceptions: await n(
        `SELECT count(*)::int AS n FROM putaway_tasks p WHERE ${pw} AND p.status='Exception'`,
        ...pargs,
      ),
      delayedPoLines: (
        await query(
          prisma,
          `SELECT l.qty::text, l.received_qty::text, l.closed_qty::text, l.delivery_date FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.po_id WHERE ${pw} AND p.status='Approved' AND p.amending=false AND l.delivery_date < $${pargs.length + 1}::date`,
          ...pargs,
          today,
        )
      ).filter(
        (r) =>
          deliveryStatus({
            poQty: D(S(r.qty)),
            receivedQty: D(S(r.received_qty)),
            closedQty: D(S(r.closed_qty)),
            expectedDate: S(norm<Row>(r).deliveryDate),
            today,
          }).status === 'DELAYED',
      ).length,
    };
  },

  /** Real-query KPIs: PR->PO days, OTIF, PPM, GRIR ageing, dock-to-stock (hours). */
  async kpis(caller: Caller) {
    const args: unknown[] = [];
    const w = unitWhere(caller, 'p', args);
    const prpo = (
      await query(
        prisma,
        `SELECT avg(EXTRACT(EPOCH FROM (p.created_at - r.created_at))/86400)::text AS d FROM document_links d JOIN purchase_orders p ON p.id=d.to_id JOIN purchase_requisitions r ON r.id=d.from_id WHERE d.from_type='PR' AND d.to_type='PO' AND ${w}`,
        ...args,
      )
    )[0];
    const gargs: unknown[] = [];
    const gw = unitWhere(caller, 'g', gargs);
    const q = (
      await query(
        prisma,
        `SELECT COALESCE(sum(gl.rejected_qty),0)::text AS rej, COALESCE(sum(gl.received_qty),0)::text AS recv FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id WHERE g.status='Posted' AND ${gw}`,
        ...gargs,
      )
    )[0]!;
    const otif = (
      await query(
        prisma,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE (pl.delivery_date IS NULL OR g.receipt_date <= pl.delivery_date) AND pl.received_qty >= pl.qty)::int AS good FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id=gl.grn_id JOIN purchase_order_lines pl ON pl.id=gl.po_line_id WHERE g.status='Posted' AND ${gw}`,
        ...gargs,
      )
    )[0]!;
    const dock = (
      await query(
        prisma,
        `SELECT avg(EXTRACT(EPOCH FROM (t.completed_at - g.posted_at))/3600)::text AS h FROM putaway_tasks t JOIN goods_receipts g ON g.id=t.grn_id WHERE t.status='Done' AND ${caller.ctx.unitId ? 't.unit_id = $1::uuid' : 'true'}`,
        ...(caller.ctx.unitId ? [caller.ctx.unitId] : []),
      )
    )[0];
    const grir = await reportsService.grir(caller);
    const recv = D(S(q.recv));
    return {
      prToPoDays: prpo?.d ? Number(D(S(prpo.d)).toDecimalPlaces(1)) : null,
      otifPct: Number(otif.total)
        ? Number(D(Number(otif.good)).mul(100).div(Number(otif.total)).toDecimalPlaces(1))
        : null,
      ppm: recv.isZero() ? null : Number(D(S(q.rej)).mul(1_000_000).div(recv).toDecimalPlaces(0)),
      grirOpenValue: grir.total,
      grirOver90: grir.rows.filter((r) => r.bucket === '90+').length,
      dockToStockHours: dock?.h ? Number(D(S(dock.h)).toDecimalPlaces(1)) : null,
    };
  },
};
