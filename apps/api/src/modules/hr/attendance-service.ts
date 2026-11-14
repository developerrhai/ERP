// apps/api/src/modules/hr/attendance-service.ts
// Attendance management: Shifts, Rosters, Biometric file imports & automatic sync,
// Attendance day computation and period summarization.
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
import {
  computeAttendanceDay,
  computePeriodSummary,
  type ShiftConfig,
  type DayComputeResult,
} from './hr-calc';
import { smartOfficeAdapter } from './smart-office-adapter';

/** A TIME column comes back from Prisma as a Date (1970-01-01THH:MM:SSZ) or as text: both become HH:MM. */
function hhmm(v: unknown): string {
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  return String(v).slice(0, 5);
}

export class AttendanceService {
  async listShifts(): Promise<Row[]> {
    const rows = await query(prisma, `SELECT * FROM shifts WHERE active = true ORDER BY code`);
    return rows.map(norm);
  }

  /** Phase 37 C4: daily attendance of a month for the plants the caller chose (ScopeFilter.units), optionally one employee. */
  async listDays(caller: Caller, month: string, employeeId?: string): Promise<Row[]> {
    if (!/^\d{4}-\d{2}$/.test(month)) throw Errors.validation({ month: 'Use the month as yyyy-mm.' });
    const args: unknown[] = [`${month}-01`, caller.ctx.unitIds];
    let emp = '';
    if (employeeId) {
      args.push(employeeId);
      emp = `AND d.employee_id = $3::uuid`;
    }
    const rows = await query(
      prisma,
      `SELECT d.*, e.emp_code, trim(e.first_name || ' ' || coalesce(e.last_name, '')) AS employee_name, s.code AS shift_code
         FROM attendance_days d
         JOIN employees e ON e.id = d.employee_id
         JOIN LATERAL (SELECT a.unit_id FROM employee_assignments a WHERE a.employee_id = e.id
                        AND a.effective_from <= d.attendance_date AND (a.effective_to IS NULL OR a.effective_to >= d.attendance_date)
                        ORDER BY a.effective_from DESC LIMIT 1) asg ON asg.unit_id = ANY($2::uuid[])
         LEFT JOIN shifts s ON s.id = d.shift_id
        WHERE d.attendance_date >= $1::date AND d.attendance_date < ($1::date + INTERVAL '1 month')::date ${emp}
        ORDER BY d.attendance_date, e.emp_code
        LIMIT 5000`,
      ...args,
    );
    return rows.map(norm);
  }

  async getRosters(params: { from: string; to: string; unitId?: string }): Promise<Row[]> {
    const args: unknown[] = [params.from, params.to];
    let unitCond = '';
    if (params.unitId) {
      args.push(params.unitId);
      unitCond = `AND a.unit_id = $3::uuid`;
    }

    const sql = `
      SELECT r.id, r.employee_id, e.emp_code, e.first_name || ' ' || e.last_name AS employee_name,
             r.roster_date, r.shift_id, s.code AS shift_code, s.name AS shift_name, r.is_off
      FROM shift_rosters r
      JOIN employees e ON e.id = r.employee_id
      LEFT JOIN employee_assignments a ON a.employee_id = e.id AND (a.effective_to IS NULL OR a.effective_to >= r.roster_date)
      LEFT JOIN shifts s ON s.id = r.shift_id
      WHERE r.roster_date BETWEEN $1::date AND $2::date ${unitCond}
      ORDER BY r.roster_date, e.emp_code
    `;
    const rows = await query(prisma, sql, ...args);
    return rows.map(norm);
  }

  async bulkSaveRoster(
    caller: Caller,
    items: Array<{ employeeId: string; rosterDate: string; shiftId?: string | null; isOff?: boolean }>,
  ): Promise<{ saved: number }> {
    return await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const it of items) {
        await exec(
          tx,
          `INSERT INTO shift_rosters (employee_id, roster_date, shift_id, is_off, created_by_id)
           VALUES ($1::uuid, $2::date, $3::uuid, $4, $5::uuid)
           ON CONFLICT (employee_id, roster_date) DO UPDATE
           SET shift_id = EXCLUDED.shift_id, is_off = EXCLUDED.is_off`,
          it.employeeId,
          it.rosterDate,
          it.shiftId ?? null,
          it.isOff ?? false,
          caller.auth.userId,
        );
        count++;
      }
      return { saved: count };
    });
  }

  async listDevices(unitId?: string): Promise<Row[]> {
    const sql = unitId
      ? `SELECT * FROM attendance_devices WHERE unit_id = $1::uuid ORDER BY code`
      : `SELECT * FROM attendance_devices ORDER BY code`;
    const args = unitId ? [unitId] : [];
    const rows = await query(prisma, sql, ...args);
    return rows.map((r) => {
      const n = norm(r) as Record<string, unknown>;
      delete n.apiKeyRef;
      return n;
    });
  }

  async createDevice(caller: Caller, data: {
    code: string;
    name: string;
    vendor: string;
    unitId: string;
    location?: string;
    serialNo?: string;
    baseUrl?: string;
    apiKeyRef?: string;
    pollIntervalSec?: number;
    overlapMin?: number;
  }): Promise<Row> {
    const id = await insertRow(prisma, 'attendance_devices', {
      code: data.code,
      name: data.name,
      vendor: data.vendor,
      unitId: data.unitId,
      location: data.location ?? null,
      serialNo: data.serialNo ?? null,
      baseUrl: data.baseUrl ?? null,
      apiKeyRef: data.apiKeyRef ?? null,
      pollIntervalSec: data.pollIntervalSec ?? 60,
      overlapMin: data.overlapMin ?? 15,
      createdById: caller.auth.userId,
    });
    const row = (await query(prisma, `SELECT * FROM attendance_devices WHERE id = $1::uuid`, id))[0]!;
    return norm(row);
  }

  async syncDevice(deviceId: string, trigger: 'SCHEDULE' | 'MANUAL' | 'BACKFILL' = 'SCHEDULE', windowOverride?: { from: Date; to: Date }): Promise<Row> {
    const dev = (
      await query(prisma, `SELECT * FROM attendance_devices WHERE id = $1::uuid`, deviceId)
    )[0];
    if (!dev) throw Errors.notFound('Device not found.');

    const overlapMin = (dev.overlap_min as number) ?? 15;
    const now = new Date();

    let fromDate: Date;
    let toDate: Date;

    if (windowOverride) {
      fromDate = windowOverride.from;
      toDate = windowOverride.to;
    } else {
      const cursor = dev.cursor_at ? new Date(dev.cursor_at as string) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
      fromDate = new Date(cursor.getTime() - overlapMin * 60 * 1000);
      toDate = now;
    }

    const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

    const apiKey = process.env[String(dev.api_key_ref ?? 'SMART_OFFICE_API_KEY')] ?? 'dev-secret';
    const baseUrl = String(dev.base_url ?? 'https://api.smartoffice.test');

    const res = await smartOfficeAdapter.fetchLogs({
      baseUrl,
      apiKey,
      serialNo: dev.serial_no ? String(dev.serial_no) : null,
      fromDate: fmt(fromDate),
      toDate: fmt(toDate),
      timeoutMs: (dev.timeout_ms as number) ?? 10000,
    });

    if (!res.success) {
      const failCount = ((dev.consecutive_failures as number) ?? 0) + 1;
      await exec(
        prisma,
        `UPDATE attendance_devices
         SET consecutive_failures = $1, last_error = $2, updated_at = now()
         WHERE id = $3::uuid`,
        failCount,
        res.error ?? 'Connection failed',
        deviceId,
      );

      await insertRow(prisma, 'attendance_sync_runs', {
        deviceId,
        windowFrom: fromDate.toISOString(),
        windowTo: toDate.toISOString(),
        trigger,
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        unknownCodes: 0,
        status: 'FAILED',
        error: res.error ?? 'Connection failed',
      });

      return { success: false, error: res.error, failCount };
    }

    return await prisma.$transaction(async (tx) => {
      let inserted = 0;
      let duplicates = 0;
      let unknownCount = 0;
      let maxPunchTime = fromDate;

      const affectedMap = new Map<string, Set<string>>();

      for (const p of res.punches) {
        if (p.punchAt > maxPunchTime) {
          maxPunchTime = p.punchAt;
        }

        const emp = (
          await query(
            tx,
            `SELECT id FROM employees WHERE biometric_code = $1 AND status != 'SEPARATED' AND deleted_at IS NULL`,
            p.biometricCode,
          )
        )[0];

        const punchRows = await query(
          tx,
          `INSERT INTO attendance_punches (device_id, biometric_code, punch_at, direction, source)
           VALUES ($1::uuid, $2, $3::timestamptz, $4, 'API')
           ON CONFLICT (device_id, biometric_code, punch_at) DO NOTHING
           RETURNING id`,
          deviceId,
          p.biometricCode,
          p.punchAt.toISOString(),
          p.direction ?? null,
        );

        if (punchRows.length > 0) {
          inserted++;
          const punchId = punchRows[0]!.id as string;

          if (emp) {
            const empId = emp.id as string;
            const dateStr = p.punchAt.toISOString().slice(0, 10);
            if (!affectedMap.has(empId)) affectedMap.set(empId, new Set());
            affectedMap.get(empId)!.add(dateStr);
          } else {
            unknownCount++;
            await insertRow(tx, 'attendance_punch_exceptions', {
              punchId,
              deviceId,
              biometricCode: p.biometricCode,
              punchAt: p.punchAt.toISOString(),
            });
          }
        } else {
          duplicates++;
        }
      }

      await exec(
        tx,
        `UPDATE attendance_devices
         SET cursor_at = $1::timestamptz, last_ok_at = now(), consecutive_failures = 0, last_error = NULL, updated_at = now()
         WHERE id = $2::uuid`,
        maxPunchTime.toISOString(),
        deviceId,
      );

      const runId = await insertRow(tx, 'attendance_sync_runs', {
        deviceId,
        windowFrom: fromDate.toISOString(),
        windowTo: toDate.toISOString(),
        trigger,
        fetched: res.punches.length,
        inserted,
        duplicates,
        unknownCodes: unknownCount,
        status: 'OK',
      });

      for (const [empId, dates] of affectedMap.entries()) {
        for (const d of dates) {
          await this.recomputeDayInternal(tx, empId, d);
        }
      }

      return {
        success: true,
        runId,
        fetched: res.punches.length,
        inserted,
        duplicates,
        unknownCount,
      };
    });
  }

  async recomputeDayInternal(db: Db, employeeId: string, attendanceDate: string): Promise<void> {
    const dayRow = (
      await query(db, `SELECT locked FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = $2::date`, employeeId, attendanceDate)
    )[0];
    if (dayRow && dayRow.locked) {
      return;
    }

    const emp = (
      await query(db, `SELECT biometric_code FROM employees WHERE id = $1::uuid`, employeeId)
    )[0];
    if (!emp || !emp.biometric_code) return;

    const roster = (
      await query(
        db,
        `SELECT r.is_off, s.* FROM shift_rosters r
         JOIN shifts s ON s.id = r.shift_id
         WHERE r.employee_id = $1::uuid AND r.roster_date = $2::date`,
        employeeId,
        attendanceDate,
      )
    )[0];

    const defaultShift = (
      await query(db, `SELECT * FROM shifts WHERE code = 'GEN' LIMIT 1`)
    )[0];

    const shiftData = roster ?? defaultShift;
    if (!shiftData) return;

    const isWeeklyOff = roster ? !!roster.is_off : false;

    const punches = await query(
      db,
      `SELECT punch_at FROM attendance_punches
       WHERE biometric_code = $1
         AND punch_at >= ($2::date - INTERVAL '12 hours')
         AND punch_at <= ($2::date + INTERVAL '36 hours')
       ORDER BY punch_at ASC`,
      emp.biometric_code,
      attendanceDate,
    );

    const shiftConfig: ShiftConfig = {
      code: shiftData.code as string,
      startTime: hhmm(shiftData.start_time),
      endTime: hhmm(shiftData.end_time),
      breakMinutes: (shiftData.break_minutes as number) ?? 30,
      graceInMinutes: (shiftData.grace_in_minutes as number) ?? 10,
      graceOutMinutes: (shiftData.grace_out_minutes as number) ?? 0,
      halfDayMinutes: (shiftData.half_day_minutes as number) ?? 240,
      absentBelowMinutes: (shiftData.absent_below_minutes as number) ?? 240,
      fullDayMinutes: (shiftData.full_day_minutes as number) ?? 450,
      otBlockMinutes: (shiftData.ot_block_minutes as number) ?? 15,
      otMinMinutes: (shiftData.ot_min_minutes as number) ?? 30,
      isNight: !!shiftData.is_night,
      restAfterMinutes: 300,
      maxDailyMinutes: 540,
    };

    const res = computeAttendanceDay({
      date: attendanceDate,
      punches: punches.map((p) => ({ punchAt: p.punch_at as Date })),
      shift: shiftConfig,
      isWeeklyOff,
    });

    await exec(
      db,
      `INSERT INTO attendance_days (
         employee_id, attendance_date, shift_id, first_in, last_out,
         worked_minutes, late_minutes, early_minutes, ot_candidate_minutes,
         status, flags, updated_at
       ) VALUES ($1::uuid, $2::date, $3::uuid, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11::jsonb, now())
       ON CONFLICT (employee_id, attendance_date) DO UPDATE
       SET first_in = EXCLUDED.first_in,
           last_out = EXCLUDED.last_out,
           worked_minutes = EXCLUDED.worked_minutes,
           late_minutes = EXCLUDED.late_minutes,
           early_minutes = EXCLUDED.early_minutes,
           ot_candidate_minutes = EXCLUDED.ot_candidate_minutes,
           status = EXCLUDED.status,
           flags = EXCLUDED.flags,
           updated_at = now()
       WHERE NOT attendance_days.locked`,
      employeeId,
      attendanceDate,
      shiftData.id ?? null,
      res.firstIn,
      res.lastOut,
      res.workedMinutes,
      res.lateMinutes,
      res.earlyMinutes,
      res.otCandidateMinutes,
      res.status,
      JSON.stringify(res.flags),
    );
  }

  async summarizePeriod(caller: Caller, employeeId: string, fromDate: string, toDate: string): Promise<Row> {
    const days = await query(
      prisma,
      `SELECT * FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date BETWEEN $2::date AND $3::date ORDER BY attendance_date`,
      employeeId,
      fromDate,
      toDate,
    );

    const calcDays: DayComputeResult[] = days.map((d) => ({
      date: d.attendance_date as string,
      firstIn: d.first_in ? String(d.first_in) : null,
      lastOut: d.last_out ? String(d.last_out) : null,
      workedMinutes: (d.worked_minutes as number) ?? 0,
      lateMinutes: (d.late_minutes as number) ?? 0,
      earlyMinutes: (d.early_minutes as number) ?? 0,
      otCandidateMinutes: (d.ot_approved_minutes as number) || ((d.ot_candidate_minutes as number) ?? 0),
      status: d.status as any,
      flags: (d.flags as string[]) ?? [],
      isNightShift: false,
      punchesCount: d.first_in ? 2 : 0,
    }));

    const summary = computePeriodSummary({ days: calcDays });

    const id = await insertRow(prisma, 'attendance_period_summary', {
      employeeId,
      periodStart: fromDate,
      periodEnd: toDate,
      payableDays: summary.payableDays,
      presentDays: summary.presentDays,
      woDays: summary.weeklyOffDays,
      holidayDays: summary.holidayDays,
      paidLeaveDays: summary.paidLeaveDays,
      lopDays: summary.lopDays,
      otMinutes: summary.otMinutesTotal,
      nightShifts: summary.nightShiftCount,
      lateMarks: summary.lateMarksCount,
    });

    const row = (await query(prisma, `SELECT * FROM attendance_period_summary WHERE id = $1::uuid`, id))[0]!;
    return norm(row);
  }
}

export const attendanceService = new AttendanceService();
