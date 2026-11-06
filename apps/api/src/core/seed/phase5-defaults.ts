// Idempotent Inventory-slice seed (docs/phase3-4 C1): one Main Store warehouse per seeded unit
// (TAL-MAIN, SAW-MAIN, VAR-MAIN). Insert-if-missing by code, never an update; applied once and then
// recorded in `system.seed`, so a warehouse an admin deleted is not re-created. The migration inserts
// the same rows on a database that already has users; a fresh database gets them here, attributed to
// the Super Admin, so this runs after the Super Admin exists (it does nothing before that).
import type { Prisma, PrismaClient } from '@prisma/client';
import { SEED_STATE_KEY } from './defaults';

export const DEFAULT_WAREHOUSES = [
  { code: 'TAL-MAIN', name: 'Talwade Main Store', unitCode: 'TAL' },
  { code: 'SAW-MAIN', name: 'Sawardari Main Store', unitCode: 'SAW' },
  { code: 'VAR-MAIN', name: 'Varale Main Store', unitCode: 'VAR' },
] as const;

export interface Phase5SeedReport {
  warehouses: number;
}

export async function seedPhase5Defaults(db: PrismaClient): Promise<Phase5SeedReport> {
  const report: Phase5SeedReport = { warehouses: 0 };
  const row = await db.setting.findUnique({ where: { key: SEED_STATE_KEY } });
  const value = row?.value as { applied?: unknown } | undefined;
  const applied = new Set(Array.isArray(value?.applied) ? (value.applied as string[]) : []);
  if (applied.has('warehouses')) return report;

  const owner =
    (await db.user.findFirst({ where: { role: { code: 'SUPER_USER' } } })) ??
    (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!owner) return report;
  const units = new Map((await db.unit.findMany()).map((u) => [u.code, u.id]));
  const data = DEFAULT_WAREHOUSES.flatMap((w) => {
    const unitId = units.get(w.unitCode);
    return unitId ? [{ code: w.code, name: w.name, unitId, createdById: owner.id }] : [];
  });
  report.warehouses = (await db.warehouse.createMany({ data, skipDuplicates: true })).count;
  // Only mark it applied when every unit was there; otherwise a later run fills the gap.
  if (data.length === DEFAULT_WAREHOUSES.length) {
    applied.add('warehouses');
    const next: Prisma.InputJsonObject = { applied: [...applied].sort() };
    await db.setting.upsert({
      where: { key: SEED_STATE_KEY },
      create: { key: SEED_STATE_KEY, value: next },
      update: { value: next },
    });
  }
  return report;
}
