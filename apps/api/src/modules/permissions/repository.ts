// The only code that touches role_permissions. Replacement happens inside a transaction that holds
// a per-role advisory lock, so two concurrent PUTs for one role cannot interleave.
import type { Prisma, RolePermission } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import type { PermissionRole } from '../../core/rbac/permission-model';

export const permissionRepository = {
  all(db: Db = prisma): Promise<RolePermission[]> {
    return db.rolePermission.findMany();
  },

  forRole(role: PermissionRole, db: Db = prisma): Promise<RolePermission[]> {
    return db.rolePermission.findMany({ where: { role } });
  },

  async lockRole(role: PermissionRole, db: Db): Promise<void> {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_permissions:${role}`}))`;
  },

  async replace(
    role: PermissionRole,
    rows: Omit<Prisma.RolePermissionCreateManyInput, 'role'>[],
    db: Db,
  ): Promise<void> {
    await db.rolePermission.deleteMany({ where: { role } });
    await db.rolePermission.createMany({ data: rows.map((r) => ({ ...r, role })) });
  },
};
