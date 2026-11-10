// packages/calc/src/payroll/code-wage.ts
// Code on Wages (in force 21-Nov-2025): 50% rule for excluded components.

export interface ComponentAmount {
  code: string;
  amount: number;
  codeWageClass: 'INCLUDED' | 'EXCLUDED';
}

export function computeCodeWageAddBack(components: ComponentAmount[]): {
  totalPay: number;
  includedSum: number;
  excludedSum: number;
  threshold50Pct: number;
  addBackAmount: number;
  codeWages: number;
} {
  let totalPay = 0;
  let includedSum = 0;
  let excludedSum = 0;

  for (const c of components) {
    totalPay += c.amount;
    if (c.codeWageClass === 'INCLUDED') {
      includedSum += c.amount;
    } else {
      excludedSum += c.amount;
    }
  }

  const threshold50Pct = totalPay * 0.5;
  const addBackAmount = Math.max(0, excludedSum - threshold50Pct);
  const codeWages = includedSum + addBackAmount;

  return {
    totalPay,
    includedSum,
    excludedSum,
    threshold50Pct,
    addBackAmount,
    codeWages,
  };
}

