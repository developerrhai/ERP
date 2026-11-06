// The only code that touches the users table, its user_units and user_departments rows.
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { escapeLike } from '../../core/http/query-safety';
import { USER_INCLUDE } from './dto';
import type { UserWithRelations } from './dto';
import type { ListUsersQuery } from './schemas';

const LEGACY_ROLE_MAP: Record<string, string> = {
  SUPER_ADMIN: 'SUPER_USER',
  ADMIN: 'ADMINISTRATOR',
  MANAGER: 'DEPT_MANAGER',
  LEAD: 'SUPERVISOR',
  MEMBER: 'EMPLOYEE',
};

function whereFor(query: ListUsersQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (query.roleId) where.roleId = query.roleId;
  else if (query.role) {
    const code = LEGACY_ROLE_MAP[query.role] ?? query.role;
    where.role = { code };
  }

  if (query.status) where.status = query.status;
  if (query.department) where.department = query.department;
  if (query.unitId) {
    where.units = { some: { unitId: query.unitId } };
  }
  if (query.q) {
    const q = escapeLike(query.q);
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { loginId: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

function orderByFor(sort?: string): Prisma.UserOrderByWithRelationInput[] {
  if (!sort) return [{ createdAt: 'desc' }, { id: 'asc' }];
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const direction: Prisma.SortOrder = desc ? 'desc' : 'asc';
  if (field === 'role') return [{ role: { code: direction } }, { id: 'asc' }];
  return [{ [field]: direction }, { id: 'asc' }];
}

export const userRepository = {
  findById(id: string, db: Db = prisma): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  },

  findWithRelations(id: string, db: Db = prisma): Promise<UserWithRelations | null> {
    return db.user.findUnique({ where: { id }, include: USER_INCLUDE });
  },

  findWithUnits(id: string, db: Db = prisma): Promise<UserWithRelations | null> {
    return db.user.findUnique({ where: { id }, include: USER_INCLUDE });
  },

  async withUnits(user: User, db: Db = prisma): Promise<UserWithRelations> {
    const loaded = await db.user.findUnique({ where: { id: user.id }, include: USER_INCLUDE });
    if (!loaded) throw new Error('User not found');
    return loaded;
  },

  async unitIdsOf(userId: string, db: Db = prisma): Promise<string[]> {
    const rows = await db.userUnit.findMany({ where: { userId }, select: { unitId: true } });
    return rows.map((r) => r.unitId);
  },

  async replaceUnits(userId: string, unitIds: readonly string[], db: Db = prisma): Promise<void> {
    await db.userUnit.deleteMany({ where: { userId, unitId: { notIn: [...unitIds] } } });
    if (unitIds.length > 0) {
      await db.userUnit.createMany({
        data: unitIds.map((unitId) => ({ userId, unitId })),
        skipDuplicates: true,
      });
    }
  },

  async replaceExtraDepartments(
    userId: string,
    departments: readonly string[],
    createdById?: string,
    db: Db = prisma,
  ): Promise<void> {
    await db.userDepartment.deleteMany({ where: { userId } });
    if (departments.length > 0) {
      await db.userDepartment.createMany({
        data: departments.map((departmentName) => ({
          userId,
          departmentName,
          createdById,
        })),
        skipDuplicates: true,
      });
    }
  },

  async findByIdentifier(identifier: string, db: Db = prisma): Promise<User | null> {
    return (
      (await db.user.findUnique({ where: { loginId: identifier } })) ??
      (await db.user.findUnique({ where: { email: identifier } }))
    );
  },

  async findByIdentifierWithRelations(identifier: string, db: Db = prisma): Promise<UserWithRelations | null> {
    return (
      (await db.user.findUnique({ where: { loginId: identifier }, include: USER_INCLUDE })) ??
      (await db.user.findUnique({ where: { email: identifier }, include: USER_INCLUDE }))
    );
  },

  findCollisions(
    values: { loginId?: string; email?: string | null },
    excludeId?: string,
    db: Db = prisma,
  ): Promise<Pick<User, 'id' | 'loginId' | 'email'>[]> {
    const or: Prisma.UserWhereInput[] = [];
    if (values.loginId) or.push({ loginId: values.loginId }, { email: values.loginId });
    if (values.email) or.push({ email: values.email }, { loginId: values.email });
    if (or.length === 0) return Promise.resolve([]);
    return db.user.findMany({
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true, loginId: true, email: true },
    });
  },

  async list(
    query: ListUsersQuery,
    db: Db = prisma,
  ): Promise<{ users: UserWithRelations[]; total: number }> {
    const where = whereFor(query);
    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: orderByFor(query.sort),
        skip: (query.page - 1) * query.size,
        take: query.size,
      }),
      db.user.count({ where }),
    ]);
    return { users, total };
  },

  create(data: Prisma.UserUncheckedCreateInput, db: Db = prisma): Promise<User> {
    return db.user.create({ data });
  },

  async updateIfVersion(
    id: string,
    version: number,
    data: Prisma.UserUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.user.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  update(id: string, data: Prisma.UserUncheckedUpdateInput, db: Db = prisma): Promise<User> {
    return db.user.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },

  async registerFailedLogin(
    id: string,
    maxFailures: number,
    lockMinutes: number,
  ): Promise<{ locked: boolean; justLocked: boolean; lockedUntil: Date | null; count: number }> {
    return prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { failed_login_count: number; locked_until: Date | null }[]
        >`
          SELECT failed_login_count, locked_until FROM users WHERE id = ${id}::uuid FOR UPDATE`;
        const row = rows[0];
        if (!row) return { locked: false, justLocked: false, lockedUntil: null, count: 0 };
        const now = Date.now();
        if (row.locked_until && row.locked_until.getTime() > now) {
          return {
            locked: true,
            justLocked: false,
            lockedUntil: row.locked_until,
            count: row.failed_login_count,
          };
        }
        const count = row.failed_login_count + 1;
        if (count >= maxFailures) {
          const lockedUntil = new Date(now + lockMinutes * 60_000);
          await tx.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil } });
          return { locked: true, justLocked: true, lockedUntil, count };
        }
        await tx.user.update({ where: { id }, data: { failedLoginCount: count } });
        return { locked: false, justLocked: false, lockedUntil: null, count };
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  },

  async recordSuccessfulLogin(
    id: string,
    at: Date,
    ip: string | null = null,
    db: Db = prisma,
  ): Promise<User | null> {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return null;
    if (user.lockedUntil && user.lockedUntil.getTime() > at.getTime()) return null;

    const previousLoginAt = user.lastLoginAt;
    const previousLoginIp = user.lastLoginIp;

    await db.user.update({
      where: { id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: at,
        previousLoginAt,
        previousLoginIp,
        lastLoginIp: ip,
      },
    });
    return db.user.findUnique({ where: { id } });
  },
};
