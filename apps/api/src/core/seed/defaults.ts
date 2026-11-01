// Idempotent Phase 2 seed (CONTRACT §2.4): departments, department families, role permissions,
// module controls and the letterhead. It only inserts what is missing and never overwrites admin
// edits. Categories an admin can shrink (departments, families, permission rows) are applied once
// and recorded under the internal setting `system.seed`, so a re-run never re-adds deleted rows.
import type { Prisma, PrismaClient } from '@prisma/client';
import { DEPARTMENTS } from '../departments';
import {
  DEFAULT_RESOURCE,
  DEFAULT_ROLE_ROWS,
  PERMISSION_ROLES,
  familyResource,
  noActions,
} from '../rbac/permission-model';
import { ADMIN_FAMILY, defaultDepartmentFamilies, registry } from '../registry';

export const SEED_STATE_KEY = 'system.seed';
export const LETTERHEAD_KEY = 'letterhead';

type SeedCategory = 'departments' | 'departmentFamilies' | 'rolePermissions';

/** Prototype ownerDept(): which department owns each family's modules. */
export const OWNER_DEPARTMENT_BY_FAMILY: Readonly<Record<string, string>> = {
  CRM: 'Sales',
  Sales: 'Sales',
  'Procurement / SCM': 'Purchase',
  Inventory: 'Warehouse',
  'Warehouse / WMS': 'Warehouse',
  'Logistics / Fleet': 'Warehouse',
  Manufacturing: 'Production',
  'Quality / QMS': 'Quality',
  Maintenance: 'Maintenance',
  Assets: 'Maintenance',
  'Finance & Accounts': 'Finance',
  'Indian Taxation': 'Finance',
  HRMS: 'HR',
  Payroll: 'HR',
  Projects: 'Projects',
  'Service / Support': 'Service',
};

/** Families whose modules do not require approval by default (prototype ctrl()). */
export const NO_APPROVAL_FAMILIES: ReadonlySet<string> = new Set([
  'Executive',
  'Business Intelligence',
  'AI & Automation',
  'Administration',
  'Document Management',
]);

export const DEFAULT_LETTERHEAD = {
  companyName: 'RHAI Industries Pvt. Ltd.',
  legalName: 'RHAI Industries Pvt. Ltd.',
  address: 'Configure registered address in System Settings',
  phone: '',
  email: '',
  website: '',
  gstin: '',
  pan: '',
  cin: '',
  footer: 'System-generated document from RHAI Enterprise ERP',
  signatory: 'Authorized Signatory',
};

/** Prototype department code: first 4 letters upper case ("HR" stays "HR"). */
export function departmentCode(name: string): string {
  return name
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase();
}

export interface SeedReport {
  departments: number;
  departmentFamilies: number;
  rolePermissions: number;
  moduleControls: number;
  letterhead: number;
}

async function appliedCategories(db: PrismaClient): Promise<Set<SeedCategory>> {
  const row = await db.setting.findUnique({ where: { key: SEED_STATE_KEY } });
  const value = row?.value as { applied?: unknown } | undefined;
  const applied = Array.isArray(value?.applied) ? (value.applied as SeedCategory[]) : [];
  return new Set(applied);
}

async function markApplied(db: PrismaClient, applied: Set<SeedCategory>): Promise<void> {
  const value: Prisma.InputJsonObject = { applied: [...applied].sort() };
  await db.setting.upsert({
    where: { key: SEED_STATE_KEY },
    create: { key: SEED_STATE_KEY, value },
    update: { value },
  });
}

export async function seedPhase2Defaults(db: PrismaClient): Promise<SeedReport> {
  const report: SeedReport = {
    departments: 0,
    departmentFamilies: 0,
    rolePermissions: 0,
    moduleControls: 0,
    letterhead: 0,
  };
  const applied = await appliedCategories(db);

  if (!applied.has('departments')) {
    const base = Date.now();
    const result = await db.department.createMany({
      data: DEPARTMENTS.map((name, i) => ({
        name,
        code: departmentCode(name),
        head: `${name} Head`,
        createdAt: new Date(base + i),
      })),
      skipDuplicates: true,
    });
    report.departments = result.count;
    applied.add('departments');
  }

  if (!applied.has('departmentFamilies')) {
    const existing = new Set(
      (await db.department.findMany({ select: { name: true } })).map((d) => d.name),
    );
    const rows = DEPARTMENTS.filter((d) => existing.has(d)).flatMap((department) =>
      defaultDepartmentFamilies(department).map((family) => ({
        departmentName: department,
        family,
      })),
    );
    report.departmentFamilies = (
      await db.departmentFamily.createMany({ data: rows, skipDuplicates: true })
    ).count;
    applied.add('departmentFamilies');
  }

  if (!applied.has('rolePermissions')) {
    const rows: Prisma.RolePermissionCreateManyInput[] = [];
    for (const role of PERMISSION_ROLES) {
      rows.push({ role, resource: DEFAULT_RESOURCE, ...DEFAULT_ROLE_ROWS[role] });
      if (role !== 'ADMIN') {
        rows.push({ role, resource: familyResource(ADMIN_FAMILY), ...noActions(), scope: 'OWN' });
      }
    }
    report.rolePermissions = (
      await db.rolePermission.createMany({ data: rows, skipDuplicates: true })
    ).count;
    applied.add('rolePermissions');
  }

  // Module controls and the letterhead cannot be deleted through the API, so "insert what is
  // missing" is always safe: it also picks up pages added to the registry later.
  const departments = new Set(
    (await db.department.findMany({ select: { name: true } })).map((d) => d.name),
  );
  const controls: Prisma.ModuleControlCreateManyInput[] = [];
  for (const page of registry.pages.values()) {
    const wanted = OWNER_DEPARTMENT_BY_FAMILY[page.family] ?? 'Administration';
    const owner = departments.has(wanted) ? wanted : 'Administration';
    if (!departments.has(owner)) continue;
    controls.push({
      pageId: page.id,
      ownerDepartment: owner,
      approvalRequired: !NO_APPROVAL_FAMILIES.has(page.family),
    });
  }
  report.moduleControls = (
    await db.moduleControl.createMany({ data: controls, skipDuplicates: true })
  ).count;

  const letterhead = await db.setting.createMany({
    data: [{ key: LETTERHEAD_KEY, value: DEFAULT_LETTERHEAD }],
    skipDuplicates: true,
  });
  report.letterhead = letterhead.count;

  await markApplied(db, applied);
  return report;
}
