// packages/calc/src/payroll/ot-amount.ts
// Overtime calculation: (Basic + DA) / 26 / 8 * multiplier * hours (PHASE-16.md §3).

export function computeOtAmount(
  basicPlusDa: number,
  hours: number,
  multiplier = 2.0,
): number {
  if (hours <= 0 || basicPlusDa <= 0) return 0;
  const ratePerHour = (basicPlusDa / (26 * 8)) * multiplier;
  return Math.round(ratePerHour * hours);
}

