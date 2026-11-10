import { describe, expect, it } from 'vitest';
import {
  amountInWordsIndian,
  computeCodeWageAddBack,
  computeEsic,
  computeGratuityMonthlyProvision,
  computeGratuityPayable,
  computeBonusMonthlyAccrual,
  computeMlwf,
  computeOtAmount,
  computePf,
  computePtMaharashtra,
  computeTdsProjection,
  computeAnnualTaxNewRegime,
  evalFormula,
  orderComponentsTopological,
  prorate,
} from '../src/payroll/index';

describe('Payroll Calculations — Units & Golden Test (§5)', () => {
  it('converts number to Indian words', () => {
    expect(amountInWordsIndian(135335)).toBe(
      'One Lakh Thirty Five Thousand Three Hundred Thirty Five',
    );
    expect(amountInWordsIndian(0)).toBe('Zero');
    expect(amountInWordsIndian(500)).toBe('Five Hundred');
    expect(amountInWordsIndian(1200000)).toBe('Twelve Lakh');
  });

  it('evaluates safe formula parser without eval', () => {
    const ctx = { BASIC: 10000, HRA: 4000 };
    expect(evalFormula('BASIC * 0.5', ctx)).toBe(5000);
    expect(evalFormula('min(BASIC, 15000)', ctx)).toBe(10000);
    expect(evalFormula('max(BASIC, 15000)', ctx)).toBe(15000);
    expect(evalFormula('BASIC + HRA', ctx)).toBe(14000);
    expect(evalFormula('if(BASIC > 5000, 200, 0)', ctx)).toBe(200);

    // Rejects unknown variable
    expect(() => evalFormula('BASIC + UNKNOWN', ctx)).toThrow(
      "Formula refers to unknown item 'UNKNOWN'",
    );

    // Topological order
    const ordered = orderComponentsTopological([
      { code: 'GROSS', formula: 'BASIC + HRA + SPECIAL' },
      { code: 'HRA', formula: 'BASIC * 0.4' },
      { code: 'BASIC', formula: null },
      { code: 'SPECIAL', formula: null },
    ]);
    expect(ordered.indexOf('BASIC')).toBeLessThan(ordered.indexOf('HRA'));
    expect(ordered.indexOf('HRA')).toBeLessThan(ordered.indexOf('GROSS'));

    // Rejects cycle
    expect(() =>
      orderComponentsTopological([
        { code: 'A', formula: 'B + 1' },
        { code: 'B', formula: 'A + 1' },
      ]),
    ).toThrow('Circular formula');
  });

  it('calculates Code on Wages add-back example from §3', () => {
    // Basic 10,000; HRA 8,000; Conveyance 4,000
    // Total 22,000. Excluded (12,000) > 50% (11,000) -> add back 1,000 -> PF wage = 11,000
    const res = computeCodeWageAddBack([
      { code: 'BASIC', amount: 10000, codeWageClass: 'INCLUDED' },
      { code: 'HRA', amount: 8000, codeWageClass: 'EXCLUDED' },
      { code: 'CONVEYANCE', amount: 4000, codeWageClass: 'EXCLUDED' },
    ]);

    expect(res.totalPay).toBe(22000);
    expect(res.threshold50Pct).toBe(11000);
    expect(res.excludedSum).toBe(12000);
    expect(res.addBackAmount).toBe(1000);
    expect(res.codeWages).toBe(11000);
  });

  it('calculates MLWF (June and December only)', () => {
    expect(computeMlwf(2)).toEqual({ employeeMlwf: 0, employerMlwf: 0 });
    expect(computeMlwf(6)).toEqual({ employeeMlwf: 25, employerMlwf: 75 });
    expect(computeMlwf(12)).toEqual({ employeeMlwf: 25, employerMlwf: 75 });
  });

  it('calculates TDS new regime rebate and marginal relief', () => {
    // Exactly 12 Lakh -> zero tax due to rebate
    const at12L = computeAnnualTaxNewRegime(1200000);
    expect(at12L.taxAfterRebate).toBe(0);
    expect(at12L.totalTax).toBe(0);

    // Marginal relief just above 12L (e.g. 12,10,000: tax cannot exceed 10,000)
    const at1210k = computeAnnualTaxNewRegime(1210000);
    expect(at1210k.taxAfterRebate).toBeLessThanOrEqual(10000);
  });

  // -------------------------------------------------------------------------- GOLDEN TEST (§5)
  it('passes the EXACT 3-Employee February 2027 Golden Test + Balanced GL Journal', () => {
    const calendarDays = 28; // February 2027

    const pfRates = {
      employeeRate: 0.12,
      employerTotalRate: 0.12,
      epsRate: 0.0833,
      edliRate: 0.005,
      adminRate: 0.005,
      adminMinAmount: 500,
      wageCeiling: 15000,
      epsMaxAmount: 1250,
    };

    const esicRates = {
      employeeRate: 0.0075,
      employerRate: 0.0325,
      coverageCeiling: 21000,
      dailyAvgExemptLimit: 176,
    };

    // ======================================================================== Employee A: Ramesh (M, SAW)
    const aBasic = prorate(9000, 26, calendarDays); // 8,357
    const aHra = prorate(3600, 26, calendarDays); // 3,343
    const aSpecial = prorate(3400, 26, calendarDays); // 3,157
    const aConv = prorate(1000, 26, calendarDays); // 929

    expect(aBasic).toBe(8357);
    expect(aHra).toBe(3343);
    expect(aSpecial).toBe(3157);
    expect(aConv).toBe(929);

    const aOt = computeOtAmount(9000, 6, 2.0); // 519
    expect(aOt).toBe(519);

    const aGross = aBasic + aHra + aSpecial + aConv + aOt; // 16,305
    expect(aGross).toBe(16305);

    // Code wages: Basic (8357) + Special (3157) = 11,514 (INCLUDED). Excluded (3343+929=4272).
    // Excluded (4272) <= 50% of total (8152.5) -> addBack = 0.
    const aCodeWage = computeCodeWageAddBack([
      { code: 'BASIC', amount: aBasic, codeWageClass: 'INCLUDED' },
      { code: 'SPECIAL', amount: aSpecial, codeWageClass: 'INCLUDED' },
      { code: 'HRA', amount: aHra, codeWageClass: 'EXCLUDED' },
      { code: 'CONV', amount: aConv, codeWageClass: 'EXCLUDED' },
    ]);
    expect(aCodeWage.codeWages).toBe(11514);

    const aPf = computePf({
      pfWages: aCodeWage.codeWages,
      restrictToCeiling: true,
      rates: pfRates,
    });
    expect(aPf.employeePf).toBe(1382);
    expect(aPf.employerEps).toBe(959);
    expect(aPf.employerEpf).toBe(423);

    // ESIC: covered because monthly fixed gross (9000+3600+3400+1000 = 17000) <= 21000
    const aEsic = computeEsic({
      grossWageWithoutOt: aGross - aOt,
      grossWageTotal: aGross,
      paidDays: 26,
      coveredAtPeriodStart: true,
      rates: esicRates,
    });
    expect(aEsic.employeeEsic).toBe(123);
    expect(aEsic.employerEsic).toBe(530);

    const aPt = computePtMaharashtra(aGross, 'M', 2); // February 300
    expect(aPt).toBe(300);

    const aLoanEmi = 1000;
    const aDeductions = aPf.employeePf + aEsic.employeeEsic + aPt + aLoanEmi;
    expect(aDeductions).toBe(2805);

    const aNet = aGross - aDeductions;
    expect(aNet).toBe(13500);

    const aGratuity = computeGratuityMonthlyProvision(aBasic);
    expect(aGratuity).toBe(402); // 402

    const aBonus = computeBonusMonthlyAccrual(aBasic, 30);
    expect(aBonus.accrualAmount).toBe(583); // 583

    // ======================================================================== Employee B: Sunita (F, TAL)
    const bBasic = 12000;
    const bHra = 4800;
    const bSpecial = 6200;
    const bConv = 1600;
    const bGross = bBasic + bHra + bSpecial + bConv; // 24,600
    expect(bGross).toBe(24600);

    const bCodeWage = computeCodeWageAddBack([
      { code: 'BASIC', amount: bBasic, codeWageClass: 'INCLUDED' },
      { code: 'SPECIAL', amount: bSpecial, codeWageClass: 'INCLUDED' },
      { code: 'HRA', amount: bHra, codeWageClass: 'EXCLUDED' },
      { code: 'CONV', amount: bConv, codeWageClass: 'EXCLUDED' },
    ]);
    expect(bCodeWage.codeWages).toBe(18200);

    const bPf = computePf({
      pfWages: bCodeWage.codeWages,
      restrictToCeiling: true,
      rates: pfRates,
    });
    expect(bPf.wageBase).toBe(15000);
    expect(bPf.employeePf).toBe(1800);
    expect(bPf.employerEps).toBe(1250);
    expect(bPf.employerEpf).toBe(550);

    const bEsic = computeEsic({
      grossWageWithoutOt: bGross,
      grossWageTotal: bGross,
      paidDays: 28,
      coveredAtPeriodStart: false,
      rates: esicRates,
    });
    expect(bEsic.isCovered).toBe(false);

    const bPt = computePtMaharashtra(bGross, 'F', 2);
    expect(bPt).toBe(0); // Woman <= 25,000

    const bDeductions = bPf.employeePf + bPt;
    expect(bDeductions).toBe(1800);
    const bNet = bGross - bDeductions;
    expect(bNet).toBe(22800);

    const bGratuity = computeGratuityMonthlyProvision(bBasic);
    expect(bGratuity).toBe(577);

    const bBonus = computeBonusMonthlyAccrual(bBasic, 30);
    expect(bBonus.accrualAmount).toBe(583);

    // ======================================================================== Employee C: Vikram (M, VAR)
    const cBasic = 60000;
    const cHra = 30000;
    const cSpecial = 58400;
    const cConv = 1600;
    const cGross = cBasic + cHra + cSpecial + cConv; // 1,50,000
    expect(cGross).toBe(150000);

    const cCodeWage = computeCodeWageAddBack([
      { code: 'BASIC', amount: cBasic, codeWageClass: 'INCLUDED' },
      { code: 'SPECIAL', amount: cSpecial, codeWageClass: 'INCLUDED' },
      { code: 'HRA', amount: cHra, codeWageClass: 'EXCLUDED' },
      { code: 'CONV', amount: cConv, codeWageClass: 'EXCLUDED' },
    ]);
    expect(cCodeWage.codeWages).toBe(118400);

    const cPf = computePf({
      pfWages: cCodeWage.codeWages,
      restrictToCeiling: true,
      rates: pfRates,
    });
    expect(cPf.employeePf).toBe(1800);
    expect(cPf.employerEps).toBe(1250);
    expect(cPf.employerEpf).toBe(550);

    const cPt = computePtMaharashtra(cGross, 'M', 2);
    expect(cPt).toBe(300);

    // C's TDS projection:
    // projected gross 18,00,000 - 75,000 std deduction = 17,25,000
    // Tax = 1,45,000 + 4% cess 5,800 = 1,50,800
    // Paid to Jan = 1,25,670 -> (1,50,800 - 1,25,670) / 2 = 12,565!
    const cTds = computeTdsProjection({
      ytdTaxableGross: 150000 * 10,
      currentMonthTaxableGross: 150000,
      remainingMonths: 2,
      currentMonthlyRegularGross: 150000,
      standardDeduction: 75000,
      tdsDeductedToDate: 125670,
    });
    expect(cTds.currentMonthTds).toBe(12565);

    const cDeductions = cPf.employeePf + cPt + cTds.currentMonthTds;
    expect(cDeductions).toBe(14665);
    const cNet = cGross - cDeductions;
    expect(cNet).toBe(135335);

    const cGratuity = computeGratuityMonthlyProvision(cBasic);
    expect(cGratuity).toBe(2885);

    // ======================================================================== Establishment totals & GL Journal
    const totalGross = aGross + bGross + cGross; // 1,90,905
    expect(totalGross).toBe(190905);

    const employerPfTotal = aPf.employerTotal + bPf.employerTotal + cPf.employerTotal; // 1,382 + 1,800 + 1,800 = 4,982
    expect(employerPfTotal).toBe(4982);

    const edliTotal = aPf.edliAmount + bPf.edliAmount + cPf.edliAmount; // 58 + 75 + 75 = 208
    expect(edliTotal).toBe(208);

    const adminFee = 500; // minimum ₹500
    const totalPfExpense = employerPfTotal + edliTotal + adminFee; // 5,690
    expect(totalPfExpense).toBe(5690);

    const totalEmployerEsic = aEsic.employerEsic; // 530
    expect(totalEmployerEsic).toBe(530);

    const totalGratuity = aGratuity + bGratuity + cGratuity; // 402 + 577 + 2885 = 3,864
    expect(totalGratuity).toBe(3864);

    const totalBonus = aBonus.accrualAmount + bBonus.accrualAmount; // 583 + 583 = 1,166
    expect(totalBonus).toBe(1166);

    // Debits
    const totalDebits =
      totalGross + totalPfExpense + totalEmployerEsic + totalGratuity + totalBonus;
    expect(totalDebits).toBe(202155);

    // Credits
    const pfPayable =
      aPf.employeePf +
      bPf.employeePf +
      cPf.employeePf +
      employerPfTotal +
      edliTotal +
      adminFee; // 4,982 + 4,982 + 208 + 500 = 10,672
    expect(pfPayable).toBe(10672);

    const esiPayable = aEsic.employeeEsic + aEsic.employerEsic; // 123 + 530 = 653
    expect(esiPayable).toBe(653);

    const ptPayable = aPt + bPt + cPt; // 300 + 0 + 300 = 600
    expect(ptPayable).toBe(600);

    const tdsPayable = cTds.currentMonthTds; // 12,565
    expect(tdsPayable).toBe(12565);

    const employeeLoan = aLoanEmi; // 1,000
    expect(employeeLoan).toBe(1000);

    const salaryPayable = aNet + bNet + cNet; // 13,500 + 22,800 + 1,35,335 = 1,71,635
    expect(salaryPayable).toBe(171635);

    const totalCredits =
      pfPayable +
      esiPayable +
      ptPayable +
      tdsPayable +
      employeeLoan +
      salaryPayable +
      totalGratuity +
      totalBonus;

    expect(totalCredits).toBe(202155);
    expect(totalDebits).toBe(totalCredits); // BALANCES EXACTLY TO THE RUPEE!
  });
});

