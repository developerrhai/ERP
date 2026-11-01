// The only code that touches the users table (PLAN §6.3 layering). Used by the users service and
// by the auth service for credential lookups and lockout counters.
import type { Prisma, Role, User } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import type { ListUsersQuery, UserSort } from './schemas';

function orderByFor(sort: UserSort): Prisma.UserOrderByWithRelationInput[] {
  const desc = sort.startsWith('-');
  const field = (desc ? sort.slice(1) : sort) as
    | 'name'
    | 'loginId'
    | 'createdAt'
    | 'lastLoginAt'
    | 'role'
    | 'department';
  const direction: Prisma.SortOrder = desc ? 'desc' : 'asc';
  const primary: Prisma.UserOrderByWithRelationInput =
    field === 'lastLoginAt' || field === 'department'
      ? { [field]: { sort: direction, nulls: 'last' } }
      : { [field]: direction };
  // A unique tiebreaker keeps pagination stable.
  return [primary, { id: 'asc' }];
}

function whereFor(query: ListUsersQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;
  if (query.department) where.department = query.department;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { loginId: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  return where;
}

export const userRepository = {
  findById(id: string, db: Db = prisma): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  },

  /** identifier is already lowercased; loginId wins over email if both could match. */
  async findByIdentifier(identifier: string, db: Db = prisma): Promise<User | null> {
    return (
      (await db.user.findUnique({ where: { loginId: identifier } })) ??
      (await db.user.findUnique({ where: { email: identifier } }))
    );
  },

  /**
   * Users whose loginId or email collides with the given values. loginId and email share one
   * namespace because login accepts either, so a loginId may not equal anyone's email and vice versa.
   */
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

  async list(query: ListUsersQuery, db: Db = prisma): Promise<{ users: User[]; total: number }> {
    const where = whereFor(query);
    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
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

  /**
   * Optimistic-lock update: applies only if the row is still at `version` AND still has the role the
   * permission check was made against. Bumps the version.
   */
  async updateIfVersion(
    id: string,
    version: number,
    expectedRole: Role,
    data: Prisma.UserUncheckedUpdateManyInput,
    db: Db = prisma,
  ): Promise<boolean> {
    const result = await db.user.updateMany({
      where: { id, version, role: expectedRole },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count === 1;
  },

  /** Unconditional update that still bumps the version (password changes). */
  update(id: string, data: Prisma.UserUncheckedUpdateInput, db: Db = prisma): Promise<User> {
    return db.user.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },

  /**
   * Counts one failed password atomically (row lock), and locks the account when the count reaches
   * `maxFailures`. While a lock is active nothing is counted, so concurrent attempts cannot push past
   * the threshold or extend the lock. Decided after the Argon2 verify, inside one transaction.
   */
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

  /**
   * Records a successful login only if the account is not locked (an active lock is never cleared
   * by a correct password). Returns null when locked.
   */
  async recordSuccessfulLogin(id: string, at: Date, db: Db = prisma): Promise<User | null> {
    const result = await db.user.updateMany({
      where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: at } }] },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    });
    if (result.count !== 1) return null;
    return db.user.findUnique({ where: { id } });
  },
};
