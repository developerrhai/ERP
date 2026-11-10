// apps/api/src/modules/hr/exit-service.ts
// Exit process, clearance tracking, and clean F&F handoff to Phase 16 Payroll.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { NumberingService } from '../../core/numbering';
import {
  exec,
  fyOfCaller,
  insertRow,
  norm,
  query,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { recordAudit } from '../../core/audit/audit-service';

export class ExitService {
  async listCases(caller: Caller): Promise<Row[]> {
    const rows = await query(
      prisma,
      `SELECT c.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name
       FROM exit_cases c
       JOIN employees e ON e.id = c.employee_id
       ORDER BY c.resignation_date DESC, c.created_at DESC`,
    );
    return rows.map(norm);
  }

  async getCase(id: string): Promise<Row> {
    const caseRow = (
      await query(
        prisma,
        `SELECT c.*, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name, e.joining_date
         FROM exit_cases c
         JOIN employees e ON e.id = c.employee_id
         WHERE c.id = $1::uuid`,
        id,
      )
    )[0];
    if (!caseRow) throw Errors.notFound('Exit case not found.');

    const tasks = await query(prisma, `SELECT * FROM exit_clearance_tasks WHERE case_id = $1::uuid ORDER BY department`, id);
    const interview = (await query(prisma, `SELECT * FROM exit_interviews WHERE case_id = $1::uuid`, id))[0];

    return {
      ...norm(caseRow),
      clearanceTasks: tasks.map(norm),
      exitInterview: interview ? norm(interview) : null,
    };
  }

  async createCase(
    caller: Caller,
    input: {
      employeeId: string;
      exitType?: string;
      resignationDate: string;
      reason: string;
    },
  ): Promise<Row> {
    const emp = (
      await query(prisma, `SELECT * FROM employees WHERE id = $1::uuid AND deleted_at IS NULL`, input.employeeId)
    )[0];
    if (!emp) throw Errors.notFound('Employee not found.');

    const noticeDays = (emp.notice_days as number) ?? 30;
    const resDate = new Date(input.resignationDate);
    const expectedLwd = new Date(resDate.getTime() + noticeDays * 24 * 60 * 60 * 1000);
    const expectedLwdStr = expectedLwd.toISOString().slice(0, 10);

    const fy = await fyOfCaller(caller);

    return await prisma.$transaction(async (tx) => {
      const caseNo = await NumberingService.allocate(tx, {
        pageId: 'hr-exit',
        unitId: caller.ctx.unitId || '',
        fyId: fy.id,
        prefix: 'EXIT',
      });

      const caseId = await insertRow(tx, 'exit_cases', {
        caseNo,
        employeeId: input.employeeId,
        exitType: input.exitType ?? 'RESIGNATION',
        resignationDate: input.resignationDate,
        noticeDays,
        expectedLwd: expectedLwdStr,
        approvedLwd: expectedLwdStr,
        reason: input.reason,
        status: 'DRAFT',
        createdById: caller.auth.userId,
      });

      const depts = [
        { dept: 'IT', task: 'Laptop, email access, cards surrendered' },
        { dept: 'Stores / Tool Room', task: 'Tools, uniform, safety kit returned' },
        { dept: 'Finance', task: 'Travel advances, loan balance cleared' },
        { dept: 'HR / Admin', task: 'ID card, biometric access revoked' },
      ];

      for (const d of depts) {
        await insertRow(tx, 'exit_clearance_tasks', {
          caseId,
          department: d.dept,
          taskName: d.task,
          status: 'PENDING',
        });
      }

      await recordAudit({
        action: 'RECORD_CREATED',
        actorId: caller.auth.userId,
        targetType: 'ExitCase',
        targetId: caseId,
        detail: { caseNo },
      }, tx);

      const caseRow = (await query(tx, `SELECT * FROM exit_cases WHERE id = $1::uuid`, caseId))[0]!;
      return norm(caseRow);
    });
  }

  async createHandoff(caller: Caller, exitCaseId: string): Promise<Row> {
    const caseRow = (
      await query(prisma, `SELECT * FROM exit_cases WHERE id = $1::uuid`, exitCaseId)
    )[0];
    if (!caseRow) throw Errors.notFound('Exit case not found.');

    const empId = caseRow.employee_id as string;
    const emp = (
      await query(prisma, `SELECT * FROM employees WHERE id = $1::uuid`, empId)
    )[0];
    if (!emp) throw Errors.notFound('Employee not found.');

    const joinDate = new Date(emp.joining_date as string);
    const lwd = new Date((caseRow.approved_lwd ?? caseRow.expected_lwd) as string);
    const serviceDays = Math.floor((lwd.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24));
    const gratuityEligible = serviceDays >= 1825;

    const elType = (await query(prisma, `SELECT id FROM leave_types WHERE code = 'EL'`))[0];
    let elDays = 0;
    if (elType) {
      const balRow = (
        await query(
          prisma,
          `SELECT COALESCE(SUM(days), 0)::numeric AS bal FROM leave_ledger
           WHERE employee_id = $1::uuid AND leave_type_id = $2::uuid`,
          empId,
          elType.id,
        )
      )[0];
      elDays = Math.max(0, Number(balRow?.bal ?? 0));
    }

    const advRow = (
      await query(
        prisma,
        `SELECT COALESCE(SUM(amount - settled_amount), 0)::numeric AS outstanding
         FROM employee_advances
         WHERE employee_id = $1::uuid AND status = 'PAID'`,
        empId,
      )
    )[0];
    const advancesOutstanding = Number(advRow?.outstanding ?? 0);

    const dueBy = new Date(lwd.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return await prisma.$transaction(async (tx) => {
      const handoffId = await insertRow(tx, 'fnf_handoffs', {
        exitCaseId,
        employeeId: empId,
        lwd: lwd.toISOString().slice(0, 10),
        paidDaysLastPeriod: 0,
        elEncashableDays: elDays,
        noticeShortfallDays: (caseRow.shortfall_days as number) ?? 0,
        gratuityEligible,
        advancesOutstanding,
        dueBy,
        status: 'READY',
        createdById: caller.auth.userId,
      });

      await exec(
        tx,
        `UPDATE exit_cases SET status = 'FNF', updated_at = now() WHERE id = $1::uuid`,
        exitCaseId,
      );

      await exec(
        tx,
        `UPDATE employees SET status = 'SEPARATED', lwd = $1::date, updated_at = now() WHERE id = $2::uuid`,
        lwd.toISOString().slice(0, 10),
        empId,
      );

      if (emp.user_id) {
        await exec(
          tx,
          `UPDATE users SET status = 'INACTIVE', updated_at = now() WHERE id = $1::uuid`,
          emp.user_id,
        );
      }

      await recordAudit({
        action: 'RECORD_STATUS_CHANGED',
        actorId: caller.auth.userId,
        targetType: 'FnfHandoff',
        targetId: handoffId,
      }, tx);

      const handoff = (await query(tx, `SELECT * FROM fnf_handoffs WHERE id = $1::uuid`, handoffId))[0]!;
      return norm(handoff);
    });
  }
}

export const exitService = new ExitService();
