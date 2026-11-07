// Budgets (05a §4.11, 05b §5.10). One budget per (year, unit, account, optional cost centre) with 12 monthly
// amounts. Only an ACTIVE budget is enforced: a posting that would push the year-to-date actual of the account
// over the year-to-date budget is refused (409 BUDGET_EXCEEDED) unless the caller holds the override gate.
import type { Prisma } from '@prisma/client';
import { recordAudit } from '../../core/audit/audit-service';
import type { Db } from '../../core/db/prisma';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Actor } from './accounts-service';
import { FinErrors } from './errors';
import { D, money, parseMoney, ZERO } from './money';
import type { Dec } from './money';

export interface BudgetInput {
  fyId: string;
  unitId: string;
  accountId: string;
  costCenterId?: string | null;
  name: string;
  months: string[]; // 12 money strings, April first
}

export interface BudgetCheck {
  budgetId: string;
  budgetToDate: string;
  actualToDate: string;
  spend: string;
  exceeded: boolean;
  over: string;
}

function monthsOf(input: string[]): { periodNo: number; amount: Dec }[] {
  if (input.length !== 12)
    throw Errors.validation({ months: 'Give 12 monthly amounts, April first.' });
  return input.map((m, i) => {
    const amount = parseMoney(m, 'months');
    if (amount.isNegative())
      throw Errors.validation({ months: 'A monthly budget cannot be negative.' });
    return { periodNo: i + 1, amount };
  });
}

export const budgetService = {
  async list(q: { fyId: string; unitId?: string | null; status?: string }) {
    const where: Prisma.BudgetWhereInput = { fyId: q.fyId, deletedAt: null };
    if (q.unitId) where.unitId = q.unitId;
    if (q.status) where.status = q.status;
    const rows = await prisma.budget.findMany({
      where,
      include: { months: { orderBy: { periodNo: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const accounts = await prisma.account.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows.map((b) => ({
      ...b,
      accountCode: byId.get(b.accountId)?.code ?? null,
      accountName: byId.get(b.accountId)?.name ?? null,
      total: money(b.months.reduce((s, m) => s.plus(m.amount), ZERO)),
      months: b.months.map((m) => ({ periodNo: m.periodNo, amount: money(m.amount) })),
    }));
  },

  async create(input: BudgetInput, actor: Actor) {
    const months = monthsOf(input.months);
    return prisma.$transaction(async (tx) => {
      const acct = await tx.account.findFirst({ where: { id: input.accountId, deletedAt: null } });
      if (!acct || acct.rootType !== 'Expense' || acct.isGroup)
        throw Errors.validation({ accountId: 'Choose an expense ledger account.' });
      const dup = await tx.budget.findFirst({
        where: {
          fyId: input.fyId,
          unitId: input.unitId,
          accountId: input.accountId,
          costCenterId: input.costCenterId ?? null,
          deletedAt: null,
        },
      });
      if (dup)
        throw Errors.duplicate({
          accountId: 'A budget for this account (and cost centre) already exists this year.',
        });
      const created = await tx.budget.create({
        data: {
          fyId: input.fyId,
          unitId: input.unitId,
          accountId: input.accountId,
          costCenterId: input.costCenterId ?? null,
          name: input.name,
          createdById: actor.userId,
          months: { create: months },
        },
      });
      await recordAudit(
        {
          action: 'BUDGET_CREATED',
          actorId: actor.userId,
          targetType: 'Budget',
          targetId: created.id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { name: input.name },
        },
        tx,
      );
      return created;
    });
  },

  async update(
    id: string,
    version: number,
    patch: { name?: string; months?: string[] },
    actor: Actor,
  ) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.budget.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Budget not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      if (cur.status === 'Closed')
        throw FinErrors.invalidTransition('A closed budget cannot be changed.');
      if (patch.months) {
        const months = monthsOf(patch.months);
        await tx.budgetMonth.deleteMany({ where: { budgetId: id } });
        await tx.budgetMonth.createMany({ data: months.map((m) => ({ budgetId: id, ...m })) });
      }
      const res = await tx.budget.updateMany({
        where: { id, version },
        data: {
          ...(patch.name ? { name: patch.name } : {}),
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'BUDGET_UPDATED',
          actorId: actor.userId,
          targetType: 'Budget',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: {},
        },
        tx,
      );
      return tx.budget.findUniqueOrThrow({ where: { id } });
    });
  },

  async setStatus(id: string, version: number, status: 'Active' | 'Closed', actor: Actor) {
    return prisma.$transaction(async (tx) => {
      const cur = await tx.budget.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Budget not found.');
      if (cur.version !== version) throw Errors.versionConflict();
      const ok =
        (cur.status === 'Draft' && status === 'Active') ||
        (cur.status === 'Active' && status === 'Closed');
      if (!ok) throw FinErrors.invalidTransition(`A ${cur.status} budget cannot become ${status}.`);
      const res = await tx.budget.updateMany({
        where: { id, version },
        data: {
          status,
          version: { increment: 1 },
          updatedById: actor.userId,
          updatedAt: new Date(),
        },
      });
      if (res.count !== 1) throw Errors.versionConflict();
      await recordAudit(
        {
          action: 'BUDGET_ACTIVATED',
          actorId: actor.userId,
          targetType: 'Budget',
          targetId: id,
          ...(actor.meta ? { meta: actor.meta } : {}),
          detail: { status },
        },
        tx,
      );
      return tx.budget.findUniqueOrThrow({ where: { id } });
    });
  },

  async remove(id: string, actor: Actor) {
    await prisma.$transaction(async (tx) => {
      const cur = await tx.budget.findFirst({ where: { id, deletedAt: null } });
      if (!cur) throw Errors.notFound('Budget not found.');
      if (cur.status !== 'Draft')
        throw FinErrors.invalidTransition('Only a Draft budget can be deleted.');
      await tx.budget.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId, version: { increment: 1 } },
      });
    });
  },

  /**
   * Would debiting `spend` on the account take the year-to-date actual over the year-to-date budget?
   * null = no active budget applies (nothing to enforce).
   */
  async check(
    db: Db,
    p: {
      unitId: string;
      fyId: string;
      docDate: string;
      accountId: string;
      costCenterId: string | null;
      spend: Dec;
    },
  ): Promise<BudgetCheck | null> {
    const budget =
      (p.costCenterId &&
        (await db.budget.findFirst({
          where: {
            fyId: p.fyId,
            unitId: p.unitId,
            accountId: p.accountId,
            costCenterId: p.costCenterId,
            status: 'Active',
            deletedAt: null,
          },
          include: { months: true },
        }))) ||
      (await db.budget.findFirst({
        where: {
          fyId: p.fyId,
          unitId: p.unitId,
          accountId: p.accountId,
          costCenterId: null,
          status: 'Active',
          deletedAt: null,
        },
        include: { months: true },
      }));
    if (!budget) return null;
    const period = await db.financialYearPeriod.findFirst({
      where: {
        fyId: p.fyId,
        startDate: { lte: new Date(`${p.docDate}T00:00:00Z`) },
        endDate: { gte: new Date(`${p.docDate}T00:00:00Z`) },
      },
      select: { periodNo: true, endDate: true },
    });
    if (!period) return null;
    const budgetToDate = budget.months
      .filter((m) => m.periodNo <= period.periodNo)
      .reduce((s, m) => s.plus(m.amount), ZERO);
    const rows = await db.$queryRaw<{ net: string | null }[]>`
      SELECT COALESCE(SUM(debit - credit), 0)::text AS net
        FROM gl_entries
       WHERE account_id = ${p.accountId}::uuid AND unit_id = ${p.unitId}::uuid AND fy_id = ${p.fyId}::uuid
         AND is_closing = false AND posting_date <= ${period.endDate}::date
         AND (${budget.costCenterId}::uuid IS NULL OR cost_center_id = ${budget.costCenterId}::uuid)`;
    const actual = D(rows[0]?.net ?? 0);
    const after = actual.plus(p.spend);
    return {
      budgetId: budget.id,
      budgetToDate: money(budgetToDate),
      actualToDate: money(actual),
      spend: money(p.spend),
      exceeded: after.greaterThan(budgetToDate),
      over: money(after.greaterThan(budgetToDate) ? after.minus(budgetToDate) : ZERO),
    };
  },
};
