// packages/calc/src/payroll/pt-maharashtra.ts
// Maharashtra Professional Tax calculation (PHASE-16.md §3).

export interface PtSlabRow {
  gender: 'M' | 'F' | 'ALL';
  slabFrom: number;
  slabTo: number | null;
  regularAmount: number;
  februaryAmount: number;
}

export interface PtExemptionInput {
  isDisabled?: boolean; // >= 40%
  isParentOfDisabledChild?: boolean;
  age?: number; // >= 65
}

export function computePtMaharashtra(
  grossWage: number,
  gender: 'M' | 'F',
  month: number, // 1 to 12 (2 = February)
  exemptions: PtExemptionInput = {},
  slabs?: PtSlabRow[],
): number {
  if (exemptions.isDisabled || exemptions.isParentOfDisabledChild || (exemptions.age && exemptions.age >= 65)) {
    return 0;
  }

  const isFebruary = month === 2;

  // Default Maharashtra slabs
  const defaultSlabs: PtSlabRow[] = [
    { gender: 'M', slabFrom: 0, slabTo: 7500, regularAmount: 0, februaryAmount: 0 },
    { gender: 'M', slabFrom: 7501, slabTo: 10000, regularAmount: 175, februaryAmount: 175 },
    { gender: 'M', slabFrom: 10001, slabTo: null, regularAmount: 200, februaryAmount: 300 },
    { gender: 'F', slabFrom: 0, slabTo: 25000, regularAmount: 0, februaryAmount: 0 },
    { gender: 'F', slabFrom: 25001, slabTo: null, regularAmount: 200, februaryAmount: 300 },
  ];

  const activeSlabs = slabs ?? defaultSlabs;

  for (const slab of activeSlabs) {
    if (slab.gender !== 'ALL' && slab.gender !== gender) continue;
    if (grossWage >= slab.slabFrom && (slab.slabTo === null || grossWage <= slab.slabTo)) {
      return isFebruary ? slab.februaryAmount : slab.regularAmount;
    }
  }

  return 0;
}

