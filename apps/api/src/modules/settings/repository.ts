// The only code that touches the settings table: read a key, and write it with optimistic locking
// (version 0 means "the row does not exist yet").
import type { Prisma, Setting } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export const settingsRepository = {
  get(key: string, db: Db = prisma): Promise<Setting | null> {
    return db.setting.findUnique({ where: { key } });
  },

  /** Returns false when the stored version is not `expectedVersion`. */
  async writeIfVersion(
    key: string,
    expectedVersion: number,
    value: Prisma.InputJsonObject,
    actorId: string,
    db: Db = prisma,
  ): Promise<boolean> {
    if (expectedVersion === 0) {
      const created = await db.setting.createMany({
        data: [{ key, value, updatedById: actorId }],
        skipDuplicates: true,
      });
      return created.count === 1;
    }
    const result = await db.setting.updateMany({
      where: { key, version: expectedVersion },
      data: { value, updatedById: actorId, version: { increment: 1 } },
    });
    return result.count === 1;
  },
};
