// Phase 2 seed (§2.4): the seeded content matches the contract, and running the seed again is a
// no-op that never overwrites admin edits (changed permissions, removed families, module control
// edits, letterhead) while still filling in a module-control row that is missing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { DEFAULT_LETTERHEAD, departmentCode, seedPhase2Defaults } from '../src/core/seed/defaults';
import { registry } from '../src/core/registry';
import { prisma } from './helpers';
import { restoreGlobal, snapshotGlobal } from './phase2-helpers';
import type { GlobalSnapshot } from './phase2-helpers';

let snap: GlobalSnapshot;
let salesFamilies: string[];

beforeAll(async () => {
  snap = await snapshotGlobal();
  salesFamilies = (
    await prisma.departmentFamily.findMany({ where: { departmentName: 'Sales' } })
  ).map((f) => f.family);
});

afterAll(async () => {
  await prisma.departmentFamily.createMany({
    data: salesFamilies.map((family) => ({ departmentName: 'Sales', family })),
    skipDuplicates: true,
  });
  await restoreGlobal(snap);
  invalidateAccessCache();
});

describe('seeded content', () => {
  it('11 departments with prototype codes and heads', async () => {
    const depts = await prisma.department.findMany({
      where: { name: { in: [...registry.data.departments] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(depts.map((d) => d.code)).toEqual([
      'ADMI',
      'SALE',
      'PURC',
      'FINA',
      'HR',
      'PROD',
      'QUAL',
      'MAIN',
      'WARE',
      'PROJ',
      'SERV',
    ]);
    expect(depts.every((d) => d.head === `${d.name} Head`)).toBe(true);
    expect(departmentCode('HR')).toBe('HR');
    expect(departmentCode('Administration')).toBe('ADMI');
  });

  it('role permission defaults (§2.4/§5.4) and no SUPER_USER rows', async () => {
    const roles = await prisma.role.findMany();
    const roleByCode = new Map(roles.map((r) => [r.code, r]));
    const rows = await prisma.rolePermission.findMany({
      where: { resource: '*' },
      include: { role: true },
    });
    const byRole = new Map(rows.map((r) => [r.role.code, r]));
    expect(byRole.get('ADMINISTRATOR')).toMatchObject({
      view: true,
      delete: true,
      approve: false,
      controls: true,
      scope: 'ALL',
    });
    expect(byRole.get('DEPT_MANAGER')).toMatchObject({
      delete: true,
      approve: true,
      export: true,
      controls: false,
      scope: 'DEPARTMENT',
    });
    expect(byRole.get('SUPERVISOR')).toMatchObject({
      edit: true,
      delete: false,
      approve: false,
      export: true,
      scope: 'DEPARTMENT',
    });
    expect(byRole.get('EMPLOYEE')).toMatchObject({
      view: true,
      add: true,
      edit: true,
      delete: false,
      export: false,
      scope: 'OWN',
    });
    const adminFamily = await prisma.rolePermission.findMany({
      where: { resource: 'family:Administration' },
      include: { role: true },
    });
    expect(adminFamily.every((r) => r.role.level < 95)).toBe(true);
    expect(adminFamily.every((r) => !r.view && !r.controls)).toBe(true);
    const superUserRole = roleByCode.get('SUPER_USER')!;
    await expect(
      prisma.rolePermission.create({
        data: { roleId: superUserRole.id, resource: 'family:Sales' },
      }),
    ).rejects.toThrow();
  });

  it('department families from the registry, Administration expanded to 22', async () => {
    const adm = await prisma.departmentFamily.count({
      where: { departmentName: 'Administration' },
    });
    expect(adm).toBe(22);
    expect(new Set(salesFamilies)).toEqual(new Set(registry.data.deptFamilies.Sales));
  });

  it('248 module controls and the letterhead', async () => {
    const pages = [...registry.pages.keys()];
    expect(await prisma.moduleControl.count({ where: { pageId: { in: pages } } })).toBe(248);
    const letterhead = await prisma.setting.findUnique({ where: { key: 'letterhead' } });
    expect(Object.keys(letterhead?.value as object).sort()).toEqual(
      Object.keys(DEFAULT_LETTERHEAD).sort(),
    );
  });
});

describe('idempotency', () => {
  it('a second and third run insert nothing and keep admin edits', async () => {
    const empRole = await prisma.role.findUniqueOrThrow({ where: { code: 'EMPLOYEE' } });
    const supRole = await prisma.role.findUniqueOrThrow({ where: { code: 'SUPERVISOR' } });
    await prisma.rolePermission.update({
      where: { roleId_resource: { roleId: empRole.id, resource: '*' } },
      data: { add: false },
    });
    await prisma.rolePermission.delete({
      where: { roleId_resource: { roleId: supRole.id, resource: 'family:Administration' } },
    });
    await prisma.departmentFamily.deleteMany({ where: { departmentName: 'Sales', family: 'CRM' } });
    await prisma.moduleControl.update({
      where: { pageId: 'crm-leads' },
      data: { approvalRequired: false },
    });
    await prisma.setting.update({
      where: { key: 'letterhead' },
      data: { value: { ...DEFAULT_LETTERHEAD, companyName: 'Edited Co' } },
    });
    await prisma.moduleControl.delete({ where: { pageId: 'crm-sources' } });

    const second = await seedPhase2Defaults(prisma);
    expect(second).toEqual({
      departments: 0,
      departmentFamilies: 0,
      rolePermissions: 0,
      moduleControls: 1, // the missing row is restored
      letterhead: 0,
    });
    const third = await seedPhase2Defaults(prisma);
    expect(Object.values(third).every((n) => n === 0)).toBe(true);

    expect(
      (
        await prisma.rolePermission.findUniqueOrThrow({
          where: { roleId_resource: { roleId: empRole.id, resource: '*' } },
        })
      ).add,
    ).toBe(false);
    expect(
      await prisma.rolePermission.findUnique({
        where: { roleId_resource: { roleId: supRole.id, resource: 'family:Administration' } },
      }),
    ).toBeNull();
    expect(
      await prisma.departmentFamily.count({ where: { departmentName: 'Sales', family: 'CRM' } }),
    ).toBe(0);
    expect(
      (await prisma.moduleControl.findUniqueOrThrow({ where: { pageId: 'crm-leads' } }))
        .approvalRequired,
    ).toBe(false);
    const letterhead = await prisma.setting.findUniqueOrThrow({ where: { key: 'letterhead' } });
    expect((letterhead.value as { companyName: string }).companyName).toBe('Edited Co');
    expect(
      await prisma.moduleControl.findUnique({ where: { pageId: 'crm-sources' } }),
    ).not.toBeNull();
  });
});
