// apps/api/src/modules/currencies/repository.ts
// Database queries for currencies (Phase 03 Order 3)
import type { Currency, Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import type { ListCurrenciesQuery } from './schemas';

export const currencyRepository = {
  findMany: async (filter: ListCurrenciesQuery = {}, db: Db = prisma): Promise<Currency[]> => {
    const where: Prisma.CurrencyWhereInput = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { code: { contains: filter.q, mode: 'insensitive' } },
              { name: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return db.currency.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where,
      orderBy: [{ isBase: 'desc' }, { code: 'asc' }],
    });
  },

  findById: async (id: string, db: Db = prisma): Promise<Currency | null> => {
    return db.currency.findFirst({
      where: { id, deletedAt: null },
    });
  },

  findByCode: async (code: string, db: Db = prisma): Promise<Currency | null> => {
    return db.currency.findFirst({
      where: { code, deletedAt: null },
    });
  },

  findBase: async (db: Db = prisma): Promise<Currency | null> => {
    return db.currency.findFirst({
      where: { isBase: true, deletedAt: null },
    });
  },

  unsetOtherBases: async (excludeId: string, db: Db = prisma): Promise<void> => {
    await db.currency.updateMany({
      where: { id: { not: excludeId }, isBase: true },
      data: { isBase: false },
    });
  },

  create: async (data: Prisma.CurrencyUncheckedCreateInput, db: Db = prisma): Promise<Currency> => {
    return db.currency.create({ data });
  },

  updateIfVersion: async (
    id: string,
    version: number,
    data: Prisma.CurrencyUncheckedUpdateInput,
    db: Db = prisma,
  ): Promise<Currency | null> => {
    const result = await db.currency.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return db.currency.findUniqueOrThrow({ where: { id } });
  },

  softDelete: async (id: string, actorId: string, version?: number, db: Db = prisma): Promise<boolean> => {
    const where: Prisma.CurrencyWhereInput = {
      id,
      deletedAt: null,
      ...(version !== undefined ? { version } : {}),
    };
    const result = await db.currency.updateMany({
      where,
      data: {
        deletedAt: new Date(),
        deletedById: actorId,
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  },
};
