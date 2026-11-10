import { describe, it, expect } from 'vitest';
import {
  evalFormula,
  prorateComponent,
  calculateCodeWage,
  calculatePF,
  calculateESIC,
  calculatePTMaharashtra,
  calculateMLWF,
  calculateTdsProjection,
  calculateOtAmount,
  calculateBonusAccrual,
  calculateGratuityMonthly,
  numberToIndianWords,
  type ComponentInput,
} from '../src/modules/payroll/payroll-calc';

describe('Phase 16 Payroll Unit Tests', () => {
  it('Evaluates safe formulas without eval', () => {
    const ctx = { BASIC: 10000, DA: 2000, HRA: 4000 };
    expect(evalFormula('BASIC + DA', ctx)).toBe(12000);
    expect(evalFormula('min(BASIC * 0.5, HRA)', ctx)).toBe(4000);
    expect(evalFormula('if(BASIC > 5000, 200, 0)', ctx)).toBe(200);
    expect(evalFormula('round(BASIC / 3)', ctx)).toBe(3333);
  });

  it('Prorates salary components half-up', () => {
    expect(prorateComponent(9000, 26, 28)).toBe(8357);
    expect(prorateComponent(3600, 26, 28)).toBe(3343);
    expect(prorateComponent(3400, 26, 28)).toBe(3157);
    expect(prorateComponent(1000, 26, 28)).toBe(929);
  });

  it('Calculates Code on Wages 50% Add-Back rule', () => {
    const components: ComponentInput[] = [
      { code: 'BASIC', amount: 10000, code_wage_class: 'INCLUDED' },
      { code: 'HRA', amount: 8000, code_wage_class: 'EXCLUDED' },
      { code: 'CONV', amount: 4000, code_wage_class: 'EXCLUDED' },
    ];
    const res = calculateCodeWage(components);
    expect(res.totalGross).toBe(22000);
    expect(res.totalIncluded).toBe(10000);
    expect(res.totalExcluded).toBe(12000);
    expect(res.fiftyPercentLimit).toBe(11000);
    expect(res.addBackAmount).toBe(1000);
    expect(res.finalWage).toBe(11000);
  });

  it('Converts numbers to Indian currency words', () => {
    expect(numberToIndianWords(144792)).toBe('One Lakh Forty Four Thousand Seven Hundred Ninety Two Rupees Only');
    expect(numberToIndianWords(519)).toBe('Five Hundred Nineteen Rupees Only');
  });

  it('Full Section 5 February 2027 Golden Test (Ramesh, Sunita, Vikram)', () => {
    // -------------------------------------------------------------
    // Employee A: Ramesh (M, SAW) - Basic 9k, HRA 3.6k, Special 3.4k, Conv 1k, 26 paid days, 6h OT
    // -------------------------------------------------------------
    const rameshEarnedBasic = prorateComponent(9000, 26, 28); // 8357
    const rameshEarnedHra = prorateComponent(3600, 26, 28); // 3343
    const rameshEarnedSpecial = prorateComponent(3400, 26, 28); // 3157
    const rameshEarnedConv = prorateComponent(1000, 26, 28); // 929
    const rameshOt = calculateOtAmount(9000, 6); // 519

    const rameshGross = rameshEarnedBasic + rameshEarnedHra + rameshEarnedSpecial + rameshEarnedConv + rameshOt;
    expect(rameshGross).toBe(16305);

    const rameshCodeWage = calculateCodeWage([
      { code: 'BASIC', amount: rameshEarnedBasic, code_wage_class: 'INCLUDED' },
      { code: 'HRA', amount: rameshEarnedHra, code_wage_class: 'EXCLUDED' },
      { code: 'SPECIAL', amount: rameshEarnedSpecial, code_wage_class: 'INCLUDED' },
      { code: 'CONV', amount: rameshEarnedConv, code_wage_class: 'EXCLUDED' },
      { code: 'OT', amount: rameshOt, code_wage_class: 'EXCLUDED' },
    ]);
    expect(rameshCodeWage.finalWage).toBe(11514);

    const rameshPf = calculatePF({
      pfWage: rameshCodeWage.finalWage,
      isRestrictedToCeiling: true,
      age: 30,
      isExcludedFromEps: false,
    });
    expect(rameshPf.employeePF).toBe(1382);
    expect(rameshPf.employerEPS).toBe(959);
    expect(rameshPf.employerEPF).toBe(423);
    expect(rameshPf.edli).toBe(58);

    const rameshEsic = calculateESIC({
      fixedGross: 17000,
      actualGrossForContribution: rameshGross,
      paidDays: 26,
      otAmount: rameshOt,
    });
    expect(rameshEsic.isCovered).toBe(true);
    expect(rameshEsic.employeeESIC).toBe(123);
    expect(rameshEsic.employerESIC).toBe(530);

    const rameshPt = calculatePTMaharashtra({ grossWage: rameshGross, gender: 'MALE', month: 2 });
    expect(rameshPt).toBe(300);

    const rameshNet = rameshGross - (rameshPf.employeePF + rameshEsic.employeeESIC + rameshPt);
    expect(rameshNet).toBe(14500);

    // -------------------------------------------------------------
    // Employee B: Sunita (F, TAL) - Basic 12k, HRA 4.8k, Special 6.2k, Conv 1.6k, 28 paid days
    // -------------------------------------------------------------
    const sunitaGross = 12000 + 4800 + 6200 + 1600; // 24600
    const sunitaCodeWage = calculateCodeWage([
      { code: 'BASIC', amount: 12000, code_wage_class: 'INCLUDED' },
      { code: 'HRA', amount: 4800, code_wage_class: 'EXCLUDED' },
      { code: 'SPECIAL', amount: 6200, code_wage_class: 'INCLUDED' },
      { code: 'CONV', amount: 1600, code_wage_class: 'EXCLUDED' },
    ]);
    expect(sunitaCodeWage.finalWage).toBe(18200);

    const sunitaPf = calculatePF({
      pfWage: sunitaCodeWage.finalWage,
      isRestrictedToCeiling: true,
      age: 32,
      isExcludedFromEps: false,
    });
    expect(sunitaPf.employeePF).toBe(1800);
    expect(sunitaPf.employerEPS).toBe(1250);
    expect(sunitaPf.employerEPF).toBe(550);
    expect(sunitaPf.edli).toBe(75);

    const sunitaEsic = calculateESIC({
      fixedGross: 24600,
      actualGrossForContribution: sunitaGross,
      paidDays: 28,
    });
    expect(sunitaEsic.isCovered).toBe(false);

    const sunitaPt = calculatePTMaharashtra({ grossWage: sunitaGross, gender: 'FEMALE', month: 2 });
    expect(sunitaPt).toBe(0); // Female <= 25k is exempt

    const sunitaNet = sunitaGross - sunitaPf.employeePF;
    expect(sunitaNet).toBe(22800);

    // -------------------------------------------------------------
    // Employee C: Vikram (M, VAR) - Basic 60k, HRA 30k, Special 58.4k, Conv 1.6k, 28 paid days
    // -------------------------------------------------------------
    const vikramGross = 60000 + 30000 + 58400 + 1600; // 150000
    const vikramCodeWage = calculateCodeWage([
      { code: 'BASIC', amount: 60000, code_wage_class: 'INCLUDED' },
      { code: 'HRA', amount: 30000, code_wage_class: 'EXCLUDED' },
      { code: 'SPECIAL', amount: 58400, code_wage_class: 'INCLUDED' },
      { code: 'CONV', amount: 1600, code_wage_class: 'EXCLUDED' },
    ]);
    expect(vikramCodeWage.finalWage).toBe(118400);

    const vikramPf = calculatePF({
      pfWage: vikramCodeWage.finalWage,
      isRestrictedToCeiling: true,
      age: 40,
      isExcludedFromEps: false,
    });
    expect(vikramPf.employeePF).toBe(1800);
    expect(vikramPf.employerEPS).toBe(1250);
    expect(vikramPf.employerEPF).toBe(550);
    expect(vikramPf.edli).toBe(75);

    const vikramPt = calculatePTMaharashtra({ grossWage: vikramGross, gender: 'MALE', month: 2 });
    expect(vikramPt).toBe(300);

    // Vikram TDS: Annual 18L - 75k = 17,25,000 Taxable -> Tax 1,50,800. Paid to Jan = 1,25,670. Remaining (Feb+Mar) = 25,130 / 2 = 12,565
    const vikramTds = calculateTdsProjection({
      ytdTaxableGross: 150000 * 10,
      currentMonthTaxableGross: 150000,
      remainingMonths: 1, // Feb is month 11, remaining is 1 (March)
      ytdTdsDeducted: 125670,
    });
    expect(vikramTds.currentMonthTDS).toBe(12565);

    const vikramNet = vikramGross - (vikramPf.employeePF + vikramPt + vikramTds.currentMonthTDS);
    expect(vikramNet).toBe(135335);

    // -------------------------------------------------------------
    // Combined February 2027 Totals & Balanced GL Journal
    // -------------------------------------------------------------
    const combinedGross = rameshGross + sunitaGross + vikramGross;
    expect(combinedGross).toBe(190905);

    const combinedNet = rameshNet + sunitaNet + vikramNet;
    expect(combinedNet).toBe(172635);

    const combinedEmployerPf = rameshPf.employerTotal + sunitaPf.employerTotal + vikramPf.employerTotal;
    expect(combinedEmployerPf).toBe(4982);

    const combinedEdli = rameshPf.edli + sunitaPf.edli + vikramPf.edli;
    expect(combinedEdli).toBe(208);

    const pfAdmin = Math.max(500, Math.round((11514 + 15000 + 15000) * 0.005));
    expect(pfAdmin).toBe(500);

    const employerEsic = rameshEsic.employerESIC;
    expect(employerEsic).toBe(530);

    const bonusProvision = calculateBonusAccrual(rameshEarnedBasic) + calculateBonusAccrual(12000);
    expect(bonusProvision).toBe(1166);

    const gratuityProvision = calculateGratuityMonthly(rameshEarnedBasic) + calculateGratuityMonthly(12000) + calculateGratuityMonthly(60000);
    expect(gratuityProvision).toBe(3864);

    const totalDebits =
      combinedGross +
      combinedEmployerPf +
      combinedEdli +
      pfAdmin +
      employerEsic +
      bonusProvision +
      gratuityProvision;

    const totalCredits =
      combinedNet +
      (rameshPf.employeePF + sunitaPf.employeePF + vikramPf.employeePF + combinedEmployerPf + combinedEdli + pfAdmin) +
      (rameshEsic.employeeESIC + employerEsic) +
      (rameshPt + sunitaPt + vikramPt) +
      vikramTds.currentMonthTDS +
      bonusProvision +
      gratuityProvision;

    expect(totalDebits).toBe(totalCredits);
  });
});
