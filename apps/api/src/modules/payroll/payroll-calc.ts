/**
 * Pure payroll calculation engine (CommonJS for apps/api).
 * Exact parity with packages/calc/src/payroll.
 */

export function roundHalfUp(val: number): number {
  return Math.round(val + (val >= 0 ? 0.00000001 : -0.00000001));
}

export function prorateComponent(monthlyAmount: number, paidDays: number, calendarDays: number): number {
  if (calendarDays <= 0) return 0;
  if (paidDays >= calendarDays) return roundHalfUp(monthlyAmount);
  if (paidDays <= 0) return 0;
  return roundHalfUp((monthlyAmount * paidDays) / calendarDays);
}

// Safe Formula Evaluator (No eval)
export function evalFormula(formulaStr: string, context: Record<string, number>): number {
  let pos = 0;
  const str = formulaStr.trim();

  function peek(): string {
    while (pos < str.length && /\s/.test(str[pos] ?? '')) pos++;
    return pos < str.length ? (str[pos] ?? '') : '';
  }

  function getChar(): string {
    const ch = peek();
    pos++;
    return ch;
  }

  function parseExpression(): number {
    return parseComparison();
  }

  function parseComparison(): number {
    let left = parseAddSub();
    while (true) {
      const p = peek();
      if (p === '>' || p === '<' || p === '=' || p === '!') {
        let op = getChar();
        if (peek() === '=') {
          op += getChar();
        }
        const right = parseAddSub();
        if (op === '>') left = left > right ? 1 : 0;
        else if (op === '<') left = left < right ? 1 : 0;
        else if (op === '>=') left = left >= right ? 1 : 0;
        else if (op === '<=') left = left <= right ? 1 : 0;
        else if (op === '==' || op === '=') left = left === right ? 1 : 0;
        else if (op === '!=') left = left !== right ? 1 : 0;
      } else {
        break;
      }
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (true) {
      const p = peek();
      if (p === '+' || p === '-') {
        const op = getChar();
        const right = parseMulDiv();
        left = op === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parsePrimary();
    while (true) {
      const p = peek();
      if (p === '*' || p === '/') {
        const op = getChar();
        const right = parsePrimary();
        left = op === '*' ? left * right : right === 0 ? 0 : left / right;
      } else {
        break;
      }
    }
    return left;
  }

  function parsePrimary(): number {
    const p = peek();
    if (p === '-') {
      getChar();
      return -parsePrimary();
    }
    if (p === '+') {
      getChar();
      return parsePrimary();
    }
    if (p === '(') {
      getChar(); // '('
      const val = parseExpression();
      if (peek() === ')') getChar();
      return val;
    }
    if (/\d/.test(p)) {
      let numStr = '';
      while (pos < str.length && /[\d.]/.test(str[pos] ?? '')) {
        numStr += str[pos++] ?? '';
      }
      return parseFloat(numStr);
    }
    if (/[a-zA-Z_]/.test(p)) {
      let ident = '';
      while (pos < str.length && /[a-zA-Z0-9_]/.test(str[pos] ?? '')) {
        ident += str[pos++] ?? '';
      }
      if (peek() === '(') {
        // Function call: min, max, round, if
        getChar(); // '('
        const args: number[] = [];
        if (peek() !== ')') {
          while (true) {
            args.push(parseExpression());
            if (peek() === ',') {
              getChar();
            } else {
              break;
            }
          }
        }
        if (peek() === ')') getChar();

        const fn = ident.toLowerCase();
        if (fn === 'min') return Math.min(...args);
        if (fn === 'max') return Math.max(...args);
        if (fn === 'round') return roundHalfUp(args[0] ?? 0);
        if (fn === 'if') return (args[0] ?? 0) !== 0 ? (args[1] ?? 0) : (args[2] ?? 0);
        return 0;
      } else {
        return context[ident] ?? context[ident.toUpperCase()] ?? 0;
      }
    }
    return 0;
  }

  return parseExpression();
}

// Code on Wages 50% Add-Back
export interface ComponentInput {
  code: string;
  amount: number;
  code_wage_class: 'INCLUDED' | 'EXCLUDED';
}

export function calculateCodeWage(components: ComponentInput[]): {
  totalGross: number;
  totalIncluded: number;
  totalExcluded: number;
  fiftyPercentLimit: number;
  addBackAmount: number;
  finalWage: number;
} {
  let totalIncluded = 0;
  let totalExcluded = 0;

  for (const c of components) {
    if (c.code_wage_class === 'INCLUDED') {
      totalIncluded += c.amount;
    } else {
      totalExcluded += c.amount;
    }
  }

  const totalGross = totalIncluded + totalExcluded;
  const fiftyPercentLimit = totalGross * 0.5;
  const excessExcluded = totalExcluded - fiftyPercentLimit;
  const addBackAmount = excessExcluded > 0 ? roundHalfUp(excessExcluded) : 0;
  const finalWage = totalIncluded + addBackAmount;

  return {
    totalGross,
    totalIncluded,
    totalExcluded,
    fiftyPercentLimit,
    addBackAmount,
    finalWage,
  };
}

// PF Calculation
export function calculatePF(params: {
  pfWage: number;
  isRestrictedToCeiling: boolean;
  age: number;
  isExcludedFromEps: boolean;
  pfCeiling?: number;
  vpfAmount?: number;
}): {
  employeePF: number;
  employerEPS: number;
  employerEPF: number;
  employerTotal: number;
  edli: number;
  pfAdmin: number;
} {
  const ceiling = params.pfCeiling ?? 15000;
  const baseWage = params.isRestrictedToCeiling ? Math.min(params.pfWage, ceiling) : params.pfWage;

  const employeePF = roundHalfUp(baseWage * 0.12) + (params.vpfAmount ?? 0);

  let employerEPS = 0;
  let employerEPF = 0;

  if (params.age >= 58 || params.isExcludedFromEps) {
    employerEPF = roundHalfUp(baseWage * 0.12);
    employerEPS = 0;
  } else {
    const epsWage = Math.min(params.pfWage, ceiling);
    employerEPS = roundHalfUp(epsWage * 0.0833);
    if (employerEPS > 1250) employerEPS = 1250;
    const totalEmployer12 = roundHalfUp(baseWage * 0.12);
    employerEPF = totalEmployer12 - employerEPS;
  }

  const edliWage = Math.min(params.pfWage, ceiling);
  const edli = roundHalfUp(edliWage * 0.005);
  const pfAdmin = Math.max(500, roundHalfUp(edliWage * 0.005));

  return {
    employeePF,
    employerEPS,
    employerEPF,
    employerTotal: employerEPS + employerEPF,
    edli,
    pfAdmin,
  };
}

// ESIC Calculation
export function calculateESIC(params: {
  fixedGross: number;
  actualGrossForContribution: number;
  paidDays: number;
  hasDisability?: boolean;
  isCoveredAtPeriodStart?: boolean;
  otAmount?: number;
}): {
  isCovered: boolean;
  employeeESIC: number;
  employerESIC: number;
} {
  const wageCeiling = params.hasDisability ? 25000 : 21000;
  const isCovered = params.isCoveredAtPeriodStart !== undefined ? params.isCoveredAtPeriodStart : params.fixedGross <= wageCeiling;

  if (!isCovered) {
    return { isCovered: false, employeeESIC: 0, employerESIC: 0 };
  }

  const dailyAvg = params.paidDays > 0 ? (params.actualGrossForContribution - (params.otAmount ?? 0)) / params.paidDays : 0;
  const employeeESIC = dailyAvg <= 176 ? 0 : Math.ceil(params.actualGrossForContribution * 0.0075);
  const employerESIC = Math.ceil(params.actualGrossForContribution * 0.0325);

  return {
    isCovered: true,
    employeeESIC,
    employerESIC,
  };
}

// Maharashtra PT Calculation
export function calculatePTMaharashtra(params: {
  grossWage: number;
  gender: 'MALE' | 'FEMALE' | string;
  month: number;
  hasDisability?: boolean;
  isParentOfDisabled?: boolean;
  age?: number;
}): number {
  if (params.hasDisability || params.isParentOfDisabled || (params.age && params.age >= 65)) {
    return 0;
  }

  const isFebruary = params.month === 2;
  const gender = params.gender.toUpperCase();

  if (gender === 'FEMALE') {
    if (params.grossWage <= 25000) return 0;
    return isFebruary ? 300 : 200;
  } else {
    if (params.grossWage <= 7500) return 0;
    if (params.grossWage <= 10000) return 175;
    return isFebruary ? 300 : 200;
  }
}

// MLWF Calculation
export function calculateMLWF(month: number): { employeeMLWF: number; employerMLWF: number } {
  if (month === 6 || month === 12) {
    return { employeeMLWF: 25, employerMLWF: 75 };
  }
  return { employeeMLWF: 0, employerMLWF: 0 };
}

// TDS New Regime Projection (FY 2026-27)
export function calculateTdsProjection(params: {
  ytdTaxableGross: number;
  currentMonthTaxableGross: number;
  remainingMonths: number;
  previousEmployerTaxable?: number;
  ytdTdsDeducted: number;
  stdDeduction?: number;
}): {
  projectedAnnualGross: number;
  netTaxableIncome: number;
  grossTax: number;
  rebate: number;
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  totalAnnualTax: number;
  currentMonthTDS: number;
} {
  const stdDeduction = params.stdDeduction ?? 75000;
  const projectedAnnualGross =
    params.ytdTaxableGross +
    params.currentMonthTaxableGross +
    params.remainingMonths * params.currentMonthTaxableGross +
    (params.previousEmployerTaxable ?? 0);

  const netTaxableIncome = Math.max(0, projectedAnnualGross - stdDeduction);

  let grossTax = 0;
  if (netTaxableIncome > 400000) {
    const slab1 = Math.min(netTaxableIncome, 800000) - 400000;
    grossTax += slab1 * 0.05;
  }
  if (netTaxableIncome > 800000) {
    const slab2 = Math.min(netTaxableIncome, 1200000) - 800000;
    grossTax += slab2 * 0.10;
  }
  if (netTaxableIncome > 1200000) {
    const slab3 = Math.min(netTaxableIncome, 1600000) - 1200000;
    grossTax += slab3 * 0.15;
  }
  if (netTaxableIncome > 1600000) {
    const slab4 = Math.min(netTaxableIncome, 2000000) - 1600000;
    grossTax += slab4 * 0.20;
  }
  if (netTaxableIncome > 2000000) {
    const slab5 = Math.min(netTaxableIncome, 2400000) - 2000000;
    grossTax += slab5 * 0.25;
  }
  if (netTaxableIncome > 2400000) {
    const slab6 = netTaxableIncome - 2400000;
    grossTax += slab6 * 0.30;
  }

  let rebate = 0;
  if (netTaxableIncome <= 1200000) {
    rebate = Math.min(grossTax, 60000);
  } else if (netTaxableIncome <= 1275000) {
    const excessIncome = netTaxableIncome - 1200000;
    rebate = Math.max(0, grossTax - excessIncome);
  }

  let taxAfterRebate = Math.max(0, grossTax - rebate);

  let surcharge = 0;
  if (netTaxableIncome > 5000000 && netTaxableIncome <= 10000000) {
    surcharge = taxAfterRebate * 0.10;
  } else if (netTaxableIncome > 10000000 && netTaxableIncome <= 20000000) {
    surcharge = taxAfterRebate * 0.15;
  } else if (netTaxableIncome > 20000000) {
    surcharge = taxAfterRebate * 0.25;
  }

  const cess = roundHalfUp((taxAfterRebate + surcharge) * 0.04);
  const totalAnnualTax = roundHalfUp(taxAfterRebate + surcharge + cess);

  const monthsRemainingTotal = params.remainingMonths + 1;
  const currentMonthTDS = Math.max(0, roundHalfUp((totalAnnualTax - params.ytdTdsDeducted) / monthsRemainingTotal));

  return {
    projectedAnnualGross,
    netTaxableIncome,
    grossTax,
    rebate,
    taxAfterRebate,
    surcharge,
    cess,
    totalAnnualTax,
    currentMonthTDS,
  };
}

// Overtime Calculation: (Basic + DA) / 26 / 8 * 2 * hours
export function calculateOtAmount(basicDa: number, approvedHours: number, normalWorkingHoursPerDay = 8): number {
  if (approvedHours <= 0) return 0;
  const hourlyRate = basicDa / (26 * normalWorkingHoursPerDay);
  return roundHalfUp(hourlyRate * 2 * approvedHours);
}

// Bonus Accrual: min(wage, max(7000, minWage)) * 8.33%
export function calculateBonusAccrual(wage: number, minWage = 7000): number {
  if (wage > 21000) return 0;
  const wageBase = Math.min(wage, Math.max(7000, minWage));
  return roundHalfUp(wageBase * 0.0833);
}

// Gratuity Monthly Provision: 4.8077% of wage
export function calculateGratuityMonthly(wage: number): number {
  return roundHalfUp(wage * (15 / 26) / 12);
}

// Gratuity Final Settlement: last_wage * 15/26 * completed_years
export function calculateGratuitySettlement(lastWage: number, completedYears: number): number {
  if (completedYears < 5) return 0;
  const raw = (lastWage * 15 * completedYears) / 26;
  return Math.min(2000000, roundHalfUp(raw));
}

// Indian Number to Words
export function numberToIndianWords(n: number): string {
  if (n === 0) return 'Zero Rupees Only';

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function numBelow1000(num: number): string {
    let s = '';
    if (num >= 100) {
      s += units[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
    }
    if (num >= 20) {
      s += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }
    if (num > 0) {
      s += units[num] + ' ';
    }
    return s.trim();
  }

  const integerPart = Math.floor(Math.abs(n));
  const decimalPart = Math.round((Math.abs(n) - integerPart) * 100);

  let crore = Math.floor(integerPart / 10000000);
  let rem = integerPart % 10000000;
  let lakh = Math.floor(rem / 100000);
  rem %= 100000;
  let thousand = Math.floor(rem / 1000);
  let hundred = rem % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(numBelow1000(crore) + ' Crore');
  if (lakh > 0) parts.push(numBelow1000(lakh) + ' Lakh');
  if (thousand > 0) parts.push(numBelow1000(thousand) + ' Thousand');
  if (hundred > 0) parts.push(numBelow1000(hundred));

  let result = parts.join(' ').trim() + ' Rupees';
  if (decimalPart > 0) {
    result += ' and ' + numBelow1000(decimalPart) + ' Paise';
  }
  result += ' Only';
  return result;
}
