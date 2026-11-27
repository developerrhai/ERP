// REQ-01: one party that is both a customer and a supplier. What it owes us and what we owe it are set off against each
// other with one journal (Dr Trade Payables / Cr Trade Receivables); the two sides are allocated to the oldest open
// bills, the invoices are marked paid / received, and the whole adjustment can be cancelled again.
import { randomUUID } from 'node:crypto';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { apService } from '../procurement/ap-service';
import type { Actor } from './accounts-service';
import { undoReclaim } from './bill-sync';
import { D, ZERO, money, parseMoney } from './money';
import type { Dec } from './money';
import { openItemService } from './open-items-service';
import { PostingService } from './posting-service';

const TX = { maxWait: 15_000, timeout: 60_000 };
const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export type MatchedBy = 'Linked' | 'Same GSTIN' | 'Same PAN';
export interface NettingRow {
  unitId: string;
  unit: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  matchedBy: MatchedBy;
  /** open bills the party still has to pay us */
  receivable: string;
  /** open bills we still have to pay the party */
  payable: string;
  /** the most that can be set off: the smaller of the two */
  adjustable: string;
  /** receivable - payable: positive = still to come to us, negative = still to be paid by us */
  net: string;
}

/** A customer and a supplier are one party when linked by hand, or when they carry the same GSTIN or PAN. */
const MATCH_SQL = `
  SELECT c.id::text AS customer_id, c.code AS customer_code, c.name AS customer_name,
         s.id::text AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
         CASE WHEN c.linked_supplier_id = s.id THEN 'Linked'
              WHEN c.gstin IS NOT NULL AND c.gstin = s.gstin THEN 'Same GSTIN' ELSE 'Same PAN' END AS matched_by
    FROM customers c JOIN suppliers s
      ON c.linked_supplier_id = s.id
      OR (c.gstin IS NOT NULL AND c.gstin <> '' AND c.gstin = s.gstin)
      OR (c.pan IS NOT NULL AND c.pan <> '' AND c.pan = s.pan)
   WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL`;

interface Pair {
  customer_id: string;
  customer_code: string;
  customer_name: string;
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  matched_by: MatchedBy;
}

/** Open bills that may be set off, oldest first. Disputed, blocked and held-back bills stay out. */
async function bills(db: Db, side: 'RECEIVABLE' | 'PAYABLE', partyId: string, unitId: string) {
  // unpaginated: the open bills of one party in one plant
  return db.$queryRawUnsafe<{ id: string; doc_no: string; journal_id: string; outstanding: string }[]>(
    `SELECT o.id::text, o.doc_no, o.journal_id::text, o.outstanding::text FROM open_items o
      WHERE o.side = $1 AND o.party_id = $2::uuid AND o.party_type = $3 AND o.unit_id = $4::uuid
        AND o.status = 'Open' AND o.outstanding > 0
        AND NOT EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.journal_id = o.journal_id AND i.supplier_id = o.party_id AND i.payment_block)
      ORDER BY o.due_date NULLS LAST, o.doc_date, o.doc_no`,
    side,
    partyId,
    side === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER',
    unitId,
  );
}
const sum = (rows: { outstanding: string }[]): Dec => rows.reduce((s, r) => s.plus(D(r.outstanding)), ZERO);

export const nettingService = {
  async candidates(unitIds: string[]): Promise<NettingRow[]> {
    // unpaginated: parties that are both customer and supplier are a short list
    const rows = await prisma.$queryRawUnsafe<(Pair & { unit_id: string; unit: string; receivable: string; payable: string })[]>(
      `WITH pairs AS (${MATCH_SQL}),
       due AS (
         SELECT o.unit_id, o.party_type, o.party_id, sum(o.outstanding) AS amount FROM open_items o
          WHERE o.status = 'Open' AND o.outstanding > 0 AND o.unit_id = ANY($1::uuid[])
            -- open bills only, the same ones a set-off may use: an advance or credit note is not something still due
            AND o.side = CASE o.party_type WHEN 'CUSTOMER' THEN 'RECEIVABLE' ELSE 'PAYABLE' END
            AND NOT EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.journal_id = o.journal_id AND i.supplier_id = o.party_id AND i.payment_block)
          GROUP BY o.unit_id, o.party_type, o.party_id)
       SELECT p.*, u.id::text AS unit_id, u.name AS unit,
              COALESCE(r.amount, 0)::text AS receivable, COALESCE(y.amount, 0)::text AS payable
         FROM pairs p CROSS JOIN units u
         LEFT JOIN due r ON r.unit_id = u.id AND r.party_type = 'CUSTOMER' AND r.party_id = p.customer_id::uuid
         LEFT JOIN due y ON y.unit_id = u.id AND y.party_type = 'SUPPLIER' AND y.party_id = p.supplier_id::uuid
        WHERE u.id = ANY($1::uuid[]) AND (r.amount IS NOT NULL OR y.amount IS NOT NULL)
        ORDER BY LEAST(COALESCE(r.amount, 0), COALESCE(y.amount, 0)) DESC, p.customer_name, u.name`,
      unitIds,
    );
    return rows.map((r) => {
      const ar = D(r.receivable);
      const ap = D(r.payable);
      return {
        unitId: r.unit_id,
        unit: r.unit,
        customerId: r.customer_id,
        customerCode: r.customer_code,
        customerName: r.customer_name,
        supplierId: r.supplier_id,
        supplierCode: r.supplier_code,
        supplierName: r.supplier_name,
        matchedBy: r.matched_by,
        receivable: money(ar),
        payable: money(ap),
        adjustable: money(ar.lessThan(ap) ? ar : ap),
        net: money(ar.minus(ap)),
      };
    });
  },

  /** Says by hand that this customer and this supplier are the same party (`supplierId` null removes the link). */
  async link(customerId: string, supplierId: string | null, actor: Actor): Promise<{ customerId: string; supplierId: string | null }> {
    return prisma.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } });
      if (!c) throw Errors.validation({ customerId: 'Choose a customer.' });
      if (supplierId && !(await tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null } })))
        throw Errors.validation({ supplierId: 'Choose a supplier.' });
      await tx.customer.update({ where: { id: customerId }, data: { linkedSupplierId: supplierId, version: { increment: 1 }, updatedById: actor.userId } });
      await recordAudit(
        { action: 'CUSTOMER_UPDATED', actorId: actor.userId, targetType: 'Customer', targetId: customerId, ...(actor.meta ? { meta: actor.meta } : {}), detail: { code: c.code, linkedSupplier: { from: c.linkedSupplierId, to: supplierId } } },
        tx,
      );
      return { customerId, supplierId };
    });
  },

  async create(
    input: { unitId: string; customerId: string; supplierId: string; amount: string; date: string; narration?: string },
    actor: Actor,
  ): Promise<{ id: string; number: string; amount: string; version: number }> {
    const amount = parseMoney(input.amount, 'amount');
    if (!amount.greaterThan(0)) throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    return prisma.$transaction(async (tx) => {
      // one adjustment of a party at a time: two together could set off the same bills twice
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`netting:${input.customerId}:${input.supplierId}`}))`;
      const pair = (
        await tx.$queryRawUnsafe<Pair[]>(`${MATCH_SQL} AND c.id = $1::uuid AND s.id = $2::uuid LIMIT 1`, input.customerId, input.supplierId)
      )[0];
      if (!pair) throw Errors.validation({ supplierId: 'This customer and supplier are not the same party. Link them first.' });
      const receivable = await bills(tx, 'RECEIVABLE', input.customerId, input.unitId);
      const payable = await bills(tx, 'PAYABLE', input.supplierId, input.unitId);
      const most = sum(receivable).lessThan(sum(payable)) ? sum(receivable) : sum(payable);
      if (amount.greaterThan(most))
        throw Errors.validation({
          amount: most.isZero() ? 'There is nothing to set off: one of the two sides has no open bill.' : `At most ₹${money(most)} can be set off.`,
        });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
      const control = async (own: string | null, key: string): Promise<string> =>
        own ?? (await tx.accountDefault.findUniqueOrThrow({ where: { key } })).accountId;
      const id = randomUUID();
      const narration = input.narration?.trim() || `Set-off: ${pair.customer_code} ${pair.customer_name} with ${pair.supplier_code}`;
      const text = money(amount);
      const journal = await PostingService.postJournal(
        tx,
        {
          unitId: input.unitId,
          docDate: input.date,
          voucherType: 'Journal',
          source: 'SYSTEM',
          narration,
          sourceDocType: 'party_netting',
          sourceDocId: id,
          lines: [
            { accountId: await control(supplier.apAccountId, 'AP_TRADE'), debit: text, credit: '0.00', partyType: 'SUPPLIER', partyId: supplier.id, billMode: 'NEW', billItemType: 'JOURNAL', narration },
            { accountId: await control(customer.arAccountId, 'AR_DOMESTIC'), debit: '0.00', credit: text, partyType: 'CUSTOMER', partyId: customer.id, billMode: 'NEW', billItemType: 'JOURNAL', narration },
          ],
        },
        actor,
      );
      const [payableCredit, receivableCredit] = journal.openItemIds;
      if (!payableCredit || !receivableCredit) throw Errors.conflict('The set-off entry did not reach the party ledger.');
      await tx.$executeRaw`INSERT INTO party_adjustments (id, unit_id, number, adj_date, customer_id, supplier_id, amount, narration, journal_id, created_by_id)
        VALUES (${id}::uuid, ${input.unitId}::uuid, ${journal.code}, ${input.date}::date, ${customer.id}::uuid, ${supplier.id}::uuid, ${text}::numeric, ${narration}, ${journal.id}::uuid, ${actor.userId}::uuid)`;

      const settle = async (side: 'RECEIVABLE' | 'PAYABLE', source: string, list: typeof receivable): Promise<void> => {
        let left = amount;
        for (const bill of list) {
          if (left.lessThanOrEqualTo(0)) break;
          const take = left.lessThan(D(bill.outstanding)) ? left : D(bill.outstanding);
          left = left.minus(take);
          const value = money(take);
          const allocation = await openItemService.allocate(
            tx,
            { sourceItemId: source, targetItemId: bill.id, amount: value, date: input.date, journalId: journal.id },
            actor,
          );
          let salesInvoice: string | null = null;
          let purchaseInvoice: string | null = null;
          let reclaim: string | null = null;
          if (side === 'RECEIVABLE') {
            const inv = await tx.$queryRaw<{ id: string }[]>`
              SELECT id::text FROM sales_invoices WHERE journal_id = ${bill.journal_id}::uuid AND customer_id = ${customer.id}::uuid AND status = 'Posted' FOR UPDATE`;
            if (inv[0]) {
              salesInvoice = inv[0].id;
              await tx.$executeRaw`UPDATE sales_invoices SET received_amount = received_amount + ${value}::numeric,
                receipt_status = CASE WHEN received_amount + ${value}::numeric >= grand_total THEN 'PAID' ELSE 'PARTIAL' END, version = version + 1 WHERE id = ${salesInvoice}::uuid`;
            }
          } else {
            // unpaginated: the one posted invoice behind this journal and supplier
            const inv = await tx.$queryRaw<{ id: string }[]>`
              SELECT id::text FROM purchase_invoices WHERE journal_id = ${bill.journal_id}::uuid AND supplier_id = ${supplier.id}::uuid AND status = 'Posted'`;
            if (inv[0]) {
              purchaseInvoice = inv[0].id;
              reclaim = await apService.applyPayment(tx, purchaseInvoice, value, { date: input.date, actor, reference: allocation.id });
            }
          }
          await tx.$executeRaw`INSERT INTO party_adjustment_lines (adjustment_id, side, open_item_id, allocation_id, sales_invoice_id, purchase_invoice_id, itc_reclaim_id, amount)
            VALUES (${id}::uuid, ${side}, ${bill.id}::uuid, ${allocation.id}::uuid, ${salesInvoice}::uuid, ${purchaseInvoice}::uuid, ${reclaim}::uuid, ${value}::numeric)`;
        }
      };
      await settle('PAYABLE', payableCredit, payable);
      await settle('RECEIVABLE', receivableCredit, receivable);
      await recordAudit(
        { action: 'JOURNAL_POSTED', actorId: actor.userId, targetType: 'Journal', targetId: journal.id, ...(actor.meta ? { meta: actor.meta } : {}), detail: { code: journal.code, total: text, source: 'party_netting', unitId: input.unitId } },
        tx,
      );
      return { id, number: journal.code, amount: text, version: 1 };
    }, TX);
  },

  async list(unitIds: string[]) {
    // unpaginated: the newest 100 set-offs of the caller's plants
    return prisma.$queryRaw<
      { id: string; unitId: string; number: string; date: string; customerName: string; supplierName: string; amount: string; status: string; narration: string | null }[]
    >`
      SELECT a.id::text, a.unit_id::text AS "unitId", a.number, to_char(a.adj_date, 'YYYY-MM-DD') AS date, c.name AS "customerName",
             s.name AS "supplierName", a.amount::text, a.status, a.narration
        FROM party_adjustments a JOIN customers c ON c.id = a.customer_id JOIN suppliers s ON s.id = a.supplier_id
       WHERE a.unit_id = ANY(${unitIds}::uuid[]) ORDER BY a.created_at DESC LIMIT 100`;
  },

  async cancel(id: string, reason: string, unitIds: string[], actor: Actor): Promise<{ id: string; status: string }> {
    return prisma.$transaction(async (tx) => {
      const a = (
        await tx.$queryRaw<{ unit_id: string; journal_id: string; status: string; number: string }[]>`
          SELECT unit_id::text, journal_id::text, status, number FROM party_adjustments WHERE id = ${id}::uuid FOR UPDATE`
      )[0];
      if (!a || !unitIds.includes(a.unit_id)) throw Errors.notFound('Set-off not found.');
      if (a.status !== 'Posted') throw Errors.conflict('This set-off was already cancelled.');
      const date = today();
      // unpaginated: the lines of one set-off
      const lines = await tx.$queryRaw<
        { allocation_id: string; amount: string; sales_invoice_id: string | null; purchase_invoice_id: string | null; itc_reclaim_id: string | null }[]
      >`SELECT allocation_id::text, amount::text, sales_invoice_id::text, purchase_invoice_id::text, itc_reclaim_id::text FROM party_adjustment_lines WHERE adjustment_id = ${id}::uuid`;
      for (const l of lines) {
        await openItemService.reverseAllocation(tx, l.allocation_id, actor, date);
        if (l.sales_invoice_id)
          await tx.$executeRaw`UPDATE sales_invoices SET received_amount = received_amount - ${l.amount}::numeric,
            receipt_status = CASE WHEN received_amount - ${l.amount}::numeric <= 0 THEN 'UNPAID' ELSE 'PARTIAL' END, version = version + 1 WHERE id = ${l.sales_invoice_id}::uuid`;
        if (l.purchase_invoice_id)
          await tx.$executeRaw`UPDATE purchase_invoices SET paid_amount = paid_amount - ${l.amount}::numeric,
            payment_status = CASE WHEN paid_amount - ${l.amount}::numeric <= 0 THEN 'UNPAID' ELSE 'PARTIAL' END, version = version + 1 WHERE id = ${l.purchase_invoice_id}::uuid`;
        if (l.itc_reclaim_id) await undoReclaim(tx, l.itc_reclaim_id, reason, actor, date);
      }
      await PostingService.reverse(tx, a.journal_id, reason, actor, { reversalDate: date });
      await tx.$executeRaw`UPDATE party_adjustments SET status = 'Cancelled', cancel_reason = ${reason}, cancelled_at = now(), cancelled_by_id = ${actor.userId}::uuid WHERE id = ${id}::uuid`;
      await recordAudit(
        { action: 'JOURNAL_REVERSED', actorId: actor.userId, targetType: 'Journal', targetId: a.journal_id, ...(actor.meta ? { meta: actor.meta } : {}), detail: { code: a.number, reason, source: 'party_netting' } },
        tx,
      );
      return { id, status: 'Cancelled' };
    }, TX);
  },
};
