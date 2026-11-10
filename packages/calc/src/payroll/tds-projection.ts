// packages/calc/src/payroll/tds-projection.ts
// Salary TDS Annual Projection & Monthly Deduction (PHASE-16.md §3 & §5).

export interface TaxSlab {
  from: number;
  to: number | null;
  rate: number;
}

export interface TdsProjectionInput {
  ytdTaxableGross: number; // Taxable gross earned so far
  currentMonthTaxableGross: number; // Current month earned
  remainingMonths: number; // Including current month (e.g. 2 in February)
  currentMonthlyRegularGross: number; // For projecting remaining months
  previousEmployerIncome?: number;
  standardDeduction?: number; // default 75000
  rebateLimit?: number; // default 1200000
  rebateMaxAmount?: number; // default 60000
  tdsDeductedToDate: number; // TDS paid from April through last month
  cessRate?: number; // default 0.04
}

export interface TdsProjectionResult {
  projectedAnnualGross: number;
  standardDeduction: number;
  taxableIncome: number;
  basicTax: number;
  rebate: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalAnnualTax: number;
  tdsDeductedToDate: number;
  remainingTax: number;
  currentMonthTds: number;
}

export function computeAnnualTaxNewRegime(taxableIncome: number): {
  basicTax: number;
  rebate: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalTax: number;
} {
  if (taxableIncome <= 0) {
    return { basicTax: 0, rebate: 0, taxAfterRebate: 0, surcharge: 0, cess: 0, totalTax: 0 };
  }

  // Slabs: 0-4L nil; 4-8L 5%; 8-12L 10%; 12-16L 15%; 16-20L 20%; 20-24L 25%; >24L 30%
  const slabs: TaxSlab[] = [
    { from: 0, to: 400000, rate: 0.00 },
    { from: 400000, to: 800000, rate: 0.05 },
    { from: 800000, to: 1200000, rate: 0.10 },
    { from: 1200000, to: 1600000, rate: 0.15 },
    { from: 1600000, to: 2000000, rate: 0.20 },
    { from: 2000000, to: 2400000, rate: 0.25 },
    { from: 2400000, to: null, rate: 0.30 },
  ];

  let rawTax = 0;
  for (const s of slabs) {
    if (taxableIncome > s.from) {
      const taxableInSlab = s.to === null ? taxableIncome - s.from : Math.min(taxableIncome, s.to) - s.from;
      rawTax += taxableInSlab * s.rate;
    }
  }

  let rebate = 0;
  let taxAfterRebate = rawTax;

  if (taxableIncome <= 1200000) {
    rebate = rawTax; // Full rebate up to ₹60,000
    taxAfterRebate = 0;
  } else {
    // Marginal relief for income just above 12L:
    // Tax cannot exceed the income exceeding 12L
    const excessIncome = taxableIncome - 1200000;
    if (rawTax > excessIncome) {
      rebate = rawTax - excessIncome;
      taxAfterRebate = excessIncome;
    }
  }

  // Surcharge
  let surchargeRate = 0;
  if (taxableIncome > 20000000) surchargeRate = 0.25;
  else if (taxableIncome > 10000000) surchargeRate = 0.15;
  else if (taxableIncome > 5000000) surchargeRate = 0.10;

  let surcharge = taxAfterRebate * surchargeRate;

  // Surcharge marginal relief for > 50L
  if (taxableIncome > 5000000 && taxableIncome <= 5100000) {
    // Tax + surcharge cannot exceed tax at 50L + (income - 50L)
    const { totalTax: taxAt50L } = computeAnnualTaxNewRegime(5000000);
    const maxAllowed = taxAt50L + (taxableIncome - 5000000);
    if (taxAfterRebate + surcharge > maxAllowed) {
      surcharge = Math.max(0, maxAllowed - taxAfterRebate);
    }
  }

  const cess = Math.round((taxAfterRebate + surcharge) * 0.04);
  const totalTax = Math.round(taxAfterRebate + surcharge + cess);

  return {
    basicTax: Math.round(rawTax),
    rebate: Math.round(rebate),
    taxAfterRebate: Math.round(taxAfterRebate),
    surcharge: Math.round(surcharge),
    cess,
    totalTax,
  };
}

export function computeTdsProjection(input: TdsProjectionInput): TdsProjectionResult {
  const stdDeduction = input.standardDeduction ?? 75000;
  const futureMonths = Math.max(0, input.remainingMonths - 1);

  const projectedGross =
    input.ytdTaxableGross +
    input.currentMonthTaxableGross +
    futureMonths * input.currentMonthlyRegularGross +
    (input.previousEmployerIncome ?? 0);

  const taxableIncome = Math.max(0, projectedGross - stdDeduction);
  const tax = computeAnnualTaxNewRegime(taxableIncome);

  const remainingTax = Math.max(0, tax.totalTax - input.tdsDeductedToDate);
  const currentMonthTds = input.remainingMonths > 0 ? Math.round(remainingTax / input.remainingMonths) : 0;

  return {
    projectedAnnualGross: projectedGross,
    standardDeduction: stdDeduction,
    taxableIncome,
    basicTax: tax.basicTax,
    rebate: tax.rebate,
    taxAfterRebate: tax.taxAfterRebate,
    surcharge: tax.surcharge,
    cess: tax.cess,
    totalAnnualTax: tax.totalTax,
    tdsDeductedToDate: input.tdsDeductedToDate,
    remainingTax,
    currentMonthTds,
  };
}

