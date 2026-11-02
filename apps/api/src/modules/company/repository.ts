// The only code that touches the companies table (exactly one row, enforced by a unique index on a
// constant). Writes use optimistic locking on `version`.
import type { Company, Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export const companyRepository = {
  get(db: Db = prisma): Promise<Company | null> {
    return db.company.findFirst({ orderBy: { createdAt: 'asc' } });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.CompanyUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.company.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },
};
