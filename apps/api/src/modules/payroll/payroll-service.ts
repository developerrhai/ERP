import { createHash } from 'node:crypto';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import type { Caller } from '../records/service';
import { insertRow } from '../procurement/core';
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
  roundHalfUp,
  type ComponentInput,
} from './payroll-calc';
import { PayrollPostingAdapter } from './posting-adapter';

export class PayrollService {
  // -------------------------------------------------------------
  // Pay Components
  // -------------------------------------------------------------
  static async listComponents(db: Db) {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return db.$queryRaw<any[]>`
      SELECT * FROM "pay_components" ORDER BY "payslip_order" ASC, "code" ASC
    `;
  }

  static async createComponent(
    db: Db,
    data: {
      code: string;
      name: string;
      kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIB';
      calc_type: 'FIXED' | 'FORMULA' | 'ATTENDANCE' | 'INPUT' | 'STATUTORY';
      formula?: string;
      prorate?: boolean;
      taxable?: boolean;
      pf_wage?: boolean;
      esic_wage?: boolean;
      pt_wage?: boolean;
      code_wage_class?: 'INCLUDED' | 'EXCLUDED';
      bonus_wage?: boolean;
      gratuity_wage?: boolean;
      payslip_order?: number;
      payslip_label_hi?: string;
      gl_key?: string;
    },
    caller: Caller,
  ) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const existing = await db.$queryRaw<any[]>`
      SELECT "id" FROM "pay_components" WHERE "code" = ${data.code}
    `;
    if (existing.length > 0) {
      throw Errors.conflict(`Component code ${data.code} already exists`);
    }

    const row = {
      code: data.code,
      name: data.name,
      kind: data.kind,
      calc_type: data.calc_type,
      formula: data.formula ?? null,
      prorate: data.prorate ?? true,
      taxable: data.taxable ?? true,
      pf_wage: data.pf_wage ?? true,
      esic_wage: data.esic_wage ?? true,
      pt_wage: data.pt_wage ?? true,
      code_wage_class: data.code_wage_class ?? 'INCLUDED',
      bonus_wage: data.bonus_wage ?? true,
      gratuity_wage: data.gratuity_wage ?? true,
      payslip_order: data.payslip_order ?? 10,
      payslip_label_hi: data.payslip_label_hi ?? null,
      gl_key: data.gl_key ?? 'SALARY_EXPENSE',
      active: true,
      created_by_id: caller.auth.userId,
    };

    return insertRow(db, 'pay_components', row);
  }

  // -------------------------------------------------------------
  // Pay Structures
  // -------------------------------------------------------------
  static async listStructures(db: Db) {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    const structures = await db.$queryRaw<any[]>`
      SELECT * FROM "pay_structures" ORDER BY "code" ASC
    `;
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    const lines = await db.$queryRaw<any[]>`
      SELECT l.*, c."code" as "component_code", c."name" as "component_name", c."kind", c."calc_type"
      FROM "pay_structure_lines" l
      JOIN "pay_components" c ON c."id" = l."component_id"
      ORDER BY l."sequence" ASC
    `;

    return structures.map((s) => ({
      ...s,
      lines: lines.filter((l) => l.structure_id === s.id),
    }));
  }

  static async createStructure(
    db: Db,
    data: {
      code: string;
      name: string;
      description?: string;
      lines: Array<{
        component_id: string;
        formula_override?: string;
        amount_override?: number;
        sequence?: number;
      }>;
    },
    caller: Caller,
  ) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const existing = await db.$queryRaw<any[]>`
      SELECT "id" FROM "pay_structures" WHERE "code" = ${data.code}
    `;
    if (existing.length > 0) {
      throw Errors.conflict(`Structure code ${data.code} already exists`);
    }

    const structureId = await insertRow(db, 'pay_structures', {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      version: 1,
      active: true,
      created_by_id: caller.auth.userId,
    });

    let seq = 10;
    for (const line of data.lines) {
      await insertRow(db, 'pay_structure_lines', {
        structure_id: structureId,
        component_id: line.component_id,
        formula_override: line.formula_override ?? null,
        amount_override: line.amount_override ?? null,
        sequence: line.sequence ?? seq,
      });
      seq += 10;
    }

    return structureId;
  }

  // -------------------------------------------------------------
  // Salary Assignments
  // -------------------------------------------------------------
  static async assignSalary(
    db: Db,
    data: {
      employee_id: string;
      structure_id: string;
      monthly_ctc: number;
      effective_from: string;
      lines?: Array<{
        component_id: string;
        monthly_amount: number;
        formula_override?: string;
      }>;
    },
    caller: Caller,
  ) {
    // Supersede any existing active assignment with overlapping dates
    await db.$executeRaw`
      UPDATE "employee_salary_assignments"
      SET "status" = 'SUPERSEDED', "effective_to" = ${data.effective_from}::date - interval '1 day'
      WHERE "employee_id" = ${data.employee_id}::uuid AND "status" = 'ACTIVE'
    `;

    const assignmentId = await insertRow(db, 'employee_salary_assignments', {
      employee_id: data.employee_id,
      structure_id: data.structure_id,
      monthly_ctc: data.monthly_ctc,
      effective_from: data.effective_from,
      effective_to: null,
      status: 'ACTIVE',
      created_by_id: caller.auth.userId,
    });

    if (data.lines && data.lines.length > 0) {
      for (const line of data.lines) {
        await insertRow(db, 'salary_assignment_lines', {
          assignment_id: assignmentId,
          component_id: line.component_id,
          monthly_amount: line.monthly_amount,
          formula_override: line.formula_override ?? null,
        });
      }
    }

    return assignmentId;
  }

  // -------------------------------------------------------------
  // Statutory Rates
  // -------------------------------------------------------------
  static async listStatutoryRates(db: Db) {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return db.$queryRaw<any[]>`
      SELECT * FROM "statutory_rates" ORDER BY "rate_type" ASC, "effective_from" DESC
    `;
  }

  static async reviewStatutoryRate(db: Db, id: string, caller: Caller) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const rows = await db.$queryRaw<any[]>`
      SELECT "id" FROM "statutory_rates" WHERE "id" = ${id}::uuid
    `;
    if (rows.length === 0) {
      throw Errors.notFound('Statutory rate not found');
    }

    await db.$executeRaw`
      UPDATE "statutory_rates"
      SET "needs_review" = false, "reviewed_by_id" = ${caller.auth.userId}::uuid, "reviewed_at" = now()
      WHERE "id" = ${id}::uuid
    `;

    return { id, reviewed: true };
  }

  // -------------------------------------------------------------
  // Payroll Periods
  // -------------------------------------------------------------
  static async listPeriods(db: Db) {
    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return db.$queryRaw<any[]>`
      SELECT * FROM "payroll_periods" ORDER BY "month" DESC
    `;
  }

  static async createPeriod(
    db: Db,
    data: {
      month: string; // '2027-02'
      start_date: string;
      end_date: string;
      days_basis: number;
    },
  ) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const existing = await db.$queryRaw<any[]>`
      SELECT "id" FROM "payroll_periods" WHERE "month" = ${data.month}
    `;
    if (existing.length > 0) {
      throw Errors.conflict(`Payroll period for ${data.month} already exists`);
    }

    return insertRow(db, 'payroll_periods', {
      month: data.month,
      start_date: data.start_date,
      end_date: data.end_date,
      days_basis: data.days_basis,
      status: 'OPEN',
    });
  }

  // -------------------------------------------------------------
  // Payroll Runs (Life cycle: DRAFT -> CALCULATED -> APPROVED -> LOCKED -> POSTED)
  // -------------------------------------------------------------
  static async listRuns(db: Db, filter?: { period_id?: string; unit_id?: string }) {
    let whereClause = `WHERE 1=1`;
    if (filter?.period_id) whereClause += ` AND r."period_id" = '${filter.period_id}'::uuid`;
    if (filter?.unit_id) whereClause += ` AND r."unit_id" = '${filter.unit_id}'::uuid`;

    // unpaginated: admin-defined config table, a few hundred rows at most; page UIs read it whole
    return db.$queryRawUnsafe<any[]>(`
      SELECT r.*, p."month" as "period_month", u."name" as "unit_name"
      FROM "payroll_runs" r
      JOIN "payroll_periods" p ON p."id" = r."period_id"
      LEFT JOIN "units" u ON u."id" = r."unit_id"
      ${whereClause}
      ORDER BY r."created_at" DESC
    `);
  }

  static async getRun(db: Db, id: string) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const runs = await db.$queryRaw<any[]>`
      SELECT r.*, p."month" as "period_month", p."start_date", p."end_date", p."days_basis", u."name" as "unit_name"
      FROM "payroll_runs" r
      JOIN "payroll_periods" p ON p."id" = r."period_id"
      LEFT JOIN "units" u ON u."id" = r."unit_id"
      WHERE r."id" = ${id}::uuid
    `;
    if (runs.length === 0) {
      throw Errors.notFound('Payroll run not found');
    }

    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const employees = await db.$queryRaw<any[]>`
      SELECT pre.*, e."emp_code", e."full_name", e."gender", e."date_of_joining"
      FROM "payroll_run_employees" pre
      JOIN "payroll_employees_v" e ON e."id" = pre."employee_id"
      WHERE pre."run_id" = ${id}::uuid
      ORDER BY e."emp_code" ASC
    `;

    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const lines = await db.$queryRaw<any[]>`
      SELECT prl.*, c."code" as "component_code", c."name" as "component_name", c."kind"
      FROM "payroll_run_lines" prl
      JOIN "pay_components" c ON c."id" = prl."component_id"
      JOIN "payroll_run_employees" pre ON pre."id" = prl."run_employee_id"
      WHERE pre."run_id" = ${id}::uuid
      ORDER BY c."payslip_order" ASC
    `;

    return {
      ...runs[0],
      employees: employees.map((emp) => ({
        ...emp,
        lines: lines.filter((l) => l.run_employee_id === emp.id),
      })),
    };
  }

  static async createRun(
    db: Db,
    data: {
      period_id: string;
      unit_id?: string;
      run_type?: 'REGULAR' | 'ARREAR' | 'FNF' | 'BONUS' | 'REVERSAL';
      reversal_of_id?: string;
    },
    caller: Caller,
  ) {
    const runType = data.run_type ?? 'REGULAR';

    if (runType === 'REGULAR') {
      // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
      const existing = await db.$queryRaw<any[]>`
        SELECT "id" FROM "payroll_runs"
        WHERE "period_id" = ${data.period_id}::uuid
          AND (("unit_id" = ${data.unit_id}::uuid) OR (${data.unit_id || null} IS NULL AND "unit_id" IS NULL))
          AND "run_type" = 'REGULAR'
          AND "status" != 'CANCELLED'
      `;
      if (existing.length > 0) {
        throw Errors.conflict('A regular payroll run already exists for this period and unit');
      }
    }

    const count = await db.$queryRaw<any[]>`
      SELECT COUNT(*)::int as c FROM "payroll_runs"
    `;
    const runNo = `PR-${new Date().getFullYear()}-${String(Number(count[0]?.c ?? 0) + 1).padStart(4, '0')}`;

    return insertRow(db, 'payroll_runs', {
      run_no: runNo,
      period_id: data.period_id,
      unit_id: data.unit_id ?? null,
      run_type: runType,
      status: 'DRAFT',
      reversal_of_id: data.reversal_of_id ?? null,
      created_by_id: caller.auth.userId,
    });
  }

  // -------------------------------------------------------------
  // Calculate Payroll Run (13 Steps algorithm per §5)
  // -------------------------------------------------------------
  static async calculateRun(db: Db, runId: string, caller: Caller) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const runs = await db.$queryRaw<any[]>`
      SELECT r.*, p."month", p."start_date", p."end_date", p."days_basis"
      FROM "payroll_runs" r
      JOIN "payroll_periods" p ON p."id" = r."period_id"
      WHERE r."id" = ${runId}::uuid
    `;
    if (runs.length === 0) throw Errors.notFound('Payroll run not found');
    const run = runs[0];

    if (run.status === 'LOCKED' || run.status === 'POSTED') {
      throw Errors.conflict('Cannot re-calculate locked or posted payroll run');
    }

    const monthNum = parseInt(run.month.split('-')[1], 10);
    const calendarDays = run.days_basis;

    // Fetch active employees with active assignments
    let empQuery = `
      SELECT e."id", e."emp_code", e."full_name", e."gender", e."date_of_joining", e."has_disability",
             esa."id" as "assignment_id", esa."structure_id", esa."monthly_ctc",
             (SELECT cc."id" FROM "cost_centers" cc WHERE cc."code" = ea."cost_centre" OR cc."name" = ea."cost_centre" LIMIT 1) AS "cost_center_id"
      FROM "payroll_employees_v" e
      JOIN "employee_salary_assignments" esa ON esa."employee_id" = e."id" AND esa."status" = 'ACTIVE'
      LEFT JOIN "employee_assignments" ea ON ea."employee_id" = e."id" AND ea."effective_to" IS NULL
      WHERE e."status" = 'ACTIVE'
    `;
    if (run.unit_id) {
      empQuery += ` AND ea."unit_id" = '${run.unit_id}'::uuid`;
    }

    const employees = await db.$queryRawUnsafe<any[]>(empQuery);
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const components = await db.$queryRaw<any[]>`
      SELECT * FROM "pay_components" WHERE "active" = true ORDER BY "payslip_order" ASC
    `;

    // Compute input hash for idempotency
    const inputHash = createHash('sha256')
      .update(`${runId}:${employees.length}:${calendarDays}:${components.length}`)
      .digest('hex');

    // Clean existing run calculations
    await db.$executeRaw`DELETE FROM "payroll_run_employees" WHERE "run_id" = ${runId}::uuid`;

    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let totalEmployerCost = 0;

    for (const emp of employees) {
      // Step 1: Assignment Lines (Structure + Employee Overrides)
      // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
      const assignmentLines = await db.$queryRaw<any[]>`
        SELECT sal.*, c."code", c."kind", c."calc_type", c."prorate", c."code_wage_class", c."formula"
        FROM "salary_assignment_lines" sal
        JOIN "pay_components" c ON c."id" = sal."component_id"
        WHERE sal."assignment_id" = ${emp.assignment_id}::uuid
      `;

      // Step 2: Attendance (Paid days, LOP, NCP, OT)
      // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
      const attSummaries = await db.$queryRaw<any[]>`
        SELECT * FROM "attendance_period_summary"
        WHERE "employee_id" = ${emp.id}::uuid AND "period_month" = ${run.month}
      `;
      const att = attSummaries[0] ?? {
        paid_days: calendarDays,
        lop_days: 0,
        ncp_days: 0,
        approved_ot_hours: 0,
      };

      const paidDays = Number(att.paid_days);
      const lopDays = Number(att.lop_days);
      const ncpDays = Number(att.ncp_days);
      const otHours = Number(att.approved_ot_hours);

      // Step 3 & 4: Pro-rate & Formulas
      const compMap: Record<string, number> = {};
      const earnedLines: Array<{
        componentId: string;
        code: string;
        kind: string;
        amount: number;
        code_wage_class: 'INCLUDED' | 'EXCLUDED';
      }> = [];

      for (const line of assignmentLines) {
        let earned = Number(line.monthly_amount);
        if (line.prorate) {
          earned = prorateComponent(earned, paidDays, calendarDays);
        }
        compMap[line.code] = earned;
        earnedLines.push({
          componentId: line.component_id,
          code: line.code,
          kind: line.kind,
          amount: earned,
          code_wage_class: line.code_wage_class,
        });
      }

      // Step 5: OT, Incentives, Arrears
      let otAmount = 0;
      if (otHours > 0) {
        const basicAmt = compMap['BASIC'] ?? 0;
        const daAmt = compMap['DA'] ?? 0;
        otAmount = calculateOtAmount(basicAmt + daAmt, otHours);
        compMap['OT'] = otAmount;
        const otComp = components.find((c) => c.code === 'OT');
        if (otComp) {
          earnedLines.push({
            componentId: otComp.id,
            code: 'OT',
            kind: 'EARNING',
            amount: otAmount,
            code_wage_class: 'EXCLUDED',
          });
        }
      }

      // Step 6: Gross
      const grossEarnings = earnedLines
        .filter((l) => l.kind === 'EARNING')
        .reduce((sum, l) => sum + l.amount, 0);

      // Step 7: Code on Wages 50% Add-Back
      const codeWageInputs: ComponentInput[] = earnedLines.map((l) => ({
        code: l.code,
        amount: l.amount,
        code_wage_class: l.code_wage_class,
      }));
      const codeWage = calculateCodeWage(codeWageInputs);

      // Step 8: PF, ESIC, PT, MLWF
      const pfResult = calculatePF({
        pfWage: codeWage.finalWage,
        isRestrictedToCeiling: true,
        age: 30, // Default below 58
        isExcludedFromEps: false,
        vpfAmount: 0,
      });

      // Fixed gross for ESIC coverage test
      const fixedGross = assignmentLines
        .filter((l) => l.kind === 'EARNING')
        .reduce((sum, l) => sum + Number(l.monthly_amount), 0);

      const esicResult = calculateESIC({
        fixedGross,
        actualGrossForContribution: grossEarnings,
        paidDays,
        hasDisability: emp.has_disability,
        otAmount,
      });

      const ptAmount = calculatePTMaharashtra({
        grossWage: grossEarnings,
        gender: emp.gender,
        month: monthNum,
        hasDisability: emp.has_disability,
      });

      const mlwfResult = calculateMLWF(monthNum);

      // Step 9: Loan EMIs
      let loanEmi = 0;
      const dueSchedules = await db.$queryRaw<any[]>`
        SELECT ls.* FROM "loan_schedules" ls
        JOIN "employee_loans" el ON el."id" = ls."loan_id"
        WHERE el."employee_id" = ${emp.id}::uuid AND ls."status" = 'PENDING'
        ORDER BY ls."instalment_no" ASC
        LIMIT 1
      `;
      if (dueSchedules.length > 0) {
        loanEmi = Number(dueSchedules[0].total_amount);
      }

      // Step 9b (Phase 29): the employee share of a CLOSED canteen month for this payroll month
      const canteenRows = await db.$queryRaw<any[]>`
        SELECT coalesce(sum(c.employee_share), 0)::float AS amt FROM "canteen_coupons" c
        JOIN "canteen_months" m ON m.unit_id = c.unit_id AND m.month = ${run.month} AND m.status = 'CLOSED'
        WHERE c.person_kind = 'EMPLOYEE' AND c.person_id = ${emp.id}::uuid AND c.payment_mode = 'PAYROLL' AND c.status = 'SERVED'
          AND to_char(c.date, 'YYYY-MM') = ${run.month}
      `;
      const canteenDed = Number(canteenRows[0]?.amt ?? 0);

      // Step 10: TDS
      const tdsResult = calculateTdsProjection({
        ytdTaxableGross: grossEarnings * 10, // Simulated projection for 12 months
        currentMonthTaxableGross: grossEarnings,
        remainingMonths: Math.max(0, 12 - monthNum),
        ytdTdsDeducted: 0,
      });

      // Step 11: Net
      const totalEmpDeductions =
        pfResult.employeePF +
        esicResult.employeeESIC +
        ptAmount +
        mlwfResult.employeeMLWF +
        loanEmi +
        canteenDed +
        tdsResult.currentMonthTDS;

      let netSalary = grossEarnings - totalEmpDeductions;
      let empStatus: 'OK' | 'WARN' | 'ERROR' | 'HELD' = 'OK';
      if (netSalary < 0) {
        empStatus = 'HELD';
        netSalary = 0; // Defer EMI
      }

      // Step 12: Employer Costs, Bonus, Gratuity
      const bonusAccrual = calculateBonusAccrual(compMap['BASIC'] ?? grossEarnings);
      const gratuityProvision = calculateGratuityMonthly(compMap['BASIC'] ?? grossEarnings);
      const totalEmployerContribution =
        pfResult.employerTotal +
        pfResult.edli +
        pfResult.pfAdmin +
        esicResult.employerESIC +
        mlwfResult.employerMLWF;
      const totalEmployerCostEmp = grossEarnings + totalEmployerContribution + bonusAccrual + gratuityProvision;

      // Step 13: Create Run Employee & Lines
      const runEmpId = await insertRow(db, 'payroll_run_employees', {
        run_id: runId,
        employee_id: emp.id,
        paid_days: paidDays,
        lop_days: lopDays,
        ncp_days: ncpDays,
        gross: grossEarnings,
        deductions: totalEmpDeductions,
        net: netSalary,
        employer_cost: totalEmployerCostEmp,
        status: empStatus,
        messages: JSON.stringify([]),
        snapshot: JSON.stringify({
          pf: pfResult,
          esic: esicResult,
          pt: ptAmount,
          mlwf: mlwfResult,
          tds: tdsResult,
          codeWage,
          cost_center_id: emp.cost_center_id,
        }),
      });

      // Insert Earning Lines
      for (const line of earnedLines) {
        await insertRow(db, 'payroll_run_lines', {
          run_employee_id: runEmpId,
          component_id: line.componentId,
          amount: line.amount,
          source: line.code === 'OT' ? 'OT' : 'STRUCTURE',
        });
      }

      // Insert Deduction Lines
      const dedMap: Record<string, number> = {
        PF: pfResult.employeePF,
        ESIC: esicResult.employeeESIC,
        PT: ptAmount,
        MLWF: mlwfResult.employeeMLWF,
        LOAN: loanEmi,
        CANTEEN_DED: canteenDed,
        TDS: tdsResult.currentMonthTDS,
      };

      for (const [code, amt] of Object.entries(dedMap)) {
        if (amt > 0) {
          const c = components.find((comp) => comp.code === code);
          if (c) {
            await insertRow(db, 'payroll_run_lines', {
              run_employee_id: runEmpId,
              component_id: c.id,
              amount: amt,
              source: code === 'LOAN' ? 'LOAN' : code === 'CANTEEN_DED' ? 'MANUAL' : 'STATUTORY',
            });
          }
        }
      }

      totalGross += grossEarnings;
      totalDeductions += totalEmpDeductions;
      totalNet += netSalary;
      totalEmployerCost += totalEmployerCostEmp;
    }

    // Update Run Totals
    await db.$executeRaw`
      UPDATE "payroll_runs"
      SET "status" = 'CALCULATED',
          "total_gross" = ${totalGross},
          "total_deductions" = ${totalDeductions},
          "total_net" = ${totalNet},
          "total_employer_cost" = ${totalEmployerCost},
          "employee_count" = ${employees.length},
          "input_hash" = ${inputHash},
          "updated_at" = now()
      WHERE "id" = ${runId}::uuid
    `;

    return {
      runId,
      status: 'CALCULATED',
      employeeCount: employees.length,
      totalGross,
      totalDeductions,
      totalNet,
      totalEmployerCost,
      inputHash,
    };
  }

  // -------------------------------------------------------------
  // Lock Payroll Run
  // -------------------------------------------------------------
  static async lockRun(db: Db, runId: string, caller: Caller) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const runs = await db.$queryRaw<any[]>`
      SELECT * FROM "payroll_runs" WHERE "id" = ${runId}::uuid
    `;
    if (runs.length === 0) throw Errors.notFound('Payroll run not found');
    const run = runs[0];

    if (run.status !== 'CALCULATED' && run.status !== 'APPROVED') {
      throw Errors.conflict(`Cannot lock payroll run with status ${run.status}`);
    }

    await db.$executeRaw`
      UPDATE "payroll_runs"
      SET "status" = 'LOCKED',
          "locked_at" = now(),
          "locked_by_id" = ${caller.auth.userId}::uuid,
          "updated_at" = now()
      WHERE "id" = ${runId}::uuid
    `;

    return { runId, status: 'LOCKED' };
  }

  // -------------------------------------------------------------
  // Post Payroll Run to GL
  // -------------------------------------------------------------
  static async postRun(db: Db, runId: string, caller: Caller) {
    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const runs = await db.$queryRaw<any[]>`
      SELECT r.*, p."start_date", p."end_date"
      FROM "payroll_runs" r
      JOIN "payroll_periods" p ON p."id" = r."period_id"
      WHERE r."id" = ${runId}::uuid
    `;
    if (runs.length === 0) throw Errors.notFound('Payroll run not found');
    const run = runs[0];

    if (run.status !== 'LOCKED' && run.status !== 'APPROVED') {
      throw Errors.conflict(`Run must be LOCKED or APPROVED before posting. Current: ${run.status}`);
    }

    // unpaginated: whole-run/period build: a payroll run, bank file or statutory export needs every row of that run
    const runEmployees = await db.$queryRaw<any[]>`
      SELECT * FROM "payroll_run_employees" WHERE "run_id" = ${runId}::uuid
    `;

    // Aggregate totals and department cost centre splits
    let totalGross = 0;
    let totalNet = 0;
    let totalEmployeePf = 0;
    let totalEmployerPf = 0;
    let totalEdli = 0;
    let totalPfAdmin = 0;
    let totalEmployeeEsic = 0;
    let totalEmployerEsic = 0;
    let totalPt = 0;
    let totalMlwfEmp = 0;
    let totalMlwfEmpr = 0;
    let totalTds = 0;
    let totalLoanEmi = 0;
    let totalBonusProvision = 0;
    let totalGratuityProvision = 0;

    const deptMap: Record<
      string,
      {
        costCenterId?: string;
        gross: number;
        employerPf: number;
        employerEsic: number;
        bonusProvision: number;
        gratuityProvision: number;
      }
    > = {};

    for (const emp of runEmployees) {
      const snap = typeof emp.snapshot === 'string' ? JSON.parse(emp.snapshot) : emp.snapshot;
      const gross = Number(emp.gross);
      const net = Number(emp.net);
      const empPf = snap?.pf?.employeePF ?? 0;
      const emprPf = snap?.pf?.employerTotal ?? 0;
      const edli = snap?.pf?.edli ?? 0;
      const pfAdmin = snap?.pf?.pfAdmin ?? 0;
      const empEsic = snap?.esic?.employeeESIC ?? 0;
      const emprEsic = snap?.esic?.employerESIC ?? 0;
      const pt = snap?.pt ?? 0;
      const mlwfEmp = snap?.mlwf?.employeeMLWF ?? 0;
      const mlwfEmpr = snap?.mlwf?.employerMLWF ?? 0;
      const tds = snap?.tds?.currentMonthTDS ?? 0;
      const bonus = calculateBonusAccrual(gross);
      const gratuity = calculateGratuityMonthly(gross);

      totalGross += gross;
      totalNet += net;
      totalEmployeePf += empPf;
      totalEmployerPf += emprPf;
      totalEdli += edli;
      totalPfAdmin += pfAdmin;
      totalEmployeeEsic += empEsic;
      totalEmployerEsic += emprEsic;
      totalPt += pt;
      totalMlwfEmp += mlwfEmp;
      totalMlwfEmpr += mlwfEmpr;
      totalTds += tds;
      totalBonusProvision += bonus;
      totalGratuityProvision += gratuity;

      const ccId = snap?.cost_center_id ?? 'DEFAULT';
      if (!deptMap[ccId]) {
        deptMap[ccId] = {
          costCenterId: snap?.cost_center_id,
          gross: 0,
          employerPf: 0,
          employerEsic: 0,
          bonusProvision: 0,
          gratuityProvision: 0,
        };
      }
      deptMap[ccId].gross += gross;
      deptMap[ccId].employerPf += emprPf;
      deptMap[ccId].employerEsic += emprEsic;
      deptMap[ccId].bonusProvision += bonus;
      deptMap[ccId].gratuityProvision += gratuity;
    }

    const unitId = run.unit_id ?? caller.ctx.unitId ?? '';
    const posted = await PayrollPostingAdapter.postPayrollRun(
      db,
      {
        runId: run.id,
        runNo: run.run_no,
        unitId,
        periodDate: run.end_date,
        totals: {
          gross: totalGross,
          net: totalNet,
          employeePf: totalEmployeePf,
          employerPf: totalEmployerPf,
          edli: totalEdli,
          pfAdmin: totalPfAdmin,
          employeeEsic: totalEmployeeEsic,
          employerEsic: totalEmployerEsic,
          pt: totalPt,
          mlwfEmp: totalMlwfEmp,
          mlwfEmpr: totalMlwfEmpr,
          tds: totalTds,
          loanEmi: totalLoanEmi,
          bonusProvision: totalBonusProvision,
          gratuityProvision: totalGratuityProvision,
        },
        deptSplits: Object.values(deptMap),
      },
      caller,
    );

    await db.$executeRaw`
      UPDATE "payroll_runs"
      SET "status" = 'POSTED',
          "journal_id" = ${posted.id}::uuid,
          "updated_at" = now()
      WHERE "id" = ${runId}::uuid
    `;

    return {
      runId,
      status: 'POSTED',
      journalId: posted.id,
      journalCode: posted.code,
    };
  }
}
