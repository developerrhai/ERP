// packages/calc/src/payroll/esic.ts
// Employee State Insurance calculation (PHASE-16.md §3).

export interface EsicRateConfig {
  employeeRate: number; // e.g. 0.0075
  employerRate: number; // e.g. 0.0325
  coverageCeiling: number; // e.g. 21000
  coverageCeilingDisabled?: number; // e.g. 25000
  dailyAvgExemptLimit: number; // e.g. 176
}

export interface EsicComputeInput {
  grossWageWithoutOt: number; // For coverage test
  grossWageTotal: number; // Including OT for contribution
  paidDays: number;
  coveredAtPeriodStart?: boolean;
  isDisabled?: boolean;
  rates: EsicRateConfig;
}

export interface EsicComputeResult {
  isCovered: boolean;
  wageBase: number;
  employeeEsic: number;
  employerEsic: number;
  isDailyAvgExempt: boolean;
}

export function computeEsic(input: EsicComputeInput): EsicComputeResult {
  const r = input.rates;
  const ceiling = input.isDisabled ? (r.coverageCeilingDisabled ?? 25000) : r.coverageCeiling;

  // Coverage test: fixed gross without OT <= ceiling OR covered at start of contribution period
  const isCovered = input.coveredAtPeriodStart ?? (input.grossWageWithoutOt <= ceiling);

  if (!isCovered) {
    return {
      isCovered: false,
      wageBase: 0,
      employeeEsic: 0,
      employerEsic: 0,
      isDailyAvgExempt: false,
    };
  }

  const wageBase = input.grossWageTotal;
  const dailyAvg = input.paidDays > 0 ? wageBase / input.paidDays : 0;
  const isDailyAvgExempt = dailyAvg <= r.dailyAvgExemptLimit;

  // Round up to next rupee
  const employeeEsic = isDailyAvgExempt ? 0 : Math.ceil(wageBase * r.employeeRate);
  const employerEsic = Math.ceil(wageBase * r.employerRate);

  return {
    isCovered: true,
    wageBase,
    employeeEsic,
    employerEsic,
    isDailyAvgExempt,
  };
}

