// The only users query Role Master needs: how many users hold each role.
import { prisma } from '../../core/db/prisma';
import type { RoleCode } from '../../core/rbac/role-rules';

export const roleRepository = {
  async userCountsByRole(): Promise<Map<RoleCode, number>> {
    const rows = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });
    return new Map(rows.map((r) => [r.role, r._count._all]));
  },
};
