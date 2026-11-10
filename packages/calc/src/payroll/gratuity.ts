// packages/calc/src/payroll/gratuity.ts
// Gratuity monthly provision & settlement payable (PHASE-16.md §3).

export function computeGratuityMonthlyProvision(
  earnedBasicPlusDa: number,
  provisionRate = 0.048077,
): number {
  if (earnedBasicPlusDa <= 0) return 0;
  return Math.round(earnedBasicPlusDa * provisionRate);
}

export function computeGratuityPayable(
  lastDrawnBasicPlusDa: number,
  completedYears: number,
  monthsBeyondYears = 0,
  isFixedTerm = false,
  gratuityCap = 2000000,
): { isEligible: boolean; payableAmount: number } {
  // Eligibility: 5 years for permanent, 1 year for fixed-term
  const minYears = isFixedTerm ? 1 : 5;
  const effectiveYears = monthsBeyondYears > 6 ? completedYears + 1 : completedYears;

  if (effectiveYears < minYears) {
    return { isEligible: false, payableAmount: 0 };
  }

  // Formula: last wage * 15 / 26 * effective years
  const raw = (lastDrawnBasicPlusDa * 15 * effectiveYears) / 26;
  const payableAmount = Math.min(Math.round(raw), gratuityCap);

  return { isEligible: true, payableAmount };
}

