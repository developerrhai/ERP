// The only code that touches the units table (plus the counts that decide IN_USE). Listing order
// is creation order, which keeps the 3 seeded units first (TAL, SAW, VAR).
import type { Prisma, Unit } from '@prisma/client';
import { UNIT_ORDER } from '../../core/context/context-repository';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export type UnitWithCount = Unit & { _count: { userUnits: number } };

const withCount = { _count: { select: { userUnits: true } } } as const;

export const unitRepository = {
  list(where: Prisma.UnitWhereInput = {}, db: Db = prisma): Promise<UnitWithCount[]> {
    return db.unit.findMany({ where, orderBy: UNIT_ORDER, include: withCount });
  },

  findById(id: string, db: Db = prisma): Promise<UnitWithCount | null> {
    return db.unit.findUnique({ where: { id }, include: withCount });
  },

  findByIds(ids: readonly string[], db: Db = prisma): Promise<Unit[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return db.unit.findMany({ where: { id: { in: [...ids] } } });
  },

  findCollisions(
    values: { code?: string; name?: string },
    excludeId?: string,
    db: Db = prisma,
  ): Promise<Pick<Unit, 'id' | 'code' | 'name'>[]> {
    const or: Prisma.UnitWhereInput[] = [];
    if (values.code) or.push({ code: values.code });
    if (values.name) or.push({ name: { equals: values.name, mode: 'insensitive' } });
    if (or.length === 0) return Promise.resolve([]);
    return db.unit.findMany({
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true, code: true, name: true },
    });
  },

  create(data: Prisma.UnitUncheckedCreateInput, db: Db = prisma): Promise<Unit> {
    return db.unit.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.UnitUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.unit.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  /** Users that reference the unit (assigned to it, or with it as their default). */
  countUsers(id: string, db: Db = prisma): Promise<number> {
    return db.user.count({
      where: { OR: [{ units: { some: { unitId: id } } }, { defaultUnitId: id }] },
    });
  },

  /** Records (including soft-deleted ones) kept in the unit. */
  countRecords(id: string, db: Db = prisma): Promise<number> {
    return db.genericRecord.count({ where: { unitId: id } });
  },

  async delete(id: string, db: Db = prisma): Promise<void> {
    await db.unit.delete({ where: { id } });
  },
};
