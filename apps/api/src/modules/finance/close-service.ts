// Period close and year-end closing (05a flows F6/F7, BR-FIN-02, 05c T-FIN-24).
// A period closes only when nothing is half-done in it (no Draft / Pending journals; no open bank statement when
// fin.require_bank_reco_at_close is on). Year-end posts one closing journal per unit that moves every income and
// expense balance of the year to Retained Earnings (3004), marks the rows is_closing, then closes the periods and the year.
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, ZERO, isoDate, money } from './money';
import type { Dec } from './money';
import { PostingService } from './posting-service';
import type { PostLineInput } from './posting-service';
import { getSetting } from './settings';

async function blockers(fyStart: Date, fyEnd: Date, from: Date, to: Date) {
  void fyStart;
  void fyEnd;
  const drafts = await prisma.journal.count({
    where: { deletedAt: null, status: 'Draft', docDate: { gte: from, lte: to } },
  });
  const openStatements = await prisma.bankStatement.count({
    where: { status: 'Open', periodTo: { lte: to } },
  });
  return { drafts, openStatements };
}

export const closeService = {
  async periods(fyId: string) {
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const periods = await prisma.financialYearPeriod.findMany({
      where: { fyId },
      orderBy: { periodNo: 'asc' },
    });
    const fy = await prisma.financialYear.findUnique({ where: { id: fyId } });
    if (!fy) throw Errors.notFound('Financial year not found.');
    const requireReco = await getSetting<boolean>(prisma, 'fin.require_bank_reco_at_close', true);
    const rows = [];
    for (const p of periods) {
      const b = await blockers(fy.startDate, fy.endDate, p.startDate, p.endDate);
      rows.push({
        id: p.id,
        periodNo: p.periodNo,
        label: p.label,
        startDate: isoDate(p.startDate),
        endDate: isoDate(p.endDate),
        status: p.status,
        version: p.version,
        draftJournals: b.drafts,
        openBankStatements: requireReco ? b.openStatements : 0,
      });
    }
    const closed = await prisma.fyClosing.count({ where: { fyId } });
    return {
      fy: { id: fy.id, code: fy.code, status: fy.status, yearEndPosted: closed > 0 },
      periods: rows,
    };
  },

  async closePeriod(periodId: string, version: number, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM financial_year_periods WHERE id = ${periodId}::uuid FOR UPDATE`;
      if (!rows[0]) throw Errors.notFound('Period not found.');
      const p = await tx.financialYearPeriod.findUniqueOrThrow({ where: { id: periodId } });
      if (p.version !== version) throw Errors.versionConflict();
      if (p.status === 'CLOSED')
        throw FinErrors.invalidTransition('This period is already closed.');
      const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: p.fyId } });
      const reco = await getSetting<boolean>(tx, 'fin.require_bank_reco_at_close', true);
      const drafts = await tx.journal.count({
        where: { deletedAt: null, status: 'Draft', docDate: { gte: p.startDate, lte: p.endDate } },
      });
      const stmts = reco
        ? await tx.bankStatement.count({ where: { status: 'Open', periodTo: { lte: p.endDate } } })
        : 0;
      if (drafts || stmts) {
        const why = [
          drafts ? `${drafts} journal(s) are still Draft or waiting for approval` : '',
          stmts ? `${stmts} bank statement(s) are not reconciled` : '',
        ]
          .filter(Boolean)
          .join('; ');
        throw FinErrors.closeBlocked(`${p.label} cannot be closed: ${why}.`, { period: why });
      }
      void fy;
      await tx.financialYearPeriod.update({
        where: { id: periodId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: actor.userId,
          version: { increment: 1 },
        },
      });
      await recordAudit(
        {
          action: 'PERIOD_CLOSED',
          actorId: actor.userId,
          targetType: 'FinancialYear',
          targetId: p.fyId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { period: p.label },
        },
        tx,
      );
      return tx.financialYearPeriod.findUniqueOrThrow({ where: { id: periodId } });
    });
  },

  async reopenPeriod(periodId: string, version: number, reason: string, actor: Actor) {
    if (reason.trim().length < 5)
      throw FinErrors.reasonRequired('Give a reason of at least 5 characters.', {
        reason: 'Enter a reason.',
      });
    return prisma.$transaction(async (tx) => {
      const p = await tx.financialYearPeriod.findUnique({ where: { id: periodId } });
      if (!p) throw Errors.notFound('Period not found.');
      if (p.version !== version) throw Errors.versionConflict();
      if (p.status !== 'CLOSED') throw FinErrors.invalidTransition('This period is already open.');
      const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: p.fyId } });
      if (fy.status === 'CLOSED')
        throw FinErrors.invalidTransition(
          'The financial year is closed; a period of it cannot be reopened.',
        );
      await tx.financialYearPeriod.update({
        where: { id: periodId },
        data: { status: 'OPEN', closedAt: null, closedById: null, version: { increment: 1 } },
      });
      await recordAudit(
        {
          action: 'PERIOD_UNLOCKED',
          actorId: actor.userId,
          targetType: 'FinancialYear',
          targetId: p.fyId,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { period: p.label, reason },
        },
        tx,
      );
      return tx.financialYearPeriod.findUniqueOrThrow({ where: { id: periodId } });
    });
  },

  /** What the year-end would do, without doing it. */
  async preview(fyId: string) {
    const fy = await prisma.financialYear.findUnique({ where: { id: fyId } });
    if (!fy) throw Errors.notFound('Financial year not found.');
    // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
    const rows = await prisma.$queryRaw<{ unit_id: string; unit: string; profit: string }[]>`
      SELECT g.unit_id, u.code AS unit, COALESCE(SUM(g.credit - g.debit), 0)::text AS profit
        FROM gl_entries g JOIN accounts a ON a.id = g.account_id JOIN units u ON u.id = g.unit_id
       WHERE g.fy_id = ${fyId}::uuid AND g.is_closing = false AND a.root_type IN ('Income','Expense')
       GROUP BY g.unit_id, u.code ORDER BY u.code`;
    const drafts = await prisma.journal.count({
      where: { deletedAt: null, status: 'Draft', docDate: { gte: fy.startDate, lte: fy.endDate } },
    });
    return {
      fyId,
      code: fy.code,
      status: fy.status,
      draftJournals: drafts,
      units: rows.map((r) => ({ unitId: r.unit_id, unit: r.unit, netProfit: money(r.profit) })),
    };
  },

  async closeYear(fyId: string, actor: Actor) {
    return prisma.$transaction(
      async (tx) => {
        const lockedFy = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM financial_years WHERE id = ${fyId}::uuid FOR UPDATE`;
        if (!lockedFy[0]) throw Errors.notFound('Financial year not found.');
        const fy = await tx.financialYear.findUniqueOrThrow({ where: { id: fyId } });
        if (fy.status === 'CLOSED' || (await tx.fyClosing.count({ where: { fyId } })) > 0)
          throw FinErrors.invalidTransition('This financial year is already closed.');
        const drafts = await tx.journal.count({
          where: {
            deletedAt: null,
            status: 'Draft',
            docDate: { gte: fy.startDate, lte: fy.endDate },
          },
        });
        if (drafts)
          throw FinErrors.closeBlocked(
            `${drafts} journal(s) are still Draft or waiting for approval.`,
            { fy: 'Post or delete them first.' },
          );
        if (await getSetting<boolean>(tx, 'fin.require_bank_reco_at_close', true)) {
          const open = await tx.bankStatement.count({
            where: { status: 'Open', periodTo: { lte: fy.endDate } },
          });
          if (open)
            throw FinErrors.closeBlocked(`${open} bank statement(s) are not reconciled.`, {
              fy: 'Reconcile them first.',
            });
        }
        const retained = await tx.accountDefault.findUnique({
          where: { key: 'RETAINED_EARNINGS' },
        });
        if (!retained) throw FinErrors.unmappedKey('The Retained Earnings account is not set.');

        // unpaginated: internal policy/config lookup inside a transaction, small admin-defined table
        const bal = await tx.$queryRaw<
          { unit_id: string; account_id: string; root_type: string; net: string }[]
        >`
        SELECT g.unit_id, g.account_id, a.root_type, SUM(g.debit - g.credit)::text AS net
          FROM gl_entries g JOIN accounts a ON a.id = g.account_id
         WHERE g.fy_id = ${fyId}::uuid AND g.is_closing = false AND a.root_type IN ('Income','Expense')
         GROUP BY g.unit_id, g.account_id, a.root_type HAVING SUM(g.debit - g.credit) <> 0`;
        const byUnit = new Map<string, { account_id: string; net: Dec }[]>();
        for (const b of bal) {
          const arr = byUnit.get(b.unit_id) ?? [];
          arr.push({ account_id: b.account_id, net: D(b.net) });
          byUnit.set(b.unit_id, arr);
        }
        // the closing journals are dated the last day of the year: that period must be open while they post
        await tx.financialYearPeriod.updateMany({
          where: { fyId, endDate: fy.endDate, status: 'CLOSED' },
          data: { status: 'OPEN', closedAt: null, closedById: null },
        });
        const results: { unitId: string; journalId: string | null; netProfit: string }[] = [];
        const endDate = isoDate(fy.endDate);
        for (const [unitId, accts] of byUnit) {
          let total = ZERO; // Σ(debit − credit) of all P&L accounts: negative = profit
          const lines: PostLineInput[] = [];
          for (const a of accts) {
            total = total.plus(a.net);
            // close the account: a debit balance is credited, a credit balance is debited
            lines.push(
              a.net.greaterThan(0)
                ? {
                    accountId: a.account_id,
                    unitId,
                    debit: '0.00',
                    credit: a.net.toFixed(2),
                    narration: 'Year-end closing',
                  }
                : {
                    accountId: a.account_id,
                    unitId,
                    debit: a.net.negated().toFixed(2),
                    credit: '0.00',
                    narration: 'Year-end closing',
                  },
            );
          }
          // Retained earnings takes the opposite of the total: profit (total < 0) -> credit
          lines.push(
            total.lessThan(0)
              ? {
                  accountId: retained.accountId,
                  unitId,
                  debit: '0.00',
                  credit: total.negated().toFixed(2),
                  narration: 'Net profit for the year',
                }
              : {
                  accountId: retained.accountId,
                  unitId,
                  debit: total.toFixed(2),
                  credit: '0.00',
                  narration: 'Net loss for the year',
                },
          );
          const posted = await PostingService.postJournal(
            tx,
            {
              unitId,
              docDate: endDate,
              voucherType: 'Closing',
              source: 'SYSTEM',
              isClosing: true,
              narration: `Year-end closing ${fy.code}`,
              sourceDocType: 'fy-closing',
              sourceDocId: fyId,
              lines,
            },
            actor,
          );
          const profit = total.negated();
          await tx.fyClosing.create({
            data: {
              fyId,
              unitId,
              journalId: posted.id,
              netProfit: profit,
              closedById: actor.userId,
            },
          });
          results.push({ unitId, journalId: posted.id, netProfit: money(profit) });
        }
        if (results.length === 0) {
          // nothing to close, but the year is still sealed: one marker row per unit is not needed
          await tx.fyClosing.create({
            data: {
              fyId,
              unitId: (await tx.unit.findFirstOrThrow({ orderBy: { code: 'asc' } })).id,
              journalId: null,
              netProfit: ZERO,
              closedById: actor.userId,
            },
          });
        }
        await tx.financialYearPeriod.updateMany({
          where: { fyId, status: { not: 'CLOSED' } },
          data: { status: 'CLOSED', closedAt: new Date(), closedById: actor.userId },
        });
        await tx.financialYear.update({
          where: { id: fyId },
          data: { status: 'CLOSED', version: { increment: 1 } },
        });
        await recordAudit(
          {
            action: 'FY_CLOSED',
            actorId: actor.userId,
            targetType: 'FinancialYear',
            targetId: fyId,
            ...(actor.meta ? { meta: actor.meta } : {}),
            detail: { code: fy.code, units: results.length },
          },
          tx,
        );
        return { fyId, code: fy.code, closings: results };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  },
};
