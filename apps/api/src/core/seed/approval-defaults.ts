// Seeds the prototype approval matrix (docs/phases/PHASE-05.md §4 Seed): for each of the departments
// except Administration, one default rule set with 4 levels — L1 ₹0 Department Manager, L2 ₹50,000
// Department Head, L3 ₹2,00,000 General Manager, L4 ₹10,00,000 Director (CFO for Finance). SLA 48 h;
// each level escalates to the next level's role. Insert-if-missing only: an administrator's edits are
// never overwritten, and a department that already has a default set is left alone.
import type { PrismaClient } from '@prisma/client';

const LEVELS = [
  { level: 1, threshold: '0', role: 'DEPT_MANAGER' },
  { level: 2, threshold: '50000', role: 'DEPT_HEAD' },
  { level: 3, threshold: '200000', role: 'GENERAL_MANAGER' },
  { level: 4, threshold: '1000000', role: 'DIRECTOR' },
] as const;

export async function seedApprovalDefaults(prisma: PrismaClient): Promise<{ sets: number }> {
  const [departments, roles] = await Promise.all([
    prisma.department.findMany({ where: { name: { not: 'Administration' } } }),
    prisma.role.findMany({
      where: { code: { in: ['DEPT_MANAGER', 'DEPT_HEAD', 'GENERAL_MANAGER', 'DIRECTOR', 'CFO'] } },
    }),
  ]);
  const roleId = new Map(roles.map((r) => [r.code, r.id]));
  let sets = 0;
  for (const dept of departments) {
    const exists = await prisma.approvalRuleSet.findFirst({
      where: { departmentId: dept.id, docType: null, unitId: null },
      select: { id: true },
    });
    if (exists) continue;
    const approvers = LEVELS.map((l) =>
      l.level === 4 && dept.name === 'Finance' ? 'CFO' : l.role,
    );
    const ids = approvers.map((code) => roleId.get(code));
    if (ids.some((id) => !id)) continue; // roles not seeded yet: try again on the next boot
    await prisma.approvalRuleSet.create({
      data: {
        departmentId: dept.id,
        noAmountLevels: 1,
        rules: {
          create: LEVELS.map((l, i) => ({
            level: l.level,
            threshold: l.threshold,
            approverRoleId: ids[i] as string,
            slaHours: 48,
            escalateRoleId: i < LEVELS.length - 1 ? (ids[i + 1] as string) : null,
          })),
        },
      },
    });
    sets += 1;
  }
  return { sets };
}
