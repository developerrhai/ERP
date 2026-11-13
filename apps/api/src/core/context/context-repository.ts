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

/** Role.all_units determines if all units are accessible (Phase 02 §5.3). */
export function hasAllUnits(source: any): boolean {
  if (typeof source === 'boolean') return source;
  if (!source) return false;
  if (typeof source === 'object') {
    if (typeof source.allUnits === 'boolean') return source.allUnits;
    if (source.role && typeof source.role === 'object' && typeof source.role.allUnits === 'boolean') {
      return source.role.allUnits;
    }
  }
  return false;
}

/** Phase 23: users.all_units_access ("all plants, including future plants"). Raw SQL: the column is new. */
export async function userAllUnitsFlag(userId: string, db: Db = prisma): Promise<boolean> {
  const rows = await db.$queryRaw<{ f: boolean }[]>`SELECT all_units_access AS f FROM users WHERE id = ${userId}::uuid`;
  return rows[0]?.f === true;
}

export interface PlantPreference {
  unitIds: string[];
  remember: boolean;
}

export const contextRepository = {
  /** Phase 23: the plants the user chose to view, and whether to skip the picker. */
  async plantPreference(userId: string, db: Db = prisma): Promise<PlantPreference> {
    const rows = await db.$queryRaw<{ unit_ids: string[]; remember_plants: boolean }[]>`
      SELECT unit_ids::text[] AS unit_ids, remember_plants FROM user_preferences WHERE user_id = ${userId}::uuid`;
    return { unitIds: rows[0]?.unit_ids ?? [], remember: rows[0]?.remember_plants === true };
  },

  async savePlantPreference(
    userId: string,
    value: { unitIds: string[]; remember: boolean },
    db: Db = prisma,
  ): Promise<void> {
    await db.$executeRaw`
      INSERT INTO user_preferences (user_id, unit_ids, remember_plants, updated_at)
      VALUES (${userId}::uuid, ${value.unitIds}::uuid[], ${value.remember}, now())
      ON CONFLICT (user_id) DO UPDATE SET unit_ids = EXCLUDED.unit_ids, remember_plants = EXCLUDED.remember_plants, updated_at = now()`;
  },

  allActiveUnits(db: Db = prisma): Promise<Unit[]> {
    return db.unit.findMany({ where: { status: 'ACTIVE' }, orderBy: UNIT_ORDER });
  },

  company(db: Db = prisma) {
    return db.company.findFirst({ orderBy: { createdAt: 'asc' } });
  },

  /** ACTIVE units the user may work in. */
  async accessibleUnits(user: { id: string; allUnits?: boolean; role?: any }, db: Db = prisma): Promise<Unit[]> {
    const everything = hasAllUnits(user) || (await userAllUnitsFlag(user.id, db));
    return db.unit.findMany({
      where: everything
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
