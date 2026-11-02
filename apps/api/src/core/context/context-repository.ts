// The reads the working context needs (Phase 3 §A2): the single company, the units a user may work
// in, financial years and the saved preference. Kept apart so the middleware and /me/context share
// exactly the same queries.
import type { FinancialYear, Prisma, Unit, UserPreference } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { Db } from '../db/prisma';
import { hasMinRole } from '../rbac/role-rules';
import type { RoleCode } from '../rbac/role-rules';

/** Unit Master order: creation order (the 3 seeded units first, TAL, SAW, VAR), then code. */
export const UNIT_ORDER: Prisma.UnitOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { code: 'asc' },
];

/** Newest year first. */
export const FY_ORDER: Prisma.FinancialYearOrderByWithRelationInput[] = [{ startDate: 'desc' }];

/** ADMIN and SUPER_ADMIN implicitly have every unit and may choose "All units". */
export function hasAllUnits(role: RoleCode): boolean {
  return hasMinRole(role, 'ADMIN');
}

export const contextRepository = {
  company(db: Db = prisma) {
    return db.company.findFirst({ orderBy: { createdAt: 'asc' } });
  },

  /** ACTIVE units the user may work in. */
  accessibleUnits(user: { id: string; role: RoleCode }, db: Db = prisma): Promise<Unit[]> {
    return db.unit.findMany({
      where: hasAllUnits(user.role)
        ? { status: 'ACTIVE' }
        : { status: 'ACTIVE', userUnits: { some: { userId: user.id } } },
      orderBy: UNIT_ORDER,
    });
  },

  unitById(id: string, db: Db = prisma): Promise<Unit | null> {
    return db.unit.findUnique({ where: { id } });
  },

  async hasUnitRow(userId: string, unitId: string, db: Db = prisma): Promise<boolean> {
    return (await db.userUnit.count({ where: { userId, unitId } })) > 0;
  },

  fyById(id: string, db: Db = prisma): Promise<FinancialYear | null> {
    return db.financialYear.findUnique({ where: { id } });
  },

  /** The current year, else the newest open one, else the newest one. */
  async defaultFy(db: Db = prisma): Promise<FinancialYear | null> {
    return (
      (await db.financialYear.findFirst({ where: { isCurrent: true } })) ??
      (await db.financialYear.findFirst({ where: { status: 'OPEN' }, orderBy: FY_ORDER })) ??
      (await db.financialYear.findFirst({ orderBy: FY_ORDER }))
    );
  },

  allFys(db: Db = prisma): Promise<FinancialYear[]> {
    return db.financialYear.findMany({ orderBy: FY_ORDER });
  },

  preference(userId: string, db: Db = prisma): Promise<UserPreference | null> {
    return db.userPreference.findUnique({ where: { userId } });
  },

  savePreference(
    userId: string,
    value: { unitId: string | null; allUnits: boolean; fyId: string },
    db: Db = prisma,
  ): Promise<UserPreference> {
    return db.userPreference.upsert({
      where: { userId },
      create: { userId, ...value },
      update: value,
    });
  },
};
