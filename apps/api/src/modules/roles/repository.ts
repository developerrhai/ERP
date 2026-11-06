// The only code that touches the roles table.
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_CODE_MAP: Record<string, string> = {
  SUPER_ADMIN: 'SUPER_USER',
  ADMIN: 'ADMINISTRATOR',
  MANAGER: 'DEPT_MANAGER',
  LEAD: 'SUPERVISOR',
  MEMBER: 'EMPLOYEE',
};

export const roleRepository = {
  async userCountsByRoleId(db: Db = prisma): Promise<Map<string, number>> {
    const rows = await db.user.groupBy({ by: ['roleId'], _count: { _all: true } });
    return new Map(rows.map((r) => [r.roleId, r._count._all]));
  },

  findAll(db: Db = prisma): Promise<Role[]> {
    return db.role.findMany({
      orderBy: [{ level: 'desc' }, { code: 'asc' }],
    });
  },

  findById(id: string, db: Db = prisma): Promise<Role | null> {
    if (!UUID_REGEX.test(id)) return Promise.resolve(null);
    return db.role.findUnique({ where: { id } });
  },

  findByCode(code: string, db: Db = prisma): Promise<Role | null> {
    const resolved = LEGACY_CODE_MAP[code] ?? code;
    return db.role.findUnique({ where: { code: resolved } });
  },

  findByName(name: string, db: Db = prisma): Promise<Role | null> {
    return db.role.findUnique({ where: { name } });
  },

  userCount(roleId: string, db: Db = prisma): Promise<number> {
    return db.user.count({ where: { roleId } });
  },

  create(data: Prisma.RoleCreateInput, db: Db = prisma): Promise<Role> {
    return db.role.create({ data });
  },

  async updateWithVersion(
    id: string,
    data: Prisma.RoleUpdateInput,
    expectedVersion: number,
    db: Db = prisma,
  ): Promise<Role | null> {
    const result = await db.role.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: expectedVersion + 1 },
    });
    if (result.count === 0) return null;
    return db.role.findUnique({ where: { id } });
  },

  async delete(id: string, db: Db = prisma): Promise<void> {
    await db.role.delete({ where: { id } });
  },
};
