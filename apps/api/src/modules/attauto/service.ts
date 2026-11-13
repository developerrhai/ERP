// Phase 28: attendance automation. Punches arrive from devices (push or agent) with no manual upload, each affected day is
// recalculated at once, policies apply automatic actions WITH a reason (reversible by HR), alerts and reports go out by themselves,
// the month locks on the lock day, and a live board shows who is inside now. All of it is per plant (R-37).
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { recordAudit } from '../../core/audit/audit-service';
import { prisma } from '../../core/db/prisma';
import { Errors } from '../../core/http/errors';
import { logger } from '../../core/logger';
import { computePeriodSummary } from '../hr/hr-calc';
import type { DayComputeResult } from '../hr/hr-calc';
import { attendanceService } from '../hr/attendance-service';
import { deliver } from '../docsmail/automation';
import { notificationService } from '../notifications/service';
import { query } from '../procurement/core';
import type { Row } from '../procurement/core';
import type { Caller } from '../records/service';
import { deviceHealth, distanceM, insideSite, istParts, lateMarkTriggers, lockDue, monthRange, nextMonth, parsePushBody, previousMonth } from './calc';
import type { ParsedPunch } from './calc';

const S = (v: unknown): string => String(v ?? '');
const N = (v: unknown): number => Number(v ?? 0);
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type PolicyKey = 'LATE_MARK' | 'MISSED_PUNCH' | 'AUTO_ABSENT' | 'AUTO_LEAVE' | 'AUTO_OT' | 'AUTO_COMPOFF' | 'AUTO_SHIFT' | 'MOBILE_PUNCH' | 'BUDDY_ALERT' | 'AUTO_LOCK';

/** The policy in force for a plant: the plant's own row wins over the all-plants row. */
export async function policyOf(unitId: string | null, key: PolicyKey): Promise<{ enabled: boolean; params: Record<string, unknown> }> {
  const r = (await query(
    prisma,
    `SELECT enabled, params FROM attendance_policies WHERE policy_key = $1 AND category = 'ALL' AND effective_from <= CURRENT_DATE AND (unit_id = $2::uuid OR unit_id IS NULL)
      ORDER BY (unit_id IS NULL) ASC LIMIT 1`,
    key,
    unitId,
  ))[0];
  return { enabled: Boolean(r?.enabled), params: (r?.params as Record<string, unknown>) ?? {} };
}

async function employeePlant(db: Tx | typeof prisma, employeeId: string, onDate: string): Promise<{ unitId: string | null; department: string | null; managerUserId: string | null; userId: string | null }> {
  const r = (await query(
    db,
    `SELECT a.unit_id, a.department, m.user_id AS manager_user_id, e.user_id
       FROM employees e LEFT JOIN employee_assignments a ON a.employee_id = e.id AND a.effective_from <= $2::date AND (a.effective_to IS NULL OR a.effective_to >= $2::date)
       LEFT JOIN employees m ON m.id = a.reporting_manager_employee_id WHERE e.id = $1::uuid ORDER BY a.effective_from DESC NULLS LAST LIMIT 1`,
    employeeId,
    onDate,
  ))[0];
  return { unitId: r?.unit_id ? S(r.unit_id) : null, department: r?.department ? S(r.department) : null, managerUserId: r?.manager_user_id ? S(r.manager_user_id) : null, userId: r?.user_id ? S(r.user_id) : null };
}

async function hrUsers(unitId: string): Promise<string[]> {
  return (await query(
    prisma,
    `SELECT u.id::text AS id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'ACTIVE' AND (u.department = 'HR' OR r.level >= 90)
        AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $1::uuid) OR r.all_units OR u.all_units_access)`,
    unitId,
  )).map((r) => S(r.id));
}

export const attService = {
  // ------------------------------------------------------------------------------------------ ingestion
  /** Auth of a pushing device: the serial must be registered and active, else the caller gets 401 and HR an alert. */
  async deviceBySerial(serial: string): Promise<Row | null> {
    if (!serial) return null;
    return (await query(prisma, `SELECT * FROM attendance_devices WHERE serial_no = $1 AND active`, serial))[0] ?? null;
  },

  async touchDevice(dev: Row): Promise<void> {
    await query(prisma, `UPDATE attendance_devices SET last_seen_at = now(), status = 'ONLINE' WHERE id = $1::uuid`, dev.id);
  },

  async unknownDevice(serial: string): Promise<void> {
    const day = istParts(new Date()).date;
    await query(prisma, `INSERT INTO attendance_alerts (alert_date, kind, ref, detail) VALUES ($1::date, 'DEVICE_OFFLINE', $2, $3) ON CONFLICT DO NOTHING`, day, `unknown:${serial}`.slice(0, 80), `Device ${serial} is not registered.`);
  },

  /** Insert punches (duplicates ignored), recompute only the affected employee-days, update presence, run the day policies. */
  async ingest(opts: { device: Row; agentId?: string | null; punches: ParsedPunch[]; source: 'DEVICE' | 'API' }): Promise<{ received: number; inserted: number; duplicates: number; unknown: number }> {
    const dev = opts.device;
    const unitId = S(dev.unit_id);
    let inserted = 0;
    let duplicates = 0;
    let unknown = 0;
    const affected = new Map<string, Set<string>>();
    await prisma.$transaction(async (tx) => {
      for (const p of opts.punches) {
        const row = await query(
          tx,
          `INSERT INTO attendance_punches (device_id, biometric_code, punch_at, direction, source) VALUES ($1::uuid, $2, $3::timestamptz, $4, $5)
           ON CONFLICT (device_id, biometric_code, punch_at) DO NOTHING RETURNING id`,
          dev.id, p.code, p.at.toISOString(), p.direction, opts.source,
        );
        if (!row[0]) {
          duplicates += 1;
          continue;
        }
        inserted += 1;
        const emp = (await query(tx, `SELECT id FROM employees WHERE biometric_code = $1 AND status != 'SEPARATED' AND deleted_at IS NULL`, p.code))[0];
        if (!emp) {
          unknown += 1;
          await query(tx, `INSERT INTO attendance_punch_exceptions (punch_id, device_id, biometric_code, punch_at) VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz)`, row[0].id, dev.id, p.code, p.at.toISOString());
          continue;
        }
        const set = affected.get(S(emp.id)) ?? new Set<string>();
        set.add(istParts(p.at).date);
        affected.set(S(emp.id), set);
      }
      for (const [empId, dates] of affected) {
        for (const d of dates) await attendanceService.recomputeDayInternal(tx, empId, d);
      }
    });
    const last = opts.punches.reduce<Date | null>((m, p) => (!m || p.at > m ? p.at : m), null);
    await query(prisma, `UPDATE attendance_devices SET last_seen_at = now(), last_punch_at = COALESCE($2::timestamptz, last_punch_at), status = 'ONLINE', consecutive_failures = 0, last_error = NULL WHERE id = $1::uuid`, dev.id, last?.toISOString() ?? null);
    await query(prisma, `INSERT INTO device_sync_logs (device_id, agent_id, unit_id, received, inserted, duplicates, unknown_codes) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)`, dev.id, opts.agentId ?? null, unitId, opts.punches.length, inserted, duplicates, unknown);
    for (const [empId] of affected) await attService.updatePresence(unitId, empId);
    await attService.buddyCheck(unitId, S(dev.id), opts.punches);
    const today = istParts(new Date()).date;
    for (const [empId, dates] of affected) for (const d of dates) await attService.applyDayPolicies(empId, d, today).catch((e) => logger.warn({ err: e }, 'Attendance policies failed'));
    return { received: opts.punches.length, inserted, duplicates, unknown };
  },

  async ingestPush(device: Row, body: string): Promise<{ received: number; inserted: number; duplicates: number; unknown: number; bad: number }> {
    const tzOffset = 330;
    const { punches, bad } = parsePushBody(body, tzOffset);
    const r = await attService.ingest({ device, punches, source: 'DEVICE' });
    return { ...r, bad };
  },

  /** An agent posts a signed batch: header X-Agent-Id, X-Signature = hex HMAC-SHA256 of the raw body with sha256(agent key). */
  async verifyAgent(agentId: string, signature: string, rawBody: string): Promise<Row | null> {
    const a = (await query(prisma, `SELECT * FROM attendance_agents WHERE id::text = $1 AND status = 'ACTIVE'`, agentId))[0];
    if (!a) return null;
    const expect = createHmac('sha256', S(a.key_hash)).update(rawBody).digest('hex');
    const ok = signature.length === expect.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expect));
    if (!ok) return null;
    await query(prisma, `UPDATE attendance_agents SET last_seen_at = now() WHERE id = $1::uuid`, a.id);
    return a;
  },

  async ingestAgent(agent: Row, batch: { serial?: string; punches: { code: string; time: string; status?: string }[] }): Promise<Row> {
    const dev = (await query(prisma, `SELECT * FROM attendance_devices WHERE serial_no = $1 AND active AND unit_id = $2::uuid`, batch.serial ?? '', agent.unit_id))[0];
    if (!dev) throw Errors.validation({ serial: `Device ${batch.serial ?? ''} is not registered for this agent's plant.` });
    const lines = batch.punches.map((p) => `${p.code}\t${p.time}\t${p.status ?? ''}`).join('\n');
    const { punches, bad } = parsePushBody(lines);
    const r = await attService.ingest({ device: dev, agentId: S(agent.id), punches, source: 'API' });
    return { ...r, bad };
  },

  /** In or out right now: an odd number of punches today means inside. */
  async updatePresence(unitId: string, employeeId: string): Promise<void> {
    const today = istParts(new Date()).date;
    const r = (await query(
      prisma,
      `SELECT count(*)::int AS n, max(p.punch_at) AS last FROM attendance_punches p JOIN employees e ON e.biometric_code = p.biometric_code
        WHERE e.id = $1::uuid AND (p.punch_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
      employeeId,
      today,
    ))[0];
    if (!r || !r.last) return;
    const info = await employeePlant(prisma, employeeId, today);
    await query(
      prisma,
      `INSERT INTO live_presence (unit_id, employee_id, department, status, last_punch_at) VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz)
       ON CONFLICT (unit_id, employee_id) DO UPDATE SET status = EXCLUDED.status, last_punch_at = EXCLUDED.last_punch_at, department = EXCLUDED.department`,
      unitId, employeeId, info.department, N(r.n) % 2 === 1 ? 'INSIDE' : 'OUT', r.last,
    );
  },

  /** Two different codes on one device within a few seconds, repeatedly: an alert for HR (alert only, nothing changes). */
  async buddyCheck(unitId: string, deviceId: string, punches: ParsedPunch[]): Promise<void> {
    const pol = await policyOf(unitId, 'BUDDY_ALERT');
    if (!pol.enabled || punches.length < 2) return;
    const secs = N(pol.params.seconds) || 3;
    const times = N(pol.params.times) || 3;
    const sorted = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
    let hits = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.code !== sorted[i - 1]!.code && sorted[i]!.at.getTime() - sorted[i - 1]!.at.getTime() <= secs * 1000) hits += 1;
    }
    if (hits < times) return;
    const day = istParts(new Date()).date;
    const ins = await query(prisma, `INSERT INTO attendance_alerts (unit_id, alert_date, kind, ref, detail) VALUES ($1::uuid, $2::date, 'BUDDY', $3, $4) ON CONFLICT DO NOTHING RETURNING id`, unitId, day, deviceId, `Possible buddy punching: ${hits} pairs of different codes within ${secs} s.`);
    if (ins[0]) await prisma.$transaction(async (tx) => { const hr = await hrUsers(unitId); if (hr.length) await notificationService.notify(tx, hr, { type: 'attendance.device', title: 'Possible buddy punching', body: `${hits} pairs of punches within ${secs} seconds on one device.`, link: '/m/hr-attendance', entityType: 'attendance_alert', entityId: S(ins[0]!.id), dedupeKey: `buddy:${S(ins[0]!.id)}` }); });
  },

  // ------------------------------------------------------------------------------------------ policies on a day
  /** Applies the plant's policies to one employee-day. Every change is an auto action with a reason (once per day and policy). */
  async applyDayPolicies(employeeId: string, date: string, today: string): Promise<void> {
    const day = (await query(prisma, `SELECT * FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = $2::date`, employeeId, date))[0];
    if (!day || day.locked) return;
    const info = await employeePlant(prisma, employeeId, date);
    if (!info.unitId) return;
    const unitId = info.unitId;
    const record = async (policy: PolicyKey, action: string, before: unknown, after: unknown, reason: string): Promise<boolean> => {
      const r = await query(prisma, `INSERT INTO attendance_auto_actions (employee_id, unit_id, action_date, policy_key, action, before_json, after_json, reason) VALUES ($1::uuid,$2::uuid,$3::date,$4,$5,$6::jsonb,$7::jsonb,$8) ON CONFLICT DO NOTHING RETURNING id`, employeeId, unitId, date, policy, action, JSON.stringify(before), JSON.stringify(after), reason);
      return Boolean(r[0]);
    };
    const tell = async (userIds: (string | null)[], title: string, body: string, key: string) => {
      const ids = [...new Set(userIds.filter((x): x is string => Boolean(x)))];
      if (ids.length) await prisma.$transaction(async (tx) => notificationService.notify(tx, ids, { type: 'attendance.auto_action', title, body, link: '/m/hr-attendance', entityType: 'attendance_day', entityId: S(day.id), dedupeKey: key }));
    };

    // late marks: every Nth late day of the month costs a part of a day
    const late = await policyOf(unitId, 'LATE_MARK');
    if (late.enabled && N(day.late_minutes) > 0) {
      const ym = date.slice(0, 7);
      const { from, to } = monthRange(ym);
      const lateDays = (await query(prisma, `SELECT attendance_date::text AS d FROM attendance_days WHERE employee_id = $1::uuid AND late_minutes > 0 AND attendance_date BETWEEN $2::date AND $3::date AND attendance_date <= $4::date ORDER BY attendance_date`, employeeId, from, to, date)).map((r) => S(r.d));
      const every = N(late.params.lates) || 3;
      if (lateDays.includes(date) && lateMarkTriggers(lateDays.length, every)) {
        const deduct = N(late.params.deductDays) || 0.5;
        const names = lateDays.slice(-every).map((d) => Number(d.slice(8, 10))).join(', ');
        const reason = `${every === 3 ? '3rd' : `${every}th`} late mark in ${new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} (${names})`;
        if (await record('LATE_MARK', 'MARK_LOP', { autoLop: N(day.auto_lop) }, { autoLop: deduct }, reason)) {
          await query(prisma, `UPDATE attendance_days SET auto_lop = $2::numeric WHERE id = $1::uuid AND NOT locked`, day.id, deduct);
          await tell([info.userId, info.managerUserId], 'Late mark: −0.5 day', reason, `att:late:${S(day.id)}`);
        }
      }
    }

    // missed punch not regularised in D days: half day
    const mis = await policyOf(unitId, 'MISSED_PUNCH');
    if (mis.enabled && S(day.status) === 'MIS' && !day.regularized) {
      const days = N(mis.params.days) || 3;
      const age = (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000;
      if (age >= days) {
        if (await record('MISSED_PUNCH', 'MARK_HD', { status: 'MIS' }, { status: 'HD' }, `Missed punch not regularised in ${days} days`)) {
          await query(prisma, `UPDATE attendance_days SET status = 'HD', auto_hd = true WHERE id = $1::uuid AND NOT locked`, day.id);
          await tell([info.userId, info.managerUserId], 'Missed punch became a half day', `Your missed punch on ${date} was not regularised in ${days} days. HR can reverse this with a reason.`, `att:hd:${S(day.id)}`);
        }
      }
    }

    // provisional absence
    const ab = await policyOf(unitId, 'AUTO_ABSENT');
    if (ab.enabled && S(day.status) === 'A' && date < today) {
      await record('AUTO_ABSENT', 'MARK_A', { status: S(day.status) }, { status: 'A', provisional: true }, 'No punch and no leave: provisional absence (final at the muster lock)');
    }

    // overtime to approval
    const ot = await policyOf(unitId, 'AUTO_OT');
    if (ot.enabled && N(day.ot_candidate_minutes) > 0) {
      const exists = (await query(prisma, `SELECT 1 FROM ot_entries WHERE employee_id = $1::uuid AND date = $2::date`, employeeId, date))[0];
      if (!exists) {
        const hours = Math.round((N(day.ot_candidate_minutes) / 60) * 100) / 100;
        const ins = await query(prisma, `INSERT INTO ot_entries (employee_id, date, shift_id, eligible_hours, approved_hours, status) VALUES ($1::uuid,$2::date,$3::uuid,$4,0,'PENDING') RETURNING id`, employeeId, date, day.shift_id ?? null, hours);
        await record('AUTO_OT', 'CREATE_OT_REQ', null, { eligibleMinutes: day.ot_candidate_minutes }, `Overtime of ${N(day.ot_candidate_minutes)} minutes on ${date} sent for approval`);
        await tell([info.managerUserId], `Overtime to approve: ${N(day.ot_candidate_minutes)} min on ${date}`, 'An employee worked beyond the shift. Approve or reject in Attendance.', `att:ot:${S(ins[0]!.id)}`);
      }
    }
  },

  /** HR reverses an automatic change with a reason; the day returns to what it was. */
  async reverse(caller: Caller, id: string, reason: string): Promise<Row> {
    if (!reason || reason.trim().length < 5) throw Errors.validation({ reason: 'Reason required to reverse an automatic change.' });
    const a = (await query(prisma, `SELECT * FROM attendance_auto_actions WHERE id = $1::uuid`, id))[0];
    if (!a || (a.unit_id && !caller.ctx.unitIds.includes(S(a.unit_id)))) throw Errors.notFound('Automatic action not found.');
    if (a.reversed_at) throw Errors.conflict('This change was already reversed.');
    const day = (await query(prisma, `SELECT id, locked FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = $2::date`, a.employee_id, a.action_date))[0];
    if (day?.locked) throw Errors.conflict(`${S(a.action_date).slice(0, 7)} attendance is locked. Ask HR head to unlock with a reason.`);
    await prisma.$transaction(async (tx) => {
      if (day) {
        if (a.action === 'MARK_HD') await query(tx, `UPDATE attendance_days SET status = $2, auto_hd = false WHERE id = $1::uuid`, day.id, S((a.before_json as Record<string, unknown>)?.status ?? 'MIS'));
        if (a.action === 'MARK_LOP') await query(tx, `UPDATE attendance_days SET auto_lop = 0 WHERE id = $1::uuid`, day.id);
      }
      await query(tx, `UPDATE attendance_auto_actions SET reversed_by_id = $2::uuid, reversed_at = now(), reverse_reason = $3 WHERE id = $1::uuid`, id, caller.auth.user.id, reason.trim());
      await recordAudit({ action: 'attendance.auto_reversed', actorId: caller.auth.user.id, targetType: 'attendance_auto_action', targetId: id, detail: { action: S(a.action), reason: reason.trim() } }, tx);
    });
    return (await query(prisma, `SELECT * FROM attendance_auto_actions WHERE id = $1::uuid`, id))[0]!;
  },

  async autoActions(caller: Caller, f: { employee?: string; month?: string; policy?: string; unit?: string }): Promise<Row[]> {
    const range = f.month ? monthRange(f.month) : null;
    return query(
      prisma,
      `SELECT a.*, e.emp_code, trim(concat(e.first_name, ' ', e.last_name)) AS employee, u.code AS unit_code
         FROM attendance_auto_actions a JOIN employees e ON e.id = a.employee_id LEFT JOIN units u ON u.id = a.unit_id
        WHERE (a.unit_id IS NULL OR a.unit_id = ANY($1::uuid[])) AND ($2::uuid IS NULL OR a.employee_id = $2::uuid)
          AND ($3::date IS NULL OR a.action_date BETWEEN $3::date AND $4::date) AND ($5::text IS NULL OR a.policy_key = $5) AND ($6::uuid IS NULL OR a.unit_id = $6::uuid)
        ORDER BY a.created_at DESC LIMIT 300`,
      caller.ctx.unitIds, f.employee ?? null, range?.from ?? null, range?.to ?? null, f.policy ?? null, f.unit ?? null,
    );
  },

  // ------------------------------------------------------------------------------------------ nightly / scheduled
  /** Run for yesterday every morning: provisional absences, half days for old missed punches, OT requests (idempotent). */
  async runDaily(now: Date = new Date()): Promise<{ days: number }> {
    const today = istParts(now).date;
    const from = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const rows = await query(prisma, `SELECT employee_id::text AS employee_id, attendance_date::text AS d FROM attendance_days WHERE attendance_date BETWEEN $1::date AND $2::date AND NOT locked AND status IN ('MIS','A') OR (attendance_date = $2::date - 1 AND NOT locked)`, from, today);
    for (const r of rows) await attService.applyDayPolicies(S(r.employee_id), S(r.d), today).catch((e) => logger.warn({ err: e }, 'Daily policy failed'));
    return { days: rows.length };
  },

  /** Reminder for each missed punch of yesterday (once per employee-day): push / in-app to the employee and the manager. */
  async remindMissedPunches(now: Date = new Date()): Promise<number> {
    const yesterday = istParts(new Date(now.getTime() - 86_400_000)).date;
    const rows = await query(prisma, `SELECT d.employee_id::text AS employee_id, d.attendance_date::text AS d FROM attendance_days d WHERE d.attendance_date = $1::date AND d.status = 'MIS' AND NOT d.locked AND NOT d.regularized`, yesterday);
    let n = 0;
    for (const r of rows) {
      const info = await employeePlant(prisma, S(r.employee_id), yesterday);
      if (!info.unitId) continue;
      const ins = await query(prisma, `INSERT INTO attendance_alerts (employee_id, unit_id, alert_date, kind, ref, detail, status) VALUES ($1::uuid,$2::uuid,$3::date,'MISSED_PUNCH','', $4,'SENT') ON CONFLICT DO NOTHING RETURNING id`, r.employee_id, info.unitId, yesterday, `Missed out-punch on ${yesterday}. Regularise in ESS.`);
      if (!ins[0]) continue;
      n += 1;
      const ids = [info.userId, info.managerUserId].filter((x): x is string => Boolean(x));
      if (ids.length) await prisma.$transaction(async (tx) => notificationService.notify(tx, ids, { type: 'attendance.missed_punch', title: `Missed punch on ${yesterday}`, body: `Missed out-punch on ${yesterday}. Regularise in ESS.`, link: '/m/hr-ess', entityType: 'attendance_alert', entityId: S(ins[0]!.id), dedupeKey: `mis:${S(ins[0]!.id)}` }));
      const emails = (await query(prisma, `SELECT email FROM users WHERE id = ANY($1::uuid[]) AND email IS NOT NULL`, ids)).map((x) => S(x.email));
      await deliver({ code: 'missed_punch', unitId: info.unitId, runKey: `${S(r.employee_id)}:${yesterday}`, docNo: yesterday, to: emails, vars: { doc_no: yesterday, detail: `Missed out-punch on ${yesterday}. Regularise in ESS.`, date: yesterday } });
    }
    return n;
  },

  /** Device health: STALE after 30 minutes without data in shift hours, OFFLINE after 2 hours; HR is told once per change. */
  async deviceHealthCheck(now: Date = new Date()): Promise<{ stale: number; offline: number }> {
    const p = istParts(now);
    const inShift = p.hour >= 6 && p.hour < 23;
    const devs = await query(prisma, `SELECT * FROM attendance_devices WHERE active AND connection IN ('PUSH','AGENT')`);
    let stale = 0;
    let offline = 0;
    for (const d of devs) {
      const health = deviceHealth(d.last_seen_at ? new Date(S(d.last_seen_at)) : null, now, inShift);
      if (health === S(d.status)) continue;
      await query(prisma, `UPDATE attendance_devices SET status = $2 WHERE id = $1::uuid`, d.id, health);
      if (health === 'ONLINE') continue;
      health === 'STALE' ? (stale += 1) : (offline += 1);
      const kind = health === 'STALE' ? 'DEVICE_STALE' : 'DEVICE_OFFLINE';
      const ins = await query(prisma, `INSERT INTO attendance_alerts (unit_id, alert_date, kind, ref, detail) VALUES ($1::uuid,$2::date,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`, d.unit_id, p.date, kind, S(d.id), `${S(d.name)} has sent no data since ${d.last_seen_at ? S(d.last_seen_at) : 'ever'}.`);
      if (ins[0]) {
        const hr = await hrUsers(S(d.unit_id));
        if (hr.length) await prisma.$transaction(async (tx) => notificationService.notify(tx, hr, { type: 'attendance.device', title: `${S(d.name)} is ${health.toLowerCase()}`, body: `No punches received from ${S(d.name)}. Check the device and its network.`, link: '/m/hr-attendance-devices', entityType: 'attendance_device', entityId: S(d.id), dedupeKey: `dev:${S(d.id)}:${health}:${p.date}` }));
      }
    }
    return { stale, offline };
  },

  /** Lock a month for a plant: every day is calculated, the summary (with automatic late-mark deductions) is stored and the days are locked. */
  async lockMonth(unitId: string, ym: string, actorId: string | null): Promise<{ employees: number; lopDays: number }> {
    const { from, to } = monthRange(ym);
    const emps = await query(prisma, `SELECT DISTINCT d.employee_id::text AS id FROM attendance_days d JOIN employee_assignments a ON a.employee_id = d.employee_id AND a.unit_id = $1::uuid AND a.effective_from <= d.attendance_date AND (a.effective_to IS NULL OR a.effective_to >= d.attendance_date) WHERE d.attendance_date BETWEEN $2::date AND $3::date`, unitId, from, to);
    let lop = 0;
    for (const e of emps) {
      const days = await query(prisma, `SELECT * FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date BETWEEN $2::date AND $3::date ORDER BY attendance_date`, e.id, from, to);
      const calc: DayComputeResult[] = days.map((d) => ({
        date: S(d.attendance_date), firstIn: d.first_in ? S(d.first_in) : null, lastOut: d.last_out ? S(d.last_out) : null, workedMinutes: N(d.worked_minutes), lateMinutes: N(d.late_minutes), earlyMinutes: N(d.early_minutes),
        otCandidateMinutes: N(d.ot_approved_minutes) || N(d.ot_candidate_minutes), status: S(d.status) as DayComputeResult['status'], flags: [], isNightShift: false, punchesCount: d.first_in ? 2 : 0,
      }));
      const sum = computePeriodSummary({ days: calc });
      const autoLop = days.reduce((a, d) => a + N(d.auto_lop), 0);
      const lopDays = sum.lopDays + autoLop;
      lop += lopDays;
      await query(
        prisma,
        `INSERT INTO attendance_period_summary (employee_id, period_start, period_end, payable_days, present_days, wo_days, holiday_days, paid_leave_days, lop_days, ot_minutes, night_shifts, late_marks, locked, locked_at, locked_by_id)
         VALUES ($1::uuid,$2::date,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,now(),$13::uuid)
         ON CONFLICT (employee_id, period_start, period_end) DO UPDATE SET payable_days = EXCLUDED.payable_days, present_days = EXCLUDED.present_days, wo_days = EXCLUDED.wo_days, holiday_days = EXCLUDED.holiday_days,
           paid_leave_days = EXCLUDED.paid_leave_days, lop_days = EXCLUDED.lop_days, ot_minutes = EXCLUDED.ot_minutes, night_shifts = EXCLUDED.night_shifts, late_marks = EXCLUDED.late_marks, locked = true, locked_at = now(), locked_by_id = EXCLUDED.locked_by_id, updated_at = now()`,
        e.id, from, to, Math.max(0, sum.payableDays - autoLop), sum.presentDays, sum.weeklyOffDays, sum.holidayDays, sum.paidLeaveDays, lopDays, sum.otMinutesTotal, sum.nightShiftCount, sum.lateMarksCount, actorId,
      );
      await query(prisma, `UPDATE attendance_days SET locked = true WHERE employee_id = $1::uuid AND attendance_date BETWEEN $2::date AND $3::date`, e.id, from, to);
    }
    const hr = await hrUsers(unitId);
    if (hr.length) await prisma.$transaction(async (tx) => notificationService.notify(tx, hr, { type: 'attendance.locked', title: `${ym} attendance locked`, body: `${emps.length} employees, LOP ${Math.round(lop * 10) / 10} days.`, link: '/m/hr-attendance', entityType: 'attendance_lock', entityId: unitId, dedupeKey: `lock:${unitId}:${ym}` }));
    await recordAudit({ action: 'attendance.month_locked', actorId, targetType: 'unit', targetId: unitId, detail: { month: ym, employees: emps.length } });
    return { employees: emps.length, lopDays: Math.round(lop * 100) / 100 };
  },

  async unlockMonth(caller: Caller, unitId: string, ym: string, reason: string): Promise<{ days: number }> {
    if (!reason || reason.trim().length < 10) throw Errors.validation({ reason: 'Give a reason of at least 10 characters.' });
    if (!caller.ctx.unitIds.includes(unitId)) throw Errors.forbidden();
    const { from, to } = monthRange(ym);
    const r = await query(prisma, `UPDATE attendance_days d SET locked = false FROM employee_assignments a WHERE a.employee_id = d.employee_id AND a.unit_id = $1::uuid AND d.attendance_date BETWEEN $2::date AND $3::date AND d.locked RETURNING d.id`, unitId, from, to);
    await query(prisma, `UPDATE attendance_period_summary s SET locked = false FROM employee_assignments a WHERE a.employee_id = s.employee_id AND a.unit_id = $1::uuid AND s.period_start = $2::date AND s.period_end = $3::date`, unitId, from, to);
    await recordAudit({ action: 'attendance.month_unlocked', actorId: caller.auth.user.id, targetType: 'unit', targetId: unitId, detail: { month: ym, reason: reason.trim() } });
    return { days: r.length };
  },

  /** Job body (hourly): lock the previous month on the lock day at the lock hour, per plant, once. */
  async autoLock(now: Date = new Date()): Promise<{ locked: number }> {
    const ym = previousMonth(istParts(now).month);
    const units = await query(prisma, `SELECT id::text AS id FROM units WHERE active IS NOT FALSE`).catch(() => query(prisma, `SELECT id::text AS id FROM units`));
    let locked = 0;
    for (const u of units) {
      const pol = await policyOf(S(u.id), 'AUTO_LOCK');
      if (!pol.enabled || !lockDue(now, ym, N(pol.params.day) || 2, N(pol.params.hour) || 18)) continue;
      const open = await query(prisma, `SELECT 1 FROM attendance_days d JOIN employee_assignments a ON a.employee_id = d.employee_id AND a.unit_id = $1::uuid WHERE NOT d.locked AND d.attendance_date BETWEEN $2::date AND $3::date LIMIT 1`, u.id, monthRange(ym).from, monthRange(ym).to);
      if (!open[0]) continue;
      await attService.lockMonth(S(u.id), ym, null);
      locked += 1;
    }
    return { locked };
  },

  // ------------------------------------------------------------------------------------------ live board
  async live(caller: Caller, f: { unit?: string; dept?: string }): Promise<Row[]> {
    const units = f.unit ? [f.unit].filter((x) => caller.ctx.unitIds.includes(x)) : caller.ctx.unitIds;
    const today = istParts(new Date()).date;
    return query(
      prisma,
      `WITH exp AS (
         SELECT a.unit_id, coalesce(a.department, 'No department') AS department, count(*)::int AS expected
           FROM employees e JOIN employee_assignments a ON a.employee_id = e.id AND a.effective_from <= $2::date AND (a.effective_to IS NULL OR a.effective_to >= $2::date)
           LEFT JOIN attendance_days d ON d.employee_id = e.id AND d.attendance_date = $2::date
          WHERE e.status != 'SEPARATED' AND e.deleted_at IS NULL AND a.unit_id = ANY($1::uuid[]) AND coalesce(d.status, 'P') NOT IN ('WO','H','L','LHD')
            AND ($3::text IS NULL OR a.department = $3)
          GROUP BY 1, 2),
       ins AS (SELECT unit_id, coalesce(department, 'No department') AS department, count(*) FILTER (WHERE status = 'INSIDE')::int AS inside FROM live_presence WHERE unit_id = ANY($1::uuid[]) AND last_punch_at::date >= $2::date - 1 GROUP BY 1, 2)
       SELECT u.code AS unit_code, exp.unit_id, exp.department, exp.expected, coalesce(ins.inside, 0) AS inside,
              CASE WHEN exp.expected > 0 THEN round(100.0 * coalesce(ins.inside, 0) / exp.expected, 1) ELSE NULL END AS pct
         FROM exp JOIN units u ON u.id = exp.unit_id LEFT JOIN ins ON ins.unit_id = exp.unit_id AND ins.department = exp.department
        ORDER BY u.code, exp.department`,
      units, today, f.dept ?? null,
    );
  },

  // ------------------------------------------------------------------------------------------ admin: devices, agents, policies, sites
  async devices(caller: Caller): Promise<Row[]> {
    return query(
      prisma,
      `SELECT d.id, d.code, d.name, d.vendor, d.serial_no, d.connection, d.status, d.last_seen_at, d.last_punch_at, d.active, d.unit_id, u.code AS unit_code,
              (SELECT count(*)::int FROM attendance_punches p WHERE p.device_id = d.id AND (p.punch_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS today_punches,
              (SELECT count(*)::int FROM attendance_punch_exceptions x WHERE x.device_id = d.id AND x.resolved_at IS NULL) AS unknown_codes
         FROM attendance_devices d LEFT JOIN units u ON u.id = d.unit_id WHERE d.unit_id = ANY($1::uuid[]) ORDER BY u.code, d.name`,
      caller.ctx.unitIds,
    );
  },
  async registerDevice(caller: Caller, b: { code: string; name: string; unitId: string; connection: 'PUSH' | 'AGENT' | 'MANUAL'; serialNo?: string | null; vendor?: string | null }): Promise<Row> {
    if (!caller.ctx.unitIds.includes(b.unitId)) throw Errors.forbidden();
    if (b.connection !== 'MANUAL' && !b.serialNo?.trim()) throw Errors.validation({ serialNo: 'A push or agent device needs its serial number.' });
    const r = await query(
      prisma,
      `INSERT INTO attendance_devices (code, name, vendor, unit_id, serial_no, connection, created_by_id) VALUES ($1,$2,$3,$4::uuid,$5,$6,$7::uuid) RETURNING *`,
      b.code.trim(), b.name.trim(), b.vendor ?? 'FILE_ZKTECO', b.unitId, b.serialNo?.trim() || null, b.connection, caller.auth.user.id,
    ).catch((e: { message?: string; meta?: { code?: string } }) => {
      if (e.meta?.code === '23505' || /23505|duplicate key|unique/i.test(String(e.message))) throw Errors.conflict('A device with this serial number or code is already registered.');
      throw e;
    });
    await recordAudit({ action: 'attendance.device_registered', actorId: caller.auth.user.id, targetType: 'attendance_device', targetId: S(r[0]!.id), detail: { code: b.code, connection: b.connection } });
    return r[0]!;
  },
  /** The agent key is shown once; only its hash is stored. The agent signs with sha256(key). */
  async createAgent(caller: Caller, b: { unitId: string; name: string }): Promise<{ id: string; key: string }> {
    if (!caller.ctx.unitIds.includes(b.unitId)) throw Errors.forbidden();
    const key = randomBytes(24).toString('hex');
    const keyHash = createHash('sha256').update(key).digest('hex');
    const r = await query(prisma, `INSERT INTO attendance_agents (unit_id, name, key_hash, created_by_id) VALUES ($1::uuid,$2,$3,$4::uuid) RETURNING id`, b.unitId, b.name.trim(), keyHash, caller.auth.user.id);
    await recordAudit({ action: 'attendance.agent_created', actorId: caller.auth.user.id, targetType: 'attendance_agent', targetId: S(r[0]!.id), detail: { name: b.name } });
    return { id: S(r[0]!.id), key };
  },
  async agents(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT a.id, a.name, a.status, a.last_seen_at, a.version, u.code AS unit_code FROM attendance_agents a JOIN units u ON u.id = a.unit_id WHERE a.unit_id = ANY($1::uuid[]) ORDER BY a.created_at DESC`, caller.ctx.unitIds);
  },
  async syncLogs(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT l.*, d.name AS device FROM device_sync_logs l LEFT JOIN attendance_devices d ON d.id = l.device_id WHERE l.unit_id = ANY($1::uuid[]) ORDER BY l.at DESC LIMIT 100`, caller.ctx.unitIds);
  },

  async policies(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT p.*, u.code AS unit_code FROM attendance_policies p LEFT JOIN units u ON u.id = p.unit_id WHERE p.unit_id IS NULL OR p.unit_id = ANY($1::uuid[]) ORDER BY p.policy_key, (p.unit_id IS NOT NULL), u.code`, caller.ctx.unitIds);
  },
  async setPolicy(caller: Caller, b: { policyKey: PolicyKey; unitId?: string | null; enabled: boolean; params?: Record<string, unknown>; effectiveFrom?: string }): Promise<Row> {
    if (b.unitId && !caller.ctx.unitIds.includes(b.unitId)) throw Errors.forbidden();
    const r = await query(
      prisma,
      `INSERT INTO attendance_policies (unit_id, category, policy_key, enabled, params, effective_from, updated_by_id)
       VALUES ($1::uuid, 'ALL', $2, $3, coalesce($4::jsonb, '{}'::jsonb), COALESCE($5::date, CURRENT_DATE), $6::uuid)
       ON CONFLICT (coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), category, policy_key)
       DO UPDATE SET enabled = EXCLUDED.enabled, params = CASE WHEN $4::jsonb IS NULL THEN attendance_policies.params ELSE EXCLUDED.params END, effective_from = EXCLUDED.effective_from, updated_at = now(), updated_by_id = EXCLUDED.updated_by_id RETURNING *`,
      b.unitId ?? null, b.policyKey, b.enabled, b.params ? JSON.stringify(b.params) : null, b.effectiveFrom ?? null, caller.auth.user.id,
    );
    await recordAudit({ action: 'attendance.policy_changed', actorId: caller.auth.user.id, targetType: 'attendance_policy', targetId: S(r[0]!.id), detail: { key: b.policyKey, unit: b.unitId ?? 'all', enabled: b.enabled, params: (b.params ?? {}) as Record<string, string | number | boolean | null> } });
    return r[0]!;
  },

  async sites(caller: Caller): Promise<Row[]> {
    return query(prisma, `SELECT g.*, u.code AS unit_code FROM geo_sites g JOIN units u ON u.id = g.unit_id WHERE g.unit_id = ANY($1::uuid[]) ORDER BY u.code, g.name`, caller.ctx.unitIds);
  },
  async addSite(caller: Caller, b: { unitId: string; name: string; lat: number; lng: number; radiusM: number }): Promise<Row> {
    if (!caller.ctx.unitIds.includes(b.unitId)) throw Errors.forbidden();
    const r = await query(prisma, `INSERT INTO geo_sites (unit_id, name, lat, lng, radius_m) VALUES ($1::uuid,$2,$3,$4,$5) RETURNING *`, b.unitId, b.name.trim(), b.lat, b.lng, b.radiusM);
    await recordAudit({ action: 'attendance.site_added', actorId: caller.auth.user.id, targetType: 'geo_site', targetId: S(r[0]!.id), detail: { name: b.name } });
    return r[0]!;
  },

  // ------------------------------------------------------------------------------------------ mobile punch
  /** ESS punch: GPS accuracy must be good and the person must be inside a geo-site of their plant. */
  async mobilePunch(caller: Caller, b: { lat: number; lng: number; accuracy: number; deviceInfo?: string | null; now?: Date }): Promise<Row> {
    const emp = (await query(prisma, `SELECT e.id, e.biometric_code FROM employees e WHERE e.user_id = $1::uuid AND e.status != 'SEPARATED' AND e.deleted_at IS NULL`, caller.auth.user.id))[0];
    if (!emp) throw Errors.forbidden('Your login is not linked to an employee.');
    const when = b.now ?? new Date();
    const info = await employeePlant(prisma, S(emp.id), istParts(when).date);
    if (!info.unitId) throw Errors.validation({ site: 'You are not assigned to a plant.' });
    const pol = await policyOf(info.unitId, 'MOBILE_PUNCH');
    if (!pol.enabled) throw Errors.forbidden('Mobile punch is not switched on for your plant.');
    const maxAcc = N(pol.params.maxAccuracyM) || 100;
    if (b.accuracy > maxAcc) throw Errors.validation({ accuracy: `GPS is not accurate enough (${Math.round(b.accuracy)} m). Move to an open place and try again.` });
    const sites = await query(prisma, `SELECT * FROM geo_sites WHERE unit_id = $1::uuid AND active`, info.unitId);
    if (sites.length === 0) throw Errors.validation({ site: 'No punch site is set for your plant. Ask HR.' });
    let best: { site: Row; dist: number } | null = null;
    for (const s of sites) {
      const dist = distanceM(b.lat, b.lng, N(s.lat), N(s.lng));
      if (!best || dist < best.dist) best = { site: s, dist };
    }
    const inside = insideSite(best!.dist, N(best!.site.radius_m));
    await query(prisma, `INSERT INTO mobile_punches (employee_id, at, lat, lng, accuracy_m, site_id, inside, distance_m, device_info) VALUES ($1::uuid,$2::timestamptz,$3,$4,$5,$6::uuid,$7,$8,$9)`, emp.id, when.toISOString(), b.lat, b.lng, b.accuracy, best!.site.id, inside, best!.dist, b.deviceInfo ?? null);
    if (!inside) throw Errors.validation({ site: `You are ${Math.round(best!.dist)} m from ${S(best!.site.name)}. Punch from inside the site.` });
    if (!emp.biometric_code) throw Errors.validation({ site: 'Your employee record has no attendance code. Ask HR.' });
    // a virtual "mobile" device per plant carries the punch into the same pipeline
    let dev = (await query(prisma, `SELECT * FROM attendance_devices WHERE code = $1`, `MOBILE-${info.unitId.slice(0, 8)}`))[0];
    if (!dev) dev = (await query(prisma, `INSERT INTO attendance_devices (code, name, vendor, unit_id, connection, status) VALUES ($1,'Mobile punch','FILE_ZKTECO',$2::uuid,'MANUAL','ONLINE') RETURNING *`, `MOBILE-${info.unitId.slice(0, 8)}`, info.unitId))[0]!;
    const out = await attService.ingest({ device: dev, punches: [{ code: S(emp.biometric_code), at: when, status: '', direction: null }], source: 'API' });
    return { accepted: true, site: S(best!.site.name), distanceM: Math.round(best!.dist), ...out };
  },

  // ------------------------------------------------------------------------------------------ reports (mail automation #32)
  /** Yesterday per department of a plant: present / late / absent / missed punch / on leave. */
  async dailyDepartmentSummary(date: string): Promise<{ unitId: string; unitCode: string; department: string; present: number; late: number; absent: number; missed: number; onLeave: number }[]> {
    const rows = await query(
      prisma,
      `SELECT a.unit_id::text AS unit_id, u.code AS unit_code, coalesce(a.department, 'No department') AS department,
              count(*) FILTER (WHERE d.status IN ('P','HP','WOP','HD'))::int AS present, count(*) FILTER (WHERE d.late_minutes > 0)::int AS late,
              count(*) FILTER (WHERE d.status = 'A')::int AS absent, count(*) FILTER (WHERE d.status = 'MIS')::int AS missed, count(*) FILTER (WHERE d.status IN ('L','LHD'))::int AS on_leave
         FROM attendance_days d JOIN employee_assignments a ON a.employee_id = d.employee_id AND a.effective_from <= d.attendance_date AND (a.effective_to IS NULL OR a.effective_to >= d.attendance_date)
         JOIN units u ON u.id = a.unit_id WHERE d.attendance_date = $1::date GROUP BY 1, 2, 3 ORDER BY 2, 3`,
      date,
    );
    return rows.map((r) => ({ unitId: S(r.unit_id), unitCode: S(r.unit_code), department: S(r.department), present: N(r.present), late: N(r.late), absent: N(r.absent), missed: N(r.missed), onLeave: N(r.on_leave) }));
  },

  /** Automation #32 (from 10:30): per department manager, yesterday's counts. One email per plant, department and day. */
  async sendDailyReports(now: Date = new Date()): Promise<number> {
    const p = istParts(now);
    if (p.hour < 10 || (p.hour === 10 && p.minute < 30)) return 0;
    const date = istParts(new Date(now.getTime() - 86_400_000)).date;
    let sent = 0;
    for (const r of await attService.dailyDepartmentSummary(date)) {
      const mgr = await query(
        prisma,
        `SELECT u.email FROM users u JOIN roles ro ON ro.id = u.role_id WHERE u.status = 'ACTIVE' AND u.email IS NOT NULL AND u.department = $2 AND ro.level >= 60
            AND (EXISTS (SELECT 1 FROM user_units uu WHERE uu.user_id = u.id AND uu.unit_id = $1::uuid) OR ro.all_units OR u.all_units_access)`,
        r.unitId,
        r.department,
      );
      const detail = `${r.department} (${r.unitCode}) on ${date}: present ${r.present}, late ${r.late}, absent ${r.absent}, missed punch ${r.missed}, on leave ${r.onLeave}.`;
      const out = await deliver({ code: 'daily_attendance', unitId: r.unitId, runKey: `${r.unitId}:${r.department}:${date}`, docNo: `${r.department} ${date}`, to: mgr.map((m) => S(m.email)), vars: { doc_no: `${r.department} ${date}`, detail, date } });
      if (out === 'SENT') sent += 1;
    }
    return sent;
  },
};

export { nextMonth };
