// Phase 3 test helpers: snapshot/restore of the shared company / units / financial-years rows (so a
// test that renames, deactivates, adds or closes one leaves the DB as it found it), lookups by code,
// and a small client for the context headers.
import type { Company, FinancialYear, Unit } from '@prisma/client';
import { invalidateAccessCache } from '../src/core/rbac/access';
import { prisma } from './helpers';

export interface Phase3Snapshot {
  company: Company[];
  units: Unit[];
  fys: FinancialYear[];
}

export async function snapshotPhase3(): Promise<Phase3Snapshot> {
  const [company, units, fys] = await Promise.all([
    prisma.company.findMany(),
    prisma.unit.findMany(),
    prisma.financialYear.findMany(),
  ]);
  return { company, units, fys };
}

export async function restorePhase3(snap: Phase3Snapshot): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const keepUnits = snap.units.map((u) => u.id);
    const extraUnits = (
      await tx.unit.findMany({ where: { id: { notIn: keepUnits } }, select: { id: true } })
    ).map((u) => u.id);
    if (extraUnits.length > 0) {
      await tx.userUnit.deleteMany({ where: { unitId: { in: extraUnits } } });
      await tx.user.updateMany({
        where: { defaultUnitId: { in: extraUnits } },
        data: { defaultUnitId: null },
      });
      await tx.unit.deleteMany({ where: { id: { in: extraUnits } } });
    }
    // Free the unique names / codes first, then put every seeded unit back as it was.
    for (const u of snap.units) {
      await tx.unit.update({
        where: { id: u.id },
        data: { code: `Z${u.code}`.slice(0, 10), name: `~${u.id}` },
      });
    }
    for (const u of snap.units) await tx.unit.update({ where: { id: u.id }, data: u });

    const keepFys = snap.fys.map((f) => f.id);
    await tx.financialYear.deleteMany({ where: { id: { notIn: keepFys } } });
    await tx.financialYear.updateMany({ data: { isCurrent: false, status: 'OPEN' } });
    for (const f of [...snap.fys].sort((a, b) => Number(a.isCurrent) - Number(b.isCurrent))) {
      await tx.financialYear.update({ where: { id: f.id }, data: f });
    }
    for (const c of snap.company) await tx.company.update({ where: { id: c.id }, data: c });
  });
  invalidateAccessCache();
}

export async function unitByCode(code: string): Promise<Unit> {
  return prisma.unit.findUniqueOrThrow({ where: { code } });
}

export async function fyByCode(code: string): Promise<FinancialYear> {
  return prisma.financialYear.findUniqueOrThrow({ where: { code } });
}

/** A fresh unit (unique code / name) so tests never have to mutate the 3 seeded ones. */
export async function makeUnit(status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): Promise<Unit> {
  const suffix = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X');
  return prisma.unit.create({ data: { code: `U${suffix}`, name: `Unit ${suffix}`, status } });
}

/** X-Unit-Id / X-FY-Id headers (undefined values are left out). */
export function ctxHeaders(unit?: string, fy?: string): Record<string, string> {
  return {
    ...(unit !== undefined ? { 'X-Unit-Id': unit } : {}),
    ...(fy !== undefined ? { 'X-FY-Id': fy } : {}),
  };
}
