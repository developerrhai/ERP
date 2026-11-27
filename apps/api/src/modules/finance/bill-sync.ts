// A bill settled straight in the books (a Cash / Bank Book payment, or "Allocate" of an advance or a note) must show on
// its invoice too. Payments made from Accounts Payable, customer receipts, returns and set-offs update their invoices
// themselves and do not come here. What was added is remembered per allocation, so a cancel takes back exactly that.
import type { Db } from '../../core/db/prisma';
import type { Actor } from './accounts-service';
import { D, money } from './money';
import { PostingService } from './posting-service';

export interface BillSettled {
  allocationId: string;
  /** the credit that settled the bill: a payment, an advance, a note, a journal */
  sourceItemId: string;
  /** the bill that was settled */
  targetItemId: string;
  amount: string;
  date: string;
}

interface Bill {
  side: string;
  party_id: string;
  journal_id: string | null;
  source_type: string;
}

/** The part of `amount` that is still open on the invoice: an invoice is never marked paid beyond its value. */
const upTo = (amount: string, open: string): string | null => {
  const take = D(amount).lessThan(D(open)) ? D(amount) : D(open);
  return take.greaterThan(0) ? money(take) : null;
};

export const billSync = {
  async apply(tx: Db, input: BillSettled, actor: Actor): Promise<void> {
    // unpaginated: one row by the two ids
    const bill = (
      await tx.$queryRaw<Bill[]>`
        SELECT t.side, t.party_id::text, t.journal_id::text, s.item_type AS source_type
          FROM open_items t, open_items s WHERE t.id = ${input.targetItemId}::uuid AND s.id = ${input.sourceItemId}::uuid`
    )[0];
    if (!bill?.journal_id) return;
    if (bill.side === 'PAYABLE') {
      // unpaginated: the one posted invoice behind this journal and supplier
      const inv = (
        await tx.$queryRaw<{ id: string; open: string }[]>`
          SELECT id::text, (net_payable - paid_amount)::text AS open FROM purchase_invoices
           WHERE journal_id = ${bill.journal_id}::uuid AND supplier_id = ${bill.party_id}::uuid AND status = 'Posted' AND deleted_at IS NULL FOR UPDATE`
      )[0];
      const value = inv ? upTo(input.amount, inv.open) : null;
      if (!inv || !value) return;
      // loaded here, not at the top: accounts payable itself posts through the cash and bank service
      const { apService } = await import('../procurement/ap-service.js');
      // a note lowers what is owed: it is not a payment, so it claims no late-payment tax credit back
      const note = bill.source_type === 'DEBIT_NOTE' || bill.source_type === 'CREDIT_NOTE';
      const reclaim = await apService.applyPayment(tx, inv.id, value, { date: input.date, actor, noReclaim: note, reference: input.allocationId });
      await tx.$executeRaw`INSERT INTO allocation_invoice_links (allocation_id, purchase_invoice_id, amount, itc_reclaim_id)
        VALUES (${input.allocationId}::uuid, ${inv.id}::uuid, ${value}::numeric, ${reclaim}::uuid)`;
      return;
    }
    // unpaginated: the one posted invoice behind this journal and customer
    const inv = (
      await tx.$queryRaw<{ id: string; open: string }[]>`
        SELECT id::text, (grand_total - received_amount)::text AS open FROM sales_invoices
         WHERE journal_id = ${bill.journal_id}::uuid AND customer_id = ${bill.party_id}::uuid AND status = 'Posted' AND deleted_at IS NULL FOR UPDATE`
    )[0];
    const value = inv ? upTo(input.amount, inv.open) : null;
    if (!inv || !value) return;
    await tx.$executeRaw`UPDATE sales_invoices SET received_amount = received_amount + ${value}::numeric,
      receipt_status = CASE WHEN received_amount + ${value}::numeric >= grand_total THEN 'PAID' ELSE 'PARTIAL' END, version = version + 1 WHERE id = ${inv.id}::uuid`;
    await tx.$executeRaw`INSERT INTO allocation_invoice_links (allocation_id, sales_invoice_id, amount)
      VALUES (${input.allocationId}::uuid, ${inv.id}::uuid, ${value}::numeric)`;
  },

  /** Called when an allocation is undone. Does nothing for an allocation that did not come through `apply`. */
  async release(tx: Db, allocationId: string, reason: string, actor: Actor, date: string): Promise<void> {
    // unpaginated: one row by its id
    const link = (
      await tx.$queryRaw<{ purchase_invoice_id: string | null; sales_invoice_id: string | null; amount: string; itc_reclaim_id: string | null }[]>`
        SELECT purchase_invoice_id::text, sales_invoice_id::text, amount::text, itc_reclaim_id::text
          FROM allocation_invoice_links WHERE allocation_id = ${allocationId}::uuid`
    )[0];
    if (!link) return;
    if (link.sales_invoice_id)
      await tx.$executeRaw`UPDATE sales_invoices SET received_amount = received_amount - ${link.amount}::numeric,
        receipt_status = CASE WHEN received_amount - ${link.amount}::numeric <= 0 THEN 'UNPAID' ELSE 'PARTIAL' END, version = version + 1 WHERE id = ${link.sales_invoice_id}::uuid`;
    if (link.purchase_invoice_id)
      await tx.$executeRaw`UPDATE purchase_invoices SET paid_amount = paid_amount - ${link.amount}::numeric,
        payment_status = CASE WHEN paid_amount - ${link.amount}::numeric <= 0 THEN 'UNPAID' ELSE 'PARTIAL' END, version = version + 1 WHERE id = ${link.purchase_invoice_id}::uuid`;
    if (link.itc_reclaim_id) await undoReclaim(tx, link.itc_reclaim_id, reason, actor, date);
  },
};

/** Reverses the credit claimed again by a settlement that is now cancelled (the same steps as cancelling a payment). */
export async function undoReclaim(tx: Db, reclaimId: string, reason: string, actor: Actor, date: string): Promise<void> {
  // unpaginated: one row by its id
  const r = (
    await tx.$queryRaw<{ unit_id: string; invoice_id: string; journal_id: string; cgst: string; sgst: string; igst: string }[]>`
      SELECT unit_id::text, invoice_id::text, journal_id::text, cgst::text, sgst::text, igst::text FROM itc_reversals WHERE id = ${reclaimId}::uuid`
  )[0];
  if (!r) return;
  const mirror = await PostingService.reverse(tx, r.journal_id, reason, actor, { reversalDate: date });
  await tx.$executeRaw`INSERT INTO itc_reversals (unit_id, invoice_id, kind, cgst, sgst, igst, event_date, journal_id, created_by_id)
    VALUES (${r.unit_id}::uuid, ${r.invoice_id}::uuid, 'R37_REVERSE', ${r.cgst}::numeric, ${r.sgst}::numeric, ${r.igst}::numeric, ${date}::date, ${mirror.id}::uuid, ${actor.userId}::uuid)`;
  const total = money(D(r.cgst).plus(D(r.sgst)).plus(D(r.igst)));
  await tx.$executeRaw`UPDATE purchase_invoices SET itc_reversed_amount = itc_reversed_amount + ${total}::numeric WHERE id = ${r.invoice_id}::uuid`;
}
