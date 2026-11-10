// packages/calc/src/payroll/bonus.ts
// Bonus calculation & monthly accrual (PHASE-16.md §3).

export function computeBonusMonthlyAccrual(
  monthlyWage: number,
  daysWorkedInYear: number,
  eligibilityCeiling = 21000,
  calculationFloor = 7000,
  bonusRate = 0.0833,
): { isEligible: boolean; accrualAmount: number } {
  if (monthlyWage > eligibilityCeiling || daysWorkedInYear < 30) {
    return { isEligible: false, accrualAmount: 0 };
  }

  const calculationBase = Math.min(monthlyWage, calculationFloor);
  const accrualAmount = Math.round(calculationBase * bonusRate);

  return { isEligible: true, accrualAmount };
}

