// The only code that touches role_permissions. Replacement happens inside a transaction that holds
// a per-role advisory lock, so two concurrent PUTs for one role cannot interleave.
import type { Prisma, RolePermission } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

export const permissionRepository = {
  all(db: Db = prisma): Promise<RolePermission[]> {
    // unpaginated: role permission matrix: roles x pages, bounded by the role and page lists
    return db.rolePermission.findMany();
  },

  forRoleId(roleId: string, db: Db = prisma): Promise<RolePermission[]> {
    // unpaginated: role permission matrix: roles x pages, bounded by the role and page lists
    return db.rolePermission.findMany({ where: { roleId } });
  },

  async lockRoleId(roleId: string, db: Db): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_permissions:${roleId}`}))`;
  },

  async replace(
    roleId: string,
    rows: Omit<Prisma.RolePermissionCreateManyInput, 'roleId'>[],
    db: Db,
  ): Promise<void> {
    await db.rolePermission.deleteMany({ where: { roleId } });
    await db.rolePermission.createMany({ data: rows.map((r) => ({ ...r, roleId })) });
  },
};
