// apps/api/src/modules/uoms/repository.ts
// Database queries for UOMs (Phase 03 Order 3)
import type { Prisma, Uom } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import type { ListUomsQuery } from './schemas';

export const uomRepository = {
  findMany: async (filter: ListUomsQuery = {}, db: Db = prisma): Promise<Uom[]> => {
    const where: Prisma.UomWhereInput = {
      deletedAt: null,
      ...(filter.status ? { status: { equals: filter.status, mode: 'insensitive' } } : {}),
      ...(filter.uomClass ? { uomClass: filter.uomClass } : {}),
      ...(filter.q
        ? {
            OR: [
              { code: { contains: filter.q, mode: 'insensitive' } },
              { name: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return db.uom.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where,
      orderBy: [{ code: 'asc' }],
    });
  },

  findById: async (id: string, db: Db = prisma): Promise<Uom | null> => {
    return db.uom.findFirst({
      where: { id, deletedAt: null },
    });
  },

  findByCode: async (code: string, db: Db = prisma): Promise<Uom | null> => {
    return db.uom.findFirst({
      where: { code, deletedAt: null },
    });
  },

  findCollisions: async (
    values: { code?: string; name?: string },
    excludeId?: string,
    db: Db = prisma,
  ): Promise<{ id: string; code: string; name: string }[]> => {
    const or: Prisma.UomWhereInput[] = [];
    if (values.code) or.push({ code: values.code });
    if (values.name) or.push({ name: { equals: values.name, mode: 'insensitive' } });
    if (or.length === 0) return [];

    return db.uom.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where: {
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: or,
      },
      select: { id: true, code: true, name: true },
    });
  },

  create: async (data: Prisma.UomUncheckedCreateInput, db: Db = prisma): Promise<Uom> => {
    return db.uom.create({ data });
  },

  updateIfVersion: async (
    id: string,
    version: number,
    data: Prisma.UomUncheckedUpdateInput,
    db: Db = prisma,
  ): Promise<Uom | null> => {
    const result = await db.uom.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return db.uom.findUniqueOrThrow({ where: { id } });
  },

  softDelete: async (id: string, actorId: string, version?: number, db: Db = prisma): Promise<boolean> => {
    const where: Prisma.UomWhereInput = {
      id,
      deletedAt: null,
      ...(version !== undefined ? { version } : {}),
    };
    const result = await db.uom.updateMany({
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
