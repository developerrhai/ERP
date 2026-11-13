// The only code that touches department_families (plus the department lookup it needs).
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export const departmentAccessRepository = {
  departments: (db: Db = prisma) =>
    db.department.findMany({
      take: 500, // unpaginated: small lookup, max 500
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, families: { select: { family: true } } },
    }),
  findDepartment: (name: string, db: Db = prisma) =>
    db.department.findUnique({ where: { name }, select: { id: true, name: true } }),
  familiesOf: async (name: string, db: Db = prisma) =>
    (
      await db.departmentFamily.findMany({
        take: 500, // unpaginated: small lookup, max 500
        where: { departmentName: name },
        select: { family: true },
      })
    ).map((r) => r.family),
  lock: async (name: string, db: Db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`department_families:${name}`}))`;
  },
  replace: async (name: string, families: string[], db: Db) => {
    await db.departmentFamily.deleteMany({ where: { departmentName: name } });
    await db.departmentFamily.createMany({
      data: families.map((family) => ({ departmentName: name, family })),
    });
  },
};
