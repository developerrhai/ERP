// Idempotent Phase 3 seed (docs/phase3-4 Stage A): the single company, the units TAL / SAW / VAR and
// FY 2025-26 / 2026-27 (2026-27 current). Insert-if-missing only, never an update. Units and years
// can be deleted / changed by an admin, so they are applied once (recorded in `system.seed`); the
// company cannot be deleted, so it is checked on every run. The migration inserts the same rows.
import type { Prisma, PrismaClient } from '@prisma/client';
import { fyCode, fyDates, fyLabel } from '../../modules/financial-years/fy-rules';
import { SEED_STATE_KEY } from './defaults';

type Phase3Category = 'units' | 'financialYears';

export const DEFAULT_COMPANY = {
  code: 'SAWANT',
  legalName: 'Sawant Group (Ready Hand)',
  tradeName: 'Sawant Group',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
} as const;

/** Prototype order: Unit 1, 2, 3. */
export const DEFAULT_UNITS = [
  { code: 'TAL', name: 'Talwade' },
  { code: 'SAW', name: 'Sawardari' },
  { code: 'VAR', name: 'Varale' },
] as const;

/** Start years of the seeded financial years; the last one is current. */
export const DEFAULT_FY_START_YEARS = [2025, 2026] as const;
export const CURRENT_FY_START_YEAR = 2026;

export interface Phase3SeedReport {
  company: number;
  units: number;
  financialYears: number;
}

async function readApplied(db: PrismaClient): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: SEED_STATE_KEY } });
  const value = row?.value as { applied?: unknown } | undefined;
  return Array.isArray(value?.applied) ? (value.applied as string[]) : [];
}

async function writeApplied(db: PrismaClient, applied: Set<string>): Promise<void> {
  const value: Prisma.InputJsonObject = { applied: [...applied].sort() };
  await db.setting.upsert({
    where: { key: SEED_STATE_KEY },
    create: { key: SEED_STATE_KEY, value },
    update: { value },
  });
}

export async function seedPhase3Defaults(db: PrismaClient): Promise<Phase3SeedReport> {
  const report: Phase3SeedReport = { company: 0, units: 0, financialYears: 0 };

  if ((await db.company.count()) === 0) {
    await db.company.create({ data: { ...DEFAULT_COMPANY } });
    report.company = 1;
  }

  const applied = new Set(await readApplied(db));
  const mark = (category: Phase3Category) => applied.add(category);

  if (!applied.has('units')) {
    const base = Date.now();
    report.units = (
      await db.unit.createMany({
        data: DEFAULT_UNITS.map((u, i) => ({ ...u, createdAt: new Date(base + i) })),
        skipDuplicates: true,
      })
    ).count;
    mark('units');
  }

  if (!applied.has('financialYears')) {
    const hasCurrent = (await db.financialYear.count({ where: { isCurrent: true } })) > 0;
    report.financialYears = (
      await db.financialYear.createMany({
        data: DEFAULT_FY_START_YEARS.map((year) => ({
          code: fyCode(year),
          label: fyLabel(year),
          ...fyDates(year),
          isCurrent: !hasCurrent && year === CURRENT_FY_START_YEAR,
        })),
        skipDuplicates: true,
      })
    ).count;
    mark('financialYears');
  }

  await writeApplied(db, applied);
  return report;
}
