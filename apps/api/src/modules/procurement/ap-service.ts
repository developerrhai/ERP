// Phase 9: accounts payable. Payables / ageing / due schedule, payment proposals, supplier payments (UTR typed by hand
// in v1), Rule 37 ITC reclaim on payment and the exported PurchaseInvoiceService.applyPayment contract.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { AppError, Errors } from '../../core/http/errors';
import { cashBankService } from '../finance/cash-bank-service';
import { PostingService } from '../finance/posting-service';
import type { EventLine } from '../finance/posting-service';
import type { Caller } from '../records/service';
import { D, ZERO, round2, str } from '../inventory/money';
import type { Dec } from '../inventory/money';
import { concreteUnit } from '../inventory/typed';
import {
  TX,
  allocateNumber,
  audit,
  departmentOf,
  exec,
  fyOfCaller,
  insertRow,
  loadDoc,
  loadLines,
  norm,
  query,
  registerDoc,
  scopeSql,
  settings,
  todayIst,
} from './core';
import { S } from './core';
import type { DocDef, Actor, Row } from './core';
import { daysBetween, msmeInterest } from './math';

export const SPP_DEF: DocDef = {
  pageId: 'fin-ap',
  table: 'supplier_payment_proposals',
  title: 'Payment Proposal',
  amountCol: 'total',
  linesTable: 'supplier_payment_proposal_lines',
  parentCol: 'proposal_id',
};
registerDoc(SPP_DEF);
const SPAY_DEF: DocDef = {
  pageId: 'fin-ap',
  table: 'supplier_payments',
  title: 'Supplier Payment',
  amountCol: 'amount',
  linesTable: 'supplier_payment_allocations',
  parentCol: 'payment_id',
};

export type Bucket = 'NOT_DUE' | '0-30' | '31-60' | '61-90' | '90+';
export function bucketOf(dueDate: string | null, asOf: string): Bucket {
  if (!dueDate || dueDate > asOf) return 'NOT_DUE';
  const d = daysBetween(dueDate, asOf);
  return d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
}

async function outstandingInvoices(
  caller: Caller,
  f: { supplierId?: string | undefined; dueTill?: string | undefined; includeBlocked?: boolean },
) {
  const args: unknown[] = [];
  const where = [
    `i.status = 'Posted'`,
    `i.deleted_at IS NULL`,
    `i.net_payable - i.paid_amount > 0`,
  ];
  if (caller.ctx.unitId) {
    args.push(caller.ctx.unitId);
    where.push(`i.unit_id = $${args.length}::uuid`);
  } else if (!caller.ctx.allUnits) where.push('false');
  if (f.supplierId) {
    args.push(f.supplierId);
    where.push(`i.supplier_id = $${args.length}::uuid`);
  }
  if (f.dueTill) {
    args.push(f.dueTill);
    where.push(`i.due_date <= $${args.length}::date`);
  }
  if (!f.includeBlocked) where.push('i.payment_block = false');
  return query(
    prisma,
    `SELECT i.id::text, i.number, i.vendor_invoice_no, i.supplier_id::text, s.name AS supplier_name, s.msme_category, i.invoice_date, i.due_date, i.msme_due_date,
      i.net_payable::text, i.paid_amount::text, (i.net_payable - i.paid_amount)::text AS outstanding, i.payment_block, i.payment_block_reason
      FROM purchase_invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE ${where.join(' AND ')} ORDER BY i.due_date NULLS LAST, i.number`,
    ...args,
  );
}

export const apService = {
  async payables(
    caller: Caller,
    q: { supplierId?: string | undefined; asOf?: string | undefined },
  ) {
    const asOf = q.asOf ?? todayIst();
    const set = await settings();
    const rows = await outstandingInvoices(caller, {
      supplierId: q.supplierId,
      includeBlocked: true,
    });
    const list: Row[] = rows.map((r) => {
      const n = norm<Row>(r);
      const due = (n.dueDate as string | null) ?? null;
      const msmeOverdue = !!n.msmeDueDate && S(n.msmeDueDate) < asOf;
      const interest =
        msmeOverdue && set.msmeBankRatePct
          ? str(
              msmeInterest(
                D(S(n.outstanding)),
                D(set.msmeBankRatePct),
                daysBetween(S(n.msmeDueDate), asOf),
              ),
            )
          : null;
      return {
        ...n,
        bucket: bucketOf(due, asOf),
        daysPastDue: due && due < asOf ? daysBetween(due, asOf) : 0,
        msmeOverdue,
        msmeInterestInfo: interest,
      };
    });
    const bySupplier = new Map<
      string,
      { supplierId: string; supplierName: string; outstanding: Dec; invoices: number }
    >();
    for (const r of list) {
      const k = S(r.supplierId);
      const cur = bySupplier.get(k) ?? {
        supplierId: k,
        supplierName: S(r.supplierName),
        outstanding: ZERO,
        invoices: 0,
      };
      cur.outstanding = cur.outstanding.plus(D(S(r.outstanding)));
      cur.invoices += 1;
      bySupplier.set(k, cur);
    }
    return {
      asOf,
      rows: list,
      suppliers: [...bySupplier.values()].map((s) => ({ ...s, outstanding: str(s.outstanding) })),
    };
  },

  async ageing(caller: Caller, asOf = todayIst()) {
    const rows = await outstandingInvoices(caller, { includeBlocked: true });
    const totals: Record<Bucket, Dec> = {
      NOT_DUE: ZERO,
      '0-30': ZERO,
      '31-60': ZERO,
      '61-90': ZERO,
      '90+': ZERO,
    };
    const per = new Map<
      string,
      { supplierId: string; supplierName: string; buckets: Record<Bucket, Dec> }
    >();
    for (const r of rows) {
      const n = norm<Row>(r);
      const b = bucketOf((n.dueDate as string | null) ?? null, asOf);
      totals[b] = totals[b].plus(D(S(n.outstanding)));
      const k = S(n.supplierId);
      const cur = per.get(k) ?? {
        supplierId: k,
        supplierName: S(n.supplierName),
        buckets: { NOT_DUE: ZERO, '0-30': ZERO, '31-60': ZERO, '61-90': ZERO, '90+': ZERO },
      };
      cur.buckets[b] = cur.buckets[b].plus(D(S(n.outstanding)));
      per.set(k, cur);
    }
    const fmt = (m: Record<Bucket, Dec>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, str(round2(v))]));
    const total = Object.values(totals).reduce((a, v) => a.plus(v), ZERO);
    return {
      asOf,
      totals: fmt(totals),
      total: str(round2(total)),
      suppliers: [...per.values()].map((s) => ({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        buckets: fmt(s.buckets),
      })),
    };
  },

  async dueSchedule(caller: Caller, q: { from?: string | undefined; to?: string | undefined }) {
    const rows = await outstandingInvoices(caller, { includeBlocked: true });
    const days = new Map<string, { date: string; amount: Dec; msme: boolean; invoices: Row[] }>();
    for (const r of rows) {
      const n = norm<Row>(r);
      const d = S(n.dueDate ?? '');
      if (!d || (q.from && d < q.from) || (q.to && d > q.to)) continue;
      const cur = days.get(d) ?? { date: d, amount: ZERO, msme: false, invoices: [] };
      cur.amount = cur.amount.plus(D(S(n.outstanding)));
      cur.msme = cur.msme || !!n.msmeDueDate;
      cur.invoices.push(n);
      days.set(d, cur);
    }
    return [...days.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ ...d, amount: str(d.amount) }));
  },

  // ---------------------------------------------------------------- proposals
  async createProposal(
    caller: Caller,
    body: { dueTill: string; invoiceIds?: string[]; notes?: string },
  ) {
    const unitId = concreteUnit(caller);
    const fy = await fyOfCaller(caller);
    const id = await prisma.$transaction(async (tx) => {
      const cand = (await outstandingInvoices(caller, { dueTill: body.dueTill })).filter(
        (r) => !body.invoiceIds || body.invoiceIds.includes(S(r.id)),
      );
      if (cand.length === 0)
        throw Errors.validation({ dueTill: 'No unpaid invoices are due till that date.' });
      const total = cand.reduce((a, r) => a.plus(D(S(r.outstanding))), ZERO);
      const number = await allocateNumber(tx, SPP_DEF, unitId, fy.id);
      const pid = await insertRow(tx, 'supplier_payment_proposals', {
        unitId,
        fyId: fy.id,
        number,
        department: await departmentOf(tx, 'fin-ap', caller),
        status: 'Draft',
        dueTill: body.dueTill,
        total: str(total),
        notes: body.notes ?? null,
        createdById: caller.auth.userId,
        updatedById: caller.auth.userId,
      });
      let n = 0;
      for (const r of cand) {
        n += 1;
        await insertRow(tx, 'supplier_payment_proposal_lines', {
          proposalId: pid,
          lineNo: n,
          invoiceId: r.id,
          supplierId: r.supplier_id,
          amount: S(r.outstanding),
          selected: true,
        });
      }
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_CREATED',
        SPP_DEF.title,
        { id: pid, code: number },
        'fin-ap',
        { invoices: cand.length },
      );
      return pid;
    }, TX);
    return apService.getProposal(caller, id);
  },
  async getProposal(caller: Caller, id: string) {
    const h = await loadDoc(prisma, caller, SPP_DEF, id);
    const lines = await query(
      prisma,
      `SELECT l.*, i.number AS invoice_no, i.vendor_invoice_no, s.name AS supplier_name FROM supplier_payment_proposal_lines l JOIN purchase_invoices i ON i.id=l.invoice_id JOIN suppliers s ON s.id=l.supplier_id WHERE l.proposal_id=$1::uuid ORDER BY l.line_no`,
      id,
    );
    return { ...norm<Row>(h), lines: lines.map((l) => norm<Row>(l)) };
  },

  /** Approved proposal -> one Approved supplier payment per supplier (to be posted with bank + UTR). */
  async toPayments(caller: Caller, id: string) {
    const unitId = concreteUnit(caller);
    const fy = await fyOfCaller(caller);
    await prisma.$transaction(async (tx) => {
      const p = await loadDoc(tx, caller, SPP_DEF, id, { lock: true });
      if (p.status !== 'Approved') throw Errors.conflict('Approve the payment proposal first.');
      const lines = (await loadLines(tx, SPP_DEF, id)).filter((l) => l.selected === true);
      const bySupplier = new Map<string, Row[]>();
      for (const l of lines)
        bySupplier.set(S(l.supplier_id), [...(bySupplier.get(S(l.supplier_id)) ?? []), l]);
      for (const [sid, ls] of bySupplier) {
        let total = ZERO;
        for (const l of ls) {
          const inv = (
            await query(
              tx,
              `SELECT (net_payable - paid_amount)::text AS o, payment_block FROM purchase_invoices WHERE id=$1::uuid FOR UPDATE`,
              l.invoice_id,
            )
          )[0]!;
          if (inv.payment_block === true)
            throw Errors.conflict('An invoice on the proposal is blocked for payment.');
          if (D(S(l.amount)).gt(D(S(inv.o))))
            throw new AppError(
              409,
              'PAYMENT_EXCEEDS_PAYABLE',
              `Only ₹${S(inv.o)} is payable on this invoice.`,
            );
          total = total.plus(D(S(l.amount)));
        }
        const number = await allocateNumber(tx, SPAY_DEF, unitId, fy.id, 'fin-ap:pay');
        const pid = await insertRow(tx, 'supplier_payments', {
          unitId,
          fyId: fy.id,
          number,
          department: p.department,
          status: 'Approved',
          supplierId: sid,
          proposalId: id,
          amount: str(total),
          createdById: caller.auth.userId,
          updatedById: caller.auth.userId,
        });
        for (const l of ls)
          await insertRow(tx, 'supplier_payment_allocations', {
            paymentId: pid,
            invoiceId: l.invoice_id,
            amount: S(l.amount),
          });
      }
      await exec(
        tx,
        `UPDATE supplier_payment_proposals SET status='Posted', version=version+1, updated_at=now() WHERE id=$1::uuid`,
        id,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_POSTED',
        SPP_DEF.title,
        { id, code: S(p.number) },
        'fin-ap',
        { payments: bySupplier.size },
      );
    }, TX);
    return apService.listPayments(caller, { proposalId: id, page: 1, size: 100 });
  },

  async listPayments(
    caller: Caller,
    q: { proposalId?: string | undefined; status?: string | undefined; page: number; size: number },
  ) {
    const sc = await scopeSql(caller, 'fin-ap');
    const args = [...sc.args];
    const where = [sc.sql];
    if (q.proposalId) {
      args.push(q.proposalId);
      where.push(`t.proposal_id = $${args.length}::uuid`);
    }
    if (q.status) {
      args.push(q.status);
      where.push(`t.status = $${args.length}`);
    }
    const total = Number(
      (
        await query(
          prisma,
          `SELECT count(*)::int AS n FROM supplier_payments t WHERE ${where.join(' AND ')}`,
          ...args,
        )
      )[0]?.n ?? 0,
    );
    const rows = await query(
      prisma,
      `SELECT t.*, s.name AS supplier_name FROM supplier_payments t JOIN suppliers s ON s.id=t.supplier_id WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC LIMIT ${q.size} OFFSET ${(q.page - 1) * q.size}`,
      ...args,
    );
    return { rows: rows.map((r) => norm(r)), total };
  },

  /** Records the payment (bank, mode, UTR typed by hand) and settles the invoices. */
  async postPayment(
    caller: Caller,
    id: string,
    body: {
      bankAccountId: string;
      paymentMode: 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque' | 'Cash';
      utr?: string;
      paymentDate?: string;
    },
  ) {
    await prisma.$transaction(async (tx) => {
      const p = await loadDoc(tx, caller, SPAY_DEF, id, { lock: true });
      if (p.status !== 'Approved')
        throw Errors.conflict(
          p.status === 'Posted'
            ? 'This payment is already posted.'
            : 'Only an Approved payment can be posted.',
        );
      const date = body.paymentDate ?? todayIst();
      if (body.paymentMode !== 'Cash') {
        const bank = (
          await query(
            tx,
            `SELECT 1 FROM supplier_bank_accounts WHERE supplier_id=$1::uuid AND verified_by_id IS NOT NULL LIMIT 1`,
            p.supplier_id,
          )
        )[0];
        if (!bank)
          throw new AppError(
            409,
            'BANK_UNVERIFIED',
            "The supplier's bank account is not verified by a second person.",
          );
      }
      const allocs = await query(
        tx,
        `SELECT a.*, i.journal_id::text AS journal_id, i.status AS inv_status, i.payment_block FROM supplier_payment_allocations a JOIN purchase_invoices i ON i.id=a.invoice_id WHERE a.payment_id=$1::uuid FOR UPDATE OF i`,
        id,
      );
      const parts: { itemId: string; amount: string }[] = [];
      for (const a of allocs) {
        if (a.payment_block === true)
          throw Errors.conflict('An invoice on this payment is blocked for payment.');
        const oi =
          (
            await query(
              tx,
              `SELECT id::text FROM open_items WHERE journal_id=$1::uuid AND party_id=$2::uuid AND side='PAYABLE' ORDER BY created_at LIMIT 1`,
              a.journal_id,
              p.supplier_id,
            )
          )[0] ??
          (
            await query(
              tx,
              `SELECT id::text FROM open_items WHERE journal_id=$1::uuid AND party_id=$2::uuid ORDER BY created_at LIMIT 1`,
              a.journal_id,
              p.supplier_id,
            )
          )[0];
        if (!oi) throw Errors.conflict('The open bill of an invoice was not found.');
        parts.push({ itemId: S(oi.id), amount: S(norm<Row>(a).amount) });
      }
      const res = await cashBankService.createPaymentIn(
        tx,
        {
          kind: 'PAYMENT',
          docDate: date,
          bankAccountId: body.bankAccountId,
          supplierId: S(p.supplier_id),
          amount: S(norm<Row>(p).amount),
          mode: body.paymentMode,
          ...(body.utr ? { referenceNo: body.utr } : {}),
          narration: `Payment ${S(p.number)}`,
          allocations: parts,
        },
        { userId: caller.auth.userId },
      );
      for (const a of allocs)
        await apService.applyPayment(tx, S(a.invoice_id), S(norm<Row>(a).amount), {
          paymentId: id,
          date,
          actor: { userId: caller.auth.userId },
        });
      await exec(
        tx,
        `UPDATE supplier_payments SET status='Posted', journal_id=$2::uuid, utr=$3, bank_account_id=$4::uuid, payment_mode=$5, payment_date=$6::date, posted_at=now(), version=version+1, updated_at=now(), updated_by_id=$7::uuid WHERE id=$1::uuid`,
        id,
        res.journal.id,
        body.utr ?? null,
        body.bankAccountId,
        body.paymentMode === 'Cash' ? 'CASH' : 'BANK',
        date,
        caller.auth.userId,
      );
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_POSTED',
        SPAY_DEF.title,
        { id, code: S(p.number) },
        'fin-ap',
        { utr: body.utr ?? null },
      );
    }, TX);
    return apService.getPayment(caller, id);
  },
  async getPayment(caller: Caller, id: string) {
    const h = await loadDoc(prisma, caller, SPAY_DEF, id);
    const lines = await query(
      prisma,
      `SELECT * FROM supplier_payment_allocations WHERE payment_id=$1::uuid`,
      id,
    );
    return { ...norm<Row>(h), allocations: lines.map((l) => norm<Row>(l)) };
  },

  /** Contract used by Phase 11+ and the payment screen: settle `amount` of an invoice, reclaim ITC in proportion (Rule 37). */
  async applyPayment(
    tx: Db,
    invoiceId: string,
    amount: string,
    ctx: { paymentId?: string | undefined; date: string; actor: Actor },
  ): Promise<void> {
    const inv = (
      await query(tx, `SELECT * FROM purchase_invoices WHERE id=$1::uuid FOR UPDATE`, invoiceId)
    )[0];
    if (!inv || inv.status !== 'Posted')
      throw Errors.conflict('Only a posted invoice can be paid.');
    const n = norm<Row>(inv);
    const net = D(S(n.netPayable));
    const paidBefore = D(S(n.paidAmount));
    const unpaidBefore = net.minus(paidBefore);
    const amt = D(amount);
    if (amt.lte(0) || amt.gt(unpaidBefore))
      throw new AppError(
        409,
        'PAYMENT_EXCEEDS_PAYABLE',
        `Only ₹${str(unpaidBefore)} is payable on this invoice.`,
      );
    const paid = paidBefore.plus(amt);
    await exec(
      tx,
      `UPDATE purchase_invoices SET paid_amount=$2::numeric, payment_status=$3, version=version+1 WHERE id=$1::uuid`,
      invoiceId,
      str(paid),
      paid.gte(net) ? 'PAID' : 'PARTIAL',
    );
    // ITC reclaim: share of what is still reversed
    const rev = await query(
      tx,
      `SELECT kind, sum(cgst)::text AS c, sum(sgst)::text AS s, sum(igst)::text AS i FROM itc_reversals WHERE invoice_id=$1::uuid GROUP BY kind`,
      invoiceId,
    );
    const sum = (k: string, f: 'c' | 's' | 'i') => D(S(rev.find((r) => r.kind === k)?.[f] ?? 0));
    const remain = {
      cgst: sum('R37_REVERSE', 'c').minus(sum('R37_RECLAIM', 'c')),
      sgst: sum('R37_REVERSE', 's').minus(sum('R37_RECLAIM', 's')),
      igst: sum('R37_REVERSE', 'i').minus(sum('R37_RECLAIM', 'i')),
    };
    if (remain.cgst.plus(remain.sgst).plus(remain.igst).lte(0)) return;
    const share = amt.div(unpaidBefore);
    const part = (r: Dec) => (amt.gte(unpaidBefore) ? r : round2(r.mul(share)));
    const re = { cgst: part(remain.cgst), sgst: part(remain.sgst), igst: part(remain.igst) };
    if (re.cgst.plus(re.sgst).plus(re.igst).lte(0)) return;
    const unitId = S(inv.unit_id);
    const legs: EventLine[] = [];
    for (const [h, v] of [
      ['CGST', re.cgst],
      ['SGST', re.sgst],
      ['IGST', re.igst],
    ] as [string, Dec][])
      if (v.gt(0)) legs.push({ account: `INPUT_${h}`, debit: str(v), credit: '0.00', unitId });
    const total = re.cgst.plus(re.sgst).plus(re.igst);
    legs.push({
      account: 'ITC_REVERSED_180',
      debit: '0.00',
      credit: str(total),
      unitId,
      costCenter: await anyCostCenter(tx, unitId),
    });
    const j = await PostingService.postJournal(
      tx,
      {
        unitId,
        docDate: ctx.date,
        voucherType: 'Adjustment',
        source: 'EVENT',
        narration: `ITC reclaimed on payment, invoice ${S(inv.number)}`,
        sourceDocType: 'itc_reclaim',
        sourceDocId: ctx.paymentId ?? invoiceId,
        sourceDocNo: S(inv.number),
        event: 'ITC_R37_RECLAIM',
        payload: { docNo: S(inv.number), lines: legs },
      },
      { userId: ctx.actor.userId },
    );
    await insertRow(tx, 'itc_reversals', {
      unitId,
      invoiceId,
      kind: 'R37_RECLAIM',
      cgst: str(re.cgst),
      sgst: str(re.sgst),
      igst: str(re.igst),
      eventDate: ctx.date,
      journalId: j.id,
      paymentId: ctx.paymentId ?? null,
      createdById: ctx.actor.userId,
    });
    await exec(
      tx,
      `UPDATE purchase_invoices SET itc_reversed_amount = itc_reversed_amount - $2::numeric WHERE id=$1::uuid`,
      invoiceId,
      str(total),
    );
  },

  async cancelPayment(caller: Caller, id: string, reason: string) {
    await prisma.$transaction(async (tx) => {
      const p = await loadDoc(tx, caller, SPAY_DEF, id, { lock: true });
      if (p.status !== 'Posted') throw Errors.conflict('Only a posted payment is cancelled.');
      const pay = (
        await query(
          tx,
          `SELECT id::text, version FROM payments WHERE journal_id=$1::uuid`,
          p.journal_id,
        )
      )[0];
      if (!pay) throw Errors.notFound('The bank payment was not found.');
      for (const a of await query(
        tx,
        `SELECT invoice_id::text, amount::text FROM supplier_payment_allocations WHERE payment_id=$1::uuid`,
        id,
      )) {
        await exec(
          tx,
          `UPDATE purchase_invoices SET paid_amount = paid_amount - $2::numeric, payment_status = CASE WHEN paid_amount - $2::numeric <= 0 THEN 'UNPAID' ELSE 'PARTIAL' END, version=version+1 WHERE id=$1::uuid`,
          a.invoice_id,
          a.amount,
        );
      }
      // the Rule 37 reclaim made by this payment is undone: its journal is reversed and the credit is reversed again
      const today = todayIst();
      for (const r of await query(
        tx,
        `SELECT * FROM itc_reversals WHERE payment_id=$1::uuid AND kind='R37_RECLAIM'`,
        id,
      )) {
        const rj = await PostingService.reverse(
          tx,
          S(r.journal_id),
          reason,
          { userId: caller.auth.userId },
          { reversalDate: today },
        );
        const n = norm<Row>(r);
        await insertRow(tx, 'itc_reversals', {
          unitId: r.unit_id,
          invoiceId: r.invoice_id,
          kind: 'R37_REVERSE',
          cgst: S(n.cgst),
          sgst: S(n.sgst),
          igst: S(n.igst),
          eventDate: today,
          journalId: rj.id,
          createdById: caller.auth.userId,
        });
        await exec(
          tx,
          `UPDATE purchase_invoices SET itc_reversed_amount = itc_reversed_amount + $2::numeric WHERE id=$1::uuid`,
          r.invoice_id,
          str(
            D(S(n.cgst))
              .plus(D(S(n.sgst)))
              .plus(D(S(n.igst))),
          ),
        );
      }
      await exec(
        tx,
        `UPDATE supplier_payments SET status='Cancelled', version=version+1, updated_at=now() WHERE id=$1::uuid`,
        id,
      );
      // last: it commits on its own, so everything above is already done when it runs
      await cashBankService.cancelPayment(S(pay.id), Number(pay.version), reason, {
        userId: caller.auth.userId,
      });
      await audit(
        tx,
        caller,
        caller.auth.userId,
        'SCM_CANCELLED',
        SPAY_DEF.title,
        { id, code: S(p.number) },
        'fin-ap',
        { reason },
      );
    }, TX);
    return apService.getPayment(caller, id);
  },
};

export async function anyCostCenter(tx: Db, unitId: string): Promise<string> {
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

/** Exported contracts for later phases (PHASE-09 §5). */
export const PurchaseInvoiceService = {
  applyPayment: (
    tx: Db,
    invoiceId: string,
    amount: string,
    ctx: { paymentId?: string | undefined; date: string; actor: Actor },
  ) => apService.applyPayment(tx, invoiceId, amount, ctx),
};
