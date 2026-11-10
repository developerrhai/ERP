// apps/api/src/modules/projects/timesheet-service.ts
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { norm, query, exec, insertRow } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { PostingService } from '../finance/posting-service';
import { NumberingService } from '../../core/numbering';

export class TimesheetService {
  async listTimesheets(
    caller: Caller,
    params: { employeeId?: string; status?: string; weekStart?: string },
  ): Promise<Row[]> {
    const conds: string[] = ['1=1'];
    const args: unknown[] = [];

    if (params.employeeId) {
      args.push(params.employeeId);
      conds.push(`t.employee_id = $${args.length}::uuid`);
    }
    if (params.status) {
      args.push(params.status);
      conds.push(`t.status = $${args.length}`);
    }
    if (params.weekStart) {
      args.push(params.weekStart);
      conds.push(`t.week_start_date = $${args.length}::date`);
    }

    const sql = `
      SELECT t.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name
      FROM timesheets t
      JOIN employees e ON e.id = t.employee_id
      WHERE ${conds.join(' AND ')}
      ORDER BY t.week_start_date DESC, t.created_at DESC
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }

  async getTimesheet(caller: Caller, id: string): Promise<Row> {
    const rows = await query(
      prisma,
      `SELECT t.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name
       FROM timesheets t
       JOIN employees e ON e.id = t.employee_id
       WHERE t.id = $1::uuid`,
      id,
    );
    if (!rows[0]) throw Errors.notFound(`Timesheet not found: ${id}`);
    const ts = norm(rows[0]);

    const lines = await query(
      prisma,
      `SELECT l.*, p.name AS project_name, p.project_no, k.name AS task_name
       FROM timesheet_lines l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN project_tasks k ON k.id = l.task_id
       WHERE l.timesheet_id = $1::uuid
       ORDER BY l.work_date ASC, l.created_at ASC`,
      id,
    );
    ts.lines = lines.map(norm);
    return ts;
  }

  async createTimesheet(
    caller: Caller,
    input: {
      employeeId: string;
      weekStartDate: string;
      lines: Array<{
        workDate: string;
        projectId: string;
        taskId?: string;
        hours: number;
        billableHours?: number;
        description?: string;
      }>;
    },
  ): Promise<Row> {
    // 1. Validate hours per day across lines <= 24 (TS_DAY_HRS)
    const hoursByDate = new Map<string, number>();
    for (const l of input.lines) {
      const prev = hoursByDate.get(l.workDate) ?? 0;
      const total = prev + l.hours;
      if (total > 24) {
        throw Errors.validation({
          hours: `TS_DAY_HRS: Hours on ${l.workDate} exceed 24.`,
        });
      }
      hoursByDate.set(l.workDate, total);
    }

    // 2. Validate project team membership (TS_NOT_MEMBER)
    for (const l of input.lines) {
      const pRows = await query(
        prisma,
        `SELECT project_no, status FROM projects WHERE id = $1::uuid`,
        l.projectId,
      );
      if (!pRows[0]) throw Errors.notFound(`Project not found: ${l.projectId}`);
      if (pRows[0].status === 'CLOSED') {
        throw Errors.conflict(`PRJ_CLOSED: Project ${pRows[0].project_no} is closed; reopen it to book cost.`);
      }

      const teamRows = await query(
        prisma,
        `SELECT id FROM project_team WHERE project_id = $1::uuid AND employee_id = $2::uuid`,
        l.projectId,
        input.employeeId,
      );
      if (teamRows.length === 0) {
        throw Errors.forbidden(`TS_NOT_MEMBER: You are not on project ${pRows[0].project_no} for that date.`);
      }
    }

    let totalHours = 0;
    let totalBillable = 0;
    for (const l of input.lines) {
      totalHours += l.hours;
      totalBillable += l.billableHours ?? l.hours;
    }

    const timesheetId = await insertRow(prisma, 'timesheets', {
      employee_id: input.employeeId,
      week_start_date: input.weekStartDate,
      total_hours: totalHours,
      total_billable_hours: totalBillable,
      status: 'DRAFT',
    });

    for (const l of input.lines) {
      await insertRow(prisma, 'timesheet_lines', {
        timesheet_id: timesheetId,
        work_date: l.workDate,
        project_id: l.projectId,
        task_id: l.taskId ?? null,
        hours: l.hours,
        billable_hours: l.billableHours ?? l.hours,
        description: l.description ?? null,
      });
    }

    return this.getTimesheet(caller, timesheetId);
  }

  async submitTimesheet(caller: Caller, id: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE timesheets SET status = 'SUBMITTED', updated_at = now() WHERE id = $1::uuid`,
      id,
    );
    return this.getTimesheet(caller, id);
  }

  async approveTimesheet(caller: Caller, id: string): Promise<Row> {
    const ts = await this.getTimesheet(caller, id);
    if (ts.status === 'APPROVED') return ts;

    // Fetch employee rate (TS_NO_RATE)
    const empRows = await query(
      prisma,
      `SELECT e.id, e.emp_code, e.unit_id, e.hourly_rate, pt.cost_rate AS team_rate
       FROM employees e
       LEFT JOIN project_team pt ON pt.employee_id = e.id
       WHERE e.id = $1::uuid
       LIMIT 1`,
      ts.employee_id,
    );
    const emp = empRows[0];
    const costRate = Number(emp?.hourly_rate ?? emp?.team_rate ?? 0);
    if (costRate <= 0) {
      throw Errors.conflict(`TS_NO_RATE: No cost rate for employee ${emp?.emp_code ?? ts.employee_id}; ask HR.`);
    }

    // Freeze rate on lines and compute total cost per project
    const projectTotals = new Map<string, number>();
    const lines = (ts.lines as Row[]) || [];
    for (const l of lines) {
      const lineCost = Math.round(Number(l.hours) * costRate * 100) / 100;
      await exec(
        prisma,
        `UPDATE timesheet_lines
         SET cost_rate = $1, cost_amount = $2
         WHERE id = $3::uuid`,
        costRate,
        lineCost,
        l.id,
      );
      const projId = String(l.project_id);
      const prev = projectTotals.get(projId) ?? 0;
      projectTotals.set(projId, prev + lineCost);
    }

    // Post to GL through PostingService
    // Dr Project Labour Cost 5112 (with project_id) / Cr Labour Cost Absorbed 5113
    const unitId = (emp?.unit_id as string) || caller.ctx.unitId || '';
    const docDate = String(ts.week_start_date);

    const glLines: any[] = [];
    let grandTotalCost = 0;

    for (const [projId, pCost] of projectTotals.entries()) {
      grandTotalCost += pCost;
      glLines.push({
        accountCode: '5112', // Project Labour Cost
        debit: pCost.toFixed(2),
        credit: '0.00',
        projectId: projId,
        narration: `Timesheet labour cost: ${String(ts.employee_name)} (${docDate})`,
      });
    }

    glLines.push({
      accountCode: '5113', // Labour Cost Absorbed
      debit: '0.00',
      credit: grandTotalCost.toFixed(2),
      narration: `Absorbed labour cost: ${String(ts.employee_name)} (${docDate})`,
    });

    let journalId: string | null = null;
    try {
      const posted = await PostingService.postJournal(
        prisma,
        {
          unitId,
          docDate,
          voucherType: 'Journal',
          source: 'EVENT',
          sourceDocType: 'TIMESHEET',
          sourceDocId: String(ts.id),
          sourceDocNo: `TS-${String(ts.employee_id).slice(0, 8)}-${docDate}`,
          narration: `Labour booking for week ${docDate} - ${String(ts.employee_name)}`,
          lines: glLines,
        },
        { userId: caller.auth.userId },
      );
      journalId = posted.id;
    } catch (err: any) {
      console.warn('Timesheet journal posting note:', err.message);
    }

    await exec(
      prisma,
      `UPDATE timesheets
       SET status = 'APPROVED',
           approved_by_id = $1::uuid,
           approved_at = now(),
           journal_id = $2::uuid,
           updated_at = now()
       WHERE id = $3::uuid`,
      caller.auth.userId,
      journalId,
      id,
    );

    return this.getTimesheet(caller, id);
  }

  async rejectTimesheet(caller: Caller, id: string, reason?: string): Promise<Row> {
    await exec(
      prisma,
      `UPDATE timesheets SET status = 'REJECTED', updated_at = now() WHERE id = $1::uuid`,
      id,
    );
    return this.getTimesheet(caller, id);
  }

  async getApprovalQueue(caller: Caller): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT t.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name
       FROM timesheets t
       JOIN employees e ON e.id = t.employee_id
       WHERE t.status = 'SUBMITTED'
       ORDER BY t.week_start_date ASC`,
    );
    return rows.map(norm);
  }
}

export const timesheetService = new TimesheetService();
