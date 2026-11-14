// apps/api/src/modules/hr/leave-service.ts
// Leave management: Types, Policies, Append-only Ledger, Applications, Accruals.
import { prisma } from '../../core/db/prisma';
import type { Db } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import {
  exec,
  insertRow,
  norm,
  query,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { recordAudit } from '../../core/audit/audit-service';
import {
  computeLeaveDays,
} from './hr-calc';

/** A date column comes back from raw SQL as a Date (or a string): always yyyy-mm-dd. */
function isoDay(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

export class LeaveService {
  async listTypes(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM leave_types WHERE active = true ORDER BY code`);
    return rows.map(norm);
  }

  async getBalances(employeeId: string): Promise<Row[]> {
    const sql = `
      SELECT t.id AS leave_type_id, t.code, t.name, t.is_paid,
             COALESCE(SUM(l.days), 0)::numeric(7,2) AS balance
      FROM leave_types t
      LEFT JOIN leave_ledger l ON l.leave_type_id = t.id AND l.employee_id = $1::uuid
      WHERE t.active = true
      GROUP BY t.id, t.code, t.name, t.is_paid
      ORDER BY t.code
    `;
    const rows = await query(prisma, sql, employeeId);
    return rows.map(norm);
  }

  async getLedger(employeeId: string, leaveTypeId?: string): Promise<Row[]> {
    const args: unknown[] = [employeeId];
    let typeCond = '';
    if (leaveTypeId) {
      args.push(leaveTypeId);
      typeCond = `AND l.leave_type_id = $2::uuid`;
    }
    const sql = `
      SELECT l.*, t.code AS leave_type_code, t.name AS leave_type_name
      FROM leave_ledger l
      JOIN leave_types t ON t.id = l.leave_type_id
      WHERE l.employee_id = $1::uuid ${typeCond}
      ORDER BY l.txn_date DESC, l.created_at DESC
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }

  async apply(
    caller: Caller,
    input: {
      employeeId: string;
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      halfDayFirst?: boolean;
      halfDayLast?: boolean;
      reason: string;
      documentFileId?: string | null;
    },
  ): Promise<Row> {
    const type = (
      await query(prisma, `SELECT * FROM leave_types WHERE id = $1::uuid`, input.leaveTypeId)
    )[0];
    if (!type) throw Errors.notFound('Leave type not found.');

    const overlap = await query(
      prisma,
      `SELECT id FROM leave_applications
       WHERE employee_id = $1::uuid
         AND status IN ('PENDING_APPROVAL', 'APPROVED')
         AND start_date <= $3::date AND end_date >= $2::date`,
      input.employeeId,
      input.startDate,
      input.endDate,
    );
    if (overlap.length > 0) {
      throw Errors.conflict('You already have leave on these dates');
    }

    const spanRows = await query(
      prisma,
      `SELECT d::date AS date,
              EXISTS (SELECT 1 FROM employee_weekly_off w WHERE w.employee_id = $1::uuid) AS is_off
       FROM generate_series($2::date, $3::date, '1 day'::interval) d`,
      input.employeeId,
      input.startDate,
      input.endDate,
    );

    const spanDays = spanRows.map((r) => ({
      date: isoDay(r.date),
      isWeeklyOff: !!r.is_off,
    }));

    const calc = computeLeaveDays({
      spanDays,
      sandwichRuleActive: !!type.sandwich_rule,
      isHalfDayFirst: input.halfDayFirst,
      isHalfDayLast: input.halfDayLast,
    });

    const docRequiredAfter = (type.requires_doc_after_days as number) ?? 0;
    if (docRequiredAfter > 0 && calc.daysComputed > docRequiredAfter && !input.documentFileId) {
      throw Errors.validation({
        documentFileId: `Attach a medical certificate for more than ${docRequiredAfter} days`,
      });
    }

    if (type.code !== 'LOP') {
      const balanceRow = (
        await query(
          prisma,
          `SELECT COALESCE(SUM(days), 0)::numeric AS bal FROM leave_ledger
           WHERE employee_id = $1::uuid AND leave_type_id = $2::uuid`,
          input.employeeId,
          input.leaveTypeId,
        )
      )[0];
      const curBal = Number(balanceRow?.bal ?? 0);
      if (curBal < calc.daysComputed) {
        throw Errors.conflict(`You have ${curBal} days; this needs ${calc.daysComputed} days`);
      }
    }

    return await prisma.$transaction(async (tx) => {
      const id = await insertRow(tx, 'leave_applications', {
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        halfDayFirst: input.halfDayFirst ?? false,
        halfDayLast: input.halfDayLast ?? false,
        daysComputed: calc.daysComputed,
        reason: input.reason,
        documentFileId: input.documentFileId ?? null,
        status: 'PENDING_APPROVAL',
        createdById: caller.auth.userId,
      });

      await recordAudit({
        action: 'RECORD_CREATED',
        actorId: caller.auth.userId,
        targetType: 'LeaveApplication',
        targetId: id,
      }, tx);

      const row = (await query(tx, `SELECT * FROM leave_applications WHERE id = $1::uuid`, id))[0]!;
      return norm(row);
    });
  }

  async approve(caller: Caller, applicationId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const app = (
        await query(tx, `SELECT * FROM leave_applications WHERE id = $1::uuid FOR UPDATE`, applicationId)
      )[0];
      if (!app) throw Errors.notFound('Application not found.');
      if (app.status !== 'PENDING_APPROVAL') {
        throw Errors.conflict('Only pending applications can be approved.');
      }

      const balRow = (
        await query(
          tx,
          `SELECT COALESCE(SUM(days), 0)::numeric AS bal FROM leave_ledger
           WHERE employee_id = $1::uuid AND leave_type_id = $2::uuid`,
          app.employee_id,
          app.leave_type_id,
        )
      )[0];
      const currentBalance = Number(balRow?.bal ?? 0);
      const daysToDeduct = Number(app.days_computed);
      const balanceAfter = currentBalance - daysToDeduct;

      await insertRow(tx, 'leave_ledger', {
        employeeId: app.employee_id,
        leaveTypeId: app.leave_type_id,
        txnDate: isoDay(app.start_date),
        kind: 'AVAIL',
        days: -daysToDeduct,
        balanceAfter,
        referenceId: applicationId,
        referenceType: 'leave_applications',
        note: `Approved leave: ${app.reason}`,
        createdById: caller.auth.userId,
      });

      await exec(
        tx,
        `UPDATE leave_applications SET status = 'APPROVED', updated_at = now() WHERE id = $1::uuid`,
        applicationId,
      );

      await recordAudit({
        action: 'RECORD_STATUS_CHANGED',
        actorId: caller.auth.userId,
        targetType: 'LeaveApplication',
        targetId: applicationId,
        detail: { status: 'APPROVED' },
      }, tx);
    });
  }
}

export const leaveService = new LeaveService();
