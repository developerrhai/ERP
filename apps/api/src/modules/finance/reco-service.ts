// Bank reconciliation (05a flow F5, 05b §5.9). A statement is imported as JSON lines (the browser reads the CSV),
// must foot (opening + deposits - withdrawals = closing), is matched line by line to ledger rows of the bank
// account, and is Reconciled only when the proof difference is exactly 0.00.
//   proof:  book balance at period end - uncleared book rows  ==  statement closing - unrecorded bank lines
// Rows dated before the first statement of the account are treated as already in the bank's opening balance.
import { createHash } from 'node:crypto';
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { cashBankService } from './cash-bank-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money, parseMoney } from './money';
import type { Dec } from './money';

export interface StatementInput {
  bankAccountId: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: string;
  closingBalance: string;
  lines: {
    txnDate: string;
    description?: string;
    refNo?: string;
    withdrawal?: string;
    deposit?: string;
  }[];
}

async function lockStatement(tx: Db, id: string) {
  const r = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM bank_statements WHERE id = ${id}::uuid FOR UPDATE`;
  if (!r[0]) throw Errors.notFound('Bank statement not found.');
  return tx.bankStatement.findUniqueOrThrow({ where: { id } });
}

/** The proof (also shown on screen before the user presses Reconcile). */
async function proof(db: Db, statementId: string) {
  const st = await db.bankStatement.findUniqueOrThrow({ where: { id: statementId } });
  const bank = await db.bankAccount.findUniqueOrThrow({ where: { id: st.bankAccountId } });
  const first = await db.bankStatement.findFirst({
    where: { bankAccountId: st.bankAccountId },
    orderBy: { periodFrom: 'asc' },
    select: { periodFrom: true },
  });
  const bf = first?.periodFrom ?? st.periodFrom;
  // unpaginated: rows of one parent (account_id)
  const bookRows = await db.$queryRaw<{ v: string }[]>`
    SELECT COALESCE(SUM(debit - credit), 0)::text AS v FROM gl_entries
     WHERE account_id = ${bank.accountId}::uuid AND unit_id = ${bank.unitId}::uuid AND posting_date <= ${st.periodTo}::date`;
  // unpaginated: rows of one parent (account_id)
  const uncleared = await db.$queryRaw<{ v: string; n: bigint }[]>`
    SELECT COALESCE(SUM(g.debit - g.credit), 0)::text AS v, COUNT(*)::bigint AS n FROM gl_entries g
     WHERE g.account_id = ${bank.accountId}::uuid AND g.unit_id = ${bank.unitId}::uuid
       AND g.posting_date >= ${bf}::date AND g.posting_date <= ${st.periodTo}::date
       AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.gl_entry_id = g.id AND m.unmatched_at IS NULL)`;
  // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
  const unrec = await db.$queryRaw<{ v: string; n: bigint }[]>`
    SELECT COALESCE(SUM(deposit - withdrawal), 0)::text AS v, COUNT(*)::bigint AS n FROM bank_statement_lines
     WHERE statement_id = ${statementId}::uuid AND match_status <> 'Matched'`;
  const book = D(bookRows[0]?.v ?? 0);
  const unclearedNet = D(uncleared[0]?.v ?? 0);
  const unrecNet = D(unrec[0]?.v ?? 0);
  const adjustedBook = book.minus(unclearedNet);
  const adjustedBank = D(st.closingBalance).minus(unrecNet);
  return {
    statementId,
    bookBalance: money(book),
    unclearedBook: money(unclearedNet),
    unclearedCount: Number(uncleared[0]?.n ?? 0),
    statementClosing: money(st.closingBalance),
    unrecordedBank: money(unrecNet),
    unrecordedCount: Number(unrec[0]?.n ?? 0),
    adjustedBook: money(adjustedBook),
    adjustedBank: money(adjustedBank),
    difference: money(adjustedBook.minus(adjustedBank)),
  };
}

export const recoService = {
  async importStatement(input: StatementInput, actor: Actor) {
    const opening = parseMoney(input.openingBalance, 'openingBalance');
    const closing = parseMoney(input.closingBalance, 'closingBalance');
    if (input.periodTo < input.periodFrom)
      throw Errors.validation({ periodTo: 'The end date is before the start date.' });
    if (input.lines.length === 0) throw Errors.validation({ lines: 'The statement has no lines.' });
    let w = ZERO;
    let d = ZERO;
    const lines = input.lines.map((l, i) => {
      const wd = parseMoney(l.withdrawal || '0', `lines.${i}.withdrawal`);
      const dp = parseMoney(l.deposit || '0', `lines.${i}.deposit`);
      if (
        wd.isNegative() ||
        dp.isNegative() ||
        (wd.greaterThan(0) && dp.greaterThan(0)) ||
        (wd.isZero() && dp.isZero())
      ) {
        throw Errors.validation({
          [`lines.${i}.withdrawal`]: 'Each line has either a withdrawal or a deposit.',
        });
      }
      if (l.txnDate < input.periodFrom || l.txnDate > input.periodTo)
        throw Errors.validation({
          [`lines.${i}.txnDate`]: 'The date is outside the statement period.',
        });
      w = w.plus(wd);
      d = d.plus(dp);
      return { ...l, withdrawal: wd, deposit: dp };
    });
    if (!opening.plus(d).minus(w).equals(closing)) {
      throw FinErrors.statementDoesNotFoot(
        `The statement does not foot: opening ${money(opening)} + deposits ${money(d)} - withdrawals ${money(w)} = ${money(opening.plus(d).minus(w))}, but closing is ${money(closing)}.`,
        { closingBalance: 'Check the balances.' },
      );
    }
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          input.bankAccountId,
          input.periodFrom,
          input.periodTo,
          input.openingBalance,
          input.closingBalance,
          input.lines,
        ]),
      )
      .digest('hex');
    return prisma.$transaction(async (tx) => {
      const bank = await tx.bankAccount.findFirst({
        where: { id: input.bankAccountId, deletedAt: null },
      });
      if (!bank || bank.kind !== 'BANK')
        throw Errors.validation({ bankAccountId: 'Choose a bank account.' });
      if (await tx.bankStatement.findFirst({ where: { bankAccountId: bank.id, fileHash: hash } }))
        throw FinErrors.duplicateStatement('This statement was already imported.');
      const prior = await tx.bankStatement.findFirst({
        where: {
          bankAccountId: bank.id,
          periodTo: { lt: new Date(`${input.periodFrom}T00:00:00Z`) },
        },
        orderBy: { periodTo: 'desc' },
      });
      if (prior) {
        if (prior.status !== 'Reconciled')
          throw FinErrors.previousStatementOpen('Reconcile the previous statement first.');
        if (!D(prior.closingBalance).equals(opening))
          throw FinErrors.statementDoesNotFoot(
            `The opening balance must equal the previous closing balance (${money(prior.closingBalance)}).`,
            { openingBalance: 'Does not match the previous statement.' },
          );
      }
      if (
        await tx.bankStatement.findFirst({
          where: {
            bankAccountId: bank.id,
            periodFrom: { lte: new Date(`${input.periodTo}T00:00:00Z`) },
            periodTo: { gte: new Date(`${input.periodFrom}T00:00:00Z`) },
          },
        })
      ) {
        throw FinErrors.duplicateStatement('This period overlaps a statement already imported.');
      }
      const st = await tx.bankStatement.create({
        data: {
          bankAccountId: bank.id,
          periodFrom: new Date(`${input.periodFrom}T00:00:00Z`),
          periodTo: new Date(`${input.periodTo}T00:00:00Z`),
          openingBalance: opening,
          closingBalance: closing,
          fileHash: hash,
          createdById: actor.userId,
        },
      });
      let no = 0;
      await tx.bankStatementLine.createMany({
        data: lines.map((l) => ({
          statementId: st.id,
          lineNo: (no += 1),
          txnDate: new Date(`${l.txnDate}T00:00:00Z`),
          description: l.description ?? null,
          refNo: l.refNo ?? null,
          withdrawal: l.withdrawal,
          deposit: l.deposit,
        })),
      });
      await recordAudit(
        {
          action: 'BANK_STATEMENT_IMPORTED',
          actorId: actor.userId,
          targetType: 'Statement',
          targetId: st.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { lines: lines.length, from: input.periodFrom, to: input.periodTo },
        },
        tx,
      );
      return st;
    });
  },

  async list(q: { bankAccountId?: string; status?: string; page: number; size: number }) {
    const where = {
      ...(q.bankAccountId ? { bankAccountId: q.bankAccountId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.bankStatement.findMany({
        where,
        orderBy: { periodFrom: 'desc' },
        skip: (q.page - 1) * q.size,
        take: q.size,
      }),
      prisma.bankStatement.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((s) => ({
        ...s,
        periodFrom: isoDate(s.periodFrom),
        periodTo: isoDate(s.periodTo),
        openingBalance: money(s.openingBalance),
        closingBalance: money(s.closingBalance),
      })),
    };
  },

  async get(id: string) {
    const st = await prisma.bankStatement.findUnique({ where: { id } });
    if (!st) throw Errors.notFound('Bank statement not found.');
    // unpaginated: rows named by an id list
    const lines = await prisma.bankStatementLine.findMany({
      where: { statementId: id },
      orderBy: { lineNo: 'asc' },
    });
    // unpaginated: rows named by an id list
    const matches = await prisma.bankMatch.findMany({
      where: { lineId: { in: lines.map((l) => l.id) }, unmatchedAt: null },
    });
    const byLine = new Map(matches.map((m) => [m.lineId, m]));
    return {
      statement: {
        ...st,
        periodFrom: isoDate(st.periodFrom),
        periodTo: isoDate(st.periodTo),
        openingBalance: money(st.openingBalance),
        closingBalance: money(st.closingBalance),
      },
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        txnDate: isoDate(l.txnDate),
        description: l.description,
        refNo: l.refNo,
        withdrawal: money(l.withdrawal),
        deposit: money(l.deposit),
        matchStatus: l.matchStatus,
        matchId: byLine.get(l.id)?.id ?? null,
        glEntryId: byLine.get(l.id)?.glEntryId ?? null,
      })),
      proof: await proof(prisma, id),
    };
  },

  /** Candidate ledger rows for each unmatched line: same amount and side, within 10 days, closest first. */
  async suggestions(statementId: string) {
    const st = await prisma.bankStatement.findUnique({ where: { id: statementId } });
    if (!st) throw Errors.notFound('Bank statement not found.');
    const bank = await prisma.bankAccount.findUniqueOrThrow({ where: { id: st.bankAccountId } });
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const lines = await prisma.bankStatementLine.findMany({
      where: { statementId, matchStatus: 'Unmatched' },
      orderBy: { lineNo: 'asc' },
    });
    const out = [];
    for (const l of lines) {
      const deposit = D(l.deposit).greaterThan(0);
      const amount = deposit ? D(l.deposit) : D(l.withdrawal);
      const cands = await prisma.$queryRaw<
        {
          id: string;
          posting_date: Date;
          voucher_no: string;
          narration: string | null;
          gap: number;
        }[]
      >`
        SELECT g.id, g.posting_date, g.voucher_no, g.narration, abs(g.posting_date - ${l.txnDate}::date)::int AS gap FROM gl_entries g
         WHERE g.account_id = ${bank.accountId}::uuid AND g.unit_id = ${bank.unitId}::uuid
           AND (CASE WHEN ${deposit} THEN g.debit ELSE g.credit END) = ${amount.toFixed(2)}::numeric
           AND abs(g.posting_date - ${l.txnDate}::date) <= 10
           AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.gl_entry_id = g.id AND m.unmatched_at IS NULL)
         ORDER BY (CASE WHEN ${l.refNo ?? ''} <> '' AND g.voucher_no ILIKE '%' || ${l.refNo ?? ''} || '%' THEN 0 ELSE 1 END), gap, g.seq LIMIT 3`;
      out.push({
        lineId: l.id,
        candidates: cands.map((c) => ({
          glEntryId: c.id,
          date: isoDate(c.posting_date),
          voucherNo: c.voucher_no,
          narration: c.narration,
          gapDays: c.gap,
        })),
      });
    }
    return out;
  },

  async match(statementId: string, lineId: string, glEntryId: string, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const st = await lockStatement(tx, statementId);
      if (st.status !== 'Open')
        throw FinErrors.invalidTransition('This statement is already reconciled. Reopen it first.');
      const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, statementId } });
      if (!line) throw Errors.notFound('Statement line not found.');
      if (line.matchStatus === 'Matched') throw Errors.conflict('This line is already matched.');
      const bank = await tx.bankAccount.findUniqueOrThrow({ where: { id: st.bankAccountId } });
      const gl = await tx.glEntry.findUnique({ where: { id: glEntryId } });
      if (!gl || gl.accountId !== bank.accountId || gl.unitId !== bank.unitId)
        throw Errors.validation({
          glEntryId: 'This ledger row does not belong to the bank account.',
        });
      const deposit = D(line.deposit).greaterThan(0);
      const lineAmt = deposit ? D(line.deposit) : D(line.withdrawal);
      const glAmt = deposit ? D(gl.debit) : D(gl.credit);
      if (!lineAmt.equals(glAmt))
        throw FinErrors.amountMismatch(
          `The amounts differ: bank ${money(lineAmt)}, books ${money(glAmt)}.`,
          { glEntryId: 'The amounts must be the same.' },
        );
      try {
        await tx.bankMatch.create({
          data: { lineId, glEntryId, amount: lineAmt, matchedById: actor.userId },
        });
      } catch {
        throw Errors.conflict('This ledger row is already matched to another bank line.');
      }
      await tx.bankStatementLine.update({
        where: { id: lineId },
        data: { matchStatus: 'Matched' },
      });
      await recordAudit(
        {
          action: 'BANK_MATCHED',
          actorId: actor.userId,
          targetType: 'Statement',
          targetId: statementId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { lineId, glEntryId, amount: money(lineAmt) },
        },
        tx,
      );
      return proof(tx, statementId);
    });
  },

  async unmatch(statementId: string, lineId: string, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const st = await lockStatement(tx, statementId);
      if (st.status !== 'Open')
        throw FinErrors.invalidTransition('This statement is already reconciled. Reopen it first.');
      const m = await tx.bankMatch.findFirst({ where: { lineId, unmatchedAt: null } });
      if (!m) throw Errors.notFound('This line is not matched.');
      await tx.bankMatch.update({
        where: { id: m.id },
        data: { unmatchedAt: new Date(), unmatchedById: actor.userId },
      });
      await tx.bankStatementLine.update({
        where: { id: lineId },
        data: { matchStatus: 'Unmatched' },
      });
      await recordAudit(
        {
          action: 'BANK_UNMATCHED',
          actorId: actor.userId,
          targetType: 'Statement',
          targetId: statementId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { lineId },
        },
        tx,
      );
      return proof(tx, statementId);
    });
  },

  /** A bank line the books do not have yet (charges, interest): post it and match it in one go. */
  async createEntry(statementId: string, lineId: string, counterAccountId: string, actor: Actor) {
    const st = await prisma.bankStatement.findUnique({ where: { id: statementId } });
    if (!st) throw Errors.notFound('Bank statement not found.');
    const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, statementId } });
    if (!line) throw Errors.notFound('Statement line not found.');
    if (line.matchStatus !== 'Unmatched') throw Errors.conflict('This line is already handled.');
    const deposit = D(line.deposit).greaterThan(0);
    const amount = deposit ? D(line.deposit) : D(line.withdrawal);
    const res = await cashBankService.createPayment(
      {
        kind: deposit ? 'RECEIPT' : 'PAYMENT',
        docDate: isoDate(line.txnDate),
        bankAccountId: st.bankAccountId,
        counterAccountId,
        amount: amount.toFixed(2),
        mode: 'NEFT',
        ...(line.refNo ? { referenceNo: line.refNo } : {}),
        narration: line.description ?? 'Bank entry',
      },
      actor,
    );
    const gl = await prisma.glEntry.findFirstOrThrow({
      where: {
        journalId: res.journal.id,
        accountId: (await prisma.bankAccount.findUniqueOrThrow({ where: { id: st.bankAccountId } }))
          .accountId,
      },
    });
    return recoService.match(statementId, lineId, gl.id, actor);
  },

  async reconcile(statementId: string, version: number, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const st = await lockStatement(tx, statementId);
      if (st.version !== version) throw Errors.versionConflict();
      if (st.status !== 'Open')
        throw FinErrors.invalidTransition('This statement is already reconciled.');
      const open = await tx.bankStatementLine.count({
        where: { statementId, matchStatus: 'Unmatched' },
      });
      if (open > 0)
        throw FinErrors.suggestionsPending(
          `${open} bank line(s) are not matched yet. Match them or post the missing entries.`,
          { lines: `${open} unmatched` },
        );
      const p = await proof(tx, statementId);
      if (p.difference !== '0.00') {
        throw FinErrors.reconDifference(
          `The books and the bank differ by ${p.difference}. Match the remaining lines or post the missing entries.`,
          { difference: p.difference },
        );
      }
      await tx.bankStatement.update({
        where: { id: statementId },
        data: {
          status: 'Reconciled',
          reconciledAt: new Date(),
          reconciledById: actor.userId,
          version: { increment: 1 },
        },
      });
      await recordAudit(
        {
          action: 'BANK_STATEMENT_RECONCILED',
          actorId: actor.userId,
          targetType: 'Statement',
          targetId: statementId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { unrecorded: p.unrecordedCount },
        },
        tx,
      );
      return { ...p, status: 'Reconciled' };
    });
  },

  async reopen(statementId: string, version: number, reason: string, actor: Actor) {
    if (reason.trim().length < 5)
      throw FinErrors.reasonRequired('Give a reason of at least 5 characters.', {
        reason: 'Enter a reason.',
      });
    return prisma.$transaction(async (tx) => {
      const st = await lockStatement(tx, statementId);
      if (st.version !== version) throw Errors.versionConflict();
      if (st.status !== 'Reconciled')
        throw FinErrors.invalidTransition('This statement is not reconciled.');
      const later = await tx.bankStatement.count({
        where: { bankAccountId: st.bankAccountId, periodFrom: { gt: st.periodTo } },
      });
      if (later)
        throw FinErrors.invalidTransition(
          'A later statement exists. Reopen from the latest one backwards.',
        );
      await tx.bankStatement.update({
        where: { id: statementId },
        data: {
          status: 'Open',
          reconciledAt: null,
          reconciledById: null,
          version: { increment: 1 },
        },
      });
      await recordAudit(
        {
          action: 'BANK_STATEMENT_REOPENED',
          actorId: actor.userId,
          targetType: 'Statement',
          targetId: statementId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { reason },
        },
        tx,
      );
      return proof(tx, statementId);
    });
  },
};

export type { Dec };
