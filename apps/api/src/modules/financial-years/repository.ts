// The only code that touches the financial_years table. Writes run under one advisory lock so
// "add next year" and "set current" cannot interleave (the partial unique index is the last guard).
import type { FinancialYear, Prisma } from '@prisma/client';
import { FY_ORDER } from '../../core/context/context-repository';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export const financialYearRepository = {
  list(db: Db = prisma): Promise<FinancialYear[]> {
    return db.financialYear.findMany({ orderBy: FY_ORDER });
  },

  findById(id: string, db: Db = prisma): Promise<FinancialYear | null> {
    return db.financialYear.findUnique({ where: { id } });
  },

  findByCode(code: string, db: Db = prisma): Promise<FinancialYear | null> {
    return db.financialYear.findUnique({ where: { code } });
  },

  latest(db: Db = prisma): Promise<FinancialYear | null> {
    return db.financialYear.findFirst({ orderBy: FY_ORDER });
  },

  current(db: Db = prisma): Promise<FinancialYear | null> {
    return db.financialYear.findFirst({ where: { isCurrent: true } });
  },

  async lock(db: Db): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('financial_years'))`;
  },

  create(data: Prisma.FinancialYearUncheckedCreateInput, db: Db = prisma): Promise<FinancialYear> {
    return db.financialYear.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.FinancialYearUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.financialYear.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },
};
