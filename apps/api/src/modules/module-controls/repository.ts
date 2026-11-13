// The only code that touches module_controls (plus the owner-department lookup it needs).
import type { Department, ModuleControl, Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export const moduleControlRepository = {
  all(db: Db = prisma): Promise<ModuleControl[]> {
    // unpaginated: one control row per page (registry size)
    return db.moduleControl.findMany();
  },

  find(pageId: string, db: Db = prisma): Promise<ModuleControl | null> {
    return db.moduleControl.findUnique({ where: { pageId } });
  },

  findDepartment(name: string, db: Db = prisma): Promise<Department | null> {
    return db.department.findUnique({ where: { name } });
  },

  /** Optimistic-lock update; bumps the version. */
  async updateIfVersion(
    pageId: string,
    version: number,
    data: Prisma.ModuleControlUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.moduleControl.updateMany({
      where: { pageId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },
};
