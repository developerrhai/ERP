// Bill-wise sub-ledger (05b §5.8, BR-FIN-08, BR-FIN-10). An open item is one bill, credit note, receipt or
// advance of a party; `allocations` (append-only) settle a credit item against an invoice item. Undo = a
// negative allocation row (BR-FIN-10 f). Σ outstanding of a party must equal its control-account GL balance.
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney } from './money';
import type { Dec } from './money';

interface ItemRow {
  id: string;
  unit_id: string;
  side: string;
  party_type: string;
  party_id: string;
  amount: string;
  settled_amount: string;
  outstanding: string;
  status: string;
  currency_code: string;
}

async function lockItem(tx: Db, id: string): Promise<ItemRow> {
  const rows = await tx.$queryRaw<ItemRow[]>`
    SELECT id, unit_id, side, party_type, party_id, amount::text, settled_amount::text, outstanding::text, status, currency_code
      FROM open_items WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows[0]) throw Errors.notFound('Bill not found.');
  return rows[0];
}

export interface AllocateInput {
  /** the credit side (amount < 0): a receipt, a payment, a credit note, an advance */
  sourceItemId: string;
  /** the bill side (amount > 0) */
  targetItemId: string;
  amount: string;
  date: string;
  paymentId?: string | null;
  journalId?: string | null;
  /** a payment must not settle a blocked / disputed bill (BR-FIN-10 e) */
  forPayment?: boolean;
}

export const openItemService = {
  /** Settle `amount` of the target bill with the source credit. Row-locks both items in id order (no deadlock). */
  async allocate(tx: Db, input: AllocateInput, actor: Actor): Promise<{ id: string }> {
    const amount = parseMoney(input.amount, 'amount');
    if (!amount.greaterThan(0))
      throw Errors.validation({ amount: 'Enter an amount greater than 0.' });
    const [firstId, secondId] = [input.sourceItemId, input.targetItemId].sort();
    await lockItem(tx, firstId as string);
    await lockItem(tx, secondId as string);
    const src = await lockItem(tx, input.sourceItemId);
    const tgt = await lockItem(tx, input.targetItemId);
    if (D(src.amount).greaterThanOrEqualTo(0) || D(tgt.amount).lessThanOrEqualTo(0)) {
      throw FinErrors.overAllocation(
        'Settle a credit (receipt, payment, credit note) against a bill.',
      );
    }
    if (
      src.side !== tgt.side ||
      src.party_id !== tgt.party_id ||
      src.party_type !== tgt.party_type
    ) {
      throw FinErrors.partyRoleMismatch('Both items must belong to the same party and ledger.');
    }
    if (src.currency_code !== tgt.currency_code)
      throw FinErrors.currencyNotSupported('Both items must be in the same currency.');
    if (src.status === 'Cancelled' || tgt.status === 'Cancelled')
      throw FinErrors.invalidTransition('A cancelled bill cannot be settled.');
    if (input.forPayment && (tgt.status === 'Blocked' || tgt.status === 'Disputed')) {
      throw FinErrors.itemBlocked('This bill is blocked or disputed and cannot be paid yet.');
    }
    if (amount.greaterThan(D(tgt.outstanding)) || amount.greaterThan(D(src.outstanding).abs())) {
      throw FinErrors.overAllocation(
        `Allocation is more than the open amount (bill ${money(tgt.outstanding)}, credit ${money(D(src.outstanding).abs())}).`,
        {
          amount: 'Reduce the amount.',
        },
      );
    }
    await tx.$executeRaw`UPDATE open_items SET settled_amount = settled_amount + ${amount.toFixed(2)}::numeric,
      status = CASE WHEN settled_amount + ${amount.toFixed(2)}::numeric = abs(amount) THEN 'Settled' ELSE status END,
      version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid
      WHERE id IN (${input.sourceItemId}::uuid, ${input.targetItemId}::uuid)`;
    const row = await tx.allocation.create({
      data: {
        unitId: tgt.unit_id,
        sourceItemId: input.sourceItemId,
        targetItemId: input.targetItemId,
        amount,
        allocatedOn: new Date(`${input.date}T00:00:00Z`),
        paymentId: input.paymentId ?? null,
        journalId: input.journalId ?? null,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    await recordAudit(
      {
        action: 'ALLOCATION_ADDED',
        actorId: actor.userId,
        targetType: 'OpenItem',
        targetId: input.targetItemId,
        ...(actor.meta ? { meta: actor.meta } : {}),
        detail: { source: input.sourceItemId, amount: money(amount) },
      },
      tx,
    );
    return row;
  },

  /** Undo an allocation with a negative row; both items become open again. */
  async reverseAllocation(
    tx: Db,
    allocationId: string,
    actor: Actor,
    date: string,
  ): Promise<{ id: string }> {
    const a = await tx.allocation.findUnique({ where: { id: allocationId } });
    if (!a || D(a.amount).lessThanOrEqualTo(0)) throw Errors.notFound('Allocation not found.');
    if (await tx.allocation.count({ where: { reversesId: allocationId } }))
      throw FinErrors.alreadyReversed('This allocation was already undone.');
    const [firstId, secondId] = [a.sourceItemId, a.targetItemId].sort();
    await lockItem(tx, firstId as string);
    await lockItem(tx, secondId as string);
    await tx.$executeRaw`UPDATE open_items SET settled_amount = settled_amount - ${D(a.amount).toFixed(2)}::numeric,
      status = CASE WHEN status = 'Settled' THEN 'Open' ELSE status END,
      version = version + 1, updated_at = now(), updated_by_id = ${actor.userId}::uuid
      WHERE id IN (${a.sourceItemId}::uuid, ${a.targetItemId}::uuid)`;
    const row = await tx.allocation.create({
      data: {
        unitId: a.unitId,
        sourceItemId: a.sourceItemId,
        targetItemId: a.targetItemId,
        amount: D(a.amount).negated(),
        allocatedOn: new Date(`${date}T00:00:00Z`),
        paymentId: a.paymentId,
        journalId: a.journalId,
        reversesId: a.id,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    await recordAudit(
      {
        action: 'ALLOCATION_REVERSED',
        actorId: actor.userId,
        targetType: 'OpenItem',
        targetId: a.targetItemId,
        ...(actor.meta ? { meta: actor.meta } : {}),
        detail: { allocation: a.id },
      },
      tx,
    );
    return row;
  },

  /** Open bills of a party, in FIFO order (due date, document date, number). */
  async openBills(db: Db, side: 'RECEIVABLE' | 'PAYABLE', partyId: string, unitId?: string | null) {
    // unpaginated: rows of one parent record (record / party / supplier / HSN)
    const rows = await db.openItem.findMany({
      where: {
        side,
        partyId,
        status: { in: ['Open', 'Disputed', 'Blocked'] },
        ...(unitId ? { unitId } : {}),
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { docDate: 'asc' }, { docNo: 'asc' }],
    });
    return rows
      .filter((r) => !D(r.outstanding ?? 0).isZero())
      .map((r) => ({
        id: r.id,
        itemType: r.itemType,
        docNo: r.docNo,
        docDate: isoDate(r.docDate),
        dueDate: r.dueDate ? isoDate(r.dueDate) : null,
        amount: money(r.amount),
        outstanding: money(r.outstanding),
        status: r.status,
        unitId: r.unitId,
      }));
  },

  async list(q: {
    side?: string;
    partyId?: string;
    status?: string;
    unitId?: string | null;
    page: number;
    size: number;
  }) {
    const where = {
      ...(q.side ? { side: q.side } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.unitId ? { unitId: q.unitId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.openItem.findMany({
        where,
        orderBy: [{ docDate: 'desc' }, { docNo: 'desc' }],
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.openItem.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        side: r.side,
        partyType: r.partyType,
        partyId: r.partyId,
        itemType: r.itemType,
        docNo: r.docNo,
        docDate: isoDate(r.docDate),
        dueDate: r.dueDate ? isoDate(r.dueDate) : null,
        amount: money(r.amount),
        settled: money(r.settledAmount),
        outstanding: money(r.outstanding),
        status: r.status,
        unitId: r.unitId,
        version: r.version,
      })),
    };
  },

  /** Block / dispute / release a bill (collections follow-up). */
  async setHold(
    id: string,
    status: 'Open' | 'Blocked' | 'Disputed',
    reason: string | null,
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const it = await lockItem(tx, id);
      if (it.status === 'Settled' || it.status === 'Cancelled')
        throw FinErrors.invalidTransition('A settled or cancelled bill cannot be blocked.');
      if (status !== 'Open' && !reason?.trim())
        throw FinErrors.reasonRequired('Give a reason.', { reason: 'Enter a reason.' });
      await tx.openItem.update({
        where: { id },
        data: {
          status,
          blockedReason: status === 'Blocked' ? reason : null,
          disputeReason: status === 'Disputed' ? reason : null,
          version: { increment: 1 },
          updatedById: actor.userId,
        },
      });
      return { id, status };
    });
  },

  /** BR-FIN-36 helper: Σ open items vs the GL balance of the party's control accounts. */
  async agreement(
    db: Db,
    side: 'RECEIVABLE' | 'PAYABLE',
    partyId: string,
  ): Promise<{ subLedger: string; ledger: string; agrees: boolean }> {
    // unpaginated: single-row SUM() aggregate
    const sub = await db.$queryRaw<{ v: string }[]>`
      SELECT COALESCE(SUM(outstanding), 0)::text AS v
        FROM open_items WHERE side = ${side} AND party_id = ${partyId}::uuid AND status <> 'Cancelled'`;
    // `outstanding` keeps the sign of the item (bills +, credits -), so the sum is the signed party balance
    // unpaginated: single-row SUM() aggregate
    const gl = await db.$queryRaw<{ v: string }[]>`
      SELECT COALESCE(SUM(CASE WHEN ${side} = 'RECEIVABLE' THEN g.debit - g.credit ELSE g.credit - g.debit END), 0)::text AS v
        FROM gl_entries g JOIN accounts a ON a.id = g.account_id
       WHERE g.party_id = ${partyId}::uuid AND a.control_side = ${side}`;
    const s: Dec = D(sub[0]?.v ?? 0);
    const l: Dec = D(gl[0]?.v ?? 0);
    return { subLedger: money(s), ledger: money(l), agrees: s.equals(l) };
  },
};

export { ZERO };
