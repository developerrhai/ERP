// apps/api/src/modules/designations/repository.ts
// Database queries for designations (Phase 03 Order 3)
import type { Designation, Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import type { ListDesignationsQuery } from './schemas';

export type DesignationWithDept = Designation & {
  department: { id: string; code: string; name: string } | null;
};

const WITH_DEPT = {
  department: { select: { id: true, code: true, name: true } },
} as const;

export const designationRepository = {
  findMany: async (filter: ListDesignationsQuery, db: Db = prisma): Promise<DesignationWithDept[]> => {
    const where: Prisma.DesignationWhereInput = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.q
        ? {
            OR: [
              { code: { contains: filter.q, mode: 'insensitive' } },
              { name: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return db.designation.findMany({
      where,
      include: WITH_DEPT,
      orderBy: [{ level: 'desc' }, { name: 'asc' }],
    });
  },

  findById: async (id: string, db: Db = prisma): Promise<DesignationWithDept | null> => {
    return db.designation.findFirst({
      where: { id, deletedAt: null },
      include: WITH_DEPT,
    });
  },

  findByCode: async (code: string, db: Db = prisma): Promise<Designation | null> => {
    return db.designation.findFirst({
      where: { code, deletedAt: null },
    });
  },

  findCollisions: async (
    values: { code?: string; name?: string },
    excludeId?: string,
    db: Db = prisma,
  ): Promise<{ id: string; code: string; name: string }[]> => {
    const or: Prisma.DesignationWhereInput[] = [];
    if (values.code) or.push({ code: values.code });
    if (values.name) or.push({ name: { equals: values.name, mode: 'insensitive' } });
    if (or.length === 0) return [];

    return db.designation.findMany({
      where: {
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: or,
      },
      select: { id: true, code: true, name: true },
    });
  },

  create: async (data: Prisma.DesignationUncheckedCreateInput, db: Db = prisma): Promise<DesignationWithDept> => {
    return db.designation.create({
      data,
      include: WITH_DEPT,
    });
  },

  updateIfVersion: async (
    id: string,
    version: number,
    data: Prisma.DesignationUncheckedUpdateInput,
    db: Db = prisma,
  ): Promise<DesignationWithDept | null> => {
    const result = await db.designation.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    if (result.count === 0) return null;
    return db.designation.findUniqueOrThrow({
      where: { id },
      include: WITH_DEPT,
    });
  },

  softDelete: async (id: string, actorId: string, version?: number, db: Db = prisma): Promise<boolean> => {
    const where: Prisma.DesignationWhereInput = {
      id,
      deletedAt: null,
      ...(version !== undefined ? { version } : {}),
    };
    const result = await db.designation.updateMany({
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
