// The only code that touches the departments table (plus the counts that decide IN_USE). Listing
// order is creation order, which keeps the 11 seeded departments in prototype order.
import type { Department, Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export type DepartmentWithCount = Department & { _count: { users: number } };

export const departmentRepository = {
  list(db: Db = prisma): Promise<DepartmentWithCount[]> {
    return db.department.findMany({
      take: 500, // unpaginated: small lookup, max 500
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
  },

  async activeNames(db: Db = prisma): Promise<string[]> {
    const rows = await db.department.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where: { status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      select: { name: true },
    });
    return rows.map((r) => r.name);
  },

  findById(id: string, db: Db = prisma): Promise<DepartmentWithCount | null> {
    return db.department.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
  },

  findByName(name: string, db: Db = prisma): Promise<Department | null> {
    return db.department.findUnique({ where: { name } });
  },

  findCollisions(
    values: { code?: string; name?: string },
    excludeId?: string,
    db: Db = prisma,
  ): Promise<Pick<Department, 'id' | 'code' | 'name'>[]> {
    const or: Prisma.DepartmentWhereInput[] = [];
    if (values.code) or.push({ code: values.code });
    if (values.name) or.push({ name: { equals: values.name, mode: 'insensitive' } });
    if (or.length === 0) return Promise.resolve([]);
    return db.department.findMany({
      take: 500, // unpaginated: small lookup, max 500
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true, code: true, name: true },
    });
  },

  create(data: Prisma.DepartmentUncheckedCreateInput, db: Db = prisma): Promise<Department> {
    return db.department.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.DepartmentUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.department.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  countUsers(name: string, db: Db = prisma): Promise<number> {
    return db.user.count({ where: { department: name } });
  },

  countOwnedModules(name: string, db: Db = prisma): Promise<number> {
    return db.moduleControl.count({ where: { ownerDepartment: name } });
  },

  async deleteWithFamilies(id: string, name: string, db: Db = prisma): Promise<void> {
    await db.departmentFamily.deleteMany({ where: { departmentName: name } });
    await db.department.delete({ where: { id } });
  },
};
