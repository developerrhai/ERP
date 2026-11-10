// packages/calc/src/payroll/prorate.ts
// Rounding to rupee, half-up. Prorate by paid_days / calendar_days.

export function roundHalfUp(num: number): number {
  return Math.round(num);
}

export function prorate(monthly: number, paidDays: number, calendarDays: number): number {
  if (calendarDays <= 0 || paidDays <= 0) return 0;
  if (paidDays >= calendarDays) return roundHalfUp(monthly);
  return roundHalfUp((monthly * paidDays) / calendarDays);
}

