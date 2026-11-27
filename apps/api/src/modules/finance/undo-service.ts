// Taking back a money entry from the screen: the list of Cash / Bank Book entries that can be cancelled, and the
// "Allocate" settlements that can be undone. Only settlements made with the Allocate button are undone here: those of a
// payment, a receipt, a return or a set-off are taken back by cancelling that document.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { billSync } from './bill-sync';
import { openItemService } from './open-items-service';

export type Side = 'RECEIVABLE' | 'PAYABLE';
const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const TX = { maxWait: 15_000, timeout: 30_000 };

export interface Allocated {
  id: string;
  date: string;
  side: Side;
  party: string;
  /** what settled the bill: the advance, note or unused receipt */
  creditNo: string;
  billNo: string;
  amount: string;
  madeBy: string;
}
export interface BookEntry {
  id: string;
  number: string;
  version: number;
  kind: string;
  date: string;
  amount: string;
  mode: string;
  status: string;
  detail: string;
  /** set when the entry was made from Accounts Payable: it is cancelled there */
  apNumber: string | null;
  /** set when the entry records a tax challan: it cannot be cancelled */
  challanNo: string | null;
  /** later "Allocate" settlements of this entry: they are undone before it can be cancelled */
  allocated: Allocated[];
}

/** Settlements made by "Allocate" that are still in force. `a` is the allocation. */
const BY_HAND = `a.amount > 0 AND a.payment_id IS NULL AND a.journal_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM allocations r WHERE r.reverses_id = a.id)`;
const SELECT_ALLOCATED = `
  SELECT a.id::text AS id, to_char(a.allocated_on, 'YYYY-MM-DD') AS date, t.side,
         COALESCE(c.name, s.name, '') AS party, src.doc_no AS "creditNo", t.doc_no AS "billNo", a.amount::text AS amount,
         COALESCE(u.name, '') AS "madeBy", src.journal_id::text AS "sourceJournal"
    FROM allocations a
    JOIN open_items t ON t.id = a.target_item_id
    JOIN open_items src ON src.id = a.source_item_id
    LEFT JOIN customers c ON c.id = t.party_id
    LEFT JOIN suppliers s ON s.id = t.party_id
    LEFT JOIN users u ON u.id = a.created_by_id
   WHERE ${BY_HAND}`;

export const undoService = {
  async allocations(side: Side, unitIds: string[]): Promise<Allocated[]> {
    const rows = await prisma.$queryRawUnsafe<(Allocated & { sourceJournal: string | null })[]>(
      `${SELECT_ALLOCATED} AND t.side = $1 AND a.unit_id = ANY($2::uuid[]) ORDER BY a.created_at DESC LIMIT 100`,
      side,
      unitIds,
    );
    return rows.map(({ sourceJournal: _journal, ...row }) => row);
  },

  /** Which ledger an allocation belongs to: decides who may undo it. */
  async sideOf(id: string, unitIds: string[]): Promise<Side> {
    // unpaginated: one row by its id
    const row = (
      await prisma.$queryRawUnsafe<{ side: Side }[]>(
        `SELECT t.side FROM allocations a JOIN open_items t ON t.id = a.target_item_id WHERE a.id = $1::uuid AND a.unit_id = ANY($2::uuid[]) LIMIT 1`,
        id,
        unitIds,
      )
    )[0];
    if (!row) throw Errors.notFound('Allocation not found.');
    return row.side;
  },

  async undo(id: string, reason: string, actor: Actor): Promise<{ id: string; undone: true }> {
    return prisma.$transaction(async (tx) => {
      // two people pressing Undo together: the second waits here and is then told it is already undone
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`undo-allocation:${id}`}))`;
      // unpaginated: one row by its id
      const hand = (
        await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT a.id::text AS id FROM allocations a WHERE a.id = $1::uuid AND ${BY_HAND} LIMIT 1`, id)
      )[0];
      if (!hand)
        throw Errors.conflict('This settlement cannot be undone here: it is already undone, or it belongs to a payment, receipt, return or set-off. Cancel that instead.');
      const date = today();
      await openItemService.reverseAllocation(tx, id, actor, date, reason);
      await billSync.release(tx, id, reason, actor, date);
      return { id, undone: true as const };
    }, TX);
  },

  /** The newest entries of one cash / bank account, with what stands in the way of cancelling each. */
  async entries(bankAccountId: string, unitIds: string[]): Promise<BookEntry[]> {
    const rows = await prisma.$queryRawUnsafe<(Omit<BookEntry, 'allocated'> & { journalId: string })[]>(
      `SELECT p.id::text AS id, p.code AS number, p.version, p.kind, to_char(p.doc_date, 'YYYY-MM-DD') AS date, p.amount::text AS amount,
              p.mode, p.status, p.journal_id::text AS "journalId",
              COALESCE(s.name, e.name, ca.name, tb.name, p.narration, '') AS detail,
              (SELECT sp.number FROM supplier_payments sp WHERE sp.journal_id = p.journal_id AND sp.status = 'Posted' LIMIT 1) AS "apNumber",
              (SELECT tc.challan_no FROM tax_challans tc WHERE tc.payment_id = p.id LIMIT 1) AS "challanNo"
         FROM payments p
         LEFT JOIN suppliers s ON s.id = p.party_id
         LEFT JOIN users e ON e.id = p.party_id
         LEFT JOIN accounts ca ON ca.id = p.counter_account_id
         LEFT JOIN bank_accounts tb ON tb.id = p.to_bank_account_id
        WHERE (p.bank_account_id = $1::uuid OR p.to_bank_account_id = $1::uuid) AND p.unit_id = ANY($2::uuid[])
        ORDER BY p.doc_date DESC, p.created_at DESC LIMIT 50`,
      bankAccountId,
      unitIds,
    );
    const journals = rows.filter((r) => r.status === 'Posted').map((r) => r.journalId);
    const held = journals.length
      ? await prisma.$queryRawUnsafe<(Allocated & { sourceJournal: string })[]>(
          // unpaginated: the allocations of at most 50 entries
          `${SELECT_ALLOCATED} AND src.journal_id = ANY($1::uuid[]) ORDER BY a.created_at`,
          journals,
        )
      : [];
    return rows.map(({ journalId, ...row }) => ({
      ...row,
      allocated: held.filter((a) => a.sourceJournal === journalId).map(({ sourceJournal: _journal, ...a }) => a),
    }));
  },
};
