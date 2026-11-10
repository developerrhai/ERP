// apps/api/src/modules/hr/ess-service.ts
// Employee Self Service: personal details, attendance, leave, expenses, requests, privacy notice.
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import {
  norm,
  query,
} from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';

export class EssService {
  async getEmployeeForUser(userId: string): Promise<Row> {
    const emp = (
      await query(
        prisma,
        `SELECT e.*, a.unit_id, u.name AS unit_name, a.department, a.designation_id, d.name AS designation_name
         FROM employees e
         LEFT JOIN employee_assignments a ON a.employee_id = e.id AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
         LEFT JOIN units u ON u.id = a.unit_id
         LEFT JOIN designations d ON d.id = a.designation_id
         WHERE e.user_id = $1::uuid AND e.status != 'SEPARATED' AND e.deleted_at IS NULL
         ORDER BY a.effective_from DESC LIMIT 1`,
        userId,
      )
    )[0];
    if (!emp) throw Errors.notFound('No employee profile linked to this user account.');
    return norm(emp);
  }

  async getMyProfile(caller: Caller): Promise<Row> {
    return await this.getEmployeeForUser(caller.auth.userId);
  }

  async getMyAttendance(caller: Caller, monthStr?: string): Promise<Row[]> {
    const emp = await this.getEmployeeForUser(caller.auth.userId);
    const targetMonth = monthStr ?? new Date().toISOString().slice(0, 7);
    const from = `${targetMonth}-01`;

    const rows = await query(
      prisma,
      `SELECT d.*, s.code AS shift_code, s.name AS shift_name
       FROM attendance_days d
       LEFT JOIN shifts s ON s.id = d.shift_id
       WHERE d.employee_id = $1::uuid
         AND d.attendance_date >= $2::date
         AND d.attendance_date < ($2::date + INTERVAL '1 month')::date
       ORDER BY d.attendance_date ASC`,
      emp.id,
      from,
    );
    return rows.map(norm);
  }

  async getMyLeave(caller: Caller): Promise<{ balances: Row[]; applications: Row[] }> {
    const emp = await this.getEmployeeForUser(caller.auth.userId);
    const balances = await query(
      prisma,
      `SELECT t.id AS leave_type_id, t.code, t.name, COALESCE(SUM(l.days), 0)::numeric AS balance
       FROM leave_types t
       LEFT JOIN leave_ledger l ON l.leave_type_id = t.id AND l.employee_id = $1::uuid
       WHERE t.active = true
       GROUP BY t.id, t.code, t.name
       ORDER BY t.code`,
      emp.id,
    );

    const apps = await query(
      prisma,
      `SELECT a.*, t.code AS leave_type_code, t.name AS leave_type_name
       FROM leave_applications a
       JOIN leave_types t ON t.id = a.leave_type_id
       WHERE a.employee_id = $1::uuid
       ORDER BY a.start_date DESC`,
      emp.id,
    );

    return {
      balances: balances.map(norm),
      applications: apps.map(norm),
    };
  }

  async getPrivacyNotice(userId: string): Promise<{ notice: Row; accepted: boolean }> {
    const notice = (
      await query(prisma, `SELECT * FROM privacy_notices ORDER BY effective_from DESC LIMIT 1`)
    )[0];
    if (!notice) throw Errors.notFound('No privacy notice published.');

    const accepted = (
      await query(
        prisma,
        `SELECT 1 FROM privacy_notice_acceptances WHERE notice_id = $1::uuid AND user_id = $2::uuid`,
        notice.id,
        userId,
      )
    ).length > 0;

    return { notice: norm(notice), accepted };
  }

  async acceptPrivacyNotice(caller: Caller, noticeId: string): Promise<void> {
    await query(
      prisma,
      `INSERT INTO privacy_notice_acceptances (notice_id, user_id, ip)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (notice_id, user_id) DO NOTHING`,
      noticeId,
      caller.auth.userId,
      caller.meta?.ip ?? null,
    );
  }
}

export const essService = new EssService();
