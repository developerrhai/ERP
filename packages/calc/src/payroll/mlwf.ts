// packages/calc/src/payroll/mlwf.ts
// Maharashtra Labour Welfare Fund (MLWF) - June (month 6) and December (month 12) only.

export function computeMlwf(
  month: number,
  employeeRate = 25,
  employerRate = 75,
): { employeeMlwf: number; employerMlwf: number } {
  if (month === 6 || month === 12) {
    return {
      employeeMlwf: employeeRate,
      employerMlwf: employerRate,
    };
  }
  return { employeeMlwf: 0, employerMlwf: 0 };
}

