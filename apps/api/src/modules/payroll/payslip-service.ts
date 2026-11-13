import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { insertRow } from '../procurement/core';
import { HrCrypto } from '../hr/hr-crypto';
import { numberToIndianWords } from './payroll-calc';

export class PayslipService {
  static async getPayslip(db: Db, runEmployeeId: string) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const rows = await db.$queryRaw<any[]>`
      SELECT pre.*, r."run_no", r."status" as "run_status",
             p."month", p."days_basis",
             e."id" as "employee_id", e."emp_code", e."full_name", e."designation", e."department",
             e."date_of_joining", eiv."pan", eiv."uan", eiv."esic_number", eiv."aadhaar_encrypted",
             eba."account_number_encrypted", eba."ifsc_code", eba."bank_name"
      FROM "payroll_run_employees" pre
      JOIN "payroll_runs" r ON r."id" = pre."run_id"
      JOIN "payroll_periods" p ON p."id" = r."period_id"
      JOIN "payroll_employees_v" e ON e."id" = pre."employee_id"
      LEFT JOIN "payroll_identity_v" eiv ON eiv."employee_id" = e."id"
      LEFT JOIN "payroll_bank_v" eba ON eba."employee_id" = e."id" AND eba."is_primary" = true
      WHERE pre."id" = ${runEmployeeId}::uuid
    `;

    if (rows.length === 0) {
      throw Errors.notFound('Payroll run employee record not found');
    }

    const row = rows[0];

    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const lines = await db.$queryRaw<any[]>`
      SELECT prl.*, c."code", c."name", c."kind", c."payslip_order", c."payslip_label_hi"
      FROM "payroll_run_lines" prl
      JOIN "pay_components" c ON c."id" = prl."component_id"
      WHERE prl."run_employee_id" = ${runEmployeeId}::uuid
      ORDER BY c."payslip_order" ASC
    `;

    const earnings = lines
      .filter((l) => l.kind === 'EARNING')
      .map((l) => ({
        code: l.code,
        name: l.name,
        nameHi: l.payslip_label_hi,
        amount: Number(l.amount),
      }));

    const deductions = lines
      .filter((l) => l.kind === 'DEDUCTION')
      .map((l) => ({
        code: l.code,
        name: l.name,
        nameHi: l.payslip_label_hi,
        amount: Number(l.amount),
      }));

    // Mask Aadhaar: only last 4 digits
    let maskedAadhaar = 'XXXX-XXXX-XXXX';
    if (row.aadhaar_encrypted) {
      const plainAadhaar = HrCrypto.decryptAadhaar(row.aadhaar_encrypted);
      maskedAadhaar = HrCrypto.maskAadhaar(plainAadhaar);
    }

    // Mask Bank Account: only last 4 digits
    let maskedAccount = 'XXXXXXXXXXXX';
    if (row.account_number_encrypted) {
      const plainAcc = HrCrypto.decryptBank(row.account_number_encrypted);
      maskedAccount = HrCrypto.maskAccount(plainAcc);
    }

    const netAmount = Number(row.net);
    const amountInWords = numberToIndianWords(netAmount);

    return {
      payslipNo: `PS-${row.run_no}-${row.emp_code}`,
      runNo: row.run_no,
      periodMonth: row.month,
      employee: {
        id: row.employee_id,
        code: row.emp_code,
        name: row.full_name,
        designation: row.designation,
        department: row.department,
        doj: row.date_of_joining,
        pan: row.pan,
        uan: row.uan,
        esicNo: row.esic_number,
        aadhaarMasked: maskedAadhaar,
        bankName: row.bank_name,
        accountNoMasked: maskedAccount,
        ifsc: row.ifsc_code,
      },
      attendance: {
        calendarDays: row.days_basis,
        paidDays: Number(row.paid_days),
        lopDays: Number(row.lop_days),
        ncpDays: Number(row.ncp_days),
      },
      earnings,
      deductions,
      totals: {
        gross: Number(row.gross),
        deductions: Number(row.deductions),
        net: netAmount,
        amountInWords,
      },
    };
  }

  static async releasePayslips(db: Db, runId: string, caller: Caller) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const runEmployees = await db.$queryRaw<any[]>`
      SELECT pre."id", pre."employee_id", r."period_id", r."run_no", e."emp_code"
      FROM "payroll_run_employees" pre
      JOIN "payroll_runs" r ON r."id" = pre."run_id"
      JOIN "payroll_employees_v" e ON e."id" = pre."employee_id"
      WHERE pre."run_id" = ${runId}::uuid
    `;

    for (const re of runEmployees) {
      const payslipNo = `PS-${re.run_no}-${re.emp_code}`;
      // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
      const existing = await db.$queryRaw<any[]>`
        SELECT "id" FROM "payslips" WHERE "run_employee_id" = ${re.id}::uuid
      `;
      if (existing.length === 0) {
        await insertRow(db, 'payslips', {
          payslip_no: payslipNo,
          run_employee_id: re.id,
          employee_id: re.employee_id,
          period_id: re.period_id,
          released_at: new Date(),
          email_status: 'PENDING',
          download_count: 0,
        });
      } else {
        await db.$executeRaw`
          UPDATE "payslips" SET "released_at" = now() WHERE "id" = ${existing[0].id}::uuid
        `;
      }
    }

    // Phase 21: notify employees & emit automated encrypted payslip email rule (best effort)
    void import('../notifications/email-automation-service.js')
      .then(async ({ emailAutomationService }) => {
        for (const re of runEmployees) {
          await emailAutomationService
            .emitEvent('payroll.payslip.released', 'PAYSLIP', re.id, 1)
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return { runId, releasedCount: runEmployees.length };
  }
}
