import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { insertRow } from '../procurement/core';
import { HrCrypto } from '../hr/hr-crypto';

export class BankFileService {
  static async listTemplates(db: Db) {
    return db.$queryRaw<any[]>`
      SELECT * FROM "bank_file_templates" WHERE "active" = true ORDER BY "name" ASC
    `;
  }

  static async listBatches(db: Db, runId?: string) {
    let query = `
      SELECT b.*, r."run_no", t."name" as "template_name"
      FROM "bank_transfer_batches" b
      JOIN "payroll_runs" r ON r."id" = b."payroll_run_id"
      LEFT JOIN "bank_file_templates" t ON t."id" = b."bank_template_id"
    `;
    if (runId) {
      query += ` WHERE b."payroll_run_id" = '${runId}'::uuid`;
    }
    query += ` ORDER BY b."generated_at" DESC`;

    return db.$queryRawUnsafe<any[]>(query);
  }

  static async generateBatch(
    db: Db,
    data: {
      payroll_run_id: string;
      bank_template_id: string;
    },
    caller: Caller,
  ) {
    const runs = await db.$queryRaw<any[]>`
      SELECT * FROM "payroll_runs" WHERE "id" = ${data.payroll_run_id}::uuid
    `;
    if (runs.length === 0) throw Errors.notFound('Payroll run not found');
    const run = runs[0];

    if (run.status !== 'LOCKED' && run.status !== 'POSTED') {
      throw Errors.conflict('Payroll run must be LOCKED or POSTED before generating bank transfer batch');
    }

    const templateRows = await db.$queryRaw<any[]>`
      SELECT * FROM "bank_file_templates" WHERE "id" = ${data.bank_template_id}::uuid
    `;
    if (templateRows.length === 0) throw Errors.notFound('Bank template not found');
    const template = templateRows[0];

    // Fetch all run employees with primary bank accounts
    const employees = await db.$queryRaw<any[]>`
      SELECT pre."id" as "run_emp_id", pre."employee_id", pre."net",
             e."emp_code", e."full_name",
             eba."account_number_encrypted", eba."ifsc_code", eba."account_name"
      FROM "payroll_run_employees" pre
      JOIN "employees" e ON e."id" = pre."employee_id"
      LEFT JOIN "employee_bank_accounts" eba ON eba."employee_id" = e."id" AND eba."is_primary" = true
      WHERE pre."run_id" = ${data.payroll_run_id}::uuid AND pre."net" > 0 AND pre."status" != 'HELD'
    `;

    if (employees.length === 0) {
      throw Errors.conflict('No eligible employees with positive net pay to disburse');
    }

    const batchCount = await db.$queryRaw<any[]>`SELECT count(*)::int as c FROM "bank_transfer_batches"`;
    const batchNo = `BTB-${new Date().getFullYear()}-${String(Number(batchCount[0]?.c ?? 0) + 1).padStart(4, '0')}`;

    let totalAmount = 0;
    const linesToInsert: Array<{
      employee_id: string;
      beneficiary_name: string;
      ifsc_code: string;
      account_number_decrypted: string;
      account_number_masked: string;
      amount: number;
    }> = [];

    for (const emp of employees) {
      if (!emp.account_number_encrypted || !emp.ifsc_code) {
        throw Errors.validation({ employee: `Employee ${emp.emp_code} (${emp.full_name}) is missing primary bank account details` });
      }

      if (!HrCrypto.validateIfsc(emp.ifsc_code)) {
        throw Errors.validation({ ifsc: `Invalid IFSC code ${emp.ifsc_code} for employee ${emp.emp_code}` });
      }

      const decryptedAcc = HrCrypto.decryptBank(emp.account_number_encrypted);
      const maskedAcc = HrCrypto.maskAccount(decryptedAcc);
      const amt = Number(emp.net);

      linesToInsert.push({
        employee_id: emp.employee_id,
        beneficiary_name: emp.account_name || emp.full_name,
        ifsc_code: emp.ifsc_code.toUpperCase(),
        account_number_decrypted: decryptedAcc,
        account_number_masked: maskedAcc,
        amount: amt,
      });

      totalAmount += amt;
    }

    const batchId = await insertRow(db, 'bank_transfer_batches', {
      batch_no: batchNo,
      payroll_run_id: data.payroll_run_id,
      bank_template_id: data.bank_template_id,
      total_amount: totalAmount,
      total_records: linesToInsert.length,
      status: 'GENERATED',
      created_by_id: caller.auth.userId,
    });

    for (const line of linesToInsert) {
      await insertRow(db, 'bank_transfer_batch_lines', {
        batch_id: batchId,
        employee_id: line.employee_id,
        beneficiary_name: line.beneficiary_name,
        ifsc_code: line.ifsc_code,
        account_number_masked: line.account_number_masked,
        amount: line.amount,
        status: 'PENDING',
      });
    }

    // Generate CSV file content
    const csvRows = ['AccountNo,BeneficiaryName,Amount,IFSC,PaymentRef'];
    for (const line of linesToInsert) {
      csvRows.push(
        `"${line.account_number_decrypted}","${line.beneficiary_name}",${line.amount.toFixed(2)},"${line.ifsc_code}","Salary-${run.run_no}"`
      );
    }
    const csvContent = csvRows.join('\r\n');

    return {
      batchId,
      batchNo,
      totalRecords: linesToInsert.length,
      totalAmount,
      csvContent,
    };
  }
}
