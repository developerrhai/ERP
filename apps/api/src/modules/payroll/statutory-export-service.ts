import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';

export class StatutoryExportService {
  /**
   * ECR 2.0 Electronic Challan cum Return format (#~# delimiter)
   */
  static async generateEcrText(db: Db, runId: string): Promise<string> {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const rows = await db.$queryRaw<any[]>`
      SELECT pre."gross", pre."ncp_days", pre."snapshot",
             e."emp_code", e."full_name",
             eiv."uan"
      FROM "payroll_run_employees" pre
      JOIN "payroll_employees_v" e ON e."id" = pre."employee_id"
      LEFT JOIN "payroll_identity_v" eiv ON eiv."employee_id" = e."id"
      WHERE pre."run_id" = ${runId}::uuid
      ORDER BY e."emp_code" ASC
    `;

    if (rows.length === 0) {
      throw Errors.notFound('No payroll employees found for this run');
    }

    const lines: string[] = [];
    for (const r of rows) {
      const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
      const uan = r.uan || '100000000000';
      const name = r.full_name;
      const gross = Math.round(Number(r.gross));
      const epfWage = Math.round(snap?.codeWage?.finalWage ?? gross);
      const cappedWage = Math.min(15000, epfWage);
      const epsWage = cappedWage;
      const edliWage = cappedWage;

      const eeShare = Math.round(snap?.pf?.employeePF ?? 0);
      const epsShare = Math.round(snap?.pf?.employerEPS ?? 0);
      const erShare = Math.round(snap?.pf?.employerEPF ?? 0);
      const ncpDays = Math.round(Number(r.ncp_days ?? 0));
      const refundOfAdvances = 0;

      // ECR 2.0 format fields separated by #~#
      const fields = [
        uan,
        name,
        gross,
        cappedWage,
        epsWage,
        edliWage,
        eeShare,
        epsShare,
        erShare,
        ncpDays,
        refundOfAdvances,
      ];

      lines.push(fields.join('#~#'));
    }

    return lines.join('\r\n');
  }

  /**
   * ESIC Monthly Return CSV format
   */
  static async generateEsicCsv(db: Db, runId: string): Promise<string> {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const rows = await db.$queryRaw<any[]>`
      SELECT pre."gross", pre."paid_days", pre."snapshot",
             e."emp_code", e."full_name",
             eiv."esic_number"
      FROM "payroll_run_employees" pre
      JOIN "payroll_employees_v" e ON e."id" = pre."employee_id"
      LEFT JOIN "payroll_identity_v" eiv ON eiv."employee_id" = e."id"
      WHERE pre."run_id" = ${runId}::uuid
      ORDER BY e."emp_code" ASC
    `;

    const csvLines = ['IP Number,IP Name,No of Days,Total Monthly Wages,IP Contribution,Reason Code'];
    for (const r of rows) {
      const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
      if (!snap?.esic?.isCovered) continue;

      const ipNo = r.esic_number || '3100000000';
      const name = r.full_name;
      const days = Math.round(Number(r.paid_days));
      const wages = Math.round(Number(r.gross));
      const ipContrib = Math.round(snap?.esic?.employeeESIC ?? 0);
      const reasonCode = '0'; // 0 for normal working

      csvLines.push(`"${ipNo}","${name}",${days},${wages},${ipContrib},"${reasonCode}"`);
    }

    return csvLines.join('\r\n');
  }

  /**
   * Maharashtra PT Monthly Statement
   */
  static async getPtStatement(db: Db, runId: string) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const rows = await db.$queryRaw<any[]>`
      SELECT pre."snapshot", e."gender", pre."gross"
      FROM "payroll_run_employees" pre
      JOIN "payroll_employees_v" e ON e."id" = pre."employee_id"
      WHERE pre."run_id" = ${runId}::uuid
    `;

    let slab0 = 0;
    let slab175 = 0;
    let slab200 = 0;
    let slab300 = 0;

    for (const r of rows) {
      const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
      const pt = snap?.pt ?? 0;
      if (pt === 175) slab175++;
      else if (pt === 200) slab200++;
      else if (pt === 300) slab300++;
      else slab0++;
    }

    const totalTax = slab175 * 175 + slab200 * 200 + slab300 * 300;

    return {
      runId,
      state: 'Maharashtra',
      breakdown: [
        { slab: 'Nil', count: slab0, rate: 0, tax: 0 },
        { slab: 'Rs 175 (7501-10000)', count: slab175, rate: 175, tax: slab175 * 175 },
        { slab: 'Rs 200 (>10000, non-Feb)', count: slab200, rate: 200, tax: slab200 * 200 },
        { slab: 'Rs 300 (February)', count: slab300, rate: 300, tax: slab300 * 300 },
      ],
      totalTax,
      totalEmployees: rows.length,
    };
  }
}

