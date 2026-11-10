// packages/calc/src/payroll/pf.ts
// Provident Fund calculation (PHASE-16.md §3). Rates and ceilings from statutory data rows.

export interface PfRateConfig {
  employeeRate: number; // e.g. 0.12
  employerTotalRate: number; // e.g. 0.12
  epsRate: number; // e.g. 0.0833
  edliRate: number; // e.g. 0.005
  adminRate: number; // e.g. 0.005
  adminMinAmount: number; // e.g. 500
  wageCeiling: number; // e.g. 15000
  epsMaxAmount: number; // e.g. 1250
}

export interface PfComputeInput {
  pfWages: number; // Code Wages
  restrictToCeiling?: boolean; // default true
  vpfAmount?: number;
  age?: number;
  isEpsExcluded?: boolean; // joined after 1-Sep-2014 above 15k
  rates: PfRateConfig;
}

export interface PfComputeResult {
  wageBase: number;
  employeePf: number;
  vpfAmount: number;
  employeeTotal: number;
  employerEps: number;
  employerEpf: number;
  employerTotal: number;
  edliWage: number;
  edliAmount: number;
}

export function computePf(input: PfComputeInput): PfComputeResult {
  const r = input.rates;
  const restrict = input.restrictToCeiling ?? true;

  const wageBase = restrict ? Math.min(input.pfWages, r.wageCeiling) : input.pfWages;
  const employeePf = Math.round(wageBase * r.employeeRate);
  const vpfAmount = Math.max(0, input.vpfAmount ?? 0);
  const employeeTotal = employeePf + vpfAmount;

  const employerTotal = Math.round(wageBase * r.employerTotalRate);

  const stopsEps = (input.age !== undefined && input.age >= 58) || !!input.isEpsExcluded;

  let employerEps = 0;
  if (!stopsEps) {
    const epsBase = Math.min(input.pfWages, r.wageCeiling);
    employerEps = Math.min(Math.round(epsBase * r.epsRate), r.epsMaxAmount);
  }

  const employerEpf = employerTotal - employerEps;

  const edliWage = Math.min(input.pfWages, r.wageCeiling);
  const edliAmount = Math.round(edliWage * r.edliRate);

  return {
    wageBase,
    employeePf,
    vpfAmount,
    employeeTotal,
    employerEps,
    employerEpf,
    employerTotal,
    edliWage,
    edliAmount,
  };
}

