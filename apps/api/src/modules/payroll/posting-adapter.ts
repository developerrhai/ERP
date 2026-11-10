import type { Db } from '../../core/db/prisma';
import { PostingService, type PostLineInput } from '../finance/posting-service';
import type { Caller } from '../records/service';

export interface PayrollRunPostingSummary {
  runId: string;
  runNo: string;
  unitId: string;
  periodDate: string; // YYYY-MM-DD
  totals: {
    gross: number;
    net: number;
    employeePf: number;
    employerPf: number;
    edli: number;
    pfAdmin: number;
    employeeEsic: number;
    employerEsic: number;
    pt: number;
    mlwfEmp: number;
    mlwfEmpr: number;
    tds: number;
    loanEmi: number;
    bonusProvision: number;
    gratuityProvision: number;
  };
  deptSplits: Array<{
    costCenterId?: string;
    gross: number;
    employerPf: number;
    employerEsic: number;
    bonusProvision: number;
    gratuityProvision: number;
  }>;
}

export class PayrollPostingAdapter {
  static async postPayrollRun(tx: Db, summary: PayrollRunPostingSummary, caller: Caller) {
    const lines: PostLineInput[] = [];

    // 1. Debits: Department splits for Gross Salary Expense (6101)
    if (summary.deptSplits.length > 0) {
      for (const dept of summary.deptSplits) {
        if (dept.gross > 0) {
          lines.push({
            accountCode: '6101',
            debit: dept.gross.toFixed(2),
            credit: '0.00',
            unitId: summary.unitId,
            costCenterId: dept.costCenterId,
            narration: `Gross Salary Expense - ${summary.runNo}`,
          });
        }
        if (dept.employerPf > 0) {
          lines.push({
            accountCode: '6102',
            debit: dept.employerPf.toFixed(2),
            credit: '0.00',
            unitId: summary.unitId,
            costCenterId: dept.costCenterId,
            narration: `Employer PF Contribution - ${summary.runNo}`,
          });
        }
        if (dept.employerEsic > 0) {
          lines.push({
            accountCode: '6102',
            debit: dept.employerEsic.toFixed(2),
            credit: '0.00',
            unitId: summary.unitId,
            costCenterId: dept.costCenterId,
            narration: `Employer ESIC Contribution - ${summary.runNo}`,
          });
        }
        if (dept.bonusProvision > 0) {
          lines.push({
            accountCode: '6104',
            debit: dept.bonusProvision.toFixed(2),
            credit: '0.00',
            unitId: summary.unitId,
            costCenterId: dept.costCenterId,
            narration: `Bonus Provision - ${summary.runNo}`,
          });
        }
        if (dept.gratuityProvision > 0) {
          lines.push({
            accountCode: '6105',
            debit: dept.gratuityProvision.toFixed(2),
            credit: '0.00',
            unitId: summary.unitId,
            costCenterId: dept.costCenterId,
            narration: `Gratuity Provision - ${summary.runNo}`,
          });
        }
      }
    } else {
      // Fallback if no department split is provided
      if (summary.totals.gross > 0) {
        lines.push({
          accountCode: '6101',
          debit: summary.totals.gross.toFixed(2),
          credit: '0.00',
          unitId: summary.unitId,
          narration: `Gross Salary Expense - ${summary.runNo}`,
        });
      }
      if (summary.totals.employerPf > 0) {
        lines.push({
          accountCode: '6102',
          debit: summary.totals.employerPf.toFixed(2),
          credit: '0.00',
          unitId: summary.unitId,
          narration: `Employer PF - ${summary.runNo}`,
        });
      }
      if (summary.totals.employerEsic > 0) {
        lines.push({
          accountCode: '6102',
          debit: summary.totals.employerEsic.toFixed(2),
          credit: '0.00',
          unitId: summary.unitId,
          narration: `Employer ESIC - ${summary.runNo}`,
        });
      }
      if (summary.totals.bonusProvision > 0) {
        lines.push({
          accountCode: '6104',
          debit: summary.totals.bonusProvision.toFixed(2),
          credit: '0.00',
          unitId: summary.unitId,
          narration: `Bonus Provision - ${summary.runNo}`,
        });
      }
      if (summary.totals.gratuityProvision > 0) {
        lines.push({
          accountCode: '6105',
          debit: summary.totals.gratuityProvision.toFixed(2),
          credit: '0.00',
          unitId: summary.unitId,
          narration: `Gratuity Provision - ${summary.runNo}`,
        });
      }
    }

    // Debits: EDLI and PF Admin (company admin level)
    if (summary.totals.edli > 0) {
      lines.push({
        accountCode: '6102',
        debit: summary.totals.edli.toFixed(2),
        credit: '0.00',
        unitId: summary.unitId,
        narration: `EDLI Expense - ${summary.runNo}`,
      });
    }
    if (summary.totals.pfAdmin > 0) {
      lines.push({
        accountCode: '6102',
        debit: summary.totals.pfAdmin.toFixed(2),
        credit: '0.00',
        unitId: summary.unitId,
        narration: `PF Admin Charges - ${summary.runNo}`,
      });
    }

    // 2. Credits: Payables & Recoveries
    if (summary.totals.net > 0) {
      lines.push({
        accountCode: '2320', // Salaries and Wages Payable
        debit: '0.00',
        credit: summary.totals.net.toFixed(2),
        unitId: summary.unitId,
        narration: `Net Salaries Payable - ${summary.runNo}`,
      });
    }

    const totalPfPayable = summary.totals.employeePf + summary.totals.employerPf + summary.totals.edli + summary.totals.pfAdmin;
    if (totalPfPayable > 0) {
      lines.push({
        accountCode: '2105', // PF Payable (or fallback to 2101 / 2321)
        debit: '0.00',
        credit: totalPfPayable.toFixed(2),
        unitId: summary.unitId,
        narration: `PF Payable (Emp + Empr + Admin + EDLI) - ${summary.runNo}`,
      });
    }

    const totalEsicPayable = summary.totals.employeeEsic + summary.totals.employerEsic;
    if (totalEsicPayable > 0) {
      lines.push({
        accountCode: '2106', // ESIC Payable
        debit: '0.00',
        credit: totalEsicPayable.toFixed(2),
        unitId: summary.unitId,
        narration: `ESIC Payable (Emp + Empr) - ${summary.runNo}`,
      });
    }

    if (summary.totals.pt > 0) {
      lines.push({
        accountCode: '2105',
        debit: '0.00',
        credit: summary.totals.pt.toFixed(2),
        unitId: summary.unitId,
        narration: `Professional Tax Payable - ${summary.runNo}`,
      });
    }

    const totalMlwfPayable = summary.totals.mlwfEmp + summary.totals.mlwfEmpr;
    if (totalMlwfPayable > 0) {
      lines.push({
        accountCode: '2106',
        debit: '0.00',
        credit: totalMlwfPayable.toFixed(2),
        unitId: summary.unitId,
        narration: `Labour Welfare Fund Payable - ${summary.runNo}`,
      });
    }

    if (summary.totals.tds > 0) {
      lines.push({
        accountCode: '2324', // TDS on Salary Payable
        debit: '0.00',
        credit: summary.totals.tds.toFixed(2),
        unitId: summary.unitId,
        narration: `TDS on Salary Payable - ${summary.runNo}`,
      });
    }

    if (summary.totals.loanEmi > 0) {
      lines.push({
        accountCode: '1503', // Employee Loans Recovery
        debit: '0.00',
        credit: summary.totals.loanEmi.toFixed(2),
        unitId: summary.unitId,
        narration: `Employee Loan Recovery - ${summary.runNo}`,
      });
    }

    if (summary.totals.bonusProvision > 0) {
      lines.push({
        accountCode: '2107', // Bonus Payable
        debit: '0.00',
        credit: summary.totals.bonusProvision.toFixed(2),
        unitId: summary.unitId,
        narration: `Bonus Payable - ${summary.runNo}`,
      });
    }

    if (summary.totals.gratuityProvision > 0) {
      lines.push({
        accountCode: '2301', // Gratuity Provision
        debit: '0.00',
        credit: summary.totals.gratuityProvision.toFixed(2),
        unitId: summary.unitId,
        narration: `Gratuity Provision Accrued - ${summary.runNo}`,
      });
    }

    // Verify debit/credit balance
    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of lines) {
      totalDebit += parseFloat(l.debit);
      totalCredit += parseFloat(l.credit);
    }
    const diff = Math.round((totalDebit - totalCredit) * 100) / 100;
    if (diff !== 0 && lines.length > 0) {
      // Small rounding difference adjustment to net salaries payable
      const netLine = lines.find((l) => l.accountCode === '2320');
      if (netLine) {
        netLine.credit = (parseFloat(netLine.credit) + diff).toFixed(2);
      }
    }

    const posted = await PostingService.postJournal(
      tx,
      {
        unitId: summary.unitId,
        docDate: summary.periodDate,
        voucherType: 'Payroll',
        source: 'SYSTEM',
        narration: `Payroll Run ${summary.runNo}`,
        sourceDocType: 'PAYROLL_RUN',
        sourceDocId: summary.runId,
        sourceDocNo: summary.runNo,
        lines,
      },
      {
        userId: caller.auth.userId,
      },
    );

    return posted;
  }

  static async reversePayrollRun(tx: Db, journalId: string, reason: string, caller: Caller) {
    return PostingService.reverse(
      tx,
      journalId,
      reason,
      {
        userId: caller.auth.userId,
      },
    );
  }
}
