// Phase 22 fix: the payroll SQL must run against the real schema (it used to read columns the employees
// table does not have). These calls use an unknown run id, so no rows come back, but a missing column or
// table would still throw a database error. A real run with data is covered by the HR/payroll feeders.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PayslipService } from '../src/modules/payroll/payslip-service';
import { PayrollService } from '../src/modules/payroll/payroll-service';
import { StatutoryExportService } from '../src/modules/payroll/statutory-export-service';
import { prisma } from './helpers';

describe('payroll SQL matches the schema', () => {
  it('payroll_employees_v exposes the columns payroll reads', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'payroll_employees_v'`;
    const names = cols.map((c) => c.column_name);
    for (const c of [
      'id',
      'emp_code',
      'full_name',
      'gender',
      'date_of_joining',
      'has_disability',
      'designation',
      'department',
      'status',
    ]) {
      expect(names, c).toContain(c);
    }
  });

  it('payslip, ECR and ESIC queries run (a clean 404 for an unknown run)', async () => {
    await expect(PayslipService.getPayslip(prisma, randomUUID())).rejects.toThrow(/not found/i);
    await expect(StatutoryExportService.generateEcrText(prisma, randomUUID())).rejects.toThrow(
      /No payroll employees/,
    );
    // ESIC returns only its header row for a run with no employees
    expect(await StatutoryExportService.generateEsicCsv(prisma, randomUUID())).toMatch(
      /^IP Number/,
    );
  });

  it('getRun of an unknown run is a clean not-found, not a database error', async () => {
    await expect(PayrollService.getRun(prisma, randomUUID())).rejects.toThrow(/not found/i);
  });
});
