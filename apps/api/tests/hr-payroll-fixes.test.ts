/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
// Seeding defects: payroll post, expense approval, project timesheets, attendance day window, shift times.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendanceService, shiftPunchWindow } from '../src/modules/hr/attendance-service';
import { API, XRW, makeUser, newApp, prisma, signInOwner, unitIds } from './helpers';

describe('HR / payroll / timesheet seeding defects', () => {
  const app = newApp();
  let token = '';
  let tal = '';
  const empIds: string[] = [];
  const cleanup: (() => Promise<unknown>)[] = [];
  const call = (method: 'get' | 'post' | 'patch', path: string) =>
    request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`).set('X-Unit-Id', tal).set(XRW);

  async function makeEmployee(tag: string, withRate = true, userId: string | null = null): Promise<string> {
    const id = randomUUID();
    const n = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    await prisma.$executeRawUnsafe(
      `INSERT INTO employees (id, emp_code, first_name, last_name, gender, dob, mobile, joining_date, status, biometric_code, user_id)
       VALUES ($1::uuid, $2, 'HPF', $2, 'M', '1990-01-01', $3, '2020-01-01', 'ACTIVE', $4, $5::uuid)`,
      id, `HPF-${tag}-${n}`, `9${n}1`, `HPF${tag}${n}`, userId,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO employee_assignments (employee_id, effective_from, unit_id, department) VALUES ($1::uuid, '2020-01-01', $2::uuid, 'Production')`,
      id, tal,
    );
    if (withRate) {
      const st = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM pay_structures LIMIT 1`))[0];
      if (st) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO employee_salary_assignments (employee_id, structure_id, monthly_ctc, effective_from, status) VALUES ($1::uuid, $2::uuid, 41600, '2020-01-01', 'ACTIVE')`,
          id, st.id,
        );
      }
    }
    empIds.push(id);
    return id;
  }

  beforeAll(async () => {
    token = (await signInOwner(app)).token;
    [tal = ''] = await unitIds(['TAL']);
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    const ids = empIds.length ? empIds : [randomUUID()];
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_days WHERE employee_id = ANY($1::uuid[])`, ids).catch(() => 0);
    await prisma.$executeRawUnsafe(`DELETE FROM attendance_punches WHERE biometric_code LIKE 'HPF%'`).catch(() => 0);
    await prisma.$executeRawUnsafe(`DELETE FROM shift_rosters WHERE employee_id = ANY($1::uuid[])`, ids).catch(() => 0);
  });

  // ------------------------------------------------------------------ 1. payroll post
  it('posts a locked payroll run to the GL (no 500)', async () => {
    const emp = await makeEmployee('PAY', false);
    const periodId = randomUUID();
    const runId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO payroll_periods (id, month, start_date, end_date, days_basis) VALUES ($1::uuid, '2026-10', '2026-10-01', '2026-10-31', 31) ON CONFLICT (month) DO NOTHING`,
      periodId,
    );
    const per = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM payroll_periods WHERE month = '2026-10'`))[0]!.id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO payroll_runs (id, run_no, period_id, unit_id, status, total_gross, total_net) VALUES ($1::uuid, $2, $3::uuid, $4::uuid, 'LOCKED', 50000, 44000)`,
      runId, `HPF-RUN-${runId.slice(0, 8)}`, per, tal,
    );
    const snap = {
      pf: { employeePF: 1800, employerTotal: 1800, edli: 75, pfAdmin: 75 },
      esic: { employeeESIC: 0, employerESIC: 0 },
      pt: 200,
      mlwf: { employeeMLWF: 10, employerMLWF: 20 },
      tds: { currentMonthTDS: 500 },
    };
    await prisma.$executeRawUnsafe(
      `INSERT INTO payroll_run_employees (run_id, employee_id, gross, net, snapshot) VALUES ($1::uuid, $2::uuid, 50000, 44000, $3::jsonb)`,
      runId, emp, JSON.stringify(snap),
    );
    cleanup.push(async () => {
      await prisma.$executeRawUnsafe(`UPDATE payroll_runs SET journal_id = NULL WHERE id = $1::uuid`, runId);
      await prisma.$executeRawUnsafe(`DELETE FROM payroll_runs WHERE id = $1::uuid`, runId);
    });
    const res = await call('post', `/payroll/runs/${runId}/post`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('POSTED');
    expect(res.body.journalId).toBeTruthy();
    const lines = await prisma.$queryRawUnsafe<{ code: string }[]>(
      `SELECT a.code FROM gl_entries g JOIN accounts a ON a.id = g.account_id WHERE g.journal_id = $1::uuid`,
      res.body.journalId,
    );
    expect(lines.length).toBeGreaterThan(2);
  });

  // ------------------------------------------------------------------ 2. expense claim approval
  it('every expense category points to an account that exists and can be posted to', async () => {
    const bad = await prisma.$queryRawUnsafe<{ name: string; gl_key: string }[]>(
      `SELECT c.name, c.gl_key FROM expense_categories c
        LEFT JOIN accounts a ON a.code = c.gl_key AND a.posting_allowed AND NOT a.is_group
       WHERE a.id IS NULL`,
    );
    expect(bad).toEqual([]);
  });

  it('approves an expense claim and posts a balanced journal (no 500)', async () => {
    const login = await makeUser({ role: 'EMPLOYEE' });
    const emp = await makeEmployee('EXP', false, login.id);
    const cats = await call('get', '/hr/expenses/categories');
    expect(cats.status).toBe(200);
    const claim = await call('post', '/hr/expenses/claims').send({
      employeeId: emp,
      unitId: tal,
      claimDate: '2026-10-10',
      title: 'HPF trip',
      lines: (cats.body.data as any[]).map((c) => ({
        categoryId: c.id,
        expenseDate: '2026-10-10',
        amount: 100,
        description: `line ${c.name}`,
        receiptDocumentId: null,
      })),
    });
    expect(claim.status, JSON.stringify(claim.body)).toBe(201);
    const id = claim.body.data.id;
    cleanup.push(async () => {
      await prisma.$executeRawUnsafe(`UPDATE hr_expense_claims SET journal_id = NULL WHERE id = $1::uuid`, id);
      await prisma.$executeRawUnsafe(`DELETE FROM hr_expense_claims WHERE id = $1::uuid`, id);
    });
    const sub = await call('post', `/hr/expenses/claims/${id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const ap = await call('post', `/hr/expenses/claims/${id}/approve`);
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const row = (await prisma.$queryRawUnsafe<{ status: string; journal_id: string }[]>(`SELECT status, journal_id FROM hr_expense_claims WHERE id = $1::uuid`, id))[0]!;
    expect(row.status).toBe('APPROVED');
    expect(row.journal_id).toBeTruthy();
  });

  it('an expense claim of an employee without a login is a clear 422, not a 500', async () => {
    const emp = await makeEmployee('EXN', false, null);
    const cats = await call('get', '/hr/expenses/categories');
    const claim = await call('post', '/hr/expenses/claims').send({
      employeeId: emp, unitId: tal, claimDate: '2026-10-10', title: 'HPF no login',
      lines: [{ categoryId: (cats.body.data as any[])[0].id, expenseDate: '2026-10-10', amount: 100, description: 'x' }],
    });
    const id = claim.body.data.id;
    cleanup.push(async () => prisma.$executeRawUnsafe(`DELETE FROM hr_expense_claims WHERE id = $1::uuid`, id));
    await call('post', `/hr/expenses/claims/${id}/submit`);
    const ap = await call('post', `/hr/expenses/claims/${id}/approve`);
    expect(ap.status, JSON.stringify(ap.body)).toBe(422);
    expect(JSON.stringify(ap.body)).toMatch(/no login linked/i);
  });

  // ------------------------------------------------------------------ 3 + 4. project timesheets
  it('creates, submits and approves a timesheet; a repeat create is a 409', async () => {
    const emp = await makeEmployee('TS', true);
    const p = await call('post', '/projects').send({ name: 'HPF ts project', start_date: '2026-01-01', end_date: '2027-12-31', contract_value: 100000, billing_type: 'TIME_MATERIAL' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const projectId = (p.body.data ?? p.body).id as string;
    await prisma.$executeRawUnsafe(
      `INSERT INTO project_team (project_id, employee_id, role, start_date, cost_rate) VALUES ($1::uuid, $2::uuid, 'ENGINEER', '2026-01-01', 250)`,
      projectId, emp,
    );
    cleanup.push(async () => {
      await prisma.$executeRawUnsafe(`UPDATE timesheets SET journal_id = NULL WHERE employee_id = $1::uuid`, emp);
      await prisma.$executeRawUnsafe(`DELETE FROM timesheets WHERE employee_id = $1::uuid`, emp);
      await prisma.$executeRawUnsafe(`DELETE FROM project_team WHERE project_id = $1::uuid`, projectId);
      await prisma.$executeRawUnsafe(`DELETE FROM projects WHERE id = $1::uuid`, projectId);
    });
    const body = {
      employeeId: emp,
      weekStartDate: '2026-10-05',
      lines: [{ workDate: '2026-10-05', projectId, hours: 8 }],
    };
    const c = await call('post', '/projects/timesheets').send(body);
    expect(c.status, JSON.stringify(c.body)).toBe(201);

    const dup = await call('post', '/projects/timesheets').send(body);
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(JSON.stringify(dup.body)).toMatch(/already/i);

    const sub = await call('post', `/projects/timesheets/${c.body.data.id}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.data.status).toBe('SUBMITTED');
    const ap = await call('post', `/projects/timesheets/${c.body.data.id}/approve`);
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(ap.body.data.status).toBe('APPROVED');
    const jr = (await prisma.$queryRawUnsafe<{ journal_id: string | null }[]>(`SELECT journal_id FROM timesheets WHERE id = $1::uuid`, c.body.data.id))[0]!;
    expect(jr.journal_id, 'the labour cost journal is posted').toBeTruthy();
    // the rate agreed on the project (250 an hour) is frozen on the line: 8 hours = 2000
    expect(Number(ap.body.data.lines[0].costAmount ?? ap.body.data.lines[0].cost_amount)).toBe(2000);
  });

  // ------------------------------------------------------------------ 5. attendance day window
  describe('attendance day uses the shift day in India time', () => {
    const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

    async function punches(code: string, list: Date[]) {
      for (const d of list) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO attendance_punches (device_id, biometric_code, punch_at, source) VALUES (NULL, $1, $2::timestamptz, 'MANUAL')`,
          code, d.toISOString(),
        );
      }
    }
    const dayOf = async (emp: string, date: string) =>
      (await prisma.$queryRawUnsafe<{ worked_minutes: number; ot_candidate_minutes: number; first_in: Date; last_out: Date }[]>(
        `SELECT worked_minutes, ot_candidate_minutes, first_in, last_out FROM attendance_days WHERE employee_id = $1::uuid AND attendance_date = $2::date`,
        emp, date,
      ))[0]!;

    it('day shift: punches of the neighbouring days are not swallowed', async () => {
      const emp = await makeEmployee('ATD', false);
      const code = (await prisma.$queryRawUnsafe<{ biometric_code: string }[]>(`SELECT biometric_code FROM employees WHERE id = $1::uuid`, emp))[0]!.biometric_code;
      await punches(code, [
        at('2027-03-09', '17:40'),
        at('2027-03-10', '09:05'),
        at('2027-03-10', '17:40'),
        at('2027-03-11', '09:05'),
      ]);
      await attendanceService.recomputeDayInternal(prisma, emp, '2027-03-10');
      const d = await dayOf(emp, '2027-03-10');
      // GEN 09:00-17:30 with a 30 minute break: 09:05 to 17:40 is 515 minutes span, 485 worked, 5 over the 480 net
      expect(d.worked_minutes).toBe(485);
      expect(d.ot_candidate_minutes).toBe(0);
      expect(d.first_in.toISOString()).toBe(at('2027-03-10', '09:05').toISOString());
      expect(d.last_out.toISOString()).toBe(at('2027-03-10', '17:40').toISOString());
    });

    it('night shift: the next morning belongs to the shift day', async () => {
      const emp = await makeEmployee('ATN', false);
      const code = (await prisma.$queryRawUnsafe<{ biometric_code: string }[]>(`SELECT biometric_code FROM employees WHERE id = $1::uuid`, emp))[0]!.biometric_code;
      const night = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM shifts WHERE code = 'NIGHT'`))[0]!.id;
      await prisma.$executeRawUnsafe(`INSERT INTO shift_rosters (employee_id, roster_date, shift_id, is_off) VALUES ($1::uuid, '2027-03-10', $2::uuid, false)`, emp, night);
      await punches(code, [
        at('2027-03-09', '22:55'), // the previous night's shift
        at('2027-03-10', '22:55'),
        at('2027-03-11', '07:35'),
        at('2027-03-11', '22:55'), // the next night's shift
      ]);
      await attendanceService.recomputeDayInternal(prisma, emp, '2027-03-10');
      const d = await dayOf(emp, '2027-03-10');
      expect(d.first_in.toISOString()).toBe(at('2027-03-10', '22:55').toISOString());
      expect(d.last_out.toISOString()).toBe(at('2027-03-11', '07:35').toISOString());
      expect(d.worked_minutes).toBe(520 - 30); // 8h40 span, 30 minute break
    });

    it('shiftPunchWindow is India time and never reaches the next day window', () => {
      const w = shiftPunchWindow('2027-03-10', { start: '23:00', end: '07:30' });
      expect(w.from.toISOString()).toBe(at('2027-03-10', '21:00').toISOString());
      expect(w.to.getTime()).toBeLessThan(at('2027-03-11', '21:00').getTime());
      expect(w.to.getTime()).toBeGreaterThan(at('2027-03-11', '07:30').getTime());
    });
  });

  // ------------------------------------------------------------------ 6. shifts
  it('GET /hr/shifts returns start and end as HH:MM', async () => {
    const res = await call('get', '/hr/shifts');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const gen = (res.body.data as any[]).find((s) => s.code === 'GEN');
    expect(gen.startTime).toBe('09:00');
    expect(gen.endTime).toBe('17:30');
    const night = (res.body.data as any[]).find((s) => s.code === 'NIGHT');
    expect(night.startTime).toBe('23:00');
    expect(night.endTime).toBe('07:30');
  });
});
